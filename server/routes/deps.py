"""Route dependencies: provider and registry live on app.state."""

from __future__ import annotations

from fastapi import Request

from ..providers.base import SynthesisProvider
from ..state import VoiceRegistry


def get_provider(request: Request) -> SynthesisProvider:
    return request.app.state.provider


def get_registry(request: Request) -> VoiceRegistry:
    return request.app.state.registry
