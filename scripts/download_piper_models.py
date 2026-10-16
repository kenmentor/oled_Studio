"""Fetch small Piper voices so the stand-in engine renders real speech.

Maps 4 Nigerian personas onto distinct English Piper voices (accent
fine-tune lands with Qwen; here we need distinct, fast, intelligible):

  ada   -> en_US-lessac-low   (female, clear)
  tunde -> en_GB-alan-low     (male, distinct)
  musa  -> en_US-ryan-low     (male, distinct)
  ngozi -> en_US-amy-low      (female, distinct)

Run: python scripts/download_piper_models.py [--dir server/static/piper]
~15MB per voice (low). Files land as <stem>.onnx + <stem>.onnx.json, then:
  PIPER_VOICE_MAP="ada:en_US-lessac-low,tunde:en_GB-alan-low,..."
  TTS_PROVIDER=piper
"""

from __future__ import annotations

import argparse
import sys
import urllib.request
from pathlib import Path

BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main"

VOICES = {
    "en_US-lessac-low": "en/en_US/lessac/low/en_US-lessac-low",
    "en_GB-alan-low": "en/en_GB/alan/low/en_GB-alan-low",
    "en_US-ryan-low": "en/en_US/ryan/low/en_US-ryan-low",
    "en_US-amy-low": "en/en_US/amy/low/en_US-amy-low",
}

PERSONA_MAP = {
    "ada": "en_US-lessac-low",
    "tunde": "en_GB-alan-low",
    "musa": "en_US-ryan-low",
    "ngozi": "en_US-amy-low",
}


def fetch(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "oled-studio/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="server/static/piper")
    args = ap.parse_args()
    out = Path(args.dir)
    ok, missing = 0, []
    for stem, rel in VOICES.items():
        for ext in (".onnx", ".onnx.json"):
            url = f"{BASE}/{rel}{ext}"
            dest = out / f"{stem}{ext}"
            if dest.is_file() and dest.stat().st_size > 0:
                print(f"cached {dest}")
                continue
            try:
                print(f"fetch {url} ...")
                fetch(url, dest)
                print(f"  -> {dest} ({dest.stat().st_size // 1024} KB)")
                ok += 1
            except Exception as e:  # noqa: BLE001
                print(f"  MISS {stem}{ext}: {e}")
                missing.append(f"{stem}{ext}")
    print()
    print("PIPER_VOICE_MAP=" + ",".join(f"{k}:{v}" for k, v in PERSONA_MAP.items()))
    if missing:
        print(f"WARNING: {len(missing)} files missing ({missing}); provider falls back to tone.")
        sys.exit(2)
    print(f"done: {ok} fetched, all cached in {out}")


if __name__ == "__main__":
    main()
