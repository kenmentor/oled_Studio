"""Synthesis provider interface.

The API layer only speaks this protocol. Engines (stub today, Qwen tomorrow)
implement it. Swapping engines never changes a route.
"""

from __future__ import annotations

from typing import Iterator, Protocol

from ..models import VoiceInfo


class SynthesisProvider(Protocol):
    name: str
    model_version: str
    sample_rate: int

    def voices(self) -> list[VoiceInfo]:
        """Voices this engine can render, in display order."""
        ...

    def synthesize_full(self, text: str, voice_id: str) -> bytes:
        """Render full utterance -> raw PCM16 mono bytes. Blocking: run in thread."""
        ...

    def synthesize_stream(self, text: str, voice_id: str) -> Iterator[bytes]:
        """Yield PCM16 mono frames progressively. Blocking generator: run in thread."""
        ...
