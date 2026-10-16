"""Backend configuration. Environment only — no secrets in code.

Env resolution order (first real env var wins, .env files never override):
  1. process environment ($env:FOO / export FOO)
  2. server/.env (per-service secrets — preferred location)
  3. repo-root .env (shared defaults)

Format: KEY=value, KEY = value, optional quotes. Lines starting with #
and blank lines are ignored. No dependency: stdlib parser, UTF-8 safe.
"""

from __future__ import annotations

import os
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key, val = key.strip(), val.strip()
        if not key or not key.replace("_", "").isalnum() or key in os.environ:
            continue
        if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
            val = val[1:-1]
        os.environ[key] = val


def _load_env_files() -> None:
    root = Path(__file__).resolve().parent.parent
    _load_dotenv(root / ".env")  # shared defaults first ...
    _load_dotenv(root / "server" / ".env")  # ... per-service secrets win


_load_env_files()


def _get(name: str, default: str) -> str:
    return os.getenv(name, default)


def _get_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


class Settings:
    """Everything the API layer needs to know, from the environment."""

    # Which synthesis provider to load: "stub" (local/test tone) or "qwen".
    provider: str = _get("TTS_PROVIDER", "stub")
    # Stable identifier clients pin to, e.g. "qwen-ng-0.1.0".
    model_version: str = _get("TTS_MODEL_VERSION", "stub-0.1.0")
    sample_rate: int = _get_int("TTS_SAMPLE_RATE", 24000)
    max_text_chars: int = _get_int("TTS_MAX_TEXT_CHARS", 2000)
    # Bytes per streamed audio frame over WS/SSE.
    stream_chunk_bytes: int = _get_int("TTS_STREAM_CHUNK_BYTES", 32768)
    # Qwen provider only: path to the fine-tuned checkpoint (Modal Volume mount).
    qwen_checkpoint: str = _get("QWEN_CHECKPOINT", "")
    # Comma-separated voice IDs the provider may serve, e.g. "ada,chiamaka,tunde".
    voices: str = _get("TTS_VOICES", "ada")

    # Piper stand-in (local neural TTS that mimics the real engine's
    # latency/shape before the Qwen checkpoint lands). Directory holding
    # "<voice>.onnx" + "<voice>.onnx.json" pairs; empty/missing = fallback.
    piper_models_dir: str = _get("PIPER_MODELS_DIR", "server/static/piper")
    # Per-voice model file override: "ada:en_US-lessac-medium,tunde:en_GB-alan-medium"
    piper_voice_map: str = _get("PIPER_VOICE_MAP", "")
    use_cuda: bool = _get("PIPER_USE_CUDA", "false").lower() == "true"

    # Modal-mimic worker (server/worker.py). Same knob names as modal_app.py
    # so local tests and Modal deploys read identically.
    worker_mode: str = _get("TTS_WORKER_MODE", "local")  # local | modal-remote
    worker_gpu: str = _get("OLED_GPU", "L40S")
    worker_min_containers: int = _get_int("OLED_MIN_WORKERS", 1)
    worker_max_containers: int = _get_int("OLED_MAX_WORKERS", 20)
    # Simulated cold-boot on first load, ms. Real Modal CPU->GPU boot is
    # ~0.5-3s; default 0 keeps unit tests fast, bench script sets e.g. 800.
    worker_cold_start_ms: int = _get_int("WORKER_COLD_START_MS", 0)
    worker_timeout_s: int = _get_int("WORKER_TIMEOUT_S", 120)


SETTINGS = Settings()
