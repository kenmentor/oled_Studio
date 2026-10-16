"""Piper stand-in provider: real neural TTS that mimics the production engine.

Why Piper: the Stub loops a fixed sample clip, so it can't tell us anything
about real spend/efficiency (latency vs text length, first-chunk time,
RTF, CPU/GPU seconds per char). Piper is a small ONNX neural TTS that runs
on CPU, streams per sentence, and has the same call shape as the future
Qwen checkpoint — so pipelines, billing, and load tests built against it
transfer 1:1 when we swap in the Modal GPU worker.

Swap path (no route changes):
  TTS_PROVIDER=stub   -> StubProvider (fixed clip, instant)
  TTS_PROVIDER=piper  -> PiperProvider (this file, real synthesis)
  TTS_PROVIDER=qwen   -> QwenProvider (Modal GPU checkpoint, real product)

Voice mapping: persona IDs (ada/tunde/musa/ngozi) map to Piper ONNX files
via PIPER_VOICE_MAP="ada:en_US-lessac-medium,tunde:en_GB-alan-medium".
Unmapped voices fall back to the default model. Missing files fall back
to a test tone (same as Stub) so CI never breaks without downloads.

Contract (same as SynthesisProvider):
  - voices() -> VoiceInfo list
  - synthesize_full(text, voice_id) -> PCM16 mono bytes at 24 kHz
  - synthesize_stream(text, voice_id) -> Iterator[PCM16 frames], first fast
"""

from __future__ import annotations

import array
import io
import wave
from pathlib import Path
from typing import Iterator

from ..audio import SAMPLE_RATE
from ..models import VoiceInfo
from .stub import _tone  # shared fallback tone, identical to StubProvider


DEFAULT_VOICES = [
    ("ada", "Ada", "Nigerian · Igbo"),
    ("tunde", "Tunde", "Nigerian · Yoruba"),
    ("musa", "Musa", "Nigerian · Hausa"),
    ("ngozi", "Ngozi", "Nigerian · Pidgin"),
]


def parse_voice_map(raw: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for part in (raw or "").split(","):
        part = part.strip()
        if not part or ":" not in part:
            continue
        k, v = part.split(":", 1)
        if k.strip() and v.strip():
            out[k.strip()] = v.strip()
    return out


def split_chunks(text: str, max_chars: int = 300) -> list[str]:
    """Split text into speakable pieces (~1-2 sentences each).

    Piper's own sentence splitter can't help when a pasted wall of text has
    no sentence breaks (one 2000-char "sentence" = one chunk = first audio
    only when the full render finishes). Packing sentences into bounded
    word-boundary pieces guarantees first audio after the first piece.
    """
    import re

    text = " ".join(text.split())
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]
    sentences = re.split(r"(?<=[.!?…\n])\s+", text)
    chunks: list[str] = []
    cur = ""

    def flush_part(part: str) -> None:
        nonlocal cur
        if cur and len(cur) + len(part) + 1 <= max_chars:
            cur = f"{cur} {part}"
        else:
            if cur:
                chunks.append(cur)
            cur = part

    for s in sentences:
        s = s.strip()
        if not s:
            continue
        if len(s) <= max_chars:
            flush_part(s)
            continue
        # Long sentence: split at word boundaries, hard-cut monster words.
        words = s.split(" ")
        part = ""
        for w in words:
            if part and len(part) + len(w) + 1 > max_chars:
                flush_part(part)
                part = w
            else:
                part = f"{part} {w}".strip() if part else w
            while len(part) > max_chars:
                if cur:
                    chunks.append(cur)
                    cur = ""
                chunks.append(part[:max_chars])
                part = part[max_chars:]
        if part:
            flush_part(part)
    if cur:
        chunks.append(cur)
    return chunks or [text]


def _resample_mono16(pcm: bytes, src_rate: int, dst_rate: int = SAMPLE_RATE) -> bytes:
    if src_rate == dst_rate or not pcm:
        return pcm
    src = array.array("h", pcm)
    ratio = dst_rate / src_rate
    n_out = int(len(src) * ratio)
    out = array.array("h", [0]) * n_out
    for i in range(n_out):
        pos = i / ratio
        i0 = int(pos)
        frac = pos - i0
        a = src[i0]
        b = src[min(i0 + 1, len(src) - 1)]
        out[i] = int(a + (b - a) * frac)
    return out.tobytes()


class PiperProvider:
    """Real ONNX synthesis with graceful fallback.

    load() mirrors Modal's @modal.enter(): call once per container/worker,
    never per request. synthesize_* raise ValueError on unknown/disabled
    voices only via the registry layer — here unknown voice = ValueError
    so misconfig fails loudly (same as QwenProvider).
    """

    name = "piper"
    model_version = "piper-standin-0.1.0"
    sample_rate = SAMPLE_RATE

    def __init__(
        self,
        voice_ids: list[str] | None = None,
        models_dir: str | Path = "server/static/piper",
        voice_map: dict[str, str] | None = None,
        use_cuda: bool = False,
    ) -> None:
        ids = voice_ids or [v[0] for v in DEFAULT_VOICES]
        labels = {v[0]: (v[1], v[2]) for v in DEFAULT_VOICES}
        self._voices = [
            VoiceInfo(
                id=v,
                label=labels.get(v, (v.capitalize(), "Nigerian"))[0],
                accent=labels.get(v, (v, "Nigerian"))[1],
                language="en",
                sample_url=f"/samples/{v}.wav",
            )
            for v in ids
        ]
        self._models_dir = Path(models_dir)
        self._voice_map = voice_map or {}
        self._use_cuda = use_cuda
        self._engines: dict[str, object] = {}
        self._native_rate: dict[str, int] = {}
        self._loaded = False
        self.last_synth_seconds: float = 0.0
        self.last_rtf: float = 0.0

    # -- lifecycle (mirrors @modal.enter) --
    def _stem_for(self, voice_id: str) -> str:
        return self._voice_map.get(voice_id) or self._voice_map.get("default") or voice_id

    def _fetch_missing(self, stems: list[str]) -> None:
        """Fetch missing stems from Hugging Face (no-op when disabled)."""
        try:
            from ..model_fetch import auto_download, ensure_models
        except Exception:
            return
        if not auto_download():
            return
        wanted = [s for s in dict.fromkeys(stems)
                  if not (self._models_dir / f"{s}.onnx").is_file()]
        if wanted:
            print(f"[models] fetching {len(wanted)} missing voice(s) from Hugging Face…")
            ensure_models(self._models_dir, wanted)

    def _load_one(self, voice_id: str) -> bool:
        """Load a single voice engine. False = missing/broken (tone fallback)."""
        if voice_id in self._engines:
            return True
        try:
            from piper import PiperVoice
        except Exception:
            return False
        stem = self._stem_for(voice_id)
        onnx = self._models_dir / f"{stem}.onnx"
        cfg = self._models_dir / f"{stem}.onnx.json"
        if not onnx.is_file():
            return False
        try:
            engine = PiperVoice.load(str(onnx), str(cfg) if cfg.is_file() else None)
            rate = int(getattr(getattr(engine, "config", None), "sample_rate", 22050))
        except Exception:
            return False
        self._engines[voice_id] = engine
        self._native_rate[voice_id] = rate
        return True

    def _ensure_engine(self, voice_id: str) -> bool:
        """Load-on-demand: fetch + load one voice on first use. This is what
        keeps small hosts alive — RAM grows per USED voice, not per mapped one."""
        if voice_id in self._engines:
            return True
        self._fetch_missing([self._stem_for(voice_id)])
        return self._load_one(voice_id)

    @staticmethod
    def _preload_enabled() -> bool:
        import os

        return os.getenv("PIPER_PRELOAD", "true").lower() in ("1", "true", "yes")

    def load(self) -> None:
        """Preload every mapped voice (boot warmup). Missing files are fetched
        from Hugging Face first (PIPER_AUTO_DOWNLOAD=false to disable);
        PIPER_PRELOAD=false skips this — voices then load on first use
        (slower first render, faster boot, less idle RAM: what Render wants).
        Whatever is still missing falls back to a test tone (never a crash)."""
        if self._loaded:
            return
        if self._preload_enabled():
            self._fetch_missing([self._stem_for(v.id) for v in self._voices])
            for v in self._voices:
                self._load_one(v.id)
        self._loaded = True

    @property
    def live_voices(self) -> list[str]:
        return list(self._engines.keys())

    def voices(self) -> list[VoiceInfo]:
        return list(self._voices)

    def _render_piper(self, text: str, voice_id: str) -> bytes:
        import time

        engine = self._engines[voice_id]
        t0 = time.perf_counter()
        chunks: list[bytes] = []
        native_rate = self._native_rate.get(voice_id, 22050)
        # piper-tts >=1.4: synthesize(text) yields AudioChunk per sentence.
        for chunk in engine.synthesize(text):  # type: ignore[attr-defined]
            data = getattr(chunk, "audio_int16_bytes", b"")
            if isinstance(data, (bytes, bytearray)):
                chunks.append(bytes(data))
            native_rate = int(getattr(chunk, "sample_rate", native_rate) or native_rate)
        raw = b"".join(chunks)
        # Older builds return full WAV per sentence; detect + strip.
        if raw[:4] == b"RIFF":
            try:
                with wave.open(io.BytesIO(raw), "rb") as w:
                    raw = w.readframes(w.getnframes())
            except Exception:
                pass
        pcm = _resample_mono16(raw, native_rate)
        dt = time.perf_counter() - t0
        audio_s = len(pcm) / 2 / self.sample_rate if pcm else 0
        self.last_synth_seconds = dt
        self.last_rtf = (dt / audio_s) if audio_s > 0 else 0.0
        return pcm

    def _seconds_for(self, text: str) -> float:
        return min(30.0, max(0.5, len(text.strip()) / 15.0))

    def synthesize_full(self, text: str, voice_id: str) -> bytes:
        self.load()
        if voice_id not in {v.id for v in self._voices}:
            raise ValueError(f"unknown voice: {voice_id}")
        if self._ensure_engine(voice_id):  # lazy: first use loads + fetches
            pcm = self._render_piper(text, voice_id)
            if pcm:
                return pcm
        # Fallback: deterministic tone so the pipeline never breaks.
        import time

        t0 = time.perf_counter()
        pcm = _tone(self._seconds_for(text), sample_rate=self.sample_rate)
        self.last_synth_seconds = time.perf_counter() - t0
        audio_s = len(pcm) / 2 / self.sample_rate
        self.last_rtf = (self.last_synth_seconds / audio_s) if audio_s else 0.0
        return pcm

    def synthesize_stream(self, text: str, voice_id: str) -> Iterator[bytes]:
        """Yield PCM piece-by-piece as Piper produces it — first audio after
        the first ~300-char piece, not after the full text. The text is split
        here (not left to Piper) so a wall of text with no sentence breaks
        still streams. Falls back to the deterministic tone (chunked) when no
        ONNX engine is loaded."""
        import time

        self.load()
        if voice_id not in {v.id for v in self._voices}:
            raise ValueError(f"unknown voice: {voice_id}")
        if self._ensure_engine(voice_id):  # lazy: first use loads + fetches
            t0 = time.perf_counter()
            total = 0
            try:
                engine = self._engines[voice_id]
                native_rate = self._native_rate.get(voice_id, 22050)
                for piece in split_chunks(text):
                    for chunk in engine.synthesize(piece):  # type: ignore[attr-defined]
                        data = getattr(chunk, "audio_int16_bytes", b"")
                        if not isinstance(data, (bytes, bytearray)) or not data:
                            continue
                        raw = bytes(data)
                        if raw[:4] == b"RIFF":
                            try:
                                with wave.open(io.BytesIO(raw), "rb") as w:
                                    raw = w.readframes(w.getnframes())
                            except Exception:
                                pass
                        rate = int(getattr(chunk, "sample_rate", native_rate) or native_rate)
                        pcm = _resample_mono16(raw, rate)
                        if not pcm:
                            continue
                        total += len(pcm)
                        yield pcm
                audio_s = total / 2 / self.sample_rate if total else 0
                dt = time.perf_counter() - t0
                self.last_synth_seconds = dt
                self.last_rtf = (dt / audio_s) if audio_s > 0 else 0.0
                return
            except Exception:
                # Engine failed mid-stream: fall through to tone only if
                # nothing was yielded yet (caller keeps partial audio).
                if total > 0:
                    return
        pcm = self.synthesize_full(text, voice_id)
        # ~200ms frames, same as Stub: first-audio UX without syscall spam.
        frame = self.sample_rate * 2 // 5
        for i in range(0, len(pcm), frame):
            yield pcm[i : i + frame]
