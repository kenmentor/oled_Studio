"""Speech routes: full WAV render + SSE PCM stream.

Wire contract:
  POST /v1/speech        -> audio/wav, exact lengths. Landing + simple clients.
  POST /v1/speech/stream -> text/event-stream of started/chunk/done/error.
                           chunk.data is base64 PCM16 mono.
"""

from __future__ import annotations

import asyncio
import base64
import time

from fastapi import APIRouter, Depends, Request, Response

from ..audio import chunk_bytes, to_wav
from ..config import Settings
from ..models import ChunkEvent, DoneEvent, ErrorEvent, SpeakRequest, StartedEvent
from ..providers.base import SynthesisProvider
from ..state import VoiceRegistry, new_request_id, new_session_id
from ..users import PERSONA_ID
from .auth import key_from_request, require_key
from .deps import get_provider, get_registry
from .errors import api_error

router = APIRouter(tags=["speech"])


def _users(request):
    return request.app.state.users


def _keys(request):
    return request.app.state.keys


def _owner_for_http(request, verified) -> tuple[str, str | None, str]:
    """(user_id, key_id, key_name). Persona by default; key owner when known."""
    if verified is not None:
        return verified.owner_id or PERSONA_ID, verified.id, verified.name
    try:
        secret = key_from_request(request)
    except Exception:
        secret = None
    if secret:
        try:
            info = _keys(request).verify(secret)
        except Exception:
            info = None
        if info is not None:
            return info.owner_id or PERSONA_ID, info.id, info.name
    return PERSONA_ID, None, ""


def _settings() -> Settings:
    from ..config import SETTINGS

    return SETTINGS


def _resolve_voice(registry: VoiceRegistry, voice_id: str | None):
    voice = registry.resolve(voice_id)
    if voice is None:
        if voice_id and registry.get(voice_id) is not None:
            raise api_error(400, "voice_disabled", f"voice is disabled: {voice_id}")
        raise api_error(404, "unknown_voice", f"no such voice: {voice_id}")
    return voice


@router.post("/v1/speech")
@router.post("/v1/tts")  # legacy path used by the landing demo
async def speak(
    body: SpeakRequest,
    request: Request,
    provider: SynthesisProvider = Depends(get_provider),
    registry: VoiceRegistry = Depends(get_registry),
    _key=Depends(require_key),
):
    settings = _settings()
    text = body.text.strip()[: settings.max_text_chars]
    if not text:
        raise api_error(400, "bad_request", "text must not be empty")
    voice = _resolve_voice(registry, body.voice_id)
    session_id = body.session_id or new_session_id()
    request_id = new_request_id()

    users = request.app.state.users
    owner, kid, kname = _owner_for_http(request, _key)
    chars = len(text)
    users.ensure_persona()

    # ---- free preview lane: real audio, zero debit, cost-0 record ----
    if body.preview:
        from ..preview import check as preview_check
        from ..preview import client_ip as preview_ip
        from ..preview import consume as preview_consume
        from .auth import session_uid as _suid

        pip = preview_ip(request)
        preview_check(pip, chars)  # 400 too long / 429 spent / 403 off
        preview_consume(pip, chars)
        viewer = _suid(request) or PERSONA_ID  # attribution only, never debited
        t0 = time.perf_counter()
        try:
            pcm = await asyncio.to_thread(provider.synthesize_full, text, voice.id)
        except Exception as e:  # noqa: BLE001
            raise api_error(500, "synthesis_failed", str(e) or "synthesis failed")
        synth_time = time.perf_counter() - t0
        audio_seconds = round(len(pcm) / 2 / provider.sample_rate, 2)
        users.record(user_id=viewer, key_id=None, key_name="preview", voice=voice.id,
                     chars=chars, text=text, audio_seconds=audio_seconds,
                     latency_ms=int(synth_time * 1000), mode="preview",
                     status="done", cost_chars=0, balance_after=users.balance(viewer))
        return Response(
            content=to_wav(pcm, provider.sample_rate),
            media_type="audio/wav",
            headers={
                "X-Request-ID": request_id,
                "X-Session-ID": session_id,
                "X-Voice-ID": voice.id,
                "X-Model-Version": provider.model_version,
                "X-Synth-Time": f"{synth_time:.2f}",
                "X-Balance-Chars": str(users.balance(viewer)),  # untouched
                "X-Preview": "true",
            },
        )

    if users.debit(owner, chars) is None:
        users.record(user_id=owner, key_id=kid, key_name=kname, voice=voice.id,
                     chars=chars, text=text, mode="batch", status="error", cost_chars=0,
                     balance_after=users.balance(owner))
        raise api_error(402, "insufficient_credits",
                        f"need {chars} chars, balance {users.balance(owner)} — top up at /v1/billing/topup")

    t0 = time.perf_counter()
    try:
        pcm = await asyncio.to_thread(provider.synthesize_full, text, voice.id)
    except Exception as e:  # noqa: BLE001 - provider failures become 500s
        users.credit(owner, chars)  # refund the reservation
        raise api_error(500, "synthesis_failed", str(e) or "synthesis failed")
    synth_time = time.perf_counter() - t0

    audio_seconds = round(len(pcm) / 2 / provider.sample_rate, 2)
    after = users.balance(owner)
    users.record(user_id=owner, key_id=kid, key_name=kname, voice=voice.id,
                 chars=chars, text=text, audio_seconds=audio_seconds,
                 latency_ms=int(synth_time * 1000), mode="batch",
                 status="done", cost_chars=chars, balance_after=after)
    headers = {
        "X-Request-ID": request_id,
        "X-Session-ID": session_id,
        "X-Voice-ID": voice.id,
        "X-Model-Version": provider.model_version,
        "X-Synth-Time": f"{synth_time:.2f}",
        "X-Balance-Chars": str(after),
    }

    return Response(
        content=to_wav(pcm, provider.sample_rate),
        media_type="audio/wav",
        headers=headers,
    )


@router.post("/v1/speech/stream")
async def speak_stream(
    body: SpeakRequest,
    request: Request,
    provider: SynthesisProvider = Depends(get_provider),
    registry: VoiceRegistry = Depends(get_registry),
    _key=Depends(require_key),
):
    from fastapi.responses import StreamingResponse

    settings = _settings()
    text = body.text.strip()[: settings.max_text_chars]
    if not text:
        raise api_error(400, "bad_request", "text must not be empty")
    voice = _resolve_voice(registry, body.voice_id)
    session_id = body.session_id or new_session_id()
    request_id = new_request_id()

    users = request.app.state.users
    owner, kid, kname = _owner_for_http(request, _key)
    chars = len(text)
    users.ensure_persona()
    if users.debit(owner, chars) is None:
        users.record(user_id=owner, key_id=kid, key_name=kname, voice=voice.id,
                     chars=chars, text=text, mode="stream", status="error", cost_chars=0,
                     balance_after=users.balance(owner))
        raise api_error(402, "insufficient_credits",
                        f"need {chars} chars, balance {users.balance(owner)} — top up at /v1/billing/topup")

    async def events():
        import asyncio as _asyncio

        started = StartedEvent(
            request_id=request_id,
            session_id=session_id,
            voice_id=voice.id,
            model_version=provider.model_version,
            sample_rate=provider.sample_rate,
        )
        yield f"data: {started.model_dump_json()}\n\n"
        t0 = time.perf_counter()
        loop = _asyncio.get_running_loop()
        queue: _asyncio.Queue = _asyncio.Queue()

        def _produce() -> None:
            try:
                for frame in provider.synthesize_stream(text, voice.id):
                    for piece in chunk_bytes(frame, settings.stream_chunk_bytes):
                        loop.call_soon_threadsafe(queue.put_nowait, ("chunk", piece))
                loop.call_soon_threadsafe(queue.put_nowait, ("end", None))
            except Exception as e:  # noqa: BLE001
                loop.call_soon_threadsafe(queue.put_nowait, ("error", e))

        producer = _asyncio.create_task(_asyncio.to_thread(_produce))
        total = 0
        try:
            while True:
                kind, payload = await queue.get()
                if kind == "chunk":
                    total += len(payload)
                    chunk = ChunkEvent(
                        request_id=request_id,
                        data=base64.b64encode(payload).decode(),
                    )
                    yield f"data: {chunk.model_dump_json()}\n\n"
                elif kind == "end":
                    break
                else:
                    raise payload
        except Exception as e:  # noqa: BLE001
            users.credit(owner, chars)
            err = ErrorEvent(request_id=request_id, code="synthesis_failed", message=str(e) or "synthesis failed")
            yield f"data: {err.model_dump_json()}\n\n"
            return
        finally:
            if not producer.done():
                producer.cancel()
        done = DoneEvent(request_id=request_id, bytes=total, synth_time=time.perf_counter() - t0)
        yield f"data: {done.model_dump_json()}\n\n"
        users.record(user_id=owner, key_id=kid, key_name=kname, voice=voice.id,
                     chars=chars, text=text, audio_seconds=round(total / 2 / provider.sample_rate, 2),
                     latency_ms=int((time.perf_counter() - t0) * 1000), mode="stream",
                     status="done", cost_chars=chars, balance_after=users.balance(owner))

    return StreamingResponse(events(), media_type="text/event-stream")


@router.get("/v1/_contract")
def contract():
    """Machine-readable reminder of the wire contract (handy for SDK authors)."""
    return {
        "version": "v1",
        "audio": {"encoding": "pcm16", "channels": 1, "sample_rate": _settings().sample_rate},
        "speech": {"request": "SpeakRequest", "response": "audio/wav + X-* headers"},
        "stream": {"transport": "SSE", "events": ["started", "chunk", "done", "error"]},
        "talk": {
            "transport": "websocket",
            "in": ["speak", "cancel"],
            "out": ["started", "binary wav frames", "done", "error"],
        },
    }
