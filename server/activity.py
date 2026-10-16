"""Admin activity log: logins + page visits.

Why a separate log: users/usage_events/invoices answer "who has what",
but nobody records "who came when". This tiny append-only log does —
logins (session started, with method) and visits (anonymous path hits).
Aggregates (series, top paths) are computed here so the admin route stays
a thin permission check + JSON shape.
"""

from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _day(at: str) -> str:
    try:
        return datetime.fromisoformat(at).astimezone(timezone.utc).date().isoformat()
    except Exception:
        return ""


def last_days(n: int) -> list[str]:
    today = datetime.now(timezone.utc).date()
    return [(today - timedelta(days=i)).isoformat() for i in range(n - 1, -1, -1)]


class MemoryActivityStore:
    """Process memory (dev/tests). For prod scale this wants capped Mongo."""

    def __init__(self) -> None:
        self._rows: list[dict] = []
        self._lock = threading.Lock()

    def record_login(self, uid: str, method: str) -> None:
        with self._lock:
            self._rows.append({"type": "login", "uid": uid, "method": method,
                               "path": "", "at": _now()})

    def record_visit(self, path: str) -> None:
        with self._lock:
            self._rows.append({"type": "visit", "uid": "", "method": "",
                               "path": path[:128], "at": _now()})

    def _snapshot(self) -> list[dict]:
        with self._lock:
            return list(self._rows)

    def count(self, kind: str) -> int:
        return sum(1 for r in self._snapshot() if r["type"] == kind)

    def series(self, kind: str, days: int = 14) -> list[dict]:
        buckets = {d: 0 for d in last_days(days)}
        for r in self._snapshot():
            if r["type"] == kind and r.get("at", "")[:10] in buckets:
                buckets[r["at"][:10]] += 1
        return [{"day": d, "count": buckets[d]} for d in last_days(days)]

    def recent_logins(self, limit: int = 8) -> list[dict]:
        rows = [r for r in self._snapshot() if r["type"] == "login"]
        rows.sort(key=lambda r: r.get("at", ""), reverse=True)
        return [dict(r) for r in rows[: max(1, min(limit, 50))]]

    def top_paths(self, limit: int = 8) -> list[dict]:
        counts: dict[str, int] = {}
        for r in self._snapshot():
            if r["type"] == "visit" and r.get("path"):
                counts[r["path"]] = counts.get(r["path"], 0) + 1
        return [{"path": p, "count": c}
                for p, c in sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[:limit]]


class MongoActivityStore:
    """Same interface, Mongo-backed (production history across restarts)."""

    def __init__(self, collection=None) -> None:
        if collection is not None:
            self._col = collection
            return
        from pymongo import MongoClient

        from .db import DB_NAME, MONGO_URL

        client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=3000)
        self._col = client[DB_NAME]["admin_activity"]
        self._col.create_index([("type", 1), ("at", -1)])

    def ping(self) -> None:
        self._col.find_one({"type": "__ping__"})

    def record_login(self, uid: str, method: str) -> None:
        self._col.insert_one({"type": "login", "uid": uid, "method": method,
                              "path": "", "at": _now()})

    def record_visit(self, path: str) -> None:
        self._col.insert_one({"type": "visit", "uid": "", "method": "",
                              "path": path[:128], "at": _now()})

    def count(self, kind: str) -> int:
        return self._col.count_documents({"type": kind})

    def series(self, kind: str, days: int = 14) -> list[dict]:
        days_list = last_days(days)
        start = days_list[0]
        cur = self._col.aggregate([
            {"$match": {"type": kind, "at": {"$gte": start}}},
            {"$group": {"_id": {"$substr": ["$at", 0, 10]}, "count": {"$sum": 1}}},
        ])
        buckets = {d: 0 for d in days_list}
        for row in cur:
            if row["_id"] in buckets:
                buckets[row["_id"]] = int(row["count"])
        return [{"day": d, "count": buckets[d]} for d in days_list]

    def recent_logins(self, limit: int = 8) -> list[dict]:
        cur = (self._col.find({"type": "login"}, {"_id": 0})
               .sort("at", -1).limit(max(1, min(limit, 50))))
        return list(cur)

    def top_paths(self, limit: int = 8) -> list[dict]:
        cur = self._col.aggregate([
            {"$match": {"type": "visit"}},
            {"$group": {"_id": "$path", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
            {"$limit": max(1, min(limit, 20))},
        ])
        return [{"path": r["_id"] or "(unknown)", "count": int(r["count"])} for r in cur]
