"""Qwen provider seam. Implemented when the fine-tuned checkpoint lands.

Contract the real provider must honor (same as StubProvider):
  - voices() -> VoiceInfo list, one entry per Nigerian-accent persona
  - synthesize_full(text, voice_id) -> PCM16 mono bytes at self.sample_rate
  - synthesize_stream(text, voice_id) -> Iterator[PCM16 frames], first frame fast

Expected wiring (Modal GPU container):
  - checkpoint path from QWEN_CHECKPOINT (Modal Volume mount)
  - model loaded once in @modal.enter(), never per request
  - voice_id selects the persona checkpoint/adapter; unknown IDs raise ValueError
"""

from __future__ import annotations

from typing import Iterator

from ..models import VoiceInfo


class NotConfiguredError(RuntimeError):
    pass


class QwenProvider:
    name = "qwen"
    sample_rate = 24000

    def __init__(self, checkpoint: str = "", model_version: str = "qwen-ng-0.1.0") -> None:
        self.model_version = model_version
        self._checkpoint = checkpoint
        self._model = None

    def load(self) -> None:
        """Load the fine-tuned checkpoint. Called once per container."""
        if not self._checkpoint:
            raise NotConfiguredError("QWEN_CHECKPOINT is not set")
        # Real implementation: load Qwen3-TTS + adapter from self._checkpoint.
        # raise until the checkpoint exists so misconfig fails loudly.
        raise NotConfiguredError(f"checkpoint not implemented: {self._checkpoint}")

    def voices(self) -> list[VoiceInfo]:
        raise NotConfiguredError("Qwen voices come from the fine-tuned checkpoint")

    def synthesize_full(self, text: str, voice_id: str) -> bytes:
        raise NotConfiguredError("Qwen provider is not wired to a checkpoint yet")

    def synthesize_stream(self, text: str, voice_id: str) -> Iterator[bytes]:
        raise NotConfiguredError("Qwen provider is not wired to a checkpoint yet")
        yield b""  # keep this a generator for interface parity
