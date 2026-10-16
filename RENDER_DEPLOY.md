# Hosting on Render (backend + console)

## 1. Apply the blueprint

Render dashboard → **New → Blueprint** → point at this repo (`render.yaml`).
You get two services: `oled-studio-api` (Python) and `oled-studio-console`
(Node). The first deploy uses placeholder URLs — step 2 fixes that.

## 2. Wire the URLs into each other

After both services exist, copy their real `https://….onrender.com` URLs:

- API service → env `FRONTEND_URL` = your console URL (this is also the
  Paystack callback + GitHub-login landing page).
- Console service → env `NEXT_PUBLIC_MIDDLEMAN_URL` = your API URL.
- GitHub OAuth app (`github.com/settings/applications/new`):
  Homepage = console URL, callback = `<api-url>/v1/auth/github/callback`.
  Put the client id/secret into the API service env.
- Paystack dashboard → webhook URL `<api-url>/v1/billing/paystack/webhook`
  (test mode first; live later with `PAYSTACK_ALLOW_LIVE=true`).

Redeploy both after env edits. Free tiers sleep — first request wakes them.

## 3. Voices (auto-download) + can Render run Piper?

Yes — verified, not assumed. Two facts from checking upstream:

- **No Docker needed.** `piper-phonemize` ships ~25MB manylinux wheels
  that bundle the phonemizer, so Render's native Python runs it with plain
  `pip install`. (`Dockerfile.api` stays in the repo as a fallback — use
  it only if a deploy ever fails importing piper.)
- **But Python must be 3.11.** Those wheels stop at cp311 — there are NO
  3.12/3.13 builds, so newer Pythons can't install Piper at all. The
  blueprint pins `PYTHON_VERSION=3.11.11` for the API (dashboard stays
  on Node 22). Don't "upgrade" the API to 3.13 or voices silently become
  test tones.
- **Lazy voices.** Each medium voice costs real RAM once loaded, so the
  blueprint sets `PIPER_PRELOAD=false`: boot stays fast and RAM grows per
  USED voice, not per mapped one. First render of a voice is slower
  (it loads then), later ones are warm. Keep uvicorn at `--workers 1` —
  every extra worker loads its own copy of every used voice.

And yes, all of this — Docker included, had we needed it — works on
Render's **free tier**. Free-tier reality stays: 512MB RAM, shared CPU,
sleep on idle. One or two voices demo fine; four medium voices with
traffic wants Starter. If a render OOMs, shrink `TTS_VOICES`.

Free-tier sleep means the first request after idle wakes the service
(and lazy-loads the voice) — expect ~30–60s on that one render, fast
after. If a render OOMs, drop `TTS_VOICES` to fewer ids.

`*.onnx` is gitignored on purpose. At **build time**,
`scripts/download_models.py` bakes the mapped voices into the image from
Hugging Face (`rhasspy/piper-voices`); at **boot/runtime**,
`PIPER_AUTO_DOWNLOAD` refetches anything missing. Watch the deploy logs for:

```
[models] fetching 4 missing voice(s) from Hugging Face…
[models] saved en_US-lessac-medium.onnx (63.1 MB)
```

Change voices with `TTS_VOICES` + `PIPER_VOICE_MAP`
(`persona:model-stem`, stems look like `en_US-lessac-medium`).
Non-standard stems need explicit URLs: `PIPER_MODEL_URLS="stem=https://…"`.

These are English stand-ins — Piper has no Nigerian-English models.
The Qwen checkpoint replaces them when it lands (`TTS_PROVIDER=qwen`).

## 4. Money checklist (before real charges)

- `REQUIRE_LOGIN=true` + generated `SESSION_SECRET` (blueprint does both).
- Paystack test keys → one ₦100 charge reconciled in Admin + Paystack.
- Admin: set `ADMIN_EMAILS` to your login email.
- Live keys only with `PAYSTACK_ALLOW_LIVE=true`, plus Mongo attached
  (`TTS_VOICE_STORE=mongo`) — memory stores don't survive restarts.
