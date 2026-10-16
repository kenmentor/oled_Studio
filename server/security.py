"""Production-grade HTTP hygiene: CORS policy, security headers, rate limits.

No new dependencies — stdlib + Starlette only. Everything is env-driven
so local dev stays frictionless and prod stays locked down.
"""

from __future__ import annotations

import os
import threading
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


def cors_origins() -> list[str]:
    """Single-server mode: the backend serves the frontend, so only local
    origins are trusted (served :8000 + dev :3001). FRONTEND_ORIGINS
    overrides for deploys."""
    raw = os.getenv("FRONTEND_ORIGINS", "").strip()
    if raw:
        return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]
    return [
        "http://127.0.0.1:8000",
        "http://localhost:8000",
        "http://127.0.0.1:3001",
        "http://localhost:3001",
    ]


def session_secret() -> str:
    secret = os.getenv("SESSION_SECRET", "")
    if not secret:
        if os.getenv("REQUIRE_LOGIN", "false").lower() in ("1", "true", "yes"):
            raise RuntimeError("SESSION_SECRET must be set when REQUIRE_LOGIN=true")
        print("[server] WARNING: SESSION_SECRET unset — OAuth sessions use a dev-only key")
        return "dev-only-secret-change-me"
    if len(secret) < 32:
        print("[server] WARNING: SESSION_SECRET shorter than 32 chars — use a longer random value")
    return secret


def session_https_only() -> bool:
    if os.getenv("SESSION_SECURE_COOKIE", "").lower() in ("1", "true", "yes"):
        return True
    return os.getenv("FRONTEND_URL", "").strip().lower().startswith("https://")


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        try:
            if request.url.scheme == "https":
                response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        except Exception:
            pass
        return response


# path prefix -> (max requests, window seconds)
_BUDGETS = [
    ("/v1/auth/", 60, 60.0),
    ("/v1/speech", 120, 60.0),
    ("/v1/tts", 120, 60.0),
    ("/v1/keys", 120, 60.0),
    ("/v1/billing/", 120, 60.0),
]
_DEFAULT_BUDGET = (600, 60.0)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """In-memory sliding-window limiter, per client IP + lane.

    Single-process semantics: every uvicorn worker keeps its own counters,
    so deploy one worker per container (or front with a shared limiter).
    """

    def __init__(self, app) -> None:
        super().__init__(app)
        self._hits: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def _budget(self, path: str) -> tuple[int, float]:
        for prefix, limit, window in _BUDGETS:
            if path.startswith(prefix):
                return limit, window
        return _DEFAULT_BUDGET

    def _client(self, request) -> str:
        try:
            fwd = request.headers.get("x-forwarded-for", "")
            if fwd:
                return fwd.split(",")[0].strip()
            return request.client.host if request.client else "unknown"
        except Exception:
            return "unknown"

    async def dispatch(self, request, call_next):
        # Preflight + health never count against anyone.
        if request.method == "OPTIONS" or request.url.path in ("/health",):
            return await call_next(request)
        limit, window = self._budget(request.url.path)
        key = f"{self._client(request)}:{request.url.path.split('/')[1:3]}"
        now = time.monotonic()
        with self._lock:
            hits = [t for t in self._hits.get(key, []) if now - t < window]
            if len(hits) >= limit:
                retry = int(window - (now - hits[0])) + 1
                return JSONResponse(
                    {"error": {"code": "rate_limited", "message": f"slow down — retry in {retry}s"}},
                    status_code=429,
                    headers={"Retry-After": str(retry)},
                )
            hits.append(now)
            self._hits[key] = hits
        return await call_next(request)
