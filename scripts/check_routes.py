"""Live route check against http://127.0.0.1:8000. Run: python scripts/check_routes.py"""
import base64
import io
import json
import os
import sys
import urllib.request
import wave

BASE = os.getenv("OLED_BASE", "http://127.0.0.1:8000").rstrip("/")
fails = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (f" [{extra}]" if extra else ""))
    if not cond:
        fails.append(name)


def req(method, path, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(
        BASE + path, data=data, method=method,
        headers={"Content-Type": "application/json", **(headers or {})},
    )
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


import urllib.error  # noqa: E402

# 1. health
s, h, b = req("GET", "/health")
body = json.loads(b)
check("GET /health", s == 200 and body["ok"] is True, str(body))

# 2. voices
s, h, b = req("GET", "/v1/voices")
voices = json.loads(b)["voices"]
check("GET /v1/voices", s == 200 and len(voices) >= 4, f"{len(voices)} voices")
check("voices have samples", all(v.get("sample_url", "").startswith("/samples/") for v in voices))

# 3. voice toggle round-trip
s, h, b = req("PATCH", "/v1/voices/ada", {"enabled": False})
check("PATCH voice disable", s == 200 and json.loads(b)["enabled"] is False)
s, h, b = req("POST", "/v1/speech", {"text": "hi", "voice_id": "ada"})
check("disabled voice refused", s == 400)
s, h, b = req("PATCH", "/v1/voices/ada", {"enabled": True})
check("PATCH voice re-enable", s == 200 and json.loads(b)["enabled"] is True)

# 4. speech -> valid wav (header names are case-insensitive over live HTTP)
s, h, b = req("POST", "/v1/speech", {"text": "Good morning Lagos", "voice_id": "ada"})
hl = {k.lower(): v for k, v in h.items()}
ok = s == 200 and hl.get("content-type") == "audio/wav"
nframes = 0
if ok:
    with wave.open(io.BytesIO(b), "rb") as w:
        ok = w.getnchannels() == 1 and w.getsampwidth() == 2 and w.getframerate() == 24000
        nframes = w.getnframes()
check("POST /v1/speech valid wav", ok, f"{len(b)} bytes, {nframes} frames")
check("speech headers", all(k in hl for k in ("x-request-id", "x-session-id", "x-voice-id", "x-model-version")))

# 5. legacy landing path
s, h, b = req("POST", "/v1/tts", {"text": "hello"})
hl = {k.lower(): v for k, v in h.items()}
check("POST /v1/tts alias", s == 200 and hl.get("content-type") == "audio/wav")

# 6. SSE stream
stream_req = urllib.request.Request(
    BASE + "/v1/speech/stream",
    data=json.dumps({"text": "hello Ada", "voice_id": "ada"}).encode(),
    method="POST",
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(stream_req, timeout=60) as resp:
    raw = resp.read().decode()
events = [json.loads(line[6:]) for line in raw.splitlines() if line.startswith("data: ")]
types = [e["type"] for e in events]
chunks = [e for e in events if e["type"] == "chunk"]
pcm = b"".join(base64.b64decode(e["data"]) for e in chunks)
check("POST /v1/speech/stream", types[0] == "started" and types[-1] == "done" and len(pcm) > 0,
      f"{len(chunks)} chunks, {len(pcm)} pcm bytes")

# 7. samples playable
s, h, b = req("GET", "/samples/ada.wav")
check("GET /samples/ada.wav", s == 200 and b[:4] == b"RIFF", f"{len(b)} bytes")

# 8. keys lifecycle
s, h, b = req("POST", "/v1/keys", {"name": "RouteCheck"})
issued = json.loads(b)
secret = issued["secret"]
kid = issued["key"]["id"]
check("POST /v1/keys issues once", s == 201 and secret.startswith("oled_sk_live_"))
s, h, b = req("GET", "/v1/keys")
listed = json.loads(b)["keys"]
mine = [k for k in listed if k["id"] == kid][0]
check("GET /v1/keys hides secret", "secret" not in mine and "hash" not in mine)
s, h, b = req("POST", "/v1/keys/verify", {"secret": secret})
check("POST /v1/keys/verify valid", json.loads(b)["valid"] is True)
s, h, b = req("DELETE", f"/v1/keys/{kid}")
check("DELETE /v1/keys revokes", s == 200)
s, h, b = req("POST", "/v1/keys/verify", {"secret": secret})
check("revoked key dead", json.loads(b)["valid"] is False)

# 9. persona billing: balance, topup, debit, 402, usage, keyed inference
s, h, b = req("GET", "/v1/billing/balance")
bal0 = json.loads(b)["balance_chars"]
check("GET /v1/billing/balance", s == 200 and bal0 >= 0, f"{bal0} chars")
s, h, b = req("POST", "/v1/billing/topup", {"amount_kobo": 1000, "card_number": "4242424242424242"})
top = json.loads(b)
check("POST /v1/billing/topup mints", s == 200 and top["granted_chars"] == 10000, f"+{top.get('granted_chars')} chars")
s, h, b = req("POST", "/v1/speech", {"text": "billing probe", "voice_id": "ada"})
hl = {k.lower(): v for k, v in h.items()}
check("speech debits persona", s == 200 and int(hl.get("x-balance-chars", -1)) == top["balance_chars"] - len("billing probe"))
s, h, b = req("POST", "/v1/keys", {"name": "BillingProbe"})
probe_secret = json.loads(b)["secret"]
s, h, b = req("POST", "/v1/speech", {"text": "keyed probe", "voice_id": "ada"},
             headers={"Authorization": f"Bearer {probe_secret}"})
check("keyed inference ok", s == 200)
s, h, b = req("GET", "/v1/usage?limit=50")
events = json.loads(b)["events"]
check("GET /v1/usage ledger", s == 200 and any(e["text"] == "keyed probe" for e in events), f"{len(events)} events")
s, h, b = req("GET", "/v1/billing/invoices")
check("GET /v1/billing/invoices", s == 200 and len(json.loads(b)["invoices"]) >= 1)

# 10. auth-lite: signup -> signin -> per-user isolation
import time as _t
email = f"route{_t.time_ns() % 100000}@example.com"
s, h, b = req("POST", "/v1/auth/signup", {"name": "Route", "email": email})
uid = json.loads(b)["user"]["id"] if s == 201 else ""
check("POST /v1/auth/signup", s == 201 and uid.startswith("user-"), email)
s, h, b = req("POST", "/v1/auth/signup", {"name": "Route", "email": email})
check("signup duplicate 409", s == 409)
s, h, b = req("POST", "/v1/auth/signin", {"email": email})
check("POST /v1/auth/signin", s == 200 and json.loads(b)["user"]["id"] == uid)
s, h, b = req("POST", "/v1/auth/signin", {"email": "nobody-here@example.com"})
check("signin unknown 404", s == 404)
s, h, b = req("GET", "/v1/auth/github")
hl = {k.lower(): v for k, v in h.items()}
ok_gh = (
    s == 503  # unconfigured
    or (s in (301, 302, 303, 307) and "github.com" in hl.get("location", ""))
    or (s == 200 and b"github" in b.lower())  # redirect followed to github.com
)
check("GET /v1/auth/github", ok_gh, "503 unconfigured or redirect to github.com")
s, h, b = req("POST", "/v1/auth/logout", None)
check("POST /v1/auth/logout", s == 200)

# 11. split-server: backend is API-only; / returns 404, pages live on :3001.
s, h, b = req("GET", "/")
check("GET / is not frontend (split-server)", s == 404, f"status={s}")

# 12. worker ops (Modal-mimic ledger: spend/efficiency per render)
s, h, b = req("GET", "/v1/worker/stats")
w = json.loads(b)
check("GET /v1/worker/stats", s == 200 and "est_cost_usd" in w and "rtf_avg" in w,
      f"engine={w.get('engine')} reqs={w.get('total_requests')}")
s, h, b = req("POST", "/v1/worker/reset", {})
check("POST /v1/worker/reset", s == 200 and json.loads(b).get("ok") is True)
s, h, b = req("GET", "/v1/worker/stats")
check("worker reset zeroes ledger", json.loads(b).get("total_requests") == 0)

print()
if fails:
    print(f"RESULT: NO — {len(fails)} failing: {fails}")
    sys.exit(1)
print("RESULT: YES — all routes connected and working")
