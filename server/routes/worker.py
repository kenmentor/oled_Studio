"""Worker ops routes: spend/efficiency ledger for the Modal-mimic.

GET  /v1/worker/stats  -> gpu type, containers, cold starts, requests,
                          audio seconds, gpu seconds, RTF, first-chunk,
                          estimated cost. Powers the bench script + dashboard.
POST /v1/worker/reset  -> zero the ledger (tests/bench isolation).
"""

from __future__ import annotations

from fastapi import APIRouter, Request

router = APIRouter(tags=["worker"])


def _worker(request: Request):
    w = getattr(request.app.state, "worker", None)
    if w is None:
        # Pre-worker apps (tests pinning a raw provider): synthesize a view.
        p = request.app.state.provider
        return {
            "mode": "direct",
            "engine": getattr(p, "name", "?"),
            "model_version": getattr(p, "model_version", "?"),
            "gpu": "n/a",
            "total_requests": 0,
            "est_cost_usd": 0,
        }
    return w.get_stats()


@router.get("/v1/worker/stats")
def worker_stats(request: Request):
    w = getattr(request.app.state, "worker", None)
    if w is None:
        return _worker(request)
    return w.get_stats()


@router.post("/v1/worker/reset")
def worker_reset(request: Request):
    w = getattr(request.app.state, "worker", None)
    if w is None:
        return {"ok": True, "reset": False}
    w.reset_stats()
    return {"ok": True, "reset": True}
