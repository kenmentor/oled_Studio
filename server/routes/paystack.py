"""Paystack wallet funding: initialize -> Checkout -> webhook credits.

The whole flow in 4 steps (read this first — everything below is one step):
  1. INITIALIZE (you click "Pay with Paystack"): the server books a
     reference (oled-...) as PENDING and asks Paystack for a Checkout URL.
     No money moves. ✅ OK looks like:
     `[paystack] checkout opened oled-.... amount=850000 kobo owner=user-...`
  2. CHECKOUT (browser leaves for checkout.paystack.com): the user pays
     there with a card. Card details never touch our servers.
  3. WEBHOOK (Paystack calls us): charge.success arrives. This is THE ONLY
     place money moves — after an HMAC signature check AND a fresh
     re-verification with Paystack. ✅ OK looks like:
     `[paystack] webhook charge.success oled-... -> user-... (already=False)`
     (already=True just means a duplicate delivery — still exactly 1 credit.)
  4. VERIFY (callback page polls): READ-ONLY status report so the UI knows
     when step 3 has happened. It can NEVER credit — a forged callback URL
     must never be able to mint money.

If step 3 hasn't arrived yet, verify says "pending" and the UI keeps
polling. Localhost can't receive webhooks, so local testing tunnels them:
  paystack login
  webhook listen localhost:8000/v1/billing/paystack/webhook   (test mode)
"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from .. import paystack_pay as pay
from ..models import InvoiceInfo
from .auth import session_uid
from .billing import get_users
from .errors import api_error

router = APIRouter(tags=["billing"])


def get_payments(request: Request):
    # The payments store lives on app.state (memory locally, Mongo in prod).
    # It holds every attempt: pending -> processing -> fulfilled | failed.
    return request.app.state.payments


def _uid_or_401(request: Request) -> str:
    # Top-ups always need a LOGGED-IN wallet. Never the persona, never a
    # ?user_id= param — otherwise anyone could fund anyone's wallet or read
    # anyone's payment history by naming their id.
    uid = session_uid(request)
    if not uid:
        raise api_error(401, "login_required", "sign in first")
    return uid


class PaystackInitRequest(BaseModel):
    # Kobo (not naira!): Paystack amounts are always in the subunit.
    # Bounds keep fat-finger typos and abusive amounts out.
    amount_kobo: int = Field(ge=100, le=10_000_000)


class PaystackInitResponse(BaseModel):
    authorization_url: str  # send the browser HERE (checkout.paystack.com/...)
    reference: str  # our oled-... id — the UI polls verify with this


class PaystackConfig(BaseModel):
    enabled: bool  # False = server has no PAYSTACK_SECRET yet
    test_mode: bool  # True = test keys (safe). False = live keys (real money).


class PaystackPayment(BaseModel):
    # One raw attempt record — the audit trail (see /transactions for the
    # user-facing feed where fulfilled money appears exactly once).
    reference: str
    amount_kobo: int
    status: str  # pending | processing | fulfilled | failed
    card_last4: str = ""
    paid_at: str = ""
    fail_reason: str = ""  # why it never credited (amount_mismatch, ...)
    created_at: str = ""


@router.get("/v1/billing/paystack/config", response_model=PaystackConfig)
def config():
    # Public info only — the SECRET key never leaves the server. The public
    # key is public by design (it lives in every checkout page), so we don't
    # even need to expose it here for the redirect flow.
    return PaystackConfig(enabled=pay.configured(), test_mode=pay.is_test_key())


@router.get("/v1/billing/paystack/payments")
def payment_history(request: Request, limit: int = 50):
    # Raw attempt records for THIS wallet only (session uid, never a param).
    # Most screens want /v1/billing/transactions instead.
    uid = _uid_or_401(request)
    rows = request.app.state.payments.list_for(uid, limit=limit)
    return {"payments": [
        PaystackPayment(
            reference=r.get("reference", ""), amount_kobo=int(r.get("amount_kobo", 0)),
            status=r.get("status", ""), card_last4=r.get("card_last4", ""),
            paid_at=r.get("paid_at", ""), fail_reason=r.get("fail_reason", ""),
            created_at=r.get("created_at", ""),
        ).model_dump() for r in rows
    ]}


class Transaction(BaseModel):
    id: str
    kind: str = Field(description="'topup' (money moved) or 'payment' (attempt).")
    status: str = Field(description="'confirmed' | 'pending' | 'processing' | 'failed'.")
    amount_kobo: int
    granted_chars: int = 0
    label: str = ""
    created_at: str = ""


@router.get("/v1/billing/transactions")
def transaction_history(request: Request, limit: int = 50, users=Depends(get_users)):
    # ONE chronological money feed. The trick: fulfilled payments appear ONCE,
    # as their confirmed top-up invoices — so the same ₦8,500 never shows up
    # as both "payment oled-..." AND "top-up OLED-...". Pending/failed
    # attempts (no invoice) appear with their status instead of vanishing.
    uid = _uid_or_401(request)
    users.ensure_persona()
    items: list[dict] = []
    # 1) Receipts: invoices = money that actually moved. Always "confirmed".
    for inv in users.invoices(uid, limit=limit):
        items.append({
            "id": inv.get("id", ""), "kind": "topup", "status": "confirmed",
            "amount_kobo": int(inv.get("amount_kobo", 0)),
            "granted_chars": int(inv.get("granted_chars", 0)),
            "label": f"{inv.get('number', '')} · card •••• {inv.get('card_last4', '')}",
            "created_at": inv.get("created_at", ""),
        })
    # 2) Attempts WITHOUT an invoice: still in flight, or never credited.
    for r in request.app.state.payments.list_for(uid, limit=limit):
        if r.get("status") == "fulfilled":
            continue  # shown once above, as its confirmed top-up invoice
        status = r.get("status", "")
        status = status if status in ("pending", "processing", "failed") else "pending"
        detail = r.get("fail_reason", "") if status == "failed" else "waiting for payment…"
        items.append({
            "id": r.get("reference", ""), "kind": "payment", "status": status,
            "amount_kobo": int(r.get("amount_kobo", 0)), "granted_chars": 0,
            "label": f"{r.get('reference', '')} · {detail}",
            "created_at": r.get("created_at", ""),
        })
    # 3) Newest first, capped so one wallet can't page forever.
    items.sort(key=lambda t: t["created_at"], reverse=True)
    items = items[: max(1, min(limit, 200))]
    return {"transactions": [Transaction(**t).model_dump() for t in items]}


@router.post("/v1/billing/paystack/initialize", response_model=PaystackInitResponse)
async def initialize(body: PaystackInitRequest, request: Request, users=Depends(get_users)):
    # STEP 1 — book the attempt, then ask Paystack for a Checkout URL.
    pay.check_usable()  # 503 unless test keys (or explicitly allowed live)
    uid = _uid_or_401(request)  # whose wallet gets credited later
    doc = users.get(uid)
    if doc is None:
        raise api_error(404, "unknown_user", f"no such user: {uid}")
    payments = request.app.state.payments
    reference = pay.new_reference(uid)  # unique oled-... id (Paystack-safe chars)
    # Booked as PENDING first: if Paystack is down, history still shows the
    # attempt instead of silently dropping it.
    payments.save_pending(reference, uid, body.amount_kobo, doc.get("email", ""))
    try:
        # metadata {uid, amount_kobo} rides along INSIDE Paystack, signed by
        # them — it's how the webhook later proves whose wallet this is.
        data = await pay.initialize(doc.get("email", ""), body.amount_kobo, reference, uid)
    except RuntimeError as e:
        raise api_error(502, "paystack_error", str(e) or "paystack request failed")
    url = str(data.get("authorization_url", ""))
    if not url:
        raise api_error(502, "paystack_error", "no authorization_url from paystack")
    # ✅ OK: attempt booked + Checkout URL ready. Watch the server log for:
    #    [paystack] checkout opened oled-... amount=... kobo owner=user-...
    print(f"[paystack] checkout opened {reference} amount={body.amount_kobo} kobo owner={uid}")
    return PaystackInitResponse(authorization_url=url, reference=str(data.get("reference", reference)))


class PaystackVerifyResponse(BaseModel):
    status: str = Field(description="'pending' | 'confirmed' | 'failed'.")
    balance_chars: int  # live wallet balance right now
    granted_chars: int = 0  # >0 only on the confirmation of a fresh credit
    invoice: InvoiceInfo | None = None  # the receipt, once it exists
    fail_reason: str = ""


@router.get("/v1/billing/paystack/verify", response_model=PaystackVerifyResponse)
async def verify(reference: str, request: Request, users=Depends(get_users)):
    # STEP 4 — READ-ONLY status for polling. This function has NO code path
    # that credits anything: no users.topup(), no fulfill(). That absence is
    # deliberate — it is what makes forged callbacks harmless.
    # Meanings: pending = webhook hasn't arrived (or user hasn't paid) → keep
    # polling; confirmed = webhook credited → show receipt; failed = over.
    pay.check_usable()
    uid = _uid_or_401(request)
    reference = reference.strip()
    if not reference:
        raise api_error(400, "bad_request", "reference is required")
    users.ensure_persona()
    payments = request.app.state.payments
    try:
        # Ask PAYSTACK (not the browser) what this reference looks like now.
        data = await pay.fetch_verified(reference)
    except Exception as e:  # noqa: BLE001
        raise api_error(502, "paystack_error", str(e) or "paystack request failed")

    # Ownership: our record says whose wallet — or, if we never saw this
    # reference (restart lost memory), Paystack-signed metadata says so.
    rec = payments.get(reference)
    if rec is None:
        meta = data.get("metadata") or {}
        if meta.get("purpose") != "wallet_topup" or not meta.get("uid"):
            raise api_error(409, "unknown_reference", "no payment attempt for this reference")
        owner = str(meta["uid"])
    else:
        owner = str(rec.get("uid", ""))
    if owner != uid:
        # Your session asking about MY payment → refuse (no info leak either).
        raise api_error(403, "wrong_wallet", "this payment belongs to another account")

    bal = users.balance(uid)
    if rec is not None and rec.get("status") == "fulfilled":
        # ✅ OK (webhook already did its job): report confirmed + receipt.
        invoice = _invoice_for(users, uid, rec.get("invoice_id", ""))
        return PaystackVerifyResponse(
            status="confirmed", balance_chars=bal,
            granted_chars=invoice.granted_chars if invoice else 0,
            invoice=invoice)
    if rec is not None and rec.get("status") == "failed":
        # ✅ OK (recorded, nothing credited): report why, so support can act.
        return PaystackVerifyResponse(status="failed", balance_chars=bal,
                                      fail_reason=rec.get("fail_reason", ""))
    ps_status = data.get("status")  # Paystack-side status (NOT our record)
    if ps_status in ("failed", "reversed"):
        return PaystackVerifyResponse(status="failed", balance_chars=bal,
                                      fail_reason=f"paystack reports {ps_status}")
    # success-but-not-fulfilled = webhook still in flight → keep polling.
    # Anything else (abandoned/ongoing/pending/...) = user hasn't paid yet.
    return PaystackVerifyResponse(status="pending", balance_chars=bal)


def _invoice_for(users, uid: str, invoice_id: str) -> InvoiceInfo | None:
    # The webhook stores the invoice id on the fulfilled record; look the
    # receipt back up so "confirmed" comes with the paper trail attached.
    if not invoice_id:
        return None
    for inv in users.invoices(uid, limit=200):
        if inv.get("id") == invoice_id:
            return InvoiceInfo(
                id=inv["id"], number=inv.get("number", ""),
                amount_kobo=int(inv.get("amount_kobo", 0)),
                granted_chars=int(inv.get("granted_chars", 0)),
                card_last4=inv.get("card_last4", ""),
                created_at=inv.get("created_at", ""))
    return None


@router.post("/v1/billing/paystack/webhook")
async def webhook(request: Request):
    # STEP 3 — THE ONLY PLACE MONEY MOVES. Three gates in order:
    #   Gate 1 (HMAC): is this really from Paystack? Computed over the RAW
    #     bytes — parsing to JSON first would change whitespace and break it.
    #   Gate 2 (event): only charge.success is money. Everything else is
    #     acked and ignored (subscriptions, disputes, ...).
    #   Gate 3 (re-verify): the event body is NOT trusted — we fetch the
    #     transaction fresh from Paystack, then fulfill() enforces
    #     success-status + exact kobo + NGN + right wallet + one credit.
    # Always 200 after Gate 1: anything else makes Paystack retry for hours.
    raw = await request.body()  # RAW bytes — never request.json() first
    sig = request.headers.get("x-paystack-signature", "")
    if not pay.verify_signature(raw, sig):
        # ❌ NOT OK: someone forged a webhook (or wrong secret). 401, no ack
        # semantics — Paystack's real retries always carry a valid signature.
        print("[paystack] webhook rejected: bad signature")
        raise api_error(401, "bad_signature", "webhook signature mismatch")
    try:
        event = json.loads(raw.decode("utf-8"))
    except Exception:
        return {"ok": True}  # signed but unreadable: ack, nothing to do
    if event.get("event") != "charge.success":
        return {"ok": True}  # not money: ack and ignore
    data = event.get("data") or {}
    reference = str(data.get("reference", ""))
    # Whose wallet? The metadata WE set at initialize (Paystack-signed now).
    meta = data.get("metadata") or {}
    uid = str(meta.get("uid", ""))
    if not reference or not uid:
        return {"ok": True}  # can't attribute it: ack, credit nothing
    users = request.app.state.users
    payments = request.app.state.payments
    try:
        live = await pay.fetch_verified(reference)  # Gate 3: fresh truth
    except Exception as e:  # noqa: BLE001 — paystack/network hiccup: they retry
        print(f"[paystack] webhook verify failed for {reference}: {e}")
        return {"ok": True}  # we stay 200 either way
    try:
        _, _, _, already = pay.fulfill(users, payments, uid=uid, data=live)
    except Exception as e:  # noqa: BLE001 — mismatch etc: record it, still ack
        reason = getattr(e, "detail", None)
        code = reason.get("code", "fulfill_failed") if isinstance(reason, dict) else "fulfill_failed"
        payments.mark_failed(reference, f"{code}: {e}")  # visible in history
        print(f"[paystack] webhook {reference} NOT credited ({code})")  # ❌ NOT OK
        return {"ok": True}
    # ✅ OK: credited once (already=True = duplicate delivery, still 1 credit).
    print(f"[paystack] webhook charge.success {reference} -> {uid} (already={already})")
    return {"ok": True}
