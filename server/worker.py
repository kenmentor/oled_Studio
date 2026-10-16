"""Modal-mimic worker: how Modal behaves, without the Modal bill.

Real Modal pattern (see server/modal_app.py):
  - @app.cls(gpu=...) + @modal.enter() loads the model ONCE per container.
  - @modal.method() serves one request; gateway calls it via .remote().
  - Autoscaler keeps min_containers warm, bursts to max_containers,
    scales to zero (next call pays a cold start), bills per container-second.
  - Weights come from a Volume, secrets from Secrets, timeouts kill runaways.

This class mirrors that interface 1:1 locally:
  - enter()        == @modal.enter()  (cold start, timed, counted)
  - synthesize_full/stream == @modal.method().remote()
  - get_stats()    == spend/efficiency ledger (gpu-seconds, RTF, $ est.)

Swap to real Modal = change TTS_WORKER_MODE to "modal-remote" (worker then
does modal.Cls.from_name(...).synthesize.remote(...)) with the SAME method
signatures. Routes never change; they only speak SynthesisProvider.

Cost model (public Modal GPU $/hr, approx, override via env):
  T4 ~0.60, L4 ~0.80, A10G ~1.10, L40S ~1.80, A100-40GB ~2.50,
  A100-80GB ~3.20, H100 ~4.50. CPU-test mode bills at 0.05/hr.
"""

from __future__ import annotations

import threading
import time
from typing import Iterator

GPU_USD_PER_HR: dict[str, float] = {
    "CPU-TEST": 0.05,
    "T4": 0.60,
    "L4": 0.80,
    "A10G": 1.10,
    "L40S": 1.80,
    "A100": 2.50,
    "A100-40GB": 2.50,
    "A100-80GB": 3.20,
    "H100": 4.50,
    "H200": 5.00,
}


class TTSWorker:
    """Wraps any SynthesisProvider with Modal-like ops semantics."""

    def __init__(
        self,
        provider,
        gpu: str = "L40S",
        mode: str = "local",
        min_containers: int = 1,
        max_containers: int = 20,
        cold_start_ms: int = 0,
        timeout_s: int = 120,
    ) -> None:
        self.provider = provider
        self.gpu = gpu
        self.mode = mode
        self.min_containers = min_containers
        self.max_containers = max_containers
        self.cold_start_ms = cold_start_ms
        self.timeout_s = timeout_s
        self._lock = threading.Lock()
        self._slots = threading.Semaphore(max(1, max_containers))
        self._entered = False
        self._cold_start_s: float = 0.0
        # ledger
        self.total_requests = 0
        self.total_chars = 0
        self.total_audio_s = 0.0
        self.total_gpu_s = 0.0
        self.cold_starts = 0
        self.timeouts = 0
        self.first_chunk_ms_sum = 0.0
        self.first_chunk_n = 0
        self.warm_containers = min_containers
        self._modal_cls = None

    # -- lifecycle: mirrors @modal.enter() --
    def enter(self) -> float:
        """Load the engine once. Returns cold-start seconds. Idempotent."""
        with self._lock:
            if self._entered:
                return 0.0
            t0 = time.perf_counter()
            if self.cold_start_ms > 0:
                time.sleep(self.cold_start_ms / 1000.0)
            load = getattr(self.provider, "load", None)
            if callable(load):
                try:
                    load()
                except Exception:
                    pass  # provider raises loudly on real use; boot stays warm
            if self.mode == "modal-remote":
                try:
                    import modal  # type: ignore

                    self._modal_cls = modal.Cls.from_name("oled-studio-tts", "TtsEngine")()
                except Exception:
                    self._modal_cls = None
            dt = time.perf_counter() - t0
            self._entered = True
            self._cold_start_s = dt
            self.cold_starts += 1
            return dt

    @property
    def live(self) -> bool:
        return self._entered

    # SynthesisProvider surface: routes speak this, so the worker IS the
    # provider. Swap = rewire which engine sits underneath, never the routes.
    @property
    def name(self) -> str:
        return getattr(self.provider, "name", "worker")

    @property
    def model_version(self) -> str:
        return getattr(self.provider, "model_version", "?")

    @property
    def sample_rate(self) -> int:
        return getattr(self.provider, "sample_rate", 24000)

    def voices(self):  # noqa: ANN202
        return self.provider.voices()

    def load(self) -> float:
        return self.enter()

    def _guard_timeout(self, dt: float) -> None:
        if dt > self.timeout_s:
            with self._lock:
                self.timeouts += 1
            raise TimeoutError(f"worker timeout after {dt:.1f}s (limit {self.timeout_s}s)")

    def _record(self, chars: int, audio_s: float, gpu_s: float, first_chunk_ms: float = 0.0) -> None:
        with self._lock:
            self.total_requests += 1
            self.total_chars += chars
            self.total_audio_s += audio_s
            self.total_gpu_s += gpu_s
            if first_chunk_ms:
                self.first_chunk_ms_sum += first_chunk_ms
                self.first_chunk_n += 1

    def _remote_full(self, text: str, voice_id: str) -> bytes:
        """Real Modal path: TtsEngine().synthesize_full.remote(...)."""
        assert self._modal_cls is not None, "modal-remote not connected"
        return self._modal_cls.synthesize_full.remote(text, voice_id)  # type: ignore

    # -- inference: mirrors @modal.method() --
    def synthesize_full(self, text: str, voice_id: str) -> bytes:
        self.enter()
        t0 = time.perf_counter()
        first_chunk_ms = 0.0
        with self._slots:
            wait_s = time.perf_counter() - t0
            s0 = time.perf_counter()
            if self.mode == "modal-remote" and self._modal_cls is not None:
                pcm = self._remote_full(text, voice_id)
            else:
                pcm = self.provider.synthesize_full(text, voice_id)
            dt = time.perf_counter() - s0
            self._guard_timeout(dt)
            first_chunk_ms = dt * 1000.0
        audio_s = len(pcm) / 2 / self.provider.sample_rate
        self._record(len(text), audio_s, dt + wait_s * 0.1, first_chunk_ms)
        return pcm

    def synthesize_stream(self, text: str, voice_id: str) -> Iterator[bytes]:
        self.enter()
        t0 = time.perf_counter()
        if self.mode == "modal-remote" and self._modal_cls is not None:
            try:
                gen = self._modal_cls.synthesize_stream.remote_gen(text, voice_id)  # type: ignore
                first = True
                total = b""
                for piece in gen:
                    if first:
                        self.first_chunk_ms_sum += (time.perf_counter() - t0) * 1000.0
                        self.first_chunk_n += 1
                        first = False
                    total += bytes(piece)
                    yield bytes(piece)
                audio_s = len(total) / 2 / self.provider.sample_rate
                self._record(len(text), audio_s, time.perf_counter() - t0)
                return
            except Exception:
                pass  # fall through to local engine
        gen = self.provider.synthesize_stream(text, voice_id)
        first = True
        total_len = 0
        for piece in gen:
            if first:
                fc = (time.perf_counter() - t0) * 1000.0
                with self._lock:
                    self.first_chunk_ms_sum += fc
                    self.first_chunk_n += 1
                first = False
            total_len += len(piece)
            yield piece
        dt = time.perf_counter() - t0
        self._guard_timeout(dt)
        audio_s = total_len / 2 / self.provider.sample_rate
        self._record(len(text), audio_s, dt)

    # -- ops surface --
    def cost_usd(self) -> float:
        rate = GPU_USD_PER_HR.get(self.gpu, 1.80)
        return round(self.total_gpu_s / 3600.0 * rate, 6)

    def get_stats(self) -> dict:
        with self._lock:
            n = self.first_chunk_n or 1
            rtf = (self.total_gpu_s / self.total_audio_s) if self.total_audio_s > 0 else 0.0
            return {
                "mode": self.mode,
                "engine": getattr(self.provider, "name", "?"),
                "model_version": getattr(self.provider, "model_version", "?"),
                "gpu": self.gpu,
                "gpu_usd_per_hr": GPU_USD_PER_HR.get(self.gpu, 1.80),
                "warm_containers": self.warm_containers,
                "min_containers": self.min_containers,
                "max_containers": self.max_containers,
                "cold_starts": self.cold_starts,
                "cold_start_s": round(self._cold_start_s, 3),
                "total_requests": self.total_requests,
                "total_chars": self.total_chars,
                "total_audio_s": round(self.total_audio_s, 2),
                "total_gpu_s": round(self.total_gpu_s, 3),
                "rtf_avg": round(rtf, 3),
                "first_chunk_ms_avg": round(self.first_chunk_ms_sum / n, 1),
                "timeouts": self.timeouts,
                "est_cost_usd": self.cost_usd(),
                "chars_per_dollar": round(self.total_chars / self.cost_usd(), 1) if self.cost_usd() else 0,
            }

    def reset_stats(self) -> None:
        with self._lock:
            self.total_requests = 0
            self.total_chars = 0
            self.total_audio_s = 0.0
            self.total_gpu_s = 0.0
            self.cold_starts = 0
            self.timeouts = 0
            self.first_chunk_ms_sum = 0.0
            self.first_chunk_n = 0
