"""Backend API contract tests. Run: python -m pytest server/tests -q"""

import base64
import io
import json
import os
import wave

from fastapi.testclient import TestClient

from server.app import create_app
from server.providers.stub import StubProvider


def client():
    os.environ["TTS_VOICE_STORE"] = "memory"  # contract tests never touch Mongo
    os.environ["ALLOW_FAKE_TOPUP"] = "true"  # ledger tests use the demo top-up
    return TestClient(create_app(StubProvider(["ada", "chiamaka"])))


def test_health():
    c = client()
    r = c.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["provider"] == "stub"
    assert body["voices"] == 2


def test_voices_list_and_toggle():
    c = client()
    voices = c.get("/v1/voices").json()["voices"]
    assert [v["id"] for v in voices] == ["ada", "chiamaka"]

    r = c.patch("/v1/voices/ada", json={"enabled": False})
    assert r.status_code == 200
    assert r.json()["enabled"] is False

    # disabled voice refuses synthesis
    r = c.post("/v1/speech", json={"text": "hi", "voice_id": "ada"})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "voice_disabled"

    # default falls through to the next enabled voice
    r = c.post("/v1/speech", json={"text": "hi"})
    assert r.status_code == 200
    assert r.headers["X-Voice-ID"] == "chiamaka"

    r = c.patch("/v1/voices/nope", json={"enabled": False})
    assert r.status_code == 404


def test_voices_add_and_remove():
    c = client()
    r = c.post(
        "/v1/voices",
        json={"id": "tunde", "label": "Tunde", "accent": "Nigerian · Yoruba"},
    )
    assert r.status_code == 201
    assert r.json()["id"] == "tunde"

    r = c.post(
        "/v1/voices",
        json={"id": "tunde", "label": "Tunde", "accent": "Nigerian · Yoruba"},
    )
    assert r.status_code == 409

    r = c.delete("/v1/voices/tunde")
    assert r.status_code == 200
    assert c.delete("/v1/voices/tunde").status_code == 404


def test_api_key_lifecycle():
    c = client()
    r = c.post("/v1/keys", json={"name": "Production"})
    assert r.status_code == 201
    issued = r.json()
    secret = issued["secret"]
    assert secret.startswith("oled_sk_live_")
    key_id = issued["key"]["id"]

    # secret never stored: list shows prefix/last4 only
    keys = c.get("/v1/keys").json()["keys"]
    assert any(k["id"] == key_id for k in keys)
    assert all("secret" not in k and "hash" not in k for k in keys)

    # verify works, garbage doesn't
    assert c.post("/v1/keys/verify", json={"secret": secret}).json()["valid"] is True
    assert c.post("/v1/keys/verify", json={"secret": "oled_sk_live_nope"}).json()["valid"] is False

    # revoke kills it instantly
    assert c.delete(f"/v1/keys/{key_id}").status_code == 200
    assert c.post("/v1/keys/verify", json={"secret": secret}).json()["valid"] is False
    assert c.delete(f"/v1/keys/{key_id}").status_code == 404


def test_speech_returns_valid_wav():
    c = client()
    r = c.post("/v1/speech", json={"text": "Good morning Lagos", "voice_id": "ada"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "audio/wav"
    assert r.headers["X-Voice-ID"] == "ada"
    assert "X-Synth-Time" in r.headers
    assert r.headers["X-Session-ID"].startswith("s-")
    with wave.open(io.BytesIO(r.content), "rb") as w:
        assert w.getnchannels() == 1
        assert w.getsampwidth() == 2
        assert w.getframerate() == 24000
        assert w.getnframes() > 0


def test_speech_rejects_empty_text():
    c = client()
    assert c.post("/v1/speech", json={"text": "   "}).status_code in (400, 422)
    assert c.post("/v1/speech", json={"text": "hi", "voice_id": "nope"}).status_code == 404


def _sse_events(body: str):
    events = []
    for chunk in body.split("\n\n"):
        for line in chunk.splitlines():
            if line.startswith("data: "):
                events.append(json.loads(line[len("data: ") :]))
    return events


def test_stream_contract():
    c = client()
    with c.stream("POST", "/v1/speech/stream", json={"text": "hello there Ada"}) as r:
        assert r.status_code == 200
        assert "text/event-stream" in r.headers["content-type"]
        events = _sse_events(r.read().decode())
    assert events[0]["type"] == "started"
    assert events[0]["voice_id"] == "ada"
    chunks = [e for e in events if e["type"] == "chunk"]
    assert chunks, "expected audio chunks"
    pcm = b"".join(base64.b64decode(e["data"]) for e in chunks)
    assert len(pcm) % 2 == 0
    assert events[-1]["type"] == "done"
    assert events[-1]["bytes"] == len(pcm)


def test_talk_websocket_contract():
    c = client()
    with c.websocket_connect("/v1/talk") as ws:
        ws.send_json({"type": "speak", "request_id": "r-1", "text": "hello", "voice_id": "ada"})
        started = ws.receive_json()
        assert started["type"] == "started"
        assert started["request_id"] == "r-1"

        header = ws.receive_bytes()
        assert header[:4] == b"RIFF" and len(header) == 44

        pcm = b""
        done = None
        for _ in range(200):
            msg = ws.receive()
            if "bytes" in msg:
                pcm += msg["bytes"]
            elif "text" in msg:
                done = json.loads(msg["text"])
                break
            else:
                break
        assert done is not None and done["type"] == "done"
        assert done["bytes"] == 44 + len(pcm)

        ws.send_json({"type": "speak", "request_id": "r-2", "text": "hi", "voice_id": "nope"})
        err = ws.receive_json()
        assert err["type"] == "error" and err["code"] == "unknown_voice"

        ws.send_json({"type": "cancel", "request_id": "r-1"})
        cancelled = ws.receive_json()
        assert cancelled["type"] == "cancelled"


def test_preview_lane_never_bills(monkeypatch):
    from server.users import PERSONA_ID, WELCOME_CHARS

    monkeypatch.setenv("PREVIEW_MAX_CHARS", "200")
    monkeypatch.setenv("PREVIEW_DAILY_CHARS_PER_IP", "10000")
    c = client()
    before = c.get("/v1/billing/balance").json()["balance_chars"]
    assert before == WELCOME_CHARS

    # free preview: 200, real WAV, balance untouched, cost-0 record
    r = c.post("/v1/speech", json={"text": "hello preview", "voice_id": "ada", "preview": True})
    assert r.status_code == 200
    assert r.headers["x-preview"] == "true"
    assert r.headers["content-type"] == "audio/wav"
    assert c.get("/v1/billing/balance").json()["balance_chars"] == before
    ev = c.get("/v1/usage").json()["events"][0]
    assert ev["mode"] == "preview" and ev["cost_chars"] == 0

    # over the cap: 400, never synthesizes
    r = c.post("/v1/speech", json={"text": "x" * 201, "voice_id": "ada", "preview": True})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "preview_too_long"

    # exhausted IP budget: 429
    monkeypatch.setenv("PREVIEW_DAILY_CHARS_PER_IP", "10")
    r = c.post("/v1/speech", json={"text": "hello preview", "voice_id": "ada", "preview": True})
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "preview_budget"

    # lane off: 403, not audio
    monkeypatch.setenv("PREVIEW_DAILY_CHARS_PER_IP", "0")
    r = c.post("/v1/speech", json={"text": "hi", "voice_id": "ada", "preview": True})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "preview_disabled"


def test_preview_lane_websocket():
    from server.users import WELCOME_CHARS

    c = client()
    before = c.get("/v1/billing/balance").json()["balance_chars"]
    with c.websocket_connect("/v1/talk") as ws:
        ws.send_json({"type": "speak", "request_id": "r-p1", "text": "hello ws",
                      "voice_id": "ada", "preview": True})
        assert ws.receive_json()["type"] == "started"
        assert ws.receive_bytes()[:4] == b"RIFF"
        done = None
        for _ in range(200):
            msg = ws.receive()
            if "text" in msg:
                done = json.loads(msg["text"])
                break
        assert done is not None and done["type"] == "done"
        assert done.get("preview") is True
    assert c.get("/v1/billing/balance").json()["balance_chars"] == before == WELCOME_CHARS


def test_persona_balance_and_topup():
    from server.users import PERSONA_ID, WELCOME_CHARS, CHARS_PER_KOBO

    c = client()
    b = c.get("/v1/billing/balance").json()
    assert b["user_id"] == PERSONA_ID
    assert b["balance_chars"] == WELCOME_CHARS

    r = c.post("/v1/billing/topup", json={"amount_kobo": 850_000, "card_number": "4242424242424242"})
    assert r.status_code == 200
    body = r.json()
    assert body["granted_chars"] == 850_000 * CHARS_PER_KOBO
    assert body["balance_chars"] == WELCOME_CHARS + 850_000 * CHARS_PER_KOBO
    assert body["invoice"]["card_last4"] == "4242"

    inv = c.get("/v1/billing/invoices").json()["invoices"]
    assert len(inv) == 1 and inv[0]["amount_kobo"] == 850_000

    r = c.post("/v1/billing/topup", json={"amount_kobo": 100, "card_number": "short"})
    assert r.status_code in (400, 422)


def test_speech_debits_and_blocks_at_zero():
    from server.users import PERSONA_ID

    c = client()
    start = c.get("/v1/billing/balance").json()["balance_chars"]

    r = c.post("/v1/speech", json={"text": "hello ada", "voice_id": "ada"})
    assert r.status_code == 200
    assert int(r.headers["x-balance-chars"]) == start - len("hello ada")

    # drain to 5 chars, then a 9-char request must 402
    users = c.app.state.users
    users._users[PERSONA_ID]["balance_chars"] = 5
    r = c.post("/v1/speech", json={"text": "hello ada", "voice_id": "ada"})
    assert r.status_code == 402
    assert r.json()["error"]["code"] == "insufficient_credits"

    usage = c.get("/v1/usage").json()["events"]
    assert any(e["status"] == "done" and e["cost_chars"] == len("hello ada") for e in usage)
    assert any(e["status"] == "error" for e in usage)


def test_key_inference_attributes_owner():
    c = client()
    issued = c.post("/v1/keys", json={"name": "Prod"}).json()
    assert issued["key"]["owner_id"] != ""
    owner = issued["key"]["owner_id"]

    r = c.post(
        "/v1/speech",
        json={"text": "keyed hello", "voice_id": "ada"},
        headers={"Authorization": f"Bearer {issued['secret']}"},
    )
    assert r.status_code == 200

    usage = c.get("/v1/usage").json()["events"]
    mine = [e for e in usage if e["key_name"] == "Prod"]
    assert mine and mine[0]["user_id"] == owner

    assert c.delete(f"/v1/keys/{issued['key']['id']}").status_code == 200
    r = c.post(
        "/v1/speech",
        json={"text": "keyed hello", "voice_id": "ada"},
        headers={"Authorization": f"Bearer {issued['secret']}"},
    )
    # revoked key verifies against nothing now: fail closed (401), even
    # though the open demo lane still serves keyless requests.
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_key"


def test_key_names_and_forged_keys():
    c = client()
    # Blank-after-strip names are rejected, not stored as "".
    r = c.post("/v1/keys", json={"name": "   "})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_name"
    assert c.post("/v1/keys", json={"name": "Prod"}).status_code == 201

    # Forged secret on the HTTP lane: 401 even in open (demo) mode.
    r = c.post(
        "/v1/speech",
        json={"text": "forged hello", "voice_id": "ada"},
        headers={"Authorization": "Bearer oled_sk_live_rubbishrubbishrubbish0000"},
    )
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_key"
    r = c.post(
        "/v1/speech/stream",
        json={"text": "forged hello", "voice_id": "ada"},
        headers={"X-API-Key": "oled_sk_live_rubbishrubbishrubbish0000"},
    )
    assert r.status_code == 401

    # No secret at all: the shared persona demo still renders (open mode).
    r = c.post("/v1/speech", json={"text": "demo hello", "voice_id": "ada"})
    assert r.status_code == 200


def test_auth_signup_signin_flow():
    from server.users import WELCOME_CHARS

    c = client()
    r = c.post("/v1/auth/signup", json={"name": "Test User", "email": "test@example.com", "company": "Test Co"})
    assert r.status_code == 201
    user = r.json()["user"]
    assert user["balance_chars"] == WELCOME_CHARS
    uid = user["id"]

    # duplicate email -> 409, pointed at signin
    r = c.post("/v1/auth/signup", json={"name": "Test User", "email": "test@example.com"})
    assert r.status_code == 409

    r = c.post("/v1/auth/signin", json={"email": "test@example.com"})
    assert r.status_code == 200
    assert r.json()["user"]["id"] == uid

    assert c.post("/v1/auth/signin", json={"email": "nobody@example.com"}).status_code == 404

    # per-user isolation: topup lands on the new user, persona untouched.
    # NOTE: signup minted a session cookie on this client, and the session
    # wins over any ?user_id= param — so persona is read with a fresh
    # (cookieless) client, exactly like an anonymous caller would.
    anon = client()
    persona_before = anon.get("/v1/billing/balance").json()["balance_chars"]
    r = c.post("/v1/billing/topup", json={"amount_kobo": 500, "card_number": "4242424242424242", "user_id": uid})
    assert r.status_code == 200
    assert r.json()["balance_chars"] == WELCOME_CHARS + 5000
    assert anon.get("/v1/billing/balance").json()["balance_chars"] == persona_before

    # user key + keyed inference debits the user, not persona
    issued = c.post("/v1/keys", json={"name": "UserKey", "owner_id": uid}).json()
    assert issued["key"]["owner_id"] == uid
    r = c.post("/v1/speech", json={"text": "user render", "voice_id": "ada"},
               headers={"Authorization": f"Bearer {issued['secret']}"})
    assert r.status_code == 200
    assert c.get("/v1/billing/balance", params={"user_id": uid}).json()["balance_chars"] == WELCOME_CHARS + 5000 - len("user render")
    assert anon.get("/v1/billing/balance").json()["balance_chars"] == persona_before

    listed = c.get("/v1/keys", params={"owner_id": uid}).json()["keys"]
    assert any(k["id"] == issued["key"]["id"] for k in listed)


def test_github_oauth_flow(monkeypatch):
    import os

    import secrets as _secrets

    from server.routes import github_auth as _gh

    os.environ["GITHUB_CLIENT_ID"] = "test-client"
    monkeypatch.setattr(_secrets, "token_urlsafe", lambda n=16: "teststate")

    async def fake_exchange(code, redirect_uri):
        assert code == "code123"
        return "tok123"

    async def fake_profile(token):
        assert token == "tok123"
        return ({"id": 424242, "login": "octocat", "name": "Octo Cat", "avatar_url": "https://x/y.png"}, "octo@example.com")

    monkeypatch.setattr(_gh, "_exchange_code", fake_exchange)
    monkeypatch.setattr(_gh, "_fetch_profile", fake_profile)

    c = client()
    r = c.get("/v1/auth/github", follow_redirects=False)
    assert r.status_code == 307
    assert "state=teststate" in r.headers["location"]

    r = c.get("/v1/auth/github/callback?code=code123&state=teststate", follow_redirects=False)
    assert r.status_code == 307
    assert r.headers["location"].endswith("/overview")

    me = c.get("/v1/users/me").json()
    assert me["email"] == "octo@example.com" and me["name"] == "Octo Cat"

    # second login, same github id, duplicative email user exists -> merge, no dup
    c.post("/v1/auth/signup", json={"name": "Plain", "email": "plain@example.com"})
    async def fake_profile2(token):
        return ({"id": 999, "login": "plainish", "name": "Plain GH", "avatar_url": ""}, "plain@example.com")
    monkeypatch.setattr(_gh, "_fetch_profile", fake_profile2)
    c.get("/v1/auth/github", follow_redirects=False)
    r = c.get("/v1/auth/github/callback?code=code123&state=teststate", follow_redirects=False)
    assert r.status_code == 307
    me = c.get("/v1/users/me").json()
    assert me["email"] == "plain@example.com"

    # bad state rejected, logged out afterwards
    r = c.get("/v1/auth/github/callback?code=code123&state=nope", follow_redirects=False)
    assert r.status_code == 307 and "oauth_error=bad_state" in r.headers["location"]
    assert c.post("/v1/auth/logout").json() == {"ok": True}


def test_github_return_to_landing(monkeypatch):
    """The console that STARTED the login is where the callback lands.

    return_to is allow-listed (FRONTEND_ORIGINS + localhost defaults):
    a foreign host falls back to FRONTEND_URL instead of open-redirecting.
    """
    import os

    from server.routes import github_auth as _gh

    os.environ["GITHUB_CLIENT_ID"] = "test-client"
    monkeypatch.setenv("FRONTEND_ORIGINS", "https://console.example.com")
    monkeypatch.setenv("FRONTEND_URL", "https://console.example.com")

    async def fake_exchange(code, redirect_uri):
        return "tok123"

    async def fake_profile(token):
        return ({"id": 424242, "login": "octocat", "name": "Octo", "avatar_url": ""}, "octo2@example.com")

    monkeypatch.setattr(_gh, "_exchange_code", fake_exchange)
    monkeypatch.setattr(_gh, "_fetch_profile", fake_profile)

    import secrets as _secrets

    monkeypatch.setattr(_secrets, "token_urlsafe", lambda n=16: "teststate")

    # NOTE: FRONTEND_URL=https makes the session cookie Secure, which a plain
    # http TestClient never sends back (bad_state). Serve the test app over
    # https so the cookie round-trips like a real browser on Render.
    from fastapi.testclient import TestClient

    from server.app import create_app
    from server.providers.stub import StubProvider

    os.environ["TTS_VOICE_STORE"] = "memory"
    c = TestClient(create_app(StubProvider(["ada", "chiamaka"])), base_url="https://testserver")
    r = c.get("/v1/auth/github?return_to=https://console.example.com/overview", follow_redirects=False)
    assert r.status_code == 307
    r = c.get("/v1/auth/github/callback?code=code123&state=teststate", follow_redirects=False)
    assert r.status_code == 307
    assert r.headers["location"] == "https://console.example.com/overview"

    # evil host: dropped, falls back to FRONTEND_URL (no open redirect)
    c.get("/v1/auth/github?return_to=https://evil.example.com/steal", follow_redirects=False)
    r = c.get("/v1/auth/github/callback?code=code123&state=teststate", follow_redirects=False)
    assert r.status_code == 307
    assert r.headers["location"] == "https://console.example.com/overview"
    assert "evil" not in r.headers["location"]


def test_session_login_logout():
    """Email auth mints a real session; logout destroys it; session wins."""
    c = client()
    r = c.post("/v1/auth/signup", json={"name": "Sess", "email": "sess@example.com"})
    assert r.status_code == 201
    uid = r.json()["user"]["id"]
    assert "session" in r.headers.get("set-cookie", ""), "signup must mint a login cookie"

    # session wins over an explicit ?user_id naming someone else entirely
    me = c.get("/v1/users/me", params={"user_id": "user_demo_ada"}).json()
    assert me["id"] == uid
    assert c.get("/v1/billing/balance").json()["user_id"] == uid

    # logout destroys it: no silent re-entry, no bootstrap
    assert c.post("/v1/auth/logout").json() == {"ok": True}
    assert c.get("/v1/users/me").status_code == 401


def test_require_login_blocks_anonymous(monkeypatch):
    """Prod posture: no session -> 401 on data lanes, even naming a user."""
    monkeypatch.setenv("REQUIRE_LOGIN", "true")
    monkeypatch.setenv("SESSION_SECRET", "test-only-32-plus-char-secret-value")
    c = client()
    assert c.get("/v1/billing/balance").status_code == 401
    assert c.get("/v1/usage").status_code == 401
    assert c.get("/v1/keys").status_code == 401
    assert c.get("/v1/users/me", params={"user_id": "user_demo_ada"}).status_code == 401

    # a real login restores access through the session, not the param
    r = c.post("/v1/auth/signup", json={"name": "Gated", "email": "gated@example.com"})
    assert r.status_code == 201
    assert c.get("/v1/billing/balance").status_code == 200


def test_security_headers_and_rate_limit():
    c = client()
    r = c.get("/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"

    # drive the auth bucket past its budget with one fabricated client
    hit_429 = False
    for _ in range(70):
        r = c.post("/v1/auth/signin", json={"email": "nobody@example.com"})
        if r.status_code == 429:
            assert r.json()["error"]["code"] == "rate_limited"
            assert "retry-after" in r.headers
            hit_429 = True
            break
    assert hit_429


# ---- Paystack wallet funding (test mode, Paystack API monkeypatched) ----

def _pay_client(monkeypatch):
    """Logged-in client with Paystack usable but fully offline."""
    import server.paystack_pay as pay

    monkeypatch.setenv("PAYSTACK_SECRET", "sk_test_dummy")
    monkeypatch.setenv("ALLOW_FAKE_TOPUP", "true")
    c = client()

    async def fake_post(path, payload):
        assert path == "/transaction/initialize"
        return {"authorization_url": "https://checkout.paystack.com/abc123",
                "access_code": "abc123", "reference": payload["reference"]}

    def make_verified(amount_kobo, uid, reference, status="success", currency="NGN"):
        return {"id": 1234567890, "domain": "test", "status": status,
                "reference": reference, "amount": amount_kobo, "currency": currency,
                "gateway_response": "Successful", "paid_at": "2026-01-01T00:00:00.000Z",
                "authorization": {"authorization_code": "AUTH_x", "bin": "408408",
                                  "last4": "4081", "channel": "card"},
                "customer": {"email": "buyer@example.com"},
                "metadata": {"uid": uid, "amount_kobo": amount_kobo, "purpose": "wallet_topup"}}

    async def fake_get(path):
        return make_verified.current

    monkeypatch.setattr(pay, "_ps_post", fake_post)
    monkeypatch.setattr(pay, "_ps_get", fake_get)
    return c, make_verified


def test_fake_topup_disabled_when_paystack_configured(monkeypatch):
    monkeypatch.setenv("PAYSTACK_SECRET", "sk_test_dummy")
    c = client()
    monkeypatch.delenv("ALLOW_FAKE_TOPUP", raising=False)  # after client(): gate reads env per-request
    r = c.post("/v1/billing/topup", json={"amount_kobo": 500, "card_number": "4242424242424242"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "fake_topup_disabled"


def _signed_webhook(c, ref, verified):
    """Deliver a charge.success webhook like Paystack would (HMAC-signed)."""
    import hashlib
    import hmac as hmac_mod
    import json as json_mod

    event = {"event": "charge.success",
             "data": {**verified, "metadata": verified["metadata"]}}
    raw = json_mod.dumps(event).encode()
    sig = hmac_mod.new(b"sk_test_dummy", raw, hashlib.sha512).hexdigest()
    return c.post("/v1/billing/paystack/webhook", content=raw,
                  headers={"x-paystack-signature": sig, "Content-Type": "application/json"})


def test_paystack_webhook_credits_verify_only_reports(monkeypatch):
    """Webhook moves money; verify only reports (never credits)."""
    from server.users import WELCOME_CHARS, CHARS_PER_KOBO

    c, make_verified = _pay_client(monkeypatch)
    uid = c.post("/v1/auth/signup", json={"name": "Pay", "email": "pay@example.com"}).json()["user"]["id"]

    r = c.post("/v1/billing/paystack/initialize", json={"amount_kobo": 850_000})
    assert r.status_code == 200
    ref = r.json()["reference"]
    assert ref.startswith("oled-")
    assert r.json()["authorization_url"].startswith("https://")

    make_verified.current = make_verified(850_000, uid, ref)  # fake_get serves .current

    # verify BEFORE any webhook: pending, wallet untouched (read-only proof)
    r = c.get("/v1/billing/paystack/verify", params={"reference": ref})
    assert r.status_code == 200
    assert r.json()["status"] == "pending"
    assert c.get("/v1/billing/balance").json()["balance_chars"] == WELCOME_CHARS

    # the webhook (and only the webhook) credits
    assert _signed_webhook(c, ref, make_verified.current).status_code == 200
    assert c.get("/v1/billing/balance").json()["balance_chars"] == WELCOME_CHARS + 850_000 * CHARS_PER_KOBO

    # verify AFTER webhook: confirmed with the receipt
    r = c.get("/v1/billing/paystack/verify", params={"reference": ref})
    assert r.status_code == 200
    assert r.json()["status"] == "confirmed"
    assert r.json()["granted_chars"] == 850_000 * CHARS_PER_KOBO
    assert r.json()["invoice"]["card_last4"] == "4081"

    # replay webhook + re-verify: still exactly one credit
    assert _signed_webhook(c, ref, make_verified.current).status_code == 200
    r = c.get("/v1/billing/paystack/verify", params={"reference": ref})
    assert r.json()["status"] == "confirmed"
    assert c.get("/v1/billing/balance").json()["balance_chars"] == WELCOME_CHARS + 850_000 * CHARS_PER_KOBO


def test_paystack_verify_is_read_only(monkeypatch):
    c, make_verified = _pay_client(monkeypatch)
    from server.users import WELCOME_CHARS

    uid = c.post("/v1/auth/signup", json={"name": "Pay2", "email": "pay2@example.com"}).json()["user"]["id"]
    ref = c.post("/v1/billing/paystack/initialize", json={"amount_kobo": 100_000}).json()["reference"]

    # Paystack says success but no webhook arrived: pending, wallet untouched
    make_verified.current = make_verified(100_000, uid, ref)
    r = c.get("/v1/billing/paystack/verify", params={"reference": ref})
    assert r.status_code == 200
    assert r.json()["status"] == "pending"
    assert c.get("/v1/billing/balance").json()["balance_chars"] == WELCOME_CHARS

    # another wallet's session reading my reference: must 403
    c2 = client()
    c2.post("/v1/auth/signup", json={"name": "Other", "email": "other@example.com"})
    r = c2.get("/v1/billing/paystack/verify", params={"reference": ref})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "wrong_wallet"

    # Paystack says the payment failed: reported failed, still no credit
    make_verified.current = make_verified(100_000, uid, ref, status="failed")
    r = c.get("/v1/billing/paystack/verify", params={"reference": ref})
    assert r.json()["status"] == "failed"
    assert c.get("/v1/billing/balance").json()["balance_chars"] == WELCOME_CHARS


def test_paystack_webhook_hmac_and_fulfill(monkeypatch):
    import hashlib
    import hmac as hmac_mod
    import json as json_mod

    c, make_verified = _pay_client(monkeypatch)
    uid = c.post("/v1/auth/signup", json={"name": "Pay3", "email": "pay3@example.com"}).json()["user"]["id"]
    ref = c.post("/v1/billing/paystack/initialize", json={"amount_kobo": 50_000}).json()["reference"]

    verified = make_verified(50_000, uid, ref)
    make_verified.current = verified

    event = {"event": "charge.success", "data": {**verified, "metadata": {"uid": uid}}}
    raw = json_mod.dumps(event).encode()
    sig = hmac_mod.new(b"sk_test_dummy", raw, hashlib.sha512).hexdigest()

    before = c.get("/v1/billing/balance").json()["balance_chars"]
    r = c.post("/v1/billing/paystack/webhook", content=raw,
               headers={"x-paystack-signature": sig, "Content-Type": "application/json"})
    assert r.status_code == 200
    after = c.get("/v1/billing/balance").json()["balance_chars"]
    assert after == before + 50_000 * 10  # CHARS_PER_KOBO

    # replay the same webhook: still 200, no double credit
    r = c.post("/v1/billing/paystack/webhook", content=raw,
               headers={"x-paystack-signature": sig, "Content-Type": "application/json"})
    assert r.status_code == 200
    assert c.get("/v1/billing/balance").json()["balance_chars"] == after

    # forged signature: 401, nothing happens
    r = c.post("/v1/billing/paystack/webhook", content=raw,
               headers={"x-paystack-signature": "0" * 128, "Content-Type": "application/json"})
    assert r.status_code == 401


def test_paystack_only_one_winner_in_a_race(monkeypatch):
    """Two fulfill() calls at once (webhook + verify): one credits, one reports."""
    import threading

    import server.paystack_pay as pay

    c, make_verified = _pay_client(monkeypatch)
    from server.users import WELCOME_CHARS, CHARS_PER_KOBO

    uid = c.post("/v1/auth/signup", json={"name": "Race", "email": "race@example.com"}).json()["user"]["id"]
    ref = c.post("/v1/billing/paystack/initialize", json={"amount_kobo": 200_000}).json()["reference"]
    verified = make_verified(200_000, uid, ref)
    make_verified.current = verified

    users = c.app.state.users
    payments = c.app.state.payments
    results, errors = [], []

    def run():
        try:
            results.append(pay.fulfill(users, payments, uid=uid, data=dict(verified)))
        except Exception as e:  # noqa: BLE001
            errors.append(e)

    threads = [threading.Thread(target=run) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors
    winners = [r for r in results if not r[3]]
    assert len(winners) == 1  # exactly one credit
    assert users.balance(uid) == WELCOME_CHARS + 200_000 * CHARS_PER_KOBO


def test_paystack_history_and_webhook_failure_recorded(monkeypatch):
    import hashlib
    import hmac as hmac_mod
    import json as json_mod

    c, make_verified = _pay_client(monkeypatch)
    uid = c.post("/v1/auth/signup", json={"name": "Hist", "email": "hist@example.com"}).json()["user"]["id"]

    ref_ok = c.post("/v1/billing/paystack/initialize", json={"amount_kobo": 10_000}).json()["reference"]
    ref_bad = c.post("/v1/billing/paystack/initialize", json={"amount_kobo": 10_000}).json()["reference"]

    # history shows both attempts as pending before any payment
    hist = c.get("/v1/billing/paystack/payments").json()["payments"]
    assert {h["reference"] for h in hist} == {ref_ok, ref_bad}
    assert all(h["status"] == "pending" for h in hist)

    # webhook with a mismatched amount: acked 200, credited nothing, recorded failed
    verified = make_verified(9_999, uid, ref_bad)
    make_verified.current = verified  # webhook re-verifies through this
    event = {"event": "charge.success", "data": {**verified, "metadata": {"uid": uid}}}
    raw = json_mod.dumps(event).encode()
    sig = hmac_mod.new(b"sk_test_dummy", raw, hashlib.sha512).hexdigest()
    r = c.post("/v1/billing/paystack/webhook", content=raw,
               headers={"x-paystack-signature": sig, "Content-Type": "application/json"})
    assert r.status_code == 200
    hist = {h["reference"]: h for h in c.get("/v1/billing/paystack/payments").json()["payments"]}
    assert hist[ref_bad]["status"] == "failed"
    assert "amount_mismatch" in hist[ref_bad]["fail_reason"]

    # a good payment fulfills via webhook and history says so
    make_verified.current = make_verified(10_000, uid, ref_ok)
    assert _signed_webhook(c, ref_ok, make_verified.current).status_code == 200
    hist = {h["reference"]: h for h in c.get("/v1/billing/paystack/payments").json()["payments"]}
    assert hist[ref_ok]["status"] == "fulfilled"
    assert hist[ref_ok]["card_last4"] == "4081"

    # history is scoped: another wallet sees none of these
    c2 = client()
    c2.post("/v1/auth/signup", json={"name": "HistOther", "email": "histother@example.com"})
    assert c2.get("/v1/billing/paystack/payments").json()["payments"] == []


def test_admin_gating_and_overview(monkeypatch):
    # unset ADMIN_EMAILS: even a logged-in user is denied with directions
    monkeypatch.delenv("ADMIN_EMAILS", raising=False)
    c = client()
    c.post("/v1/auth/signup", json={"name": "Boss", "email": "boss@example.com"})
    r = c.get("/v1/admin/overview")
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "admin_not_configured"
    # anonymous: 401, not 403
    assert client().get("/v1/admin/overview").status_code == 401

    # configured, but another account: forbidden (list never leaks)
    monkeypatch.setenv("ADMIN_EMAILS", "boss@example.com")
    other = client()
    other.post("/v1/auth/signup", json={"name": "Other", "email": "other@example.com"})
    r = other.get("/v1/admin/overview")
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "admin_forbidden"

    # admin seeds activity: a visit, a render, a preview, a (fake) top-up.
    # The Paystack balance call is stubbed — never real network in tests.
    import server.paystack_pay as pay

    async def fake_balance(path):
        assert path == "/balance"
        return [{"currency": "NGN", "balance": 123456}, {"currency": "USD", "balance": 0}]

    monkeypatch.setattr(pay, "_ps_get", fake_balance)
    assert c.post("/v1/metrics/visit", json={"path": "/studio"}).status_code == 200
    assert c.post("/v1/speech", json={"text": "hello admin", "voice_id": "ada"}).status_code == 200
    assert c.post("/v1/speech", json={"text": "free peek", "voice_id": "ada", "preview": True}).status_code == 200
    assert c.post("/v1/billing/topup", json={"amount_kobo": 1000, "card_number": "4242424242424242"}).status_code == 200
    body = c.get("/v1/admin/overview").json()
    assert body["users"]["total"] >= 1 and body["users"]["new_7d"] >= 1
    assert body["logins"]["total"] >= 1  # signup counts as first login
    assert body["visits"]["total"] >= 1
    assert body["visits"]["by_path"][0]["path"] == "/studio"
    assert body["renders"]["total"] >= 2
    assert body["renders"]["chars_total"] >= len("hello admin")
    assert body["renders"]["audio_hours"] >= 0
    assert body["renders"]["previews"]["renders"] >= 1
    assert body["renders"]["previews"]["users"] >= 1
    assert body["revenue"]["kobo_total"] >= 1000
    assert body["revenue"]["paid_in_kobo"] == 0  # fake top-up isn't Paystack money
    assert body["revenue"]["paystack_balance_kobo"] == 123456
    assert len(body["logins"]["series_14d"]) == 14
    assert any(u["email"] == "boss@example.com" for u in body["users"]["recent"])
    # full matrix, all admin-only: funnel, quality, series, leaders, liability
    assert body["funnel"]["signups"] >= 1 and body["funnel"]["activated"] >= 1
    assert body["funnel"]["visits"] >= 1
    assert body["renders"]["quality"]["done"] >= 2
    assert len(body["renders"]["series_14d"]) == 14
    assert body["renders"]["series_14d"][-1]["renders"] >= 2
    assert body["users"]["liability_chars"] >= 0
    assert body["users"]["dormant"] >= 0
    assert any(u["email"] == "boss@example.com" for u in body["users"]["top"])
    assert len(body["revenue"]["series_14d"]) == 14
    assert body["revenue"]["avg_topup_kobo"] >= 0


def test_model_url_guessing():
    from server import model_fetch as mf

    assert mf.hf_url_for_stem("en_US-lessac-medium") == (
        "https://huggingface.co/rhasspy/piper-voices/resolve/main"
        "/en/en_US/lessac/medium/en_US-lessac-medium.onnx")
    assert mf.hf_url_for_stem("en_GB-alan-medium").endswith(
        "/en/en_GB/alan/medium/en_GB-alan-medium.onnx")
    assert mf.hf_url_for_stem("ada") is None  # not standard: needs explicit URL
    assert mf.hf_url_for_stem("weird") is None


def test_model_manifest_and_skip_existing(tmp_path, monkeypatch):
    from server import model_fetch as mf

    monkeypatch.setenv("PIPER_MODEL_URLS", "custom=https://example.com/custom.onnx")
    assert mf.explicit_urls() == {"custom": "https://example.com/custom.onnx"}
    assert mf.hf_url_for_stem("custom") == "https://example.com/custom.onnx"

    # existing .onnx is never re-downloaded
    (tmp_path / "have.onnx").write_bytes(b"fake")
    missing = mf.needed_files(tmp_path, ["have", "en_US-lessac-medium"])
    assert "have" not in missing
    assert missing["en_US-lessac-medium"][0].endswith("en_US-lessac-medium.onnx")
    assert missing["en_US-lessac-medium"][1].endswith("en_US-lessac-medium.onnx.json")


def test_model_download_writes_files(tmp_path, monkeypatch):
    from server import model_fetch as mf

    def fake_download(url, dest, retries=3):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"voice-bytes")
        return True

    monkeypatch.setattr(mf, "_download", fake_download)
    results = mf.ensure_models(tmp_path, ["en_US-lessac-medium"])
    assert results == {"en_US-lessac-medium": True}
    assert (tmp_path / "en_US-lessac-medium.onnx").read_bytes() == b"voice-bytes"
    assert (tmp_path / "en_US-lessac-medium.onnx.json").read_bytes() == b"voice-bytes"


def test_piper_lazy_load_and_tone_fallback(tmp_path, monkeypatch):
    from server.providers.piper import PiperProvider

    monkeypatch.setenv("PIPER_PRELOAD", "false")
    p = PiperProvider(["ada"], models_dir=str(tmp_path))
    p.load()  # no preload: no engines, no crash, no network
    assert p.live_voices == []
    assert p._loaded is True
    # missing files + no piper lib/files -> deterministic tone, never raises
    pcm = p.synthesize_full("hello lazy", "ada")
    assert isinstance(pcm, bytes) and len(pcm) > 0
    assert p._ensure_engine("ada") is False  # nothing on disk to load


def test_piper_preload_default_true(tmp_path, monkeypatch):
    from server.providers.piper import PiperProvider

    monkeypatch.delenv("PIPER_PRELOAD", raising=False)
    p = PiperProvider(["ada"], models_dir=str(tmp_path))
    assert PiperProvider._preload_enabled() is True
    p.load()  # no files, no piper lib: still tone fallback, still no crash
    assert p.synthesize_full("hi", "ada")


def test_unified_transaction_history(monkeypatch):
    c, make_verified = _pay_client(monkeypatch)
    c.post("/v1/auth/signup", json={"name": "Txn", "email": "txn@example.com"})
    uid = c.get("/v1/users/me").json()["id"]

    ref_ok = c.post("/v1/billing/paystack/initialize", json={"amount_kobo": 20_000}).json()["reference"]
    ref_bad = c.post("/v1/billing/paystack/initialize", json={"amount_kobo": 20_000}).json()["reference"]

    # two pendings, nothing confirmed yet
    txns = c.get("/v1/billing/transactions").json()["transactions"]
    assert len(txns) == 2
    assert all(t["status"] == "pending" and t["kind"] == "payment" for t in txns)

    # fulfill one via webhook, fail the other via amount mismatch
    make_verified.current = make_verified(20_000, uid, ref_ok)
    assert _signed_webhook(c, ref_ok, make_verified.current).status_code == 200
    bad = make_verified(19_999, uid, ref_bad)
    make_verified.current = bad
    assert _signed_webhook(c, ref_bad, bad).status_code == 200

    txns = {t["id"]: t for t in c.get("/v1/billing/transactions").json()["transactions"]}
    # fulfilled money appears ONCE, as a confirmed top-up (not as payment + top-up)
    assert [t for t in txns.values() if t["status"] == "confirmed" and t["kind"] == "topup"]
    assert ref_ok not in txns
    assert txns[ref_bad]["status"] == "failed"
    assert txns[ref_bad]["kind"] == "payment"
