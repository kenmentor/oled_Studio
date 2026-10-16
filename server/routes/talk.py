"""WS /v1/talk: text in, chunked WAV audio back on the same socket.

Client -> server (JSON):
  {"type": "speak", "request_id": "r-1", "session_id?": "s-..",
   "voice_id?": "ada", "api_key?": "oled_sk_live_…", "text": "hello"}
  {"type": "cancel", "request_id": "r-1"}

Server -> client:
  {"type": "started", "request_id": ..., "session_id": ...,
   "voice_id": ..., "model_version": ..., "sample_rate": 24000}
  binary frames: first frame is the 44-byte WAV header (unknown lengths),
                 following frames are PCM16 mono. Concatenated = one WAV.
  {"type": "done", "request_id": ..., "bytes": N, "synth_time": S}
  {"type": "error", "request_id": ..., "code": ..., "message": ...}
"""

from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..audio import chunk_bytes, wav_header
from ..config import SETTINGS
from ..providers.base import SynthesisProvider
from ..state import VoiceRegistry, new_session_id
from ..users import PERSONA_ID
from .auth import check_ws_key

router = APIRouter(tags=["speech"])


@router.websocket("/v1/talk")
async def talk(ws: WebSocket):
    await ws.accept()
    provider: SynthesisProvider = ws.app.state.provider
    registry: VoiceRegistry = ws.app.state.registry

    while True:
        try:
            msg = await ws.receive_json()
        except WebSocketDisconnect:
            return
        except Exception:
            continue
        if not isinstance(msg, dict):
            continue

        mtype = msg.get("type")
        if mtype == "cancel":
            # Best-effort barge-in: the next loop iteration picks up nothing
            # new for a cancelled id. Synthesis itself is short-lived.
            rid = str(msg.get("request_id", ""))
            await ws.send_json({"type": "cancelled", "request_id": rid})
            continue
        if mtype != "speak":
            continue
        

        text = str(msg.get("text", "")).strip()[: SETTINGS.max_text_chars]
        rid = str(msg.get("request_id") or f"req-{time.time_ns() % 100000}")
        session_id = str(msg.get("session_id") or new_session_id())
        try:
            check_ws_key(ws.app.state.keys, msg.get("api_key"))
        except ValueError as e:
            await ws.send_json(
                {"type": "error", "request_id": rid, "code": "unauthorized", "message": str(e)}
            )
            await ws.close()
            return
        if not text:
            await ws.send_json(
                {"type": "error", "request_id": rid, "code": "bad_request", "message": "text must not be empty"}
            )
            continue

        voice = registry.resolve(msg.get("voice_id"))
        if voice is None:
            await ws.send_json(
                {"type": "error", "request_id": rid, "code": "unknown_voice", "message": "unknown or disabled voice"}
            )
            continue

        users = ws.app.state.users
        keys = ws.app.state.keys
        owner, kid, kname = PERSONA_ID, None, ""
        secret = msg.get("api_key")
        if secret:
            try:
                info = keys.verify(secret)
            except Exception:
                info = None
            if info is not None:
                owner, kid, kname = info.owner_id or PERSONA_ID, info.id, info.name
            else:
                # Forged secret on an otherwise open lane: fail closed like
                # the HTTP lanes (absent key = persona demo, bogus key = out).
                await ws.send_json(
                    {"type": "error", "request_id": rid, "code": "invalid_key",
                     "message": "unknown API key — check the secret or issue a new one"}
                )
                await ws.close()
                return
        users.ensure_persona()
        chars = len(text)
        # Free preview lane (docs/demo): same streaming, zero debit.
        preview = bool(msg.get("preview"))
        if preview:
            from ..preview import check as preview_check
            from ..preview import consume as preview_consume

            try:
                pip = ws.client.host if ws.client else "unknown"
                preview_check(pip, chars)  # preview_too_long / budget / disabled
            except Exception as e:  # noqa: BLE001 - api_error carries code/message
                detail = getattr(e, "detail", None) or {}
                await ws.send_json(
                    {"type": "error", "request_id": rid,
                     "code": detail.get("code", "preview_rejected") if isinstance(detail, dict) else "preview_rejected",
                     "message": detail.get("message", "preview rejected") if isinstance(detail, dict) else "preview rejected"}
                )
                continue
            preview_consume(pip, chars)
            owner, kid, kname = owner if secret else PERSONA_ID, None, "preview"
        elif users.debit(owner, chars) is None:
            await ws.send_json(
                {"type": "error", "request_id": rid, "code": "insufficient_credits",
                 "message": f"need {chars} chars, balance {users.balance(owner)} — top up at /v1/billing/topup"}
            )
            users.record(user_id=owner, key_id=kid, key_name=kname, voice=voice.id,
                         chars=chars, text=text, mode="stream", status="error", cost_chars=0,
                         balance_after=users.balance(owner))
            continue

        await ws.send_json(
            {
                "type": "started",
                "request_id": rid,
                "session_id": session_id,
                "voice_id": voice.id,
                "model_version": provider.model_version,
                "sample_rate": provider.sample_rate,
            }
        )

        print(f"[talk] speak rid={rid} chars={len(text)} voice={voice.id} owner={owner}"
              + (" preview" if preview else ""))
        t0 = time.perf_counter()
        first_ms: int | None = None
        try:
            await ws.send_bytes(wav_header(provider.sample_rate, unknown_length=True))
            total = 44
            loop = asyncio.get_running_loop()
            queue: asyncio.Queue = asyncio.Queue()

            def _produce() -> None:
                try:
                    for frame in provider.synthesize_stream(text, voice.id):
                        for piece in chunk_bytes(frame, SETTINGS.stream_chunk_bytes):
                            loop.call_soon_threadsafe(queue.put_nowait, ("chunk", piece))
                    loop.call_soon_threadsafe(queue.put_nowait, ("end", None))
                except Exception as e:  # noqa: BLE001
                    loop.call_soon_threadsafe(queue.put_nowait, ("error", e))

            producer = asyncio.create_task(asyncio.to_thread(_produce))
            try:
                while True:
                    kind, payload = await queue.get()
                    if kind == "chunk":
                        if first_ms is None:
                            first_ms = int((time.perf_counter() - t0) * 1000)
                            print(f"[talk] first frame rid={rid} after {first_ms}ms")
                        total += len(payload)
                        await ws.send_bytes(payload)
                    elif kind == "end":
                        break
                    else:
                        raise payload
            finally:
                if not producer.done():
                    producer.cancel()
            synth_time = round(time.perf_counter() - t0, 2)
            print(f"[talk] done rid={rid} bytes={total} synth={synth_time}s first={first_ms}ms"
                  + (" preview" if preview else ""))
            done_frame: dict = {
                "type": "done",
                "request_id": rid,
                "bytes": total,
                "synth_time": synth_time,
                "balance_chars": users.balance(owner),
            }
            if preview:
                done_frame["preview"] = True  # untouched balance, cost-0 record
            await ws.send_json(done_frame)
            users.record(user_id=owner, key_id=kid, key_name=kname, voice=voice.id,
                         chars=chars, text=text, audio_seconds=round((total - 44) / 2 / provider.sample_rate, 2),
                         latency_ms=first_ms if first_ms is not None else int((time.perf_counter() - t0) * 1000),
                         mode="preview" if preview else "stream",
                         status="done", cost_chars=0 if preview else chars,
                         balance_after=users.balance(owner))
        except WebSocketDisconnect:
            return
        except Exception as e:  # noqa: BLE001
            if not preview:
                users.credit(owner, chars)  # previews never debited: nothing to refund
            print(f"[talk] error rid={rid}: {e}")
            try:
                await ws.send_json(
                    {"type": "error", "request_id": rid, "code": "synthesis_failed", "message": str(e) or "synthesis failed"}
                )
            except Exception:
                pass
            continue
