"""API key lifecycle. The secret is shown once at issue and never again."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from ..keys import KeyStore
from ..models import ApiKeyCreate, ApiKeyIssued, ApiKeyVerified, ApiKeyVerify
from .auth import login_required, session_uid
from .errors import api_error

router = APIRouter(tags=["keys"])


def get_keys(request: Request) -> KeyStore:
    return request.app.state.keys


@router.post("/v1/keys", response_model=ApiKeyIssued, status_code=201)
def issue_key(body: ApiKeyCreate, request: Request, keys: KeyStore = Depends(get_keys)):
    # Blank-after-strip names ("", "   ") are rejected: every secret must
    # carry a human label, or key lists become unauditable. Checked before
    # auth so the rule holds in open and locked modes alike.
    if not body.name.strip():
        raise api_error(400, "invalid_name", "key name must not be empty")
    suid = session_uid(request)
    if not suid and login_required():
        raise api_error(401, "login_required", "sign in with GitHub first")
    info, secret = keys.issue(body.name, suid or body.owner_id)
    return ApiKeyIssued(key=info, secret=secret)


@router.get("/v1/keys")
def list_keys(request: Request, owner_id: str = "", keys: KeyStore = Depends(get_keys)):
    suid = session_uid(request)
    if not suid and login_required():
        raise api_error(401, "login_required", "sign in with GitHub first")
    filt = suid or owner_id.strip() or None  # None = open-mode legacy all-keys list
    return {"keys": [k.model_dump() for k in keys.list(filt)]}


@router.delete("/v1/keys/{key_id}")
def revoke_key(key_id: str, keys: KeyStore = Depends(get_keys)):
    if keys.revoke(key_id):
        return {"revoked": key_id}
    raise api_error(404, "unknown_key", f"no such key: {key_id}")


@router.post("/v1/keys/verify", response_model=ApiKeyVerified)
def verify_key(body: ApiKeyVerify, keys: KeyStore = Depends(get_keys)):
    info = keys.verify(body.secret)
    if info is None:
        return ApiKeyVerified(valid=False)
    return ApiKeyVerified(valid=True, key_id=info.id, name=info.name)
