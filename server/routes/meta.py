"""Health + voices routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..models import HealthResponse, VoicesResponse, VoiceCreate, VoiceUpdate
from ..state import VoiceRegistry
from .deps import get_provider, get_registry
from .errors import api_error

router = APIRouter(tags=["meta"])


@router.get("/health", response_model=HealthResponse)
def health(provider=Depends(get_provider), registry: VoiceRegistry = Depends(get_registry)):
    return HealthResponse(
        ok=True,
        provider=provider.name,
        model_version=provider.model_version,
        sample_rate=provider.sample_rate,
        voices=len(registry.all()),
    )


@router.get("/v1/voices", response_model=VoicesResponse)
def list_voices(provider=Depends(get_provider), registry: VoiceRegistry = Depends(get_registry)):
    return VoicesResponse(voices=registry.all(), model_version=provider.model_version)


@router.patch("/v1/voices/{voice_id}")
def set_voice_enabled(voice_id: str, body: VoiceUpdate, registry=Depends(get_registry)):
    voice = registry.set_enabled(voice_id, body.enabled)
    if voice is None:
        raise api_error(404, "unknown_voice", f"no such voice: {voice_id}")
    return voice


@router.post("/v1/voices", status_code=201)
def add_voice(body: VoiceCreate, registry=Depends(get_registry)):
    from ..models import VoiceInfo

    if registry.get(body.id) is not None:
        raise api_error(409, "voice_exists", f"voice already exists: {body.id}")
    return registry.create(
        VoiceInfo(
            id=body.id,
            label=body.label,
            accent=body.accent,
            language=body.language,
            enabled=True,
        )
    )


@router.delete("/v1/voices/{voice_id}")
def remove_voice(voice_id: str, registry=Depends(get_registry)):
    if registry.delete(voice_id):
        return {"deleted": voice_id}
    raise api_error(404, "unknown_voice", f"no such voice: {voice_id}")
