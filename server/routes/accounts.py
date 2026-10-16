"""Auth-lite: email-only identity, no passwords.

Signup creates a real backend user (welcome bonus included); signin looks
it up by email. Route protection stays client-side until the auth milestone
— these endpoints are identity, not security.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from ..models import AuthResponse, AuthSignin, AuthSignup, UserInfo
from .errors import api_error

router = APIRouter(tags=["accounts"])


def get_users(request: Request):
    return request.app.state.users


def _to_userinfo(doc: dict) -> UserInfo:
    return UserInfo(
        id=doc["id"],
        name=doc.get("name", ""),
        email=doc.get("email", ""),
        company=doc.get("company", ""),
        balance_chars=int(doc.get("balance_chars", 0)),
        avatar_url=doc.get("avatar_url", ""),
        created_at=doc.get("created_at", ""),
    )


@router.post("/v1/auth/signup", response_model=AuthResponse, status_code=201)
def signup(body: AuthSignup, request: Request, users=Depends(get_users)):
    doc = users.create(body.name, body.email, body.company)
    if doc is None:
        raise api_error(409, "email_taken", "that email already has an account — sign in instead")
    # Real login: bind the signed cookie to this user so logout destroys
    # something and data lanes can enforce ownership (session wins over
    # any ?user_id= param). Without this, email auth is client-side trust.
    request.session["uid"] = doc["id"]
    try:  # admin stats only — a logging failure must never break signup
        request.app.state.activity.record_login(doc["id"], "signup")
    except Exception:
        pass
    return AuthResponse(user=_to_userinfo(doc), new=True)


@router.post("/v1/auth/signin", response_model=AuthResponse)
def signin(body: AuthSignin, request: Request, users=Depends(get_users)):
    doc = users.find_by_email(body.email)
    if doc is None:
        raise api_error(404, "unknown_email", "no account for that email — sign up first")
    request.session["uid"] = doc["id"]
    try:  # admin stats only — a logging failure must never break signin
        request.app.state.activity.record_login(doc["id"], "email")
    except Exception:
        pass
    return AuthResponse(user=_to_userinfo(doc), new=False)
