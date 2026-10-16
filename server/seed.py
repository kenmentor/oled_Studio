"""Preseed Mongo with the launch voice lineup + persona user. Idempotent —
reruns never overwrite enable/disable toggles or existing balances.
Run: python -m server.seed"""

from __future__ import annotations

from .db import MongoVoiceRegistry
from .models import VoiceInfo
from .users import PERSONA_ID, WELCOME_CHARS

SEED_VOICES = [
    VoiceInfo(id="ada", label="Ada", accent="Nigerian · Igbo", language="en", enabled=True, sample_url="/samples/ada.wav"),
    VoiceInfo(id="tunde", label="Tunde", accent="Nigerian · Yoruba", language="en", enabled=True, sample_url="/samples/tunde.wav"),
    VoiceInfo(id="musa", label="Musa", accent="Nigerian · Hausa", language="en", enabled=True, sample_url="/samples/musa.wav"),
    VoiceInfo(id="ngozi", label="Ngozi", accent="Nigerian · Pidgin", language="en", enabled=True, sample_url="/samples/ngozi.wav"),
]


def main() -> None:
    registry = MongoVoiceRegistry()
    for voice in SEED_VOICES:
        saved = registry.create(voice)
        print(f"{saved.id:10s} {saved.label:10s} {saved.accent:22s} enabled={saved.enabled}")
    print(f"done: {len(SEED_VOICES)} voices in oled_studio.voices")
    from .users import UserStore

    users = UserStore()
    persona = users.ensure_persona()
    print(f"{PERSONA_ID} {persona['email']} balance={persona['balance_chars']} chars (welcome {WELCOME_CHARS})")


if __name__ == "__main__":
    main()
