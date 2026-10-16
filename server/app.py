"""App factory. One function builds the whole backend, locally or on Modal."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import security
from .config import SETTINGS
from .models import ErrorResponse
from .providers.base import SynthesisProvider
from .providers.qwen import QwenProvider
from .providers.stub import StubProvider
from .routes import keys as key_routes
from .routes import accounts, admin, billing, github_auth, meta, paystack, speech, talk, worker as worker_routes
from .state import VoiceRegistry
from .worker import TTSWorker


def server_root() -> Path:
    return Path(__file__).resolve().parent.parent


def sample_dir() -> Path:
    return server_root() / "server" / "static" / "samples"


def build_provider() -> SynthesisProvider:
    if SETTINGS.provider == "qwen":
        provider = QwenProvider(
            checkpoint=SETTINGS.qwen_checkpoint, model_version=SETTINGS.model_version
        )
        provider.load()  # fails loudly if the checkpoint is missing
        return provider
    if SETTINGS.provider == "piper":
        from .providers.piper import parse_voice_map, PiperProvider

        voice_ids = [v.strip() for v in SETTINGS.voices.split(",") if v.strip()]
        provider = PiperProvider(
            voice_ids or ["ada", "tunde", "musa", "ngozi"],
            models_dir=SETTINGS.piper_models_dir,
            voice_map=parse_voice_map(SETTINGS.piper_voice_map),
            use_cuda=SETTINGS.use_cuda,
        )
        provider.load()  # missing files = tone fallback, never a crash
        return provider
    voice_ids = [v.strip() for v in SETTINGS.voices.split(",") if v.strip()]
    return StubProvider(voice_ids or ["ada"], sample_dir=sample_dir())


def build_worker(provider: SynthesisProvider) -> TTSWorker:
    """Wrap any engine in Modal-like ops semantics. Routes speak the worker
    as if it were the provider (same methods), so local<->Modal is env-only."""
    return TTSWorker(
        provider,
        gpu=SETTINGS.worker_gpu,
        mode=SETTINGS.worker_mode,
        min_containers=SETTINGS.worker_min_containers,
        max_containers=SETTINGS.worker_max_containers,
        cold_start_ms=SETTINGS.worker_cold_start_ms,
        timeout_s=SETTINGS.worker_timeout_s,
    )


def build_registry(provider: SynthesisProvider):
    """Mongo when reachable, in-memory otherwise. Same interface either way."""
    if os.getenv("TTS_VOICE_STORE", "mongo") == "mongo":
        try:
            from .db import MongoVoiceRegistry

            registry = MongoVoiceRegistry()
            registry.all()  # fail fast if Mongo is down
            # Seed the provider lineup on every boot (upsert: descriptive
            # fields refresh, enabled toggles are preserved). Without this a
            # fresh database has NO voices and every render 404s/unknowns.
            for v in provider.voices():
                registry.create(v)
            print("[server] voice store: mongo")
            return registry
        except Exception as e:  # noqa: BLE001 - dev fallback, never silent in prod logs
            print(f"[server] mongo unreachable ({e}); voice store: memory")
    return VoiceRegistry(provider)


def build_keys():
    """Mongo when reachable, in-memory otherwise."""
    if os.getenv("TTS_VOICE_STORE", "mongo") == "mongo":
        try:
            from .keys import KeyStore

            keys = KeyStore()
            keys.list()  # fail fast if Mongo is down
            print("[server] key store: mongo")
            return keys
        except Exception as e:  # noqa: BLE001
            print(f"[server] mongo unreachable ({e}); key store: memory")
    from .keys import MemoryKeyStore

    return MemoryKeyStore()


def build_payments():
    """Paystack pending/fulfilled references. Mongo when reachable, memory otherwise."""
    if os.getenv("TTS_VOICE_STORE", "mongo") == "mongo":
        try:
            from .paystack_pay import MongoPaymentStore

            payments = MongoPaymentStore()
            payments.ping()  # fail fast if Mongo is down
            print("[server] payment store: mongo")
            return payments
        except Exception as e:  # noqa: BLE001
            print(f"[server] mongo unreachable ({e}); payment store: memory")
    from .paystack_pay import MemoryPaymentStore

    return MemoryPaymentStore()


def build_activity():
    """Login + visit log. Mongo when reachable, memory otherwise."""
    if os.getenv("TTS_VOICE_STORE", "mongo") == "mongo":
        try:
            from .activity import MongoActivityStore

            activity = MongoActivityStore()
            activity.ping()  # fail fast if Mongo is down
            print("[server] activity store: mongo")
            return activity
        except Exception as e:  # noqa: BLE001
            print(f"[server] mongo unreachable ({e}); activity store: memory")
    from .activity import MemoryActivityStore

    return MemoryActivityStore()


def build_users():
    """Persona + ledger. Mongo when reachable, memory otherwise."""
    if os.getenv("TTS_VOICE_STORE", "mongo") == "mongo":
        try:
            from .users import UserStore

            users = UserStore()
            users.ensure_persona()
            print("[server] user store: mongo")
            return users
        except Exception as e:  # noqa: BLE001
            print(f"[server] mongo unreachable ({e}); user store: memory")
    from .users import MemoryUserStore

    users = MemoryUserStore()
    users.ensure_persona()
    return users


def create_app(provider: SynthesisProvider | None = None) -> FastAPI:
    raw = provider or build_provider()
    # The worker IS the provider as far as routes are concerned (same
    # synthesize_full/stream/voices interface + stats). Raw engine stays
    # reachable for tests that pin a StubProvider directly.
    worker = raw if isinstance(raw, TTSWorker) else build_worker(raw)
    provider = worker
    app = FastAPI(title="OLED Studio TTS API", version="1.0.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=security.cors_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from starlette.middleware.sessions import SessionMiddleware

    app.add_middleware(
        SessionMiddleware,
        secret_key=security.session_secret(),
        same_site=security.session_same_site(),
        https_only=security.session_https_only(),
        # B2B hygiene: sessions die after 7 days even if logout is forgotten.
        # (Starlette default is 14; logout still kills them immediately.)
        max_age=7 * 24 * 3600,
    )
    app.add_middleware(security.SecurityHeadersMiddleware)
    app.add_middleware(security.RateLimitMiddleware)

    app.state.provider = provider
    app.state.worker = worker
    app.state.engine = raw
    app.state.registry = build_registry(provider)
    app.state.keys = build_keys()
    app.state.users = build_users()
    app.state.payments = build_payments()
    app.state.activity = build_activity()

    @app.exception_handler(HTTPException)
    async def http_errors(request: Request, exc: HTTPException):  # noqa: ARG001
        detail = exc.detail
        if isinstance(detail, dict) and "code" in detail:
            body = {"error": detail}
        else:
            body = {"error": {"code": "http_error", "message": str(detail)}}
        return JSONResponse(status_code=exc.status_code, content=ErrorResponse(**body).model_dump())

    app.include_router(meta.router)
    app.include_router(worker_routes.router)
    app.include_router(accounts.router)
    app.include_router(github_auth.router)
    app.include_router(key_routes.router)
    app.include_router(billing.router)
    app.include_router(paystack.router)
    app.include_router(admin.router)
    app.include_router(speech.router)
    app.include_router(talk.router)

    # Pre-recorded voice samples, referenced by voices as /samples/{id}.wav.
    # (API asset: the frontend streams these URLs but never hosts them.)
    samples = sample_dir()
    if samples.is_dir():
        app.mount("/samples", StaticFiles(directory=str(samples)), name="samples")

    # Split-server mode: this process is API-only (/health, /v1/*, /samples/*).
    # The Next.js frontend runs separately (`npm run dev` on :3001, or its
    # own host in prod) and talks to us cross-origin — see FRONTEND_ORIGINS
    # and server/security.py cors_origins(). Nothing is shared, nothing is
    # mounted: frontend deploys never touch this process and vice versa.

    return app


app = create_app()
