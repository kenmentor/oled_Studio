"""Persona billing: balance, fake-card top-up, usage, invoices.

Single tenant for now (fixed persona, the future auth user). Every row
carries user_id so auth later is a filter, not a migration.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from ..models import BalanceResponse, TopupRequest, TopupResponse
from ..users import PERSONA_ID
from .auth import login_required, session_uid

router = APIRouter(tags=["billing"])


def get_users(request: Request):
    return request.app.state.users


def _scoped_uid(request: Request, explicit: str = "") -> str:
    """Session wins; REQUIRE_LOGIN=true demands it; else param/persona."""
    from .errors import api_error

    suid = session_uid(request)
    if suid:
        return suid
    if login_required():
        raise api_error(401, "login_required", "sign in with GitHub first")
    return explicit.strip() or PERSONA_ID


@router.get("/v1/billing/balance", response_model=BalanceResponse)
def balance(request: Request, user_id: str = "", users=Depends(get_users)):
    uid = _scoped_uid(request, user_id)
    users.ensure_persona()
    doc = users.get(uid)
    if doc is None:
        from .errors import api_error

        raise api_error(404, "unknown_user", f"no such user: {uid}")
    bal = int(doc["balance_chars"])
    spent = users.spent(uid)
    return BalanceResponse(user_id=uid, email=doc["email"], balance_chars=bal,
                           spent_chars=spent, granted_chars=bal + spent)


@router.post("/v1/billing/topup", response_model=TopupResponse)
def topup(body: TopupRequest, request: Request, users=Depends(get_users)):
    from ..paystack_pay import allow_fake_topup, configured
    from .errors import api_error

    # Real money guard: once Paystack is configured, the demo top-up that
    # mints credits for a fake card number must die — otherwise anyone can
    # fund wallets for free. Tests/dev opt back in with ALLOW_FAKE_TOPUP=true.
    if configured() and not allow_fake_topup():
        raise api_error(403, "fake_topup_disabled", "fund the wallet with Paystack instead")

    uid = _scoped_uid(request, body.user_id)
    users.ensure_persona()
    if users.get(uid) is None:
        raise api_error(404, "unknown_user", f"no such user: {uid}")
    digits = "".join(c for c in body.card_number if c.isdigit())
    if len(digits) < 12:
        raise api_error(400, "bad_request", "card number must have at least 12 digits")
    bal, inv = users.topup(uid, body.amount_kobo, digits)
    return TopupResponse(balance_chars=bal, granted_chars=inv.granted_chars, invoice=inv)


@router.get("/v1/usage")
def usage(request: Request, limit: int = 100, user_id: str = "", users=Depends(get_users)):
    users.ensure_persona()
    return {"events": users.usage(_scoped_uid(request, user_id), limit=max(1, min(limit, 500)))}


@router.get("/v1/billing/invoices")
def invoices(request: Request, user_id: str = "", users=Depends(get_users)):
    users.ensure_persona()
    return {"invoices": users.invoices(_scoped_uid(request, user_id))}
