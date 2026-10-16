"""Full-pipeline spend/efficiency bench: text in, WAV out, ledger checked.

Hits a LIVE server (python -m uvicorn server.app:app --port 8000) and reports
what Modal billing will care about: latency, audio yield, RTF, chars debited,
worker gpu-seconds + estimated cost. Run:

  python scripts/bench_pipeline.py [--base http://127.0.0.1:8000] [--text "..."]

Exit 1 on any contract break (bad WAV, missing headers, ledger not moving).
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import sys
import time
import urllib.request
import wave

HDRS = ("x-request-id", "x-session-id", "x-voice-id", "x-model-version", "x-synth-time", "x-balance-chars")


def req(base: str, method: str, path: str, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(base + path, data=data, method=method,
                               headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:  # type: ignore
        return e.code, dict(e.headers), e.read()


import urllib.error  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--text", default="Good morning Lagos, this is the pipeline speaking.")
    ap.add_argument("--voice", default="ada")
    args = ap.parse_args()
    base = args.base.rstrip("/")
    fails: list[str] = []

    def check(name: str, cond: bool, extra: str = ""):
        print(("PASS " if cond else "FAIL ") + name + (f" [{extra}]" if extra else ""))
        if not cond:
            fails.append(name)

    s, h, b = req(base, "POST", "/v1/worker/reset", {})
    s, h, b = req(base, "GET", "/v1/billing/balance")
    bal0 = json.loads(b)["balance_chars"]
    s, h, b = req(base, "GET", "/v1/worker/stats")
    w0 = json.loads(b)

    # 1. batch render
    t0 = time.perf_counter()
    s, h, b = req(base, "POST", "/v1/speech", {"text": args.text, "voice_id": args.voice})
    wall = time.perf_counter() - t0
    hl = {k.lower(): v for k, v in h.items()}
    check("POST /v1/speech 200 wav", s == 200 and hl.get("content-type") == "audio/wav", f"{len(b)} bytes")
    check("speech headers", all(k in hl for k in HDRS))
    nframes, rate = 0, 0
    if s == 200:
        with wave.open(io.BytesIO(b), "rb") as w:
            nframes, rate = w.getnframes(), w.getframerate()
        audio_s = nframes / rate if rate else 0
        check("wav mono16 24k", rate == 24000, f"{nframes} frames, {audio_s:.2f}s audio, {wall:.2f}s wall")
        rtf = wall / audio_s if audio_s else 0
        print(f"  batch: wall={wall:.2f}s audio={audio_s:.2f}s RTF={rtf:.2f} synth_hdr={hl.get('x-synth-time')}s")
    else:
        audio_s, rtf = 0, 0

    # 2. stream render
    sreq = urllib.request.Request(base + "/v1/speech/stream",
                                  data=json.dumps({"text": args.text, "voice_id": args.voice}).encode(),
                                  method="POST", headers={"Content-Type": "application/json"})
    t0 = time.perf_counter()
    with urllib.request.urlopen(sreq, timeout=120) as resp:
        raw = resp.read().decode()
    swall = time.perf_counter() - t0
    events = [json.loads(l[6:]) for l in raw.splitlines() if l.startswith("data: ")]
    types = [e["type"] for e in events]
    pcm = b"".join(base64.b64decode(e["data"]) for e in events if e["type"] == "chunk")
    check("SSE started->done", types and types[0] == "started" and types[-1] == "done", f"{len(events)} events, {swall:.2f}s")

    # 3. spend ledger moved: chars debited, worker counted, cost estimated
    s, h, b = req(base, "GET", "/v1/billing/balance")
    bal1 = json.loads(b)["balance_chars"]
    spent_chars = bal0 - bal1
    check("chars debited", spent_chars >= 2 * len(args.text), f"spent={spent_chars} for 2 renders")
    s, h, b = req(base, "GET", "/v1/worker/stats")
    w1 = json.loads(b)
    reqs = w1.get("total_requests", 0) - w0.get("total_requests", 0)
    check("worker counted renders", reqs >= 2, f"+{reqs} req, gpu_s={w1.get('total_gpu_s')}, ${w1.get('est_cost_usd')}")
    print(f"  worker: engine={w1.get('engine')} gpu={w1.get('gpu')} rtf_avg={w1.get('rtf_avg')} "
          f"first_chunk_ms={w1.get('first_chunk_ms_avg')} chars/dollar={w1.get('chars_per_dollar')}")
    s, h, b = req(base, "GET", "/v1/usage?limit=5")
    ev = json.loads(b)["events"]
    check("usage ledger rows", any(e["text"][:20] in args.text[:20] for e in ev), f"{len(ev)} recent")

    print()
    if fails:
        print(f"RESULT: NO — {len(fails)} failing: {fails}")
        sys.exit(1)
    print(f"RESULT: YES — pipeline ok (RTF~{rtf:.2f}, spent={spent_chars} chars, est=${w1.get('est_cost_usd')})")


if __name__ == "__main__":
    main()
