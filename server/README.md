# OLED Studio TTS backend (`server/`)

Clean-room backend. No legacy assumptions: no Redis, no LiveKit, no Kokoro,
no Piper. One FastAPI app, one synthesis-provider interface, three audio lanes.

## Layout

```text
server/
  app.py            create_app(provider) — used locally and on Modal
  config.py         env-only settings (TTS_PROVIDER, TTS_MODEL_VERSION, …)
  models.py         the public contract (Pydantic schemas)
  audio.py          WAV/PCM framing — the only place byte layouts live
  state.py          provider + voice registry (enable/disable lives here)
  routes/
    meta.py         GET /health, GET /v1/voices, PATCH /v1/voices/{id}
    speech.py       POST /v1/speech (WAV), POST /v1/speech/stream (SSE)
    talk.py         WS /v1/talk (binary WAV frames)
  providers/
    base.py         SynthesisProvider protocol — engines implement this
    stub.py         deterministic test tone (API dev only, never ships)
    qwen.py         seam for the fine-tuned checkpoint (raises until wired)
  modal_app.py      Modal deploy: CPU gateway + GPU synth probe
  tests/            contract tests (6 passing)
```

## Run locally

```bash
pip install -r server/requirements-api.txt
uvicorn server.app:app --host 127.0.0.1 --port 8000
python -m pytest server/tests -q
```

## Contract (v1)

Audio is always **PCM16 mono** (`server/audio.py`: 24 kHz default).
Voices are stable string IDs (`ada`, …). Requests may name a voice or take
the default enabled one; disabled/unknown voices fail loudly.

| Endpoint | In | Out |
|---|---|---|
| `GET /health` | — | `{ok, provider, model_version, sample_rate, voices}` |
| `GET /v1/voices` | — | `{voices: [{id, label, accent, language, enabled}], model_version}` |
| `PATCH /v1/voices/{id}` | `{enabled}` | the updated voice / 404 |
| `POST /v1/speech` | `{text, voice_id?, session_id?}` | `audio/wav` + `X-Request-ID`, `X-Session-ID`, `X-Voice-ID`, `X-Model-Version`, `X-Synth-Time` |
| `POST /v1/speech/stream` | same | SSE `started` → `chunk{base64 pcm}`* → `done` |
| `WS /v1/talk` | `{type:speak…}` / `{type:cancel…}` | `started` → binary frames (44 B WAV header, then PCM) → `done` / `error` |

Errors are always `{error: {code, message}}` with codes
`bad_request · unknown_voice · voice_disabled · synthesis_failed · cancelled`.

## What’s deliberately missing

Auth, API keys, user DB, billing, fine-tuning, LiveKit rooms. Those land as
separate milestones against this contract — nothing here needs to move for them.

## Deploy to Modal

```bash
modal deploy server/modal_app.py
```

Gateway stays CPU-cheap; set `TTS_PROVIDER=qwen` + `QWEN_CHECKPOINT` and mount
the fine-tuned weights at `/weights` when the checkpoint lands. GPU choice via
`OLED_GPU` (`L40S` default, `A100-80GB`/`H100` for 1.7B).
