"""Free preview lane: short docs/demo renders that never touch a wallet.

Why it exists: browsing the docs (or the landing demo) shouldn't drain
anyone's balance. A preview render synthesizes real audio but skips the
debit entirely and is recorded with mode="preview", cost 0 — so spend
math (sum of cost_chars) never sees it.

Abuse containment (this is free audio, after all):
  - PREVIEW_MAX_CHARS (default 200): longer preview asks get a 400, not audio.
  - PREVIEW_DAILY_CHARS_PER_IP (default 2000, 0 = lane disabled): per-IP,
    per-UTC-day budget. Exhausted = 429. In-memory like the rate limiter:
    one process = one budget (documented, same as RateLimitMiddleware).
  - Preview still passes require_key: when auth is enforced you need a key
    to ask, you just aren't CHARGED. The point is unbilled, not unauthenticated.
"""

from __future__ import annotations

import os
import threading
from datetime import datetime, timezone


def _get_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def max_chars() -> int:
    return _get_int("PREVIEW_MAX_CHARS", 200)


def daily_budget() -> int:
    return _get_int("PREVIEW_DAILY_CHARS_PER_IP", 2000)


def enabled() -> bool:
    return daily_budget() > 0 and max_chars() > 0


def client_ip(request) -> str:
    """Same client identity as the rate limiter (proxy-aware)."""
    try:
        fwd = request.headers.get("x-forwarded-for", "")
        if fwd:
            return fwd.split(",")[0].strip()
        return request.client.host if request.client else "unknown"
    except Exception:
        return "unknown"


_lock = threading.Lock()
_spent: dict[str, list] = {}  # ip -> [utc_day_ordinal, chars_used]


def check(ip: str, chars: int) -> None:
    """Raise before synthesizing if this preview must not run. No state change."""
    from .routes.errors import api_error

    if not enabled():
        raise api_error(403, "preview_disabled", "free previews are switched off")
    if chars > max_chars():
        raise api_error(400, "preview_too_long",
                        f"free previews cap at {max_chars()} chars — run it billed instead")
    with _lock:
        day, used = _spent.get(ip, [0, 0])
        today = datetime.now(timezone.utc).date().toordinal()
        if day != today:
            used = 0
        if used + chars > daily_budget():
            raise api_error(429, "preview_budget",
                            "free preview budget spent for today — run it billed instead")


def consume(ip: str, chars: int) -> None:
    """Spend budget AFTER check() passed (call only when audio will render)."""
    with _lock:
        today = datetime.now(timezone.utc).date().toordinal()
        day, used = _spent.get(ip, [0, 0])
        _spent[ip] = [today, (0 if day != today else used) + chars]
