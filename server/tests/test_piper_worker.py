"""Piper stand-in + Modal-mimic worker tests. Run: python -m pytest server/tests/test_piper_worker.py -q"""

import io
import os
import wave

os.environ["TTS_VOICE_STORE"] = "memory"

from fastapi.testclient import TestClient  # noqa: E402

from server.app import create_app  # noqa: E402
from server.providers.piper import PiperProvider  # noqa: E402
from server.providers.stub import StubProvider  # noqa: E402
from server.worker import TTSWorker  # noqa: E402


def test_piper_falls_back_without_models():
    p = PiperProvider(["ada"], models_dir="server/static/piper-missing-xyz")
    pcm = p.synthesize_full("hello world", "ada")
    assert len(pcm) > 0 and len(pcm) % 2 == 0
    assert p.voices()[0].id == "ada"
    try:
        p.synthesize_full("hi", "nope")
        assert False, "unknown voice must raise"
    except ValueError:
        pass


def test_worker_counts_and_costs():
    w = TTSWorker(StubProvider(["ada"]), gpu="L40S", cold_start_ms=0, max_containers=2)
    assert w.enter() >= 0
    assert w.enter() == 0.0  # idempotent, one cold start
    assert w.cold_starts == 1
    pcm = w.synthesize_full("hello ada", "ada")
    assert len(pcm) > 0
    frames = list(w.synthesize_stream("hello ada", "ada"))
    assert b"".join(frames) == pcm
    stats = w.get_stats()
    assert stats["total_requests"] == 2
    assert stats["total_chars"] == 2 * len("hello ada")
    assert stats["total_audio_s"] > 0
    assert stats["est_cost_usd"] >= 0
    assert stats["engine"] == "stub"
    w.reset_stats()
    assert w.get_stats()["total_requests"] == 0


def test_worker_is_provider_for_routes():
    c = TestClient(create_app(StubProvider(["ada"])))
    r = c.post("/v1/speech", json={"text": "hello", "voice_id": "ada"})
    assert r.status_code == 200
    with wave.open(io.BytesIO(r.content), "rb") as fh:
        assert fh.getframerate() == 24000
    s = c.get("/v1/worker/stats").json()
    assert s["total_requests"] >= 1
    assert "est_cost_usd" in s and "rtf_avg" in s
    assert c.post("/v1/worker/reset", json={}).json()["ok"] is True
    assert c.get("/v1/worker/stats").json()["total_requests"] == 0


def test_piper_provider_through_app():
    c = TestClient(create_app(PiperProvider(["ada"], models_dir="server/static/piper-missing-xyz")))
    r = c.get("/health")
    assert r.json()["provider"] == "piper"
    r = c.post("/v1/speech", json={"text": "pipeline probe", "voice_id": "ada"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "audio/wav"
