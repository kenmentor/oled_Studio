# GitHub OAuth setup (local)

## 1. Register the app (browser, once)

1. GitHub avatar → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**.
   Direct link: `https://github.com/settings/applications/new`
   (Not GitHub Apps — that form asks for a webhook URL. You don't need it.)
2. Fill in:
   - Application name: `OLED Studio`
   - Homepage URL: `http://127.0.0.1:8000`
   - Authorization callback URL: `http://127.0.0.1:8000/v1/auth/github/callback`
3. **Register application**, copy the **Client ID**.
4. **Generate a new client secret**, copy it (shown once).

## 2. Start the server with credentials (terminal, every new shell)

```powershell
conda activate codeml
cd C:\Users\MENTOR\Desktop\Projects\personal-project\oled-studio
$env:GITHUB_CLIENT_ID="<paste-client-id>"
$env:GITHUB_CLIENT_SECRET="<paste-40-char-secret>"
$env:SESSION_SECRET="<any-random-32-plus-characters>"
python -m uvicorn server.app:app --host 127.0.0.1 --port 8000
```

Verify they landed: `$env:GITHUB_CLIENT_ID` should echo the value back.
Without them, `GET /v1/auth/github` returns `oauth_unconfigured` on purpose.

## 3. Test

1. Open `http://127.0.0.1:8000/signin` (use `127.0.0.1`, not `localhost`).
2. **Continue with GitHub** → Authorize → lands on `/overview` signed in.
3. New GitHub email → fresh user + 250,000 welcome chars + auto `Studio` key.
   Known email → merges into that account (balance and keys kept).

## 4. Lock down production (money is real — do this)

```powershell
$env:SESSION_SECRET="<any-random-32-plus-characters>"  # REQUIRED: server refuses to start REQUIRE_LOGIN without it
$env:REQUIRE_LOGIN="true"
```

What changes when `REQUIRE_LOGIN=true`:

- Every successful signup/signin (email or GitHub) mints a signed-cookie
  session (7-day max, killed immediately by logout). The browser sends it
  on every wallet/keys/usage call.
- Keys, billing, usage, and `/v1/users/me` return `401` without a session.
  A caller who just names someone else's `?user_id=` gets nothing —
  when a session exists it wins; when login is required and there is no
  session, the explicit param is dead.
- Renders stay open and bill the key owner (or persona when keyless).
  Studio always sends its uid-bound key, so spend lands on the right
  wallet. The anonymous landing demo burns the capped persona wallet
  (rate-limited per IP).
- Full lockdown (kills the public demo too): `$env:TTS_REQUIRE_AUTH="true"`.
  Every speech lane then demands a valid `oled_sk_live_…` key.

Why GitHub re-login shows Authorize every time: logout revokes our GitHub
grant (`DELETE /applications/{id}/grant`) then clears OUR session
(verify: `GET /v1/users/me` → `401`). Next "Continue with GitHub" always
lands on GitHub's Authorize screen again. If it skips the password prompt,
that's github.com's own SSO session (still logged in there) — GitHub's
security domain, not ours. Our logout cannot and must not kill your
github.com session.

## Rules

- Never commit secrets. They live in env vars only — nothing in this repo reads them from files.
- If a secret is ever pasted anywhere shared, regenerate it on the app page.
- Callback URL must match byte-for-byte, or GitHub bounces with `bad_state` / `exchange_failed` (shown on `/signin?oauth_error=...`).
