"""Live probe for WS /v1/talk: correctness + quality numbers.

Run against a LIVE server:  python scripts/probe_talk.py [--base ws://127.0.0.1:8000]

Checks:
  speak -> started -> binary WAV frames -> done (valid WAV, measures
           time-to-started, time-to-first-audio, total, RTF)
  cancel -> cancelled
  bad voice -> error(unknown_voice)

Exit 1 on any break.
"""

from __future__ import annotations

import argparse
import asyncio
import io
import json
import sys
import wave

import websockets


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="ws://127.0.0.1:8000")
    ap.add_argument("--text", default="Good morning Lagos, testing the live voice socket.")
    ap.add_argument("--voice", default="ada")
    args = ap.parse_args()
    fails: list[str] = []

    def check(name: str, cond: bool, extra: str = ""):
        print(("PASS " if cond else "FAIL ") + name + (f" [{extra}]" if extra else ""))
        if not cond:
            fails.append(name)

    url = args.base.rstrip("/") + "/v1/talk"
    async with websockets.connect(url, max_size=1 << 24) as ws:
        # 1. happy path
        t0 = asyncio.get_event_loop().time()
        await ws.send(json.dumps({"type": "speak", "request_id": "probe-1",
                                  "text": args.text, "voice_id": args.voice}))
        started = json.loads(await ws.recv())
        t_started = asyncio.get_event_loop().time() - t0
        check("started event", started.get("type") == "started"
              and started.get("request_id") == "probe-1"
              and started.get("sample_rate") == 24000,
              f"{t_started*1000:.0f}ms engine={started.get('model_version')}")

        header = await ws.recv()
        t_first = asyncio.get_event_loop().time() - t0
        if isinstance(header, str):
            header = header.encode("latin1")
        check("first frame is WAV header", header[:4] == b"RIFF" and len(header) == 44,
              f"first-audio={t_first*1000:.0f}ms")

        pcm = b""
        done = None
        while True:
            msg = await ws.recv()
            if isinstance(msg, str):
                done = json.loads(msg)
                break
            pcm += msg
        t_total = asyncio.get_event_loop().time() - t0
        check("done event", done and done.get("type") == "done"
              and done.get("bytes") == 44 + len(pcm),
              f"total={t_total*1000:.0f}ms synth={done.get('synth_time')}s bytes={done.get('bytes')}")
        try:
            with wave.open(io.BytesIO(header + pcm), "rb") as w:
                ok = (w.getnchannels() == 1 and w.getsampwidth() == 2
                      and w.getframerate() == 24000)
            # NOTE: streaming header carries 0xFFFFFFFF lengths by design,
            # so duration comes from payload bytes, not the header.
            audio_s = len(pcm) / 2 / 24000
            ok = ok and audio_s > 0
        except Exception:
            ok, audio_s = False, 0.0
        check("frames form valid WAV", ok, f"{audio_s:.2f}s audio, RTF={t_total/audio_s:.2f}" if audio_s else "")

        # 2. cancel round-trip
        await ws.send(json.dumps({"type": "cancel", "request_id": "probe-1"}))
        cancelled = json.loads(await ws.recv())
        check("cancel -> cancelled", cancelled.get("type") == "cancelled")

        # 3. bad voice fails loudly, connection stays alive
        await ws.send(json.dumps({"type": "speak", "request_id": "probe-2",
                                  "text": "hi", "voice_id": "nope"}))
        err = json.loads(await ws.recv())
        check("unknown voice -> error", err.get("type") == "error"
              and err.get("code") == "unknown_voice")

    print()
    if fails:
        print(f"RESULT: NO — {len(fails)} failing: {fails}")
        sys.exit(1)
    print("RESULT: YES — talk socket live and healthy")


if __name__ == "__main__":
    asyncio.run(main())
