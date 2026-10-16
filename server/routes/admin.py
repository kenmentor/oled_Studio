"""Admin observability: one overview of the whole business. ADMIN-ONLY.

Gate: ADMIN_EMAILS (comma-separated login emails, e.g. yours). Unset =
deny-everything with a message saying what to set; set = only those
emails. The list itself is never revealed (403 either way, code differs
so YOU can tell misconfig from non-admin while debugging).

Every stat on this site lives here and ONLY here: no other route does
cross-user reads, and the frontend never computes business numbers from
per-user endpoints. If it's not in this payload, it isn't tracked.

Shape (all wallet-scoped reads happen here, nowhere else):
  users    total, new_7d, dormant (0 renders), liability_chars (owed),
           top[{email,renders,chars,paid}], recent[...]
  logins   total, last_7d, series_14d[{day,count}], by_method{method:count},
           recent[{email,method,at}]
  visits   total, last_7d, series_14d, by_path[{path,count}]
  renders  total, chars_total, chars_7d, audio_hours, previews,
           quality{done,errors,error_rate,avg_chars,avg_latency_ms},
           series_14d[{day,renders,chars}], top_keys[{key,renders,chars}],
           by_voice[{voice,renders,chars}],
           by_mode{stream,batch}, recent[{email,chars,voice,mode,at}]
  funnel   visits, signups, activated (≥1 render), paid (≥1 fulfilled),
           visit_to_signup, signup_to_activated, activated_to_paid (rates)
  revenue  kobo_total, paid_in_kobo (Paystack-fulfilled only),
           paystack_balance_kobo (in-account now, None when unreachable),
           fulfilled, pending, failed, avg_topup_kobo,
           series_14d[{day,kobo,count}], recent[...]
  renders.previews = {users, renders, chars} for the free lane, and
  renders.audio_hours = total generated audio in hours.

NOTE: users/events/payment reads are capped (limit 500, newest first),
so on a large store the leaderboard/series cover recent history, while
totals from count()/sum ledgers stay exact.

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
    by_method: dict[str, int] = {}
    for r in login_rows:
        m = r.get("method", "") or "unknown"
        by_method[m] = by_method.get(m, 0) + 1
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

    # ---- funnel: anonymous visit -> signup -> first render -> first payment.
    # Distinct actors only (repeat visits don't inflate the top of funnel).
    from ..activity import last_days

    rendered_uids = {e.get("user_id", "") for e in events if e.get("user_id")}
    paid_uids = {r.get("uid", "") for r in pay_rows if r.get("status") == "fulfilled" and r.get("uid")}
    activated_uids = {u for u in rendered_uids if u in email_of}
    n_users = len(all_users)
    funnel = {
        "visits": activity.count("visit"),
        "signups": n_users,
        "activated": len(activated_uids),
        "paid": len(paid_uids & set(email_of)),
        "visit_to_signup": round(n_users / max(1, activity.count("visit")), 4),
        "signup_to_activated": round(len(activated_uids) / max(1, n_users), 4),
        "activated_to_paid": round(len(paid_uids & set(email_of)) / max(1, len(activated_uids)), 4),
    }

    # ---- render quality: size, failures, speed (all wallets, all time). ----
    done_rows = [e for e in events if e.get("status") == "done"]
    error_rows = [e for e in events if e.get("status") not in ("done",)]
    lat = [float(e.get("latency_ms", 0) or 0) for e in events if e.get("latency_ms")]
    quality = {
        "done": len(done_rows),
        "errors": len(error_rows),
        "error_rate": round(len(error_rows) / max(1, len(events)), 4),
        "avg_chars": round(chars_total / max(1, len(events)), 1),
        "avg_latency_ms": round(sum(lat) / max(1, len(lat)), 1),
    }

    # ---- per-day series, 14d: renders and paid-in revenue. ----
    days_14 = last_days(14)
    renders_series = [{"day": d, "renders": 0, "chars": 0} for d in days_14]
    ridx = {d: s for d, s in zip(days_14, renders_series)}
    for e in events:
        day = _day(e.get("at", ""))
        if day in ridx:
            ridx[day]["renders"] += 1
            ridx[day]["chars"] += int(e.get("chars", 0))
    revenue_series = [{"day": d, "kobo": 0, "count": 0} for d in days_14]
    vidx = {d: s for d, s in zip(days_14, revenue_series)}
    for r in pay_rows:
        if r.get("status") != "fulfilled":
            continue
        day = _day(r.get("created_at", ""))
        if day in vidx:
            vidx[day]["kobo"] += int(r.get("amount_kobo", 0))
            vidx[day]["count"] += 1

    # ---- per-user leaderboard + dormant + wallet liability. ----
    per_user: dict[str, dict] = {}
    for e in events:
        uid = e.get("user_id", "")
        b = per_user.setdefault(uid, {"renders": 0, "chars": 0})
        b["renders"] += 1
        b["chars"] += int(e.get("chars", 0))
    top_users = sorted(
        ({"email": email_of.get(uid, {}).get("email", "(deleted)"),
          "renders": b["renders"], "chars": b["chars"],
          "paid": uid in paid_uids} for uid, b in per_user.items() if uid),
        key=lambda r: r["chars"], reverse=True,
    )[:8]
    dormant = sum(1 for u in all_users if u["id"] not in rendered_uids)
    liability_chars = sum(int(u.get("balance_chars", 0)) for u in all_users)

    # ---- per-key usage: which secrets actually render. ----
    per_key: dict[str, dict] = {}
    for e in events:
        k = e.get("key_name", "") or "(no key)"
        b = per_key.setdefault(k, {"key": k, "renders": 0, "chars": 0})
        b["renders"] += 1
        b["chars"] += int(e.get("chars", 0))
    top_keys = sorted(per_key.values(), key=lambda b: b["renders"], reverse=True)[:8]

    return {
        "users": {
            "total": len(all_users),
            "new_7d": sum(1 for u in all_users if u.get("created_at", "") >= week_ago),
            "dormant": dormant,
            "liability_chars": liability_chars,
            "top": top_users,
            "recent": recent_users,
        },
        "logins": {
            "total": activity.count("login"),
            "last_7d": logins_7d,
            "series_14d": login_series,
            "by_method": by_method,
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
            "quality": quality,
            "series_14d": renders_series,
            "top_keys": top_keys,
            "by_voice": sorted(by_voice.values(), key=lambda b: b["renders"], reverse=True)[:8],
            "by_mode": by_mode,
            "recent": recent_renders,
        },
        "funnel": funnel,
        "revenue": {
            "kobo_total": users.revenue_kobo(),
            "paid_in_kobo": paid_in_kobo,
            "paystack_balance_kobo": paystack_balance_kobo,
            "fulfilled": fulfilled,
            "pending": pending,
            "failed": failed,
            "avg_topup_kobo": round(paid_in_kobo / max(1, fulfilled)),
            "series_14d": revenue_series,
            "recent": recent_payments,
        },
    }
