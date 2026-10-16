"""Admin observability: one overview of the whole business.

Gate: ADMIN_EMAILS (comma-separated login emails, e.g. yours). Unset =
deny-everything with a message saying what to set; set = only those
emails. The list itself is never revealed (403 either way, code differs
so YOU can tell misconfig from non-admin while debugging).

Shape (all wallet-scoped reads happen here, nowhere else):
  users    total, new_7d, recent[{name,email,created_at,balance}]
  logins   total, last_7d, series_14d[{day,count}], recent[{email,method,at}]
  visits   total, last_7d, series_14d, by_path[{path,count}]
  renders  total, chars_total, chars_7d, by_voice[{voice,renders,chars}],
           by_mode{stream,batch}, recent[{email,chars,voice,mode,at}]
  revenue  kobo_total, paid_in_kobo (Paystack-fulfilled only),
           paystack_balance_kobo (in-account now, None when unreachable),
           fulfilled, pending, failed,
           recent[{email,amount_kobo,status,reference,created_at}]
  renders.previews = {users, renders, chars} for the free lane, and
  renders.audio_hours = total generated audio in hours.

POST /v1/metrics/visit is PUBLIC (anonymous path hits can't need a login)
and deliberately tiny: path only, capped length, no PII, no cookies read.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from .auth import session_uid
from .billing import get_users
from .errors import api_error

router = APIRouter(tags=["admin"])


def _admin_emails() -> set[str]:
    return {e.strip().lower() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()}


def require_admin(request: Request, users) -> dict:
    """Return the admin's user doc or raise. No session = 401."""
    uid = session_uid(request)
    if not uid:
        raise api_error(401, "login_required", "sign in first")
    allowed = _admin_emails()
    if not allowed:
        raise api_error(403, "admin_not_configured", "set ADMIN_EMAILS to your login email")
    doc = users.get(uid)
    if doc is None or str(doc.get("email", "")).strip().lower() not in allowed:
        raise api_error(403, "admin_forbidden", "this account is not an admin")
    return doc


def _day(at: str) -> str:
    try:
        return datetime.fromisoformat(at).astimezone(timezone.utc).date().isoformat()
    except Exception:
        return ""


def _since(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


class VisitIn(BaseModel):
    path: str = Field(default="/", max_length=128)


@router.post("/v1/metrics/visit")
def visit(body: VisitIn, request: Request):
    """Anonymous page-view beacon. Fire-and-forget from the frontend."""
    path = (body.path or "/").strip()[:128] or "/"
    try:
        request.app.state.activity.record_visit(path)
    except Exception:
        pass  # stats must never break browsing
    return {"ok": True}


@router.get("/v1/admin/overview")
async def overview(request: Request, users=Depends(get_users)):
    require_admin(request, users)
    activity = request.app.state.activity
    payments = request.app.state.payments
    week_ago = _since(7)

    # ---- users: signups ----
    all_users = users.all_users(limit=500)
    email_of = {u["id"]: u for u in all_users}
    recent_users = [
        {"name": u.get("name", ""), "email": u.get("email", ""),
         "created_at": u.get("created_at", ""),
         "balance_chars": int(u.get("balance_chars", 0))}
        for u in all_users[:8]
    ]

    # ---- logins (session starts, by method) ----
    login_rows = activity.recent_logins(limit=200)
    recent_logins = []
    for r in login_rows[:8]:
        u = email_of.get(r.get("uid", ""), {})
        recent_logins.append({"email": u.get("email", "(deleted)"),
                              "method": r.get("method", ""),
                              "at": r.get("at", "")})

    # ---- renders (every TTS call, all wallets) ----
    events = users.all_usage(limit=500)
    chars_total = sum(int(e.get("chars", 0)) for e in events)
    chars_7d = sum(int(e.get("chars", 0)) for e in events if e.get("at", "") >= week_ago)
    by_voice: dict[str, dict] = {}
    by_mode = {"stream": 0, "batch": 0}
    for e in events:
        v = e.get("voice", "") or "—"
        b = by_voice.setdefault(v, {"voice": v, "renders": 0, "chars": 0})
        b["renders"] += 1
        b["chars"] += int(e.get("chars", 0))
        m = e.get("mode", "")
        if m in by_mode:
            by_mode[m] += 1
    recent_renders = []
    for e in events[:8]:
        u = email_of.get(e.get("user_id", ""), {})
        recent_renders.append({"email": u.get("email", "(deleted)"),
                               "chars": int(e.get("chars", 0)),
                               "voice": e.get("voice", ""),
                               "mode": e.get("mode", ""),
                               "status": e.get("status", ""),
                               "at": e.get("at", "")})
    # Free-lane adoption: who previews, how much, plus total audio hours.
    preview_rows = [e for e in events if e.get("mode") == "preview"]
    previews = {
        "users": len({e.get("user_id", "") for e in preview_rows}),
        "renders": len(preview_rows),
        "chars": sum(int(e.get("chars", 0)) for e in preview_rows),
    }
    audio_hours = round(sum(float(e.get("audio_seconds", 0) or 0) for e in events) / 3600, 2)

    # ---- money ----
    pay_rows = payments.all_payments(limit=500)
    fulfilled = sum(1 for r in pay_rows if r.get("status") == "fulfilled")
    pending = sum(1 for r in pay_rows if r.get("status") in ("pending", "processing"))
    failed = sum(1 for r in pay_rows if r.get("status") == "failed")
    # What people actually paid in (Paystack-fulfilled only — demo top-ups
    # excluded), vs kobo_total below which counts every invoice ever written.
    paid_in_kobo = sum(int(r.get("amount_kobo", 0)) for r in pay_rows
                       if r.get("status") == "fulfilled")
    # What sits in the Paystack account right now (None = unreachable).
    from ..paystack_pay import fetch_balance_kobo

    paystack_balance_kobo = await fetch_balance_kobo()
    recent_payments = []
    for r in pay_rows[:8]:
        u = email_of.get(r.get("uid", ""), {})
        recent_payments.append({"email": u.get("email", "(deleted)"),
                                "amount_kobo": int(r.get("amount_kobo", 0)),
                                "status": r.get("status", ""),
                                "reference": r.get("reference", ""),
                                "created_at": r.get("created_at", "")})

    login_series = activity.series("login", 14)
    logins_7d = sum(p["count"] for p in login_series[-7:])
    visit_series = activity.series("visit", 14)
    visits_7d = sum(p["count"] for p in visit_series[-7:])

    return {
        "users": {
            "total": len(all_users),
            "new_7d": sum(1 for u in all_users if u.get("created_at", "") >= week_ago),
            "recent": recent_users,
        },
        "logins": {
            "total": activity.count("login"),
            "last_7d": logins_7d,
            "series_14d": login_series,
            "recent": recent_logins,
        },
        "visits": {
            "total": activity.count("visit"),
            "last_7d": visits_7d,
            "series_14d": visit_series,
            "by_path": activity.top_paths(limit=8),
        },
        "renders": {
            "total": len(events),
            "chars_total": chars_total,
            "chars_7d": chars_7d,
            "audio_hours": audio_hours,
            "previews": previews,
            "by_voice": sorted(by_voice.values(), key=lambda b: b["renders"], reverse=True)[:8],
            "by_mode": by_mode,
            "recent": recent_renders,
        },
        "revenue": {
            "kobo_total": users.revenue_kobo(),
            "paid_in_kobo": paid_in_kobo,
            "paystack_balance_kobo": paystack_balance_kobo,
            "fulfilled": fulfilled,
            "pending": pending,
            "failed": failed,
            "recent": recent_payments,
        },
    }
