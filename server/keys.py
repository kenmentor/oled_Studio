"""API keys: issue once, verify fast, revoke instantly.

Secret format: oled_sk_live_<48 hex>. Only a SHA-256 hash is stored —
the full secret exists solely in the issue response. Prefix + last4 are
safe to display and sufficient to identify a key in UI.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone

from .db import DB_NAME, MONGO_URL
from .models import ApiKeyInfo

PREFIX = "oled_sk_live_"


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_collection():
    from pymongo import MongoClient

    client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=3000)
    return client[DB_NAME]["api_keys"]


def _doc_to_info(doc: dict) -> ApiKeyInfo:
    return ApiKeyInfo(
        id=doc["id"],
        name=doc["name"],
        prefix=doc["prefix"],
        last4=doc["last4"],
        created_at=doc["created_at"],
        last_used_at=doc.get("last_used_at"),
        owner_id=doc.get("owner_id", ""),
    )


class KeyStore:
    def __init__(self, collection=None) -> None:
        self._col = collection if collection is not None else get_collection()

    def issue(self, name: str, owner_id: str = "") -> tuple[ApiKeyInfo, str]:
        from .users import PERSONA_ID

        secret = PREFIX + secrets.token_hex(24)
        doc = {
            "id": f"key-{secrets.token_hex(4)}",
            "name": name.strip(),
            "hash": _hash(secret),
            "prefix": secret[:20],
            "last4": secret[-4:],
            "created_at": _now(),
            "last_used_at": None,
            "owner_id": owner_id or PERSONA_ID,
        }
        self._col.insert_one(doc)
        return _doc_to_info(doc), secret

    def list(self, owner_id: str | None = None) -> list[ApiKeyInfo]:
        q = {"owner_id": owner_id} if owner_id else {}
        return [_doc_to_info(d) for d in self._col.find(q).sort("created_at", -1)]

    def revoke(self, key_id: str) -> bool:
        return self._col.delete_one({"id": key_id}).deleted_count > 0

    def verify(self, secret: str) -> ApiKeyInfo | None:
        """Valid secret -> key info (and refresh last_used). Else None."""
        doc = self._col.find_one({"hash": _hash(secret.strip())})
        if not doc:
            return None
        self._col.update_one({"id": doc["id"]}, {"$set": {"last_used_at": _now()}})
        info = _doc_to_info(doc)
        info.last_used_at = _now()
        return info


class MemoryKeyStore:
    """Same interface, process memory. Tests and offline dev only."""

    def __init__(self) -> None:
        self._docs: dict[str, dict] = {}

    def issue(self, name: str, owner_id: str = "") -> tuple[ApiKeyInfo, str]:
        from .users import PERSONA_ID

        secret = PREFIX + secrets.token_hex(24)
        doc = {
            "id": f"key-{secrets.token_hex(4)}",
            "name": name.strip(),
            "hash": _hash(secret),
            "prefix": secret[:20],
            "last4": secret[-4:],
            "created_at": _now(),
            "last_used_at": None,
            "owner_id": owner_id or PERSONA_ID,
        }
        self._docs[doc["id"]] = doc
        return _doc_to_info(doc), secret

    def list(self, owner_id: str | None = None) -> list[ApiKeyInfo]:
        docs = sorted(self._docs.values(), key=lambda d: d["created_at"], reverse=True)
        if owner_id:
            docs = [d for d in docs if d.get("owner_id", "") == owner_id]
        return [_doc_to_info(d) for d in docs]

    def revoke(self, key_id: str) -> bool:
        return self._docs.pop(key_id, None) is not None

    def verify(self, secret: str) -> ApiKeyInfo | None:
        for doc in self._docs.values():
            if doc["hash"] == _hash(secret.strip()):
                doc["last_used_at"] = _now()
                return _doc_to_info(doc)
        return None
