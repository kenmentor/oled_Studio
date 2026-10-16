"""Request authentication. Off by default for the local test run —
flip TTS_REQUIRE_AUTH=true and every synthesis lane demands a valid key."""

from __future__ import annotations

import os

from fastapi import Request

from ..keys import KeyStore
from ..models import ApiKeyInfo
from .errors import api_error


def required() -> bool:
    return os.getenv("TTS_REQUIRE_AUTH", "false").lower() in ("1", "true", "yes")


def key_from_request(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip() or None
    header = request.headers.get("x-api-key", "").strip()
    return header or None


async def require_key(request: Request) -> ApiKeyInfo | None:
    """Dependency for HTTP lanes. Returns the key info, or None when open."""
    if not required():
        return None
    keys: KeyStore = request.app.state.keys
    secret = key_from_request(request)
    info = keys.verify(secret) if secret else None
    if info is None:
        raise api_error(401, "unauthorized", "valid API key required")
    return info


def check_ws_key(keys: KeyStore, secret: str | None) -> ApiKeyInfo | None:
    """Same gate for the WS lane, where headers aren't available."""
    if not required():
        return None
    info = keys.verify(secret) if secret else None
    if info is None:
        raise ValueError("valid API key required")
    return info


# ---- sessions (GitHub OAuth; email-merge identity, not passwords) ----

def session_uid(request: Request) -> str:
    try:
        return str(request.session.get("uid", ""))
    except Exception:
        return ""


def login_required() -> bool:
    return os.getenv("REQUIRE_LOGIN", "false").lower() in ("1", "true", "yes")


def resolve_uid(request: Request, explicit: str = "") -> str:
    """Session wins; else explicit param (scripts/tests); else persona."""
    from ..users import PERSONA_ID

    return session_uid(request) or explicit.strip() or PERSONA_ID


def require_uid(request: Request) -> str:
    """401 on metered lanes when login is enforced and no session exists."""
    uid = session_uid(request)
    if not uid and login_required():
        raise api_error(401, "login_required", "sign in with GitHub first")
    from ..users import PERSONA_ID

    return uid or PERSONA_ID
