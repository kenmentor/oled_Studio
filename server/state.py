"""Runtime state: provider plus the voice registry.

The registry is the API layer's view of "which voices exist and are on".
Engines advertise voices; this layer owns enable/disable. Persistence
(Postgres) comes with the auth/billing milestone — for now it is in-memory.
"""

from __future__ import annotations

import uuid

from .models import VoiceInfo
from .providers.base import SynthesisProvider


class VoiceRegistry:
    def __init__(self, provider: SynthesisProvider) -> None:
        self._provider = provider
        self._voices: dict[str, VoiceInfo] = {v.id: v for v in provider.voices()}

    def all(self) -> list[VoiceInfo]:
        return list(self._voices.values())

    def get(self, voice_id: str) -> VoiceInfo | None:
        return self._voices.get(voice_id)

    def default(self) -> VoiceInfo | None:
        for v in self._voices.values():
            if v.enabled:
                return v
        return next(iter(self._voices.values()), None)

    def set_enabled(self, voice_id: str, enabled: bool) -> VoiceInfo | None:
        v = self._voices.get(voice_id)
        if v is None:
            return None
        self._voices[voice_id] = v.model_copy(update={"enabled": enabled})
        return self._voices[voice_id]

    def create(self, voice: VoiceInfo) -> VoiceInfo | None:
        prev = self._voices.get(voice.id)
        if prev is not None:
            voice = voice.model_copy(update={"enabled": prev.enabled})
        self._voices[voice.id] = voice
        return voice

    def delete(self, voice_id: str) -> bool:
        return self._voices.pop(voice_id, None) is not None

    def resolve(self, voice_id: str | None) -> VoiceInfo | None:
        """Requested voice if enabled, else the default enabled voice."""
        if voice_id:
            v = self._voices.get(voice_id)
            if v is not None and v.enabled:
                return v
            return None
        return self.default()


def new_session_id() -> str:
    return f"s-{uuid.uuid4().hex[:12]}"


def new_request_id() -> str:
    return f"r-{uuid.uuid4().hex[:8]}"
