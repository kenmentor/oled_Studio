"""GitHub OAuth: authorize -> callback -> signed-cookie session.

Logout revokes the GitHub grant so the next login shows Authorize again
instead of zapping straight back in (github.com password session untouched).


Setup (owner does once on github.com/settings/developers -> OAuth Apps):
  Authorization callback URL = http://127.0.0.1:8000/v1/auth/github/callback
  Env: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET,
       SESSION_SECRET (random 32+ bytes),
       optional GITHUB_REDIRECT_URI + FRONTEND_URL overrides.

Merge rule: GitHub id match wins; else primary verified email merges into
the existing account; else a fresh user (welcome bonus) is created.
"""

from __future__ import annotations

import os
import secrets
import urllib.parse

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, RedirectResponse

router = APIRouter(tags=["accounts"])

AUTH_URL = "https://github.com/login/oauth/authorize"
TOKEN_URL = "https://github.com/login/oauth/access_token"
USER_URL = "https://api.github.com/user"
EMAILS_URL = "https://api.github.com/user/emails"


def _cid() -> str:
    return os.getenv("GITHUB_CLIENT_ID", "")


def _secret() -> str:
    return os.getenv("GITHUB_CLIENT_SECRET", "")


def _redirect_uri(request: Request) -> str:
    override = os.getenv("GITHUB_REDIRECT_URI", "").strip()
    if override:
        return override
    base = str(request.base_url).rstrip("/")
    return f"{base}/v1/auth/github/callback"


def _allowed_origins() -> set[str]:
    """Every console origin allowed to start/finish a login here."""
    from ..security import cors_origins

    origins = {o.strip().rstrip("/") for o in cors_origins() if o.strip()}
    front = os.getenv("FRONTEND_URL", "").strip().rstrip("/")
    if front:
        parsed = urllib.parse.urlparse(front)
        if parsed.scheme and parsed.netloc:
            origins.add(f"{parsed.scheme}://{parsed.netloc}")
    return {o.lower() for o in origins if o}


def _validated_return_to(value: str) -> str | None:
    """Allow-listed absolute URL the console asked to land on after login.

    Returns None for anything else (missing, relative, foreign host,
    non-http scheme) — the caller then falls back to FRONTEND_URL.
    This is what makes one API serve two consoles: the callback lands
    wherever the login STARTED instead of one hardcoded env URL."""
    try:
        target = (value or "").strip()
        if not target or "://" not in target:
            return None
        parsed = urllib.parse.urlparse(target)
        if parsed.scheme.lower() not in ("http", "https"):
            return None
        origin = f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"
        if origin not in _allowed_origins():
            print(f"[auth] return_to origin not allowed: {origin}")
            return None
        path = parsed.path or "/overview"
        if not path.startswith("/"):
            return None
        return f"{origin}{path}"
    except Exception:
        return None


def _frontend(request: Request) -> str:
    override = os.getenv("FRONTEND_URL", "").strip().rstrip("/")
    if override:
        # Bare origin (http://127.0.0.1:3001) lands on the console overview;
        # a full path override is respected as-is.
        parsed = urllib.parse.urlparse(override)
        if not parsed.path or parsed.path == "/":
            return f"{override}/overview"
        return override
    return f"{str(request.base_url).rstrip('/')}/overview"


async def _exchange_code(code: str, redirect_uri: str) -> str | None:
    """Code -> access token. Separated for tests to monkeypatch."""
    import httpx

    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(
                TOKEN_URL,
                headers={"Accept": "application/json"},
                data={
                    "client_id": _cid(),
                    "client_secret": _secret(),
                    "code": code,
                    "redirect_uri": redirect_uri,
                },
            )
            if r.status_code != 200:
                return None
            return r.json().get("access_token")
    except Exception:
        return None


async def _revoke_grant(token: str) -> None:
    """Best-effort revoke of the GitHub app authorization for this token.

    Without this, github.com keeps the app authorized and the next
    "Continue with GitHub" zaps straight back in with no Authorize screen.
    Deleting the grant forces GitHub to show Authorize again next login.
    Failure (offline, already revoked, no creds) must never block logout.
    """
    import base64

    import httpx

    cid, sec = _cid(), _secret()
    if not token or not cid or not sec:
        print(f"[auth] revoke skipped (token={'yes' if token else 'no'}, creds={'yes' if cid and sec else 'no'})")
        return
    try:
        cred = base64.b64encode(f"{cid}:{sec}".encode()).decode()
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.delete(
                f"https://api.github.com/applications/{cid}/grant",
                headers={
                    "Accept": "application/vnd.github+json",
                    "Authorization": f"Basic {cred}",
                },
                json={"access_token": token},
            )
            print(f"[auth] revoke grant -> {r.status_code}")
    except Exception as e:
        print(f"[auth] revoke grant failed: {e}")


async def _fetch_profile(token: str) -> tuple[dict, str] | None:
    """(profile, primary verified email). Separated for tests to monkeypatch."""
    import httpx

    try:
        async with httpx.AsyncClient(timeout=15) as c:
            u = await c.get(USER_URL, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
            if u.status_code != 200:
                return None
            profile = u.json()
            email = (profile.get("email") or "").strip().lower()
            if not email:
                e = await c.get(EMAILS_URL, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
                if e.status_code == 200:
                    for row in e.json():
                        if row.get("primary") and row.get("verified"):
                            email = str(row.get("email", "")).strip().lower()
                            break
                    if not email:
                        for row in e.json():
                            if row.get("verified"):
                                email = str(row.get("email", "")).strip().lower()
                                break
            if not email:
                return None
            return profile, email
    except Exception:
        return None


@router.get("/v1/auth/github")
def github_start(request: Request, return_to: str = ""):
    if not _cid():
        return JSONResponse({"error": {"code": "oauth_unconfigured", "message": "set GITHUB_CLIENT_ID/SECRET"}}, status_code=503)
    state = secrets.token_urlsafe(16)
    request.session["oauth_state"] = state
    # Where to land after the callback: wherever THIS login started
    # (hosted console stays hosted, local stays local). Allow-listed only;
    # anything else is dropped and FRONTEND_URL is used as fallback.
    landing = _validated_return_to(return_to)
    if landing:
        request.session["post_login_to"] = landing
    else:
        request.session.pop("post_login_to", None)
    q = urllib.parse.urlencode({
        "client_id": _cid(),
        "redirect_uri": _redirect_uri(request),
        "scope": "read:user user:email",
        "state": state,
    })
    return RedirectResponse(f"{AUTH_URL}?{q}", status_code=307)


@router.get("/v1/auth/github/callback")
async def github_callback(request: Request, code: str = "", state: str = ""):
    users = request.app.state.users
    base = str(request.base_url).rstrip("/")
    front = _frontend(request)
    # Prefer the console this login started from; FRONTEND_URL is fallback.
    # Re-validated here (never trusted blindly from the session).
    landing = _validated_return_to(str(request.session.get("post_login_to", "") or "")) or front
    request.session.pop("post_login_to", None)
    fail = lambda reason: RedirectResponse(f"{base}/signin?oauth_error={reason}", status_code=307)  # noqa: E731

    if not code:
        return fail("cancelled")
    expected = request.session.pop("oauth_state", "")
    if not expected or state != expected:
        return fail("bad_state")
    token = await _exchange_code(code, _redirect_uri(request))
    if not token:
        return fail("exchange_failed")
    fetched = await _fetch_profile(token)
    if not fetched:
        return fail("profile_failed")
    profile, email = fetched
    gid = str(profile.get("id", ""))

    doc = users.find_by_github(gid) if gid else None
    if doc is None:
        doc = users.find_by_email(email)
        if doc is not None:
            doc = users.link_github(doc["id"], gid, str(profile.get("avatar_url", "")))
    if doc is None:
        name = str(profile.get("name") or profile.get("login") or email.split("@")[0])
        doc = users.create(name, email)
        if doc is None:  # raced with another callback for the same email
            doc = users.find_by_email(email)
            if doc is not None:
                doc = users.link_github(doc["id"], gid, str(profile.get("avatar_url", "")))
        elif gid:
            doc = users.link_github(doc["id"], gid, str(profile.get("avatar_url", "")))
    if doc is None:
        return fail("account_failed")

    request.session["uid"] = doc["id"]
    # Kept only so logout can revoke the GitHub grant (forces the Authorize
    # screen next login instead of an instant silent re-entry). Read-only
    # scopes only; wiped on logout. Cookie is signed + httpOnly.
    request.session["gh_token"] = token
    try:  # admin stats only — a logging failure must never break login
        request.app.state.activity.record_login(doc["id"], "github")
    except Exception:
        pass
    return RedirectResponse(landing, status_code=307)


@router.post("/v1/auth/logout")
async def logout(request: Request):
    token = ""
    try:
        token = str(request.session.pop("gh_token", "") or "")
    except Exception:
        token = ""
    if token:
        await _revoke_grant(token)
    else:
        print("[auth] logout with no gh_token (pre-fix session?) — GitHub grant NOT revoked, next login may be instant")
    request.session.clear()
    return {"ok": True}


def get_users(request: Request):
    return request.app.state.users


@router.get("/v1/users/me")
def me(request: Request, user_id: str = "", users=Depends(get_users)):
    """Session user wins (real login); explicit ?user_id stays for scripts.

    No persona fallback: without either, this is a 401 so a signed-out
    browser can never bootstrap itself back in. With REQUIRE_LOGIN=true the
    explicit param is dead too — data lanes must never trust a caller who
    simply names another account (B2B impersonation otherwise)."""
    from ..models import UserInfo
    from .auth import login_required
    from .errors import api_error

    try:
        uid = str(request.session.get("uid", "") or "")
    except Exception:
        uid = ""
    if not uid and login_required():
        raise api_error(401, "login_required", "sign in first")
    uid = uid or user_id.strip()
    if not uid:
        raise api_error(401, "login_required", "sign in first")
    doc = users.get(uid)
    if doc is None:
        raise api_error(404, "unknown_user", f"no such user: {uid}")
    return UserInfo(
        id=doc["id"],
        name=doc.get("name", ""),
        email=doc.get("email", ""),
        company=doc.get("company", ""),
        balance_chars=int(doc.get("balance_chars", 0)),
        avatar_url=doc.get("avatar_url", ""),
        created_at=doc.get("created_at", ""),
    )
