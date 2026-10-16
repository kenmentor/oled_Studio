"""Public API schemas. This file IS the contract — frontends code against it."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class VoiceInfo(BaseModel):
    id: str = Field(description="Stable voice ID used in requests, e.g. 'ada'.")
    label: str = Field(description="Human name shown in UI, e.g. 'Ada'.")
    accent: str = Field(default="", description="Accent tag, e.g. 'Nigerian · Igbo'.")
    language: str = Field(default="en", description="BCP-47-ish language tag.")
    enabled: bool = Field(default=True, description="Disabled voices reject synthesis.")
    sample_url: str = Field(
        default="", description="Playable reference clip, e.g. '/samples/ada.wav'."
    )


class VoicesResponse(BaseModel):
    voices: list[VoiceInfo]
    model_version: str


class VoiceUpdate(BaseModel):
    enabled: bool


class VoiceCreate(BaseModel):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    label: str = Field(min_length=1, max_length=64)
    accent: str = Field(default="", max_length=64)
    language: str = Field(default="en", max_length=16)


class ApiKeyInfo(BaseModel):
    id: str
    name: str
    prefix: str = Field(description="First characters, safe to display.")
    last4: str = Field(description="Last 4 of the secret, safe to display.")
    created_at: str
    last_used_at: str | None = None
    owner_id: str = Field(default="", description="Owning user id; persona for now.")


class ApiKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    owner_id: str = Field(default="", description="Owning user id; persona when empty.")


class ApiKeyIssued(BaseModel):
    key: ApiKeyInfo
    secret: str = Field(description="Full secret. Shown once, never stored.")


class ApiKeyVerify(BaseModel):
    secret: str = Field(min_length=1)


class ApiKeyVerified(BaseModel):
    valid: bool
    key_id: str | None = None
    name: str | None = None


class HealthResponse(BaseModel):
    ok: bool
    provider: str
    model_version: str
    sample_rate: int
    voices: int


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    voice_id: str | None = Field(
        default=None, description="Defaults to the session/default voice."
    )
    session_id: str | None = Field(
        default=None, description="Ephemeral generation session; created if omitted."
    )
    preview: bool = Field(
        default=False,
        description="Free preview lane (docs/demo): short render, no debit, "
                    "recorded with cost 0. Capped per request and per IP/day.",
    )


class StartedEvent(BaseModel):
    type: Literal["started"] = "started"
    request_id: str
    session_id: str
    voice_id: str
    model_version: str
    sample_rate: int


class ChunkEvent(BaseModel):
    type: Literal["chunk"] = "chunk"
    request_id: str
    data: str = Field(description="Base64 PCM16 mono audio.")


class DoneEvent(BaseModel):
    type: Literal["done"] = "done"
    request_id: str
    bytes: int
    synth_time: float


class ErrorEvent(BaseModel):
    type: Literal["error"] = "error"
    request_id: str
    code: str
    message: str


class ErrorBody(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorBody


# ---- users, credits, billing (persona milestone; multi-user ready) ----

class UserInfo(BaseModel):
    id: str
    name: str
    email: str
    company: str = ""
    balance_chars: int = Field(description="Prepaid characters left to synthesize.")
    avatar_url: str = Field(default="", description="GitHub avatar URL, if linked.")
    created_at: str


class BalanceResponse(BaseModel):
    user_id: str
    email: str
    balance_chars: int
    spent_chars: int = Field(default=0, description="Lifetime billed chars from the ledger.")
    granted_chars: int = Field(default=0, description="Lifetime minted chars (balance + spent).")


class TopupRequest(BaseModel):
    amount_kobo: int = Field(ge=100, le=10_000_000, description="Fake charge amount.")
    card_number: str = Field(min_length=12, max_length=24, description="Demo card, digits only.")
    user_id: str = Field(default="", description="Who gets the chars; persona when empty.")


class InvoiceInfo(BaseModel):
    id: str
    number: str
    amount_kobo: int
    granted_chars: int
    card_last4: str
    created_at: str


class TopupResponse(BaseModel):
    balance_chars: int
    granted_chars: int
    invoice: InvoiceInfo


class UsageRecord(BaseModel):
    id: str
    at: str
    user_id: str
    key_id: str | None = None
    key_name: str = ""
    voice: str = ""
    chars: int
    text: str = Field(default="", description="Truncated request text for the dashboard.")
    audio_seconds: float = 0.0
    latency_ms: int = 0
    mode: str = "batch"
    status: str = "done"
    cost_chars: int = 0
    balance_after: int = 0


# ---- auth-lite (no passwords; identity only until the auth milestone) ----

class AuthSignup(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    email: str = Field(min_length=3, max_length=128)
    company: str = Field(default="", max_length=128)


class AuthSignin(BaseModel):
    email: str = Field(min_length=3, max_length=128)


class AuthResponse(BaseModel):
    user: UserInfo
    new: bool = Field(description="True when this request created the account.")
