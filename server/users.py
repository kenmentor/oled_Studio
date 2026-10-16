"""Persona user + prepaid character credits.

Production shape, single tenant for now:
  users {id, name, email, company, balance_chars, created_at}
  usage_events {id, at, user_id, key_id, key_name, voice, chars, ...}
  invoices {id, number, user_id, amount_kobo, granted_chars, card_last4, ...}

The fixed persona (Ada) is the future auth user: every key and every
ledger row carries her id today, so splitting per-user later is a filter,
not a migration.

Pricing (generous, documented):
  CHARS_PER_KOBO = 10  ->  1 NGN = 1,000 chars; Studio-size N8,500 = 8.5M chars
  WELCOME_CHARS  = 250_000 starter bonus, granted once via setOnInsert.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone

from .db import DB_NAME, MONGO_URL
from .models import InvoiceInfo, UsageRecord

PERSONA_ID = "user_demo_ada"
PERSONA_NAME = "Ada Lovelace"
PERSONA_EMAIL = "ada@oled.studio"
PERSONA_COMPANY = "Lagos Media Co."

CHARS_PER_KOBO = 10
WELCOME_CHARS = 250_000


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _invoice_number() -> str:
    d = datetime.now(timezone.utc)
    return f"OLED-{d.year}-{secrets.token_hex(2).upper()}"


class UserStore:
    """Mongo-backed users + ledger. Same interface as MemoryUserStore."""

    def __init__(self, users=None, events=None, invoices=None) -> None:
        if users is not None:
            self._users = users
            self._events = events
            self._invoices = invoices
            return
        from pymongo import MongoClient

        client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=3000)
        db = client[DB_NAME]
        self._users = db["users"]
        self._events = db["usage_events"]
        self._invoices = db["invoices"]

    # -- persona --
    def ensure_persona(self) -> dict:
        self._users.update_one(
            {"id": PERSONA_ID},
            {
                "$set": {
                    "name": PERSONA_NAME,
                    "email": PERSONA_EMAIL,
                    "company": PERSONA_COMPANY,
                },
                "$setOnInsert": {
                    "id": PERSONA_ID,
                    "balance_chars": WELCOME_CHARS,
                    "created_at": _now(),
                },
            },
            upsert=True,
        )
        return self.get(PERSONA_ID)

    def get(self, user_id: str) -> dict | None:
        return self._users.find_one({"id": user_id}, {"_id": 0})

    # -- admin aggregates (cross-user reads; admin route only) --
    def all_users(self, limit: int = 200) -> list[dict]:
        cur = self._users.find({}, {"_id": 0}).sort("created_at", -1).limit(max(1, min(limit, 500)))
        return list(cur)

    def all_usage(self, limit: int = 200) -> list[dict]:
        cur = self._events.find({}, {"_id": 0}).sort("at", -1).limit(max(1, min(limit, 500)))
        return list(cur)

    def all_invoices(self, limit: int = 200) -> list[dict]:
        cur = self._invoices.find({}, {"_id": 0}).sort("created_at", -1).limit(max(1, min(limit, 500)))
        return list(cur)

    def revenue_kobo(self) -> int:
        cur = self._invoices.aggregate([{"$group": {"_id": None, "total": {"$sum": "$amount_kobo"}}}])
        rows = list(cur)
        return int(rows[0]["total"]) if rows else 0

    def balance(self, user_id: str) -> int:
        doc = self.get(user_id)
        if doc is None:
            doc = self.ensure_persona() if user_id == PERSONA_ID else None
        return int(doc["balance_chars"]) if doc else 0

    # -- auth-lite identity (email only, no passwords) --
    def find_by_email(self, email: str) -> dict | None:
        return self._users.find_one(
            {"email": email.strip().lower()}, {"_id": 0}
        )

    def find_by_github(self, github_id: str) -> dict | None:
        return self._users.find_one({"github_id": str(github_id)}, {"_id": 0})

    def link_github(self, user_id: str, github_id: str, avatar_url: str = "") -> dict | None:
        from pymongo import ReturnDocument

        return self._users.find_one_and_update(
            {"id": user_id},
            {"$set": {"github_id": str(github_id), "avatar_url": avatar_url}},
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0},
        )

    def create(self, name: str, email: str, company: str = "") -> dict | None:
        """New user with welcome bonus. None when the email is taken."""
        email = email.strip().lower()
        if self.find_by_email(email) is not None:
            return None
        doc = {
            "id": f"user-{secrets.token_hex(4)}",
            "name": name.strip(),
            "email": email,
            "company": company.strip(),
            "balance_chars": WELCOME_CHARS,
            "github_id": "",
            "avatar_url": "",
            "created_at": _now(),
        }
        self._users.insert_one(doc)
        return {k: v for k, v in doc.items() if k != "_id"}
    def debit(self, user_id: str, chars: int) -> int | None:
        """Subtract chars iff balance covers it. Returns new balance or None."""
        from pymongo import ReturnDocument

        doc = self._users.find_one_and_update(
            {"id": user_id, "balance_chars": {"$gte": chars}},
            {"$inc": {"balance_chars": -chars}},
            return_document=ReturnDocument.AFTER,
        )
        return int(doc["balance_chars"]) if doc else None

    def credit(self, user_id: str, chars: int) -> int:
        from pymongo import ReturnDocument

        doc = self._users.find_one_and_update(
            {"id": user_id},
            {"$inc": {"balance_chars": chars}},
            return_document=ReturnDocument.AFTER,
        )
        if doc is None:
            self.ensure_persona()
            doc = self._users.find_one_and_update(
                {"id": user_id},
                {"$inc": {"balance_chars": chars}},
                return_document=ReturnDocument.AFTER,
            )
        return int(doc["balance_chars"])

    def topup(self, user_id: str, amount_kobo: int, card_number: str) -> tuple[int, InvoiceInfo]:
        digits = "".join(c for c in card_number if c.isdigit())
        granted = amount_kobo * CHARS_PER_KOBO
        balance = self.credit(user_id, granted)
        inv = InvoiceInfo(
            id=f"inv-{secrets.token_hex(4)}",
            number=_invoice_number(),
            amount_kobo=amount_kobo,
            granted_chars=granted,
            card_last4=digits[-4:],
            created_at=_now(),
        )
        self._invoices.insert_one({"user_id": user_id, **inv.model_dump()})
        return balance, inv

    # -- ledger --
    def record(self, **fields) -> UsageRecord:
        rec = UsageRecord(
            id=f"req-{secrets.token_hex(5)}",
            at=_now(),
            user_id=fields.get("user_id", PERSONA_ID),
            key_id=fields.get("key_id"),
            key_name=fields.get("key_name", ""),
            voice=fields.get("voice", ""),
            chars=fields.get("chars", 0),
            text=str(fields.get("text", ""))[:500],
            audio_seconds=fields.get("audio_seconds", 0.0),
            latency_ms=fields.get("latency_ms", 0),
            mode=fields.get("mode", "batch"),
            status=fields.get("status", "done"),
            cost_chars=fields.get("cost_chars", 0),
            balance_after=fields.get("balance_after", 0),
        )
        self._events.insert_one(rec.model_dump())
        return rec

    def usage(self, user_id: str, limit: int = 100) -> list[dict]:
        cur = self._events.find({"user_id": user_id}, {"_id": 0}).sort("at", -1).limit(limit)
        return list(cur)

    def spent(self, user_id: str) -> int:
        """Lifetime billed chars (done renders only)."""
        cur = self._events.aggregate([
            {"$match": {"user_id": user_id, "status": "done"}},
            {"$group": {"_id": None, "total": {"$sum": "$cost_chars"}}},
        ])
        rows = list(cur)
        return int(rows[0]["total"]) if rows else 0

    def invoices(self, user_id: str, limit: int = 50) -> list[dict]:
        cur = self._invoices.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).limit(limit)
        return list(cur)


class MemoryUserStore:
    """Same interface, process memory. Tests and offline dev only."""

    def __init__(self) -> None:
        self._users: dict[str, dict] = {}
        self._events: list[dict] = []
        self._invoices: list[dict] = []

    def ensure_persona(self) -> dict:
        if PERSONA_ID not in self._users:
            self._users[PERSONA_ID] = {
                "id": PERSONA_ID,
                "name": PERSONA_NAME,
                "email": PERSONA_EMAIL,
                "company": PERSONA_COMPANY,
                "balance_chars": WELCOME_CHARS,
                "github_id": "",
                "avatar_url": "",
                "created_at": _now(),
            }
        return self._users[PERSONA_ID]

    def get(self, user_id: str) -> dict | None:
        return self._users.get(user_id)

    # -- admin aggregates (cross-user reads; admin route only) --
    def all_users(self, limit: int = 200) -> list[dict]:
        rows = sorted(self._users.values(), key=lambda d: d.get("created_at", ""), reverse=True)
        return [dict(d) for d in rows[: max(1, min(limit, 500))]]

    def all_usage(self, limit: int = 200) -> list[dict]:
        rows = sorted(self._events, key=lambda e: e.get("at", ""), reverse=True)
        return [dict(e) for e in rows[: max(1, min(limit, 500))]]

    def all_invoices(self, limit: int = 200) -> list[dict]:
        rows = sorted(self._invoices, key=lambda i: i.get("created_at", ""), reverse=True)
        return [dict(i) for i in rows[: max(1, min(limit, 500))]]

    def revenue_kobo(self) -> int:
        return sum(int(i.get("amount_kobo", 0)) for i in self._invoices)

    def balance(self, user_id: str) -> int:
        if user_id not in self._users and user_id == PERSONA_ID:
            self.ensure_persona()
        return int(self._users.get(user_id, {}).get("balance_chars", 0))

    def find_by_email(self, email: str) -> dict | None:
        email = email.strip().lower()
        for doc in self._users.values():
            if doc.get("email", "").lower() == email:
                return doc
        return None

    def create(self, name: str, email: str, company: str = "") -> dict | None:
        """New user with welcome bonus. None when the email is taken."""
        if self.find_by_email(email) is not None:
            return None
        doc = {
            "id": f"user-{secrets.token_hex(4)}",
            "name": name.strip(),
            "email": email.strip().lower(),
            "company": company.strip(),
            "balance_chars": WELCOME_CHARS,
            "github_id": "",
            "avatar_url": "",
            "created_at": _now(),
        }
        self._users[doc["id"]] = doc
        return doc

    def find_by_github(self, github_id: str) -> dict | None:
        for doc in self._users.values():
            if doc.get("github_id", "") == str(github_id):
                return doc
        return None

    def link_github(self, user_id: str, github_id: str, avatar_url: str = "") -> dict | None:
        doc = self._users.get(user_id)
        if doc is None:
            return None
        doc["github_id"] = str(github_id)
        doc["avatar_url"] = avatar_url
        return doc

    def debit(self, user_id: str, chars: int) -> int | None:
        if user_id not in self._users and user_id == PERSONA_ID:
            self.ensure_persona()
        doc = self._users.get(user_id)
        if doc is None or int(doc["balance_chars"]) < chars:
            return None
        doc["balance_chars"] = int(doc["balance_chars"]) - chars
        return int(doc["balance_chars"])

    def credit(self, user_id: str, chars: int) -> int:
        if user_id not in self._users and user_id == PERSONA_ID:
            self.ensure_persona()
        doc = self._users.setdefault(user_id, {"id": user_id, "balance_chars": 0})
        doc["balance_chars"] = int(doc.get("balance_chars", 0)) + chars
        return int(doc["balance_chars"])

    def topup(self, user_id: str, amount_kobo: int, card_number: str) -> tuple[int, InvoiceInfo]:
        digits = "".join(c for c in card_number if c.isdigit())
        granted = amount_kobo * CHARS_PER_KOBO
        balance = self.credit(user_id, granted)
        inv = InvoiceInfo(
            id=f"inv-{secrets.token_hex(4)}",
            number=_invoice_number(),
            amount_kobo=amount_kobo,
            granted_chars=granted,
            card_last4=digits[-4:],
            created_at=_now(),
        )
        self._invoices.append({"user_id": user_id, **inv.model_dump()})
        return balance, inv

    def record(self, **fields) -> UsageRecord:
        rec = UsageRecord(
            id=f"req-{secrets.token_hex(5)}",
            at=_now(),
            user_id=fields.get("user_id", PERSONA_ID),
            key_id=fields.get("key_id"),
            key_name=fields.get("key_name", ""),
            voice=fields.get("voice", ""),
            chars=fields.get("chars", 0),
            text=str(fields.get("text", ""))[:500],
            audio_seconds=fields.get("audio_seconds", 0.0),
            latency_ms=fields.get("latency_ms", 0),
            mode=fields.get("mode", "batch"),
            status=fields.get("status", "done"),
            cost_chars=fields.get("cost_chars", 0),
            balance_after=fields.get("balance_after", 0),
        )
        self._events.append(rec.model_dump())
        return rec

    def usage(self, user_id: str, limit: int = 100) -> list[dict]:
        rows = [e for e in self._events if e["user_id"] == user_id]
        rows.sort(key=lambda e: e["at"], reverse=True)
        return rows[:limit]

    def spent(self, user_id: str) -> int:
        """Lifetime billed chars (done renders only)."""
        return sum(int(e.get("cost_chars", 0)) for e in self._events
                   if e["user_id"] == user_id and e.get("status") == "done")

    def invoices(self, user_id: str, limit: int = 50) -> list[dict]:
        rows = [i for i in self._invoices if i["user_id"] == user_id]
        rows.sort(key=lambda e: e["created_at"], reverse=True)
        return rows[:limit]
