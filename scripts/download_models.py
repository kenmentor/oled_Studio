"""Build-time voice download: `python scripts/download_models.py`.

Bakes every mapped Piper voice into the image (Render build step) so the
first request never waits on Hugging Face. Reads the same env as runtime:
TTS_VOICES, PIPER_VOICE_MAP, PIPER_MODELS_DIR (+ PIPER_MODEL_URLS override).
Safe to re-run: files already on disk are skipped, never re-downloaded.

Exit 0 even when some voices fail — the provider falls back to test tones
for those, and boot-time auto-download retries them (PIPER_AUTO_DOWNLOAD).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(root))
    # Import late (after sys.path) and light: no app boot, no provider load.
    from server.model_fetch import ensure_models  # noqa: E402
    from server.providers.piper import parse_voice_map  # noqa: E402

    voice_ids = [v.strip() for v in os.getenv("TTS_VOICES", "ada").split(",") if v.strip()]
    voice_map = parse_voice_map(os.getenv("PIPER_VOICE_MAP", ""))
    models_dir = Path(os.getenv("PIPER_MODELS_DIR", "server/static/piper"))
    stems: list[str] = []
    for vid in voice_ids:
        stem = voice_map.get(vid) or voice_map.get("default") or vid
        if stem not in stems:
            stems.append(stem)
    if not stems:
        print("[models] no voices configured — nothing to download")
        return 0
    print(f"[models] want {len(stems)} voice(s) -> {models_dir}: {', '.join(stems)}")
    results = ensure_models(models_dir, stems)
    ok = sum(1 for v in results.values() if v)
    print(f"[models] ready {ok}/{len(results)} (missing ones fall back to test tone)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
