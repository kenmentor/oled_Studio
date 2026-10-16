"""Paystack payments (test mode first, money = careful).

Flow (redirect/Checkout — no card data ever touches our servers):
  1. POST /v1/billing/paystack/initialize {amount_kobo}
     -> server creates reference oled-... , stores pending {uid, amount},
        calls Paystack, returns {authorization_url, reference}.
  2. User pays on checkout.paystack.com (test card: 4084 0840 8408 4081).
  3. Paystack fires charge.success at /v1/billing/paystack/webhook
     -> THE ONLY PLACE money moves: HMAC check, re-verify with Paystack,
        credit once (atomic claim per reference). Local testing tunnels
        webhooks via the Paystack CLI:
        `webhook listen localhost:8000/v1/billing/paystack/webhook`.
  4. Paystack redirects to <FRONTEND_URL>/billing/callback?reference=...
     -> frontend polls GET /v1/billing/paystack/verify?reference=...
     -> READ-ONLY: reports pending/confirmed/failed from our records +
        Paystack. Never credits — if it did, a forged callback could mint
        money without any webhook ever arriving.

Money rules (all enforced in fulfill()):
  - data.status must be "success" (top-level status is the API call, NOT
    the payment — per Paystack docs).
  - data.amount (kobo, what was actually paid) must EXACTLY equal the
    pending amount. No partial-credit, no over-credit.
  - data.currency must be NGN (our ledger is NGN kobo).
  - The pending record's uid must equal the session uid (no crediting
    someone else's wallet with your reference).
  - A fulfilled reference never credits twice (webhook + verify race,
    Paystack retries, double-clicks).

Secrets: PAYSTACK_SECRET lives server-side only. The public key is public
by design (exposed via /config for future InlineJS use). Live keys
(sk_live_/pk_live_) are REFUSED unless PAYSTACK_ALLOW_LIVE=true — test
mode stays test mode by default.

HOW TO READ THE SERVER LOG (every line starts with [paystack]):
  [paystack] checkout opened oled-... amount=... owner=user-...
      ✅ OK: step 1 done — attempt booked as PENDING, Checkout URL sent.
  [paystack] webhook charge.success oled-... -> user-... (already=False)
      ✅ OK: money moved EXACTLY ONCE — wallet credited, invoice written.
  [paystack] webhook charge.success oled-... -> user-... (already=True)
      ✅ OK: duplicate delivery (retry/double webhook) — recognized and
      ignored. Balance unchanged. This is the idempotency working.
  [paystack] webhook oled-... NOT credited (amount_mismatch)
      ❌ NOT OK: paid amount != booked amount. Nothing credited (correct!),
      reason saved in history. Check the amounts, then support.
  [paystack] webhook rejected: bad signature
      ❌ NOT OK: forged webhook or wrong PAYSTACK_SECRET. Nothing processed.
  [paystack] webhook verify failed for oled-...: ...
      ⚠️ Paystack/network hiccup while re-verifying. We return 200 so
      Paystack retries; nothing credited yet. If it persists, check network.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
from datetime import datetime, timezone


def _get(name: str, default: str = "") -> str:
    # Env lookup with whitespace stripped — a pasted key with a trailing
    # newline would otherwise fail Paystack auth with a confusing 401.
    return os.getenv(name, default).strip()


def secret_key() -> str:
    # THE secret. Only ever sent TO api.paystack.co in an Authorization
    # header. Never logged, never returned by any endpoint, never sent to
    # the browser. (Your env names: PAYSTACK_SECRET / PAYSTACK_PUBLIC.)
    return _get("PAYSTACK_SECRET")


def public_key() -> str:
    # Public by design — safe for checkout pages. Currently unused (the
    # redirect flow needs no browser-side key).
    return _get("PAYSTACK_PUBLIC")


def configured() -> bool:
    # Do we have ANY secret? The funding UI shows "not configured" otherwise.
    return bool(secret_key())


def is_test_key(key: str = "") -> bool:
    # Test keys start sk_test_; live keys sk_live_. Test mode = play money.
    key = key or secret_key()
    return key.startswith("sk_test_")


def allow_live() -> bool:
    # Live money needs TWO things: an sk_live_ key AND this flag. Forgetting
    # the flag with live keys = loud 503 instead of silent real charges.
    return _get("PAYSTACK_ALLOW_LIVE", "false").lower() in ("1", "true", "yes")


def allow_fake_topup() -> bool:
    # The old demo top-up (free credits for a fake card) is only legal when
    # explicitly enabled (tests/dev). In prod with Paystack set, it's 403.
    return _get("ALLOW_FAKE_TOPUP", "false").lower() in ("1", "true", "yes")


def check_usable() -> None:
    # Gate every money endpoint. Raises 503 (never leaks key values) when:
    # no secret at all, or a LIVE key without the explicit live flag.
    from .routes.errors import api_error

    if not configured():
        raise api_error(503, "paystack_unconfigured", "set PAYSTACK_SECRET first")
    if not is_test_key() and not allow_live():
        raise api_error(503, "paystack_live_blocked",
                        "live keys need PAYSTACK_ALLOW_LIVE=true — test mode only")


def new_reference(uid: str) -> str:
    # Unique id per attempt, e.g. oled-6775d23f-9f2c1a4b. Paystack only allows
    # letters/digits/-/./= so the uid is scrubbed first. Random suffix =
    # two ₦8,500 top-ups never share a reference (idempotency needs this).
    short = re.sub(r"[^a-zA-Z0-9]", "", uid)[-8:] or "user"
    return f"oled-{short}-{secrets.token_hex(4)}"


def callback_url() -> str:
    # Where Paystack sends the browser after payment. Explicit override wins
    # (prod), else built from FRONTEND_URL (dev: http://127.0.0.1:3001).
    # Empty = Paystack uses the dashboard default — still fine.
    override = _get("PAYSTACK_CALLBACK_URL").rstrip("/")
    if override:
        return override
    front = _get("FRONTEND_URL").strip().rstrip("/")
    if front:
        return f"{front}/billing/callback"
    return ""


def verify_signature(raw_body: bytes, header: str) -> bool:
    # Gate 1 of the webhook: prove the call REALLY came from Paystack.
    # Paystack signs the exact RAW bytes with our secret (HMAC-SHA512 hex).
    # RAW is essential — parsing to JSON and re-serializing changes
    # whitespace and would break the signature. compare_digest (not ==)
    # blocks timing attacks that guess the signature byte by byte.
    secret = secret_key()
    if not secret or not header:
        return False
    digest = hmac.new(secret.encode(), raw_body, hashlib.sha512).hexdigest()
    return hmac.compare_digest(digest, header.strip())


async def _ps_post(path: str, payload: dict) -> dict:
    # Thin POST wrapper. Two details matter:
    #  - body.get("status") is the API CALL's success, not the payment's.
    #    The payment status lives in data.status (checked in fulfill()).
    #  - Separated (not inlined) so tests monkeypatch it — no real network.
    import httpx

    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(
            f"https://api.paystack.co{path}",
            headers={"Authorization": f"Bearer {secret_key()}", "Content-Type": "application/json"},
            json=payload,
        )
        try:
            body = r.json()
        except Exception:
            body = {}
        if r.status_code != 200 or not body.get("status"):
            raise RuntimeError(f"paystack {r.status_code}: {body.get('message', 'request failed')}")
        return body["data"]


async def _ps_get(path: str) -> dict:
    # Same contract as _ps_post, for GET (used by fetch_verified).
    import httpx

    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get(
            f"https://api.paystack.co{path}",
            headers={"Authorization": f"Bearer {secret_key()}"},
        )
        try:
            body = r.json()
        except Exception:
            body = {}
        if r.status_code != 200 or not body.get("status"):
            raise RuntimeError(f"paystack {r.status_code}: {body.get('message', 'request failed')}")
        return body["data"]


async def initialize(email: str, amount_kobo: int, reference: str, uid: str) -> dict:
    # Ask Paystack to open a Checkout for this reference. Returns
    # {authorization_url, reference} — the URL is where the browser goes.
    # metadata rides along INSIDE Paystack (signed by them): when the webhook
    # later arrives, metadata.uid/amount_kobo prove whose wallet and how much
    # — even if our own server restarted and lost its memory in between.
    # "amount" is KOBO (subunit): ₦8,500 = 850000. Wrong unit = 100x charge.
    payload: dict = {
        "email": email,
        "amount": amount_kobo,
        "reference": reference,
        "metadata": {"uid": uid, "amount_kobo": amount_kobo, "purpose": "wallet_topup"},
    }
    cb = callback_url()
    if cb:
        payload["callback_url"] = cb
    return await _ps_post("/transaction/initialize", payload)


async def fetch_verified(reference: str) -> dict:
    # Fresh truth STRAIGHT from Paystack for one reference. Both the webhook
    # (Gate 3) and the read-only verify use this — the event body and the
    # browser URL are never trusted for money, only this response is.
    return await _ps_get(f"/transaction/verify/{reference}")


_balance_cache: dict = {"at": 0.0, "value": None}
_BALANCE_TTL = 60.0  # seconds: the admin page polls; Paystack must not be


async def fetch_balance_kobo() -> int | None:
    """NGN balance sitting IN the Paystack account (settlements not yet
    moved out). Secret-side only — never exposed raw, just the number.
    Cached 60s; ANY failure -> None (admin shows 'unavailable', never 500)."""
    import time

    now = time.monotonic()
    if now - _balance_cache["at"] < _BALANCE_TTL:
        return _balance_cache["value"]
    try:
        data = await _ps_get("/balance")  # [{currency, balance}, ...] in kobo
        rows = data if isinstance(data, list) else data.get("balances", [])
        value = None
        for row in rows:
            if isinstance(row, dict) and row.get("currency") == "NGN":
                value = int(row.get("balance", 0))
                break
        _balance_cache.update(at=now, value=value)
        return value
    except Exception:
        return _balance_cache["value"]  # stale-or-None, never an exception


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class MemoryPaymentStore:
    # Attempt ledger for ONE process (local dev + tests). Every attempt is a
    # record that walks: pending -> processing -> fulfilled, or -> failed.
    # The lock matters: FastAPI runs requests in threads, so a webhook and a
    # retry can literally touch the same dict at the same instant.

    def __init__(self) -> None:
        import threading

        self._payments: dict[str, dict] = {}
        self._lock = threading.Lock()

    def save_pending(self, reference: str, uid: str, amount_kobo: int, email: str) -> None:
        with self._lock:
            # setdefault (NOT overwrite): a duplicate initialize for the same
            # reference must never reset a fulfilled/failed record to pending.
            self._payments.setdefault(reference, {
                "reference": reference, "uid": uid, "amount_kobo": amount_kobo,
                "email": email, "status": "pending", "paystack_id": None,
                "card_last4": "", "paid_at": "", "fail_reason": "",
                "invoice_id": "", "created_at": _now(), "updated_at": _now(),
            })

    def get(self, reference: str) -> dict | None:
        with self._lock:
            rec = self._payments.get(reference)
            return dict(rec) if rec else None

    def all_payments(self, limit: int = 200) -> list[dict]:
        """Every attempt, all wallets, newest first (admin route only)."""
        with self._lock:
            rows = sorted(self._payments.values(),
                          key=lambda r: r.get("created_at", ""), reverse=True)
        return [dict(r) for r in rows[: max(1, min(limit, 500))]]  # copy: callers can't mutate it

    def list_for(self, uid: str, limit: int = 50) -> list[dict]:
        # This wallet's attempts, newest first — feeds history + transactions.
        with self._lock:
            rows = [dict(r) for r in self._payments.values() if r.get("uid") == uid]
        rows.sort(key=lambda r: r.get("created_at", ""), reverse=True)
        return rows[: max(1, min(limit, 200))]

    def claim_processing(self, reference: str) -> bool:
        # THE race guard: pending -> processing, atomically under the lock.
        # Webhook + retry arriving together: exactly one gets True (the
        # winner, who credits); the other gets False (reports already).
        with self._lock:
            rec = self._payments.get(reference)
            if rec is None or rec.get("status") != "pending":
                return False
            rec["status"] = "processing"
            rec["updated_at"] = _now()
            return True

    def release_claim(self, reference: str) -> None:
        # Winner crashed between claim and credit: hand the ticket back so a
        # later retry can still credit. Money is never silently lost.
        with self._lock:
            rec = self._payments.get(reference)
            if rec is not None and rec.get("status") == "processing":
                rec["status"] = "pending"
                rec["updated_at"] = _now()

    def mark_fulfilled(self, reference: str, paystack_id: int | None,
                       card_last4: str, paid_at: str, invoice_id: str = "") -> None:
        # Money moved: stamp the proof (Paystack id, card, receipt id).
        with self._lock:
            rec = self._payments.get(reference)
            if rec is None:
                return
            rec["status"] = "fulfilled"
            rec["paystack_id"] = paystack_id
            rec["card_last4"] = card_last4
            rec["paid_at"] = paid_at
            rec["invoice_id"] = invoice_id  # links attempt -> invoice receipt
            rec["updated_at"] = _now()

    def mark_failed(self, reference: str, reason: str) -> None:
        # Money did NOT move, and now history says why (visible in the UI).
        with self._lock:
            rec = self._payments.get(reference)
            if rec is None:
                return
            if rec.get("status") == "fulfilled":
                return  # money already moved: history must not rewrite that
            rec["status"] = "failed"
            rec["fail_reason"] = reason[:200]
            rec["updated_at"] = _now()


class MongoPaymentStore:
    # Same interface as MemoryPaymentStore, but in Mongo's "payments"
    # collection — attempts survive server restarts, so a webhook arriving
    # after a deploy still finds its pending record and credits exactly once.
    # unique index on reference = the DB itself rejects double-booking.

    def __init__(self, collection=None) -> None:
        if collection is not None:
            self._col = collection  # tests inject a fake collection here
            return
        from pymongo import MongoClient

        from .db import DB_NAME, MONGO_URL

        client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=3000)
        self._col = client[DB_NAME]["payments"]
        self._col.create_index("reference", unique=True)

    def ping(self) -> None:
        self._col.find_one({"reference": "__ping__"})

    def all_payments(self, limit: int = 200) -> list[dict]:
        """Every attempt, all wallets, newest first (admin route only)."""
        cur = (self._col.find({}, {"_id": 0})
               .sort("created_at", -1).limit(max(1, min(limit, 500))))
        return list(cur)

    def save_pending(self, reference: str, uid: str, amount_kobo: int, email: str) -> None:
        self._col.update_one(
            {"reference": reference},
            {"$setOnInsert": {
                "reference": reference, "uid": uid, "amount_kobo": amount_kobo,
                "email": email, "status": "pending", "paystack_id": None,
                "card_last4": "", "paid_at": "", "fail_reason": "",
                "invoice_id": "", "created_at": _now(), "updated_at": _now(),
            }},
            upsert=True,
        )

    def get(self, reference: str) -> dict | None:
        return self._col.find_one({"reference": reference}, {"_id": 0})

    def list_for(self, uid: str, limit: int = 50) -> list[dict]:
        cur = (self._col.find({"uid": uid}, {"_id": 0})
               .sort("created_at", -1).limit(max(1, min(limit, 200))))
        return list(cur)

    def claim_processing(self, reference: str) -> bool:
        # Same race guard, Mongo-flavored: the filter {reference, pending}
        # and the update run as ONE atomic step inside the database, across
        # processes and servers — not just threads. Two webhooks racing:
        # exactly one matches "still pending" and wins.
        from pymongo import ReturnDocument

        rec = self._col.find_one_and_update(
            {"reference": reference, "status": "pending"},
            {"$set": {"status": "processing", "updated_at": _now()}},
            return_document=ReturnDocument.AFTER,
        )
        return rec is not None

    def release_claim(self, reference: str) -> None:
        self._col.update_one(
            {"reference": reference, "status": "processing"},
            {"$set": {"status": "pending", "updated_at": _now()}},
        )

    def mark_fulfilled(self, reference: str, paystack_id: int | None,
                       card_last4: str, paid_at: str, invoice_id: str = "") -> None:
        self._col.update_one(
            {"reference": reference},
            {"$set": {"status": "fulfilled", "paystack_id": paystack_id,
                      "card_last4": card_last4, "paid_at": paid_at,
                      "invoice_id": invoice_id, "updated_at": _now()}},
        )

    def mark_failed(self, reference: str, reason: str) -> None:
        rec = self.get(reference)
        if rec is None or rec.get("status") == "fulfilled":
            return  # money already moved: history must not rewrite that
        self._col.update_one(
            {"reference": reference},
            {"$set": {"status": "failed", "fail_reason": reason[:200],
                      "updated_at": _now()}},
        )


def fulfill(users, payments, *, uid: str, data: dict):
    # THE money function — called ONLY by the webhook. Rules in order:
    #   1-3. VALIDATE (reads only, changes nothing): Paystack must say
    #      success (its top-level "status" is just the API call — the payment
    #      status is data.status), currency must be NGN (our ledger unit),
    #      amount must parse as kobo. Any failure = raise, credit nothing.
    #   4. FIND the attempt: our pending record — or, if a restart wiped
    #      memory, rebuild it from Paystack-signed metadata. Already
    #      fulfilled = report (already=True), credit nothing.
    #   5. BIND the money: record's wallet must be THIS wallet, and paid
    #      kobo must EXACTLY equal booked kobo. A single kobo off = raise.
    #   6. CLAIM the ticket (atomic): winner credits, loser reports already.
    #   7. CREDIT: users.topup mints the tokens + writes the invoice, then
    #      the attempt is stamped fulfilled with the receipt id.
    # Returns (balance_chars, granted_chars, invoice, already).
    # Raises api_error on ANY doubt — when in doubt, credit nothing.
    from .models import InvoiceInfo
    from .routes.errors import api_error

    reference = str(data.get("reference", ""))
    # Gate A: Paystack itself must call this payment a success. NOTE the
    # trap: response["status"] is the API call ("did Paystack answer?"),
    # response["data"]["status"] is the PAYMENT. We check data.status here.
    if data.get("status") != "success":
        raise api_error(402, "payment_not_successful",
                        f"paystack status is {data.get('status')!r}, not success")
    # Gate B: our wallet counts NGN kobo. A USD/GHS payment has no meaning
    # here — refuse rather than credit a meaningless amount.
    if str(data.get("currency", "NGN")) != "NGN":
        raise api_error(402, "currency_mismatch", "only NGN top-ups credit the wallet")
    try:
        paid_kobo = int(data.get("amount", 0))  # what the user ACTUALLY paid
    except (TypeError, ValueError):
        raise api_error(502, "paystack_error", "unreadable amount from paystack")
    rec = payments.get(reference) if reference else None
    if rec is None:
        # No record (memory store lost on restart, or webhook beat our DB
        # write): rebuild from Paystack-SIGNED metadata we set at initialize.
        # Wrong/missing purpose = not ours = refuse (409, credit nothing).
        meta = data.get("metadata") or {}
        if meta.get("purpose") != "wallet_topup" or not meta.get("uid"):
            raise api_error(409, "unknown_reference", "no pending top-up for this reference")
        try:
            meta_kobo = int(meta.get("amount_kobo", 0))
        except (TypeError, ValueError):
            raise api_error(502, "paystack_error", "unreadable amount from paystack")
        payments.save_pending(reference, str(meta["uid"]), meta_kobo,
                              str((data.get("customer") or {}).get("email", "")))
        rec = payments.get(reference)
    if rec is not None and rec.get("status") == "fulfilled":
        # ✅ Already fine: duplicate webhook / retry / double poll. The wallet
        # keeps its single credit; we just report the current balance.
        return users.balance(uid), 0, None, True
    expected_uid = str((rec or {}).get("uid", ""))  # wallet booked at init
    expected_kobo = int((rec or {}).get("amount_kobo", 0))  # kobo booked at init

    # Gate C: the money must land in the wallet that opened the checkout.
    # Stops wallet A paying and wallet B claiming the same reference.
    if expected_uid != uid:
        raise api_error(403, "wrong_wallet", "this payment belongs to another account")
    # Gate D: paid kobo must EXACTLY equal booked kobo. Even 1 kobo off =
    # refuse + record amount_mismatch for support. Never "close enough".
    if paid_kobo != expected_kobo:
        raise api_error(409, "amount_mismatch",
                        f"paid {paid_kobo} kobo but expected {expected_kobo} — contact support, do not retry")

    # Gate E: the atomic ticket. Winner goes on to credit; loser(s) report
    # already=True. This is what makes double-delivery safe.
    if not payments.claim_processing(reference):
        return users.balance(uid), 0, None, True
    try:
        auth = data.get("authorization") or {}
        last4 = str(auth.get("last4", "") or "")[-4:] or "0000"
        bal, inv = users.topup(uid, paid_kobo, last4)  # tokens minted HERE
    except Exception:
        payments.release_claim(reference)  # crash safety: ticket handed back
        raise
    payments.mark_fulfilled(reference, data.get("id"),
                            last4, str(data.get("paid_at", "")), inv.id)
    invoice = InvoiceInfo(
        id=inv.id, number=inv.number, amount_kobo=inv.amount_kobo,
        granted_chars=inv.granted_chars, card_last4=inv.card_last4,
        created_at=inv.created_at,
    )
    return bal, inv.granted_chars, invoice, False
