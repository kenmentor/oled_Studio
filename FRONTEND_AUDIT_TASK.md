# Agent task: frontend page-by-page production audit

## Mission
Go through the single Next.js frontend (`dashboard/`, served together with the
landing at `/`) page by page. Remove every placeholder, dead end, stale
reference, and TODO. Every control must do something real against the adequate
backend (`server/`). Leave the product visibly closer to production.

## Ground rules
- **Pixel fidelity for the landing.** `dashboard/src/landing/` is a verbatim
  copy of the old Vite landing. Do not restyle, restructure, or “improve” it.
  Allowed changes there: dead URLs, crash fixes, nothing visual.
- **UTF-8 safety (burned us before).** NEVER bulk-replace text with
  PowerShell `Get-Content`/`Set-Content` — it corrupts non-ASCII chars
  (`·` → `Â·`, `→` → `â†’`). For any multi-file text replace, use Python with
  `io.open(..., encoding="utf-8")`. Verify with a grep for `Â|â|Ã` after.
- **One frontend.** `dashboard/` is THE frontend. `landing/` (Vite) is retired
  and lives in `bin/legacy-landing/`. Do not touch `bin/` legacy code.
- **Backend is source of truth** for voices, keys, speech, health, samples.
  Usage/billing/team/webhooks stay local-demo until the auth milestone — but
  every control must still function; nothing may look broken or fake.
- Verify with `npx tsc --noEmit` (dashboard), `python -m pytest server/tests`,
  `python scripts/check_routes.py` against a live server. No `npm run build`
  unless the user asks; use `NEXT_STATIC_EXPORT=1 npm run build` + FastAPI
  static serving for the served-bundle check.

## Repo map
- `dashboard/` — Next.js 16 app. `/` landing, `/signin`, console:
  `/overview /studio /voices /keys /usage /billing /settings`.
  Build for serve: `NEXT_STATIC_EXPORT=1 npm run build` → `dashboard/out/`.
- `server/` — FastAPI backend. `server/app.py` factory, `server/models.py`
  contract, `server/routes/` (meta, keys, speech, talk), `server/db.py`
  + `server/keys.py` (Mongo, memory fallback), `server/seed.py`,
  `server/static/samples/*.wav`, `server/modal_app.py`, `server/README.md`.
- Single server: `python -m uvicorn server.app:app --host 127.0.0.1 --port 8000`
  serves API + frontend. Kill stale uvicorn on :8000 first (bind errors mean
  you are testing old code).
- Mongo: local `mongodb://127.0.0.1:27017/`, db `oled_studio`. Seed:
  `python -m server.seed` (idempotent, never overwrites toggles).

## Backend contract (what “adequate backend” means per page)
- `GET /health` → `{ok, provider, model_version, sample_rate, voices}`
- `GET /v1/voices` → `{voices: [{id,label,accent,language,enabled,sample_url}]}`
- `PATCH /v1/voices/{id}` `{enabled}` · `POST /v1/voices` · `DELETE /v1/voices/{id}`
- `POST /v1/keys` → `{key, secret}` (secret once) · `GET /v1/keys` (no secrets)
  `DELETE /v1/keys/{id}` · `POST /v1/keys/verify`
- `POST /v1/speech` → `audio/wav` (+ `X-Request-ID/X-Session-ID/X-Voice-ID/…`)
  `POST /v1/tts` legacy alias (landing demo). `POST /v1/speech/stream` SSE.
- `WS /v1/talk` speak/cancel, binary WAV frames, `api_key` field supported.
- `GET /samples/{id}.wav` pre-recorded voice clips (stub renders these).
- Auth enforcement is OFF (`TTS_REQUIRE_AUTH=false`); keys are fully
  functional (issue/verify/revoke) and the dashboard attaches them.

## Page checklist
1. **`/` landing** — must match the old Vite landing exactly. Check: fonts
   (Inter/Space Grotesk/JetBrains load), grain, marquee, sticky voice cards,
   pinned pipeline, counters, preloader, showcase loop, demo renders audio via
   `/v1/tts`, all CTAs go to `/studio` (zero `localhost:5173` refs), no
   console shell leaks onto this route. Kill the `TODO(you)` in Loved quotes.
   Refresh Developers snippets to the new backend (`/v1/speech` curl,
   `modal deploy server/modal_app.py`; drop dead `deploy/modal_app.py` +
   compose paths). Refresh Pipeline stops + Numbers stats that describe the
   retired Redis/Kokoro/429 architecture — propose new copy matching
   gateway → Qwen pool → WAV.
2. **`/overview`** — health row shows live backend voices/model; recent
   requests open the drawer; “Next up” links all land somewhere real.
3. **`/studio`** — renders playable audio end-to-end via WS; sends `voice_id`
   of the default voice + first key’s secret; failures show the real error,
   never a silent stall; usage row updates after each render.
4. **`/voices`** — list mirrors the backend (refresh on mount + signin);
   enable/disable persists server-side; Preview plays the real sample clip;
   Add creates server-side; Remove deletes server-side; `Use` sets default and
   Studio follows it. No dead preview buttons.
5. **`/keys`** — list/create/reveal-once/rotate/revoke all hit the backend;
   refresh on mount; detail drawer numbers match stored events; Studio’s
   inline revoke works.
6. **`/usage`** — filters/search/CSV export all function; rows open the
   request drawer; empty states read intentionally, not broken.
7. **`/billing`** — plan switch, card update, promo code, invoice drawer all
   function end-to-end (local demo data is acceptable; nothing may 404/stall).
8. **`/settings`** — profile save, email toggles, quota threshold, invites,
   webhooks, reset-demo all function. The disabled Delete-account button is a
   dead end: either wire it (clear local data + confirm) or remove it.
9. **`/signin`** — demo signin works; post-signin lands on `/overview`
   (currently `/studio` — fix); sign-out returns to signin from every page.

## Workflow per page
1. Read the page + its store/gateway touchpoints.
2. Click every control mentally: does it call the backend (or honest local
   demo) and produce visible feedback? Fix or remove dead ends.
3. `npx tsc --noEmit` in `dashboard/` after edits.
4. Rebuild export, restart uvicorn, run `python scripts/check_routes.py`
   (extend it when you add routes), plus `pytest server/tests`.
5. Confirm the served HTML has no mojibake (`Â|â|Ã` grep over
   `dashboard/src` and a spot-check of `dashboard/out/index.html`).

## Done criteria
- Zero TODO/FIXME/lorem/placeholder text in `dashboard/src`.
- Zero dead links/buttons across all nine routes.
- Landing visually identical to the Vite original (same copy except
  modernized backend references, same motion, same styles).
- `check_routes.py` all PASS against a fresh server + fresh seed.
- `pytest server/tests` green, `tsc` clean.
