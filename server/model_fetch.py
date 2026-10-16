"""Model weights, self-installing from Hugging Face.

Why: *.onnx is gitignored (hundreds of MB), so fresh machines — Render
included — boot with NO voices and silently fall back to test tones.
This module fetches what's missing from rhasspy/piper-voices at boot
(and at build time via scripts/download_models.py), so deploys speak
with real voices instead of beeps.

How a voice maps to files: PIPER_VOICE_MAP says ada -> en_US-lessac-medium
(a "stem"). Standard Piper stems parse as {locale}-{voice}-{quality}, and
the HF repo lays them out as {lang}/{locale}/{voice}/{quality}/{stem}:
  en_US-lessac-medium -> en/en_US/lessac/medium/en_US-lessac-medium.onnx
                        + ...onnx.json (voice config, REQUIRED by Piper)
Non-standard stems can't be guessed — give them explicit URLs:
  PIPER_MODEL_URLS="mystem=https://.../mystem.onnx"
(the .onnx.json is then expected at <url>.json).

Env:
  PIPER_AUTO_DOWNLOAD=true   fetch missing files on boot (Render wants this)
  PIPER_MODEL_URLS           explicit stem=url overrides, comma-separated
  PIPER_HF_BASE              mirror base (default: rhasspy/piper-voices)
"""

from __future__ import annotations

import os
from pathlib import Path


def _get(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def hf_base() -> str:
    return _get("PIPER_HF_BASE", "https://huggingface.co/rhasspy/piper-voices/resolve/main")


def auto_download() -> bool:
    return _get("PIPER_AUTO_DOWNLOAD", "true").lower() in ("1", "true", "yes")


def explicit_urls() -> dict[str, str]:
    """PIPER_MODEL_URLS="stem=url,stem2=url2" (the .json follows as url.json)."""
    out: dict[str, str] = {}
    for part in _get("PIPER_MODEL_URLS", "").split(","):
        part = part.strip()
        if not part or "=" not in part:
            continue
        stem, url = part.split("=", 1)
        if stem.strip() and url.strip():
            out[stem.strip()] = url.strip()
    return out


def hf_url_for_stem(stem: str) -> str | None:
    """Guess the HF URL for a standard {locale}-{voice}-{quality} stem."""
    if stem in explicit_urls():
        return explicit_urls()[stem]
    bits = stem.split("-")
    if len(bits) != 3 or "_" not in bits[0]:
        return None  # not standard-shaped: needs an explicit URL
    locale, voice, quality = bits
    lang = locale.split("_")[0]
    if not lang or not voice or not quality:
        return None
    return f"{hf_base()}/{lang}/{locale}/{voice}/{quality}/{stem}.onnx"


def needed_files(models_dir: str | Path, stems: list[str]) -> dict[str, list[str]]:
    """stems -> [missing urls]. Skips stems whose .onnx already exists."""
    models_dir = Path(models_dir)
    missing: dict[str, list[str]] = {}
    for stem in stems:
        if (models_dir / f"{stem}.onnx").is_file():
            continue  # already on disk: never re-download
        url = hf_url_for_stem(stem)
        if url is None:
            print(f"[models] no URL for {stem!r} — set PIPER_MODEL_URLS or use a standard stem")
            continue
        missing[stem] = [url, f"{url}.json"]
    return missing


def _download(url: str, dest: Path, retries: int = 3) -> bool:
    """Stream one file with retries. Separated for tests to monkeypatch."""
    import httpx

    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(1, retries + 1):
        try:
            with httpx.stream("GET", url, timeout=60, follow_redirects=True) as r:
                if r.status_code != 200:
                    print(f"[models] {r.status_code} for {url} (try {attempt}/{retries})")
                    continue
                size = 0
                with open(tmp, "wb") as f:
                    for chunk in r.iter_bytes(1 << 20):
                        f.write(chunk)
                        size += len(chunk)
            if tmp.stat().st_size == 0:
                tmp.unlink(missing_ok=True)
                continue
            tmp.replace(dest)
            print(f"[models] saved {dest.name} ({size / 1e6:.1f} MB)")
            return True
        except Exception as e:  # noqa: BLE001 - network flakiness, retry
            print(f"[models] {e} (try {attempt}/{retries})")
    tmp.unlink(missing_ok=True)
    return False


def ensure_models(models_dir: str | Path, stems: list[str]) -> dict[str, bool]:
    """Download every missing stem's .onnx + .onnx.json. Returns stem -> ok."""
    results: dict[str, bool] = {}
    for stem, urls in needed_files(models_dir, stems).items():
        models_dir_p = Path(models_dir)
        onnx_ok = _download(urls[0], models_dir_p / f"{stem}.onnx")
        json_ok = _download(urls[1], models_dir_p / f"{stem}.onnx.json") if onnx_ok else False
        results[stem] = onnx_ok and json_ok
        if not results[stem]:
            print(f"[models] {stem} incomplete — voice falls back to test tone")
    for stem in stems:
        # Already on disk -> True; unmappable (no URL) -> False so callers
        # don't claim a voice is ready when it will fall back to tone.
        results.setdefault(stem, (Path(models_dir) / f"{stem}.onnx").is_file())
    return results
