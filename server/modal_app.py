"""Modal deployment: CPU gateway + GPU synthesis pool.

Pattern (canonical Modal, researched Oct 2026):
  - @app.cls(gpu=...) + @modal.enter() loads weights ONCE per container.
  - @modal.method() serves one request; the gateway calls .remote().
  - Gateway is a cheap CPU @modal.asgi_app() serving the same FastAPI app;
    it never loads a model itself — TTS_PROVIDER=qwen makes the gateway's
    provider a thin remote handle to TtsEngine below.
  - Weights live on a Volume (/weights), secrets in Secrets, images pinned.
  - Autoscale: min_containers warm, max_containers burst, scale-to-zero
    (next call pays cold start), billed per container-second.

Local mirror: server/worker.py TTSWorker implements the SAME
enter()/synthesize_full()/synthesize_stream()/get_stats() surface against
Piper/Stub, so pipelines built locally transfer without route changes.

Deploy:
  modal deploy server/modal_app.py
  modal run server/modal_app.py::doctor   # GPU smoke test, no gateway touch

Swap:
  local test:  TTS_PROVIDER=piper TTS_WORKER_MODE=local
  production:  TTS_PROVIDER=qwen  TTS_WORKER_MODE=modal-remote (gateway calls
               TtsEngine below via modal.Cls.from_name)
"""

from __future__ import annotations

import os
from pathlib import Path

import modal

REPO = Path(__file__).resolve().parent.parent
APP_NAME = "oled-studio-tts"

MIN_CONTAINERS = int(os.getenv("OLED_MIN_WORKERS", "1"))
MAX_CONTAINERS = int(os.getenv("OLED_MAX_WORKERS", "20"))
GPU = os.getenv("OLED_GPU", "L40S")  # L40S default; A100-80GB / H100 for 1.7B

app = modal.App(APP_NAME)

weights = modal.Volume.from_name("oled-qwen-weights", create_if_missing=True)
VOLUMES = {"/weights": weights}

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("libsndfile1")
    .pip_install(
        "fastapi>=0.110.0",
        "uvicorn>=0.29.0",
        "pydantic>=2.0.0",
        "httpx>=0.27.0",
        "numpy>=1.24.0",
        "soundfile>=0.12.1",
    )
    .add_local_dir(REPO / "server", remote_path="/opt/oled/server")
)

gpu_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("libsndfile1")
    .pip_install(
        "numpy>=1.24.0",
        "soundfile>=0.12.1",
        "torch --index-url https://download.pytorch.org/whl/cu124",
        "transformers>=4.48.0",
        "accelerate>=1.2.0",
    )
    .add_local_dir(REPO / "server", remote_path="/opt/oled/server")
)

SECRETS = [modal.Secret.from_name("oled-secrets")]


@app.cls(
    image=gpu_image,
    secrets=SECRETS,
    volumes=VOLUMES,
    gpu=GPU,
    timeout=3600,
    min_containers=0,  # scale-to-zero: idle GPU costs nothing
    max_containers=MAX_CONTAINERS,
)
class TtsEngine:
    """GPU synthesis pool. Load once, serve many (mirrors TTSWorker)."""

    @modal.enter()
    def load(self):
        import sys

        sys.path.insert(0, "/opt/oled")
        from server.config import SETTINGS
        from server.providers.qwen import QwenProvider

        self.engine = QwenProvider(
            checkpoint="/weights/" + SETTINGS.model_version,
            model_version=SETTINGS.model_version,
        )
        self.engine.load()

    @modal.method()
    def synthesize_full(self, text: str, voice_id: str) -> bytes:
        return self.engine.synthesize_full(text, voice_id)

    @modal.method(is_generator=True)
    def synthesize_stream(self, text: str, voice_id: str):
        yield from self.engine.synthesize_stream(text, voice_id)

    @modal.method()
    def voices(self) -> list:
        return [v.model_dump() for v in self.engine.voices()]


@app.function(
    image=image,
    secrets=SECRETS,
    volumes=VOLUMES,
    timeout=600,
    min_containers=MIN_CONTAINERS,
    max_containers=MAX_CONTAINERS,
    cpu=2.0,
    memory=4096,
)
@modal.asgi_app()
def gateway():
    """Public API: cheap CPU gateway. GPU work goes to TtsEngine.remote()."""
    import sys

    sys.path.insert(0, "/opt/oled")
    from server.app import create_app  # noqa: E402

    # TTS_WORKER_MODE=modal-remote makes the worker call TtsEngine above.
    os.environ.setdefault("TTS_WORKER_MODE", "modal-remote")
    os.environ.setdefault("TTS_PROVIDER", "qwen")
    return create_app()


@app.function(image=image, secrets=SECRETS, volumes=VOLUMES, gpu=GPU, timeout=3600)
def synth_probe(text: str = "Good morning, Lagos.") -> dict:
    """Smoke-test the GPU image + checkpoint without touching the gateway."""
    e = TtsEngine()
    pcm: bytes = e.synthesize_full.remote(text, "ada")
    return {"bytes": len(pcm), "sample_rate": 24000}


@app.local_entrypoint()
def doctor() -> None:
    print(f"app={APP_NAME} workers={MIN_CONTAINERS}-{MAX_CONTAINERS} gpu={GPU}")
    print("gateway: modal deploy server/modal_app.py  (CPU, cheap, always warm)")
    print("engine:  TtsEngine Cls (GPU, scale-to-zero, billed per second)")
    print("smoke:   modal run server/modal_app.py::synth_probe")
