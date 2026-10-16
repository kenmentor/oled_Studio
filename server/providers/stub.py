"""Stub provider: plays the voice's pre-recorded sample clip.

This is what lets the whole flow run end to end before the fine-tuned
model exists: real voice audio in, real playable WAV out, correct
contract throughout. Duration follows the text length (trim or loop the
clip); voices with no sample fall back to a test tone.
"""

from __future__ import annotations

import math
import struct
import wave
from pathlib import Path
from typing import Iterator

from ..audio import SAMPLE_RATE
from ..models import VoiceInfo


def _tone(seconds: float, freq: float = 440.0, sample_rate: int = SAMPLE_RATE) -> bytes:
    n = max(1, int(seconds * sample_rate))
    frames = bytearray()
    for i in range(n):
        sample = int(16000 * math.sin(2 * math.pi * freq * i / sample_rate))
        frames += struct.pack("<h", sample)
    return bytes(frames)


def _read_sample(path: Path) -> bytes | None:
    """Raw PCM16 mono bytes from a WAV file, resampled to 24 kHz if needed."""
    try:
        with wave.open(str(path), "rb") as w:
            if w.getnchannels() != 1 or w.getsampwidth() != 2:
                return None
            pcm = w.readframes(w.getnframes())
            if w.getframerate() == SAMPLE_RATE:
                return pcm
            # naive linear resample for odd source rates
            import array

            src = array.array("h", pcm)
            ratio = SAMPLE_RATE / w.getframerate()
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
    except Exception:
        return None


class StubProvider:
    name = "stub"
    model_version = "stub-0.1.0"
    sample_rate = SAMPLE_RATE

    def __init__(self, voice_ids: list[str] | None = None, sample_dir: str | Path = "") -> None:
        ids = voice_ids or ["ada"]
        self._voices = [
            VoiceInfo(id=v, label=v.capitalize(), accent="Nigerian", language="en",
                      sample_url=f"/samples/{v}.wav")
            for v in ids
        ]
        self._sample_dir = Path(sample_dir) if sample_dir else None
        self._cache: dict[str, bytes] = {}

    def voices(self) -> list[VoiceInfo]:
        return list(self._voices)

    def _seconds_for(self, text: str) -> float:
        # ~15 chars/sec of speech, clamped so contract tests stay fast.
        return min(30.0, max(0.5, len(text.strip()) / 15.0))

    def _sample(self, voice_id: str) -> bytes | None:
        if voice_id in self._cache:
            return self._cache[voice_id]
        if not self._sample_dir:
            return None
        pcm = _read_sample(self._sample_dir / f"{voice_id}.wav")
        if pcm:
            self._cache[voice_id] = pcm
        return pcm

    def _render(self, text: str, voice_id: str) -> bytes:
        sample = self._sample(voice_id)
        if not sample:
            return _tone(self._seconds_for(text), sample_rate=self.sample_rate)
        # Fit the clip to the text: trim long clips, loop short ones.
        want = int(self._seconds_for(text) * self.sample_rate) * 2
        if len(sample) >= want:
            return sample[:want]
        repeats = (want // len(sample)) + 1
        return (sample * repeats)[:want]

    def synthesize_full(self, text: str, voice_id: str) -> bytes:
        return self._render(text, voice_id)

    def synthesize_stream(self, text: str, voice_id: str) -> Iterator[bytes]:
        pcm = self._render(text, voice_id)
        # ~200ms frames: progressive enough for first-audio UX, few syscalls.
        frame = self.sample_rate * 2 // 5
        for i in range(0, len(pcm), frame):
            yield pcm[i : i + frame]
