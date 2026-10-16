"""Mongo-backed voice registry. Same interface as the in-memory one.

Database: oled_studio (MONGO_DB), collection: voices.
Document: {id, label, accent, language, enabled, sample_rate, engine}
"""

from __future__ import annotations

import os

from .models import VoiceInfo

DB_NAME = os.getenv("MONGO_DB", "oled_studio")
MONGO_URL = os.getenv("MONGO_URL", "mongodb://127.0.0.1:27017/")


def get_collection():
    from pymongo import MongoClient

    client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=3000)
    return client[DB_NAME]["voices"]


def _doc_to_voice(doc: dict) -> VoiceInfo:
    return VoiceInfo(
        id=doc["id"],
        label=doc.get("label", doc["id"]),
        accent=doc.get("accent", ""),
        language=doc.get("language", "en"),
        enabled=doc.get("enabled", True),
        sample_url=doc.get("sample_url", ""),
    )


class MongoVoiceRegistry:
    """Drop-in replacement for state.VoiceRegistry, persisted in Mongo."""

    def __init__(self, collection=None) -> None:
        self._col = collection if collection is not None else get_collection()

    def all(self) -> list[VoiceInfo]:
        return [_doc_to_voice(d) for d in self._col.find().sort("id", 1)]

    def get(self, voice_id: str) -> VoiceInfo | None:
        doc = self._col.find_one({"id": voice_id})
        return _doc_to_voice(doc) if doc else None

    def default(self) -> VoiceInfo | None:
        doc = self._col.find_one({"enabled": True}, sort=[("id", 1)])
        if doc:
            return _doc_to_voice(doc)
        doc = self._col.find_one(sort=[("id", 1)])
        return _doc_to_voice(doc) if doc else None

    def set_enabled(self, voice_id: str, enabled: bool) -> VoiceInfo | None:
        from pymongo import ReturnDocument

        doc = self._col.find_one_and_update(
            {"id": voice_id},
            {"$set": {"enabled": enabled}},
            return_document=ReturnDocument.AFTER,
        )
        return _doc_to_voice(doc) if doc else None

    def create(self, voice: VoiceInfo) -> VoiceInfo | None:
        # Descriptive fields always refresh; the enabled toggle is never
        # overwritten by a reseed.
        self._col.update_one(
            {"id": voice.id},
            {
                "$set": {
                    "label": voice.label,
                    "accent": voice.accent,
                    "language": voice.language,
                    "sample_url": voice.sample_url,
                },
                "$setOnInsert": {"enabled": voice.enabled},
            },
            upsert=True,
        )
        return self.get(voice_id=voice.id)

    def delete(self, voice_id: str) -> bool:
        return self._col.delete_one({"id": voice_id}).deleted_count > 0

    def resolve(self, voice_id: str | None) -> VoiceInfo | None:
        if voice_id:
            v = self.get(voice_id)
            if v is not None and v.enabled:
                return v
            return None
        return self.default()
