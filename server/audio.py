"""Audio framing. One place owns every byte layout clients depend on."""

from __future__ import annotations

import io
import struct
import wave

SAMPLE_RATE = 24000
CHANNELS = 1
SAMPLE_WIDTH = 2  # PCM16


def wav_header(sample_rate: int = SAMPLE_RATE, unknown_length: bool = False) -> bytes:
    """44-byte WAV header.

    unknown_length=True writes 0xFFFFFFFF lengths (streaming convention):
    players consume to EOF, so concatenated chunks form one playable WAV.
    """
    size = 0xFFFFFFFF if unknown_length else 0
    return struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        size,
        b"WAVE",
        b"fmt ",
        16,
        1,
        CHANNELS,
        sample_rate,
        sample_rate * CHANNELS * SAMPLE_WIDTH,
        CHANNELS * SAMPLE_WIDTH,
        16,
        b"data",
        size,
    )


def to_wav(pcm: bytes, sample_rate: int = SAMPLE_RATE) -> bytes:
    """Wrap raw PCM16 mono bytes in a WAV container with exact lengths."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(CHANNELS)
        w.setsampwidth(SAMPLE_WIDTH)
        w.setframerate(sample_rate)
        w.writeframes(pcm)
    return buf.getvalue()


def chunk_bytes(data: bytes, size: int):
    """Yield data in size-byte frames (last frame may be short)."""
    for i in range(0, len(data), size):
        yield data[i : i + size]
