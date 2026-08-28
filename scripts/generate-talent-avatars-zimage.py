#!/usr/bin/env python3
"""Generate Hara Talent portraits locally with the cached Z-Image-Turbo model.

The nightly job is resumable and bounded to 03:00-09:00 local time. Curated Hara
roles are regenerated once for a consistent art direction; community roles are
generated only while their deterministic packaged portrait is missing.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
QUEUE = ROOT / "scripts" / "talent-avatar-queue.mjs"
PINNED_NODE = Path(os.environ.get(
    "HARA_AVATAR_NODE",
    str(Path.home() / ".nvm" / "versions" / "node" / "v22.23.1" / "bin" / "node"),
))
MODEL = Path(os.environ.get(
    "HARA_ZIMAGE_MODEL",
    str(Path.home() / ".cache" / "huggingface" / "hub" / "models--Tongyi-MAI--Z-Image-Turbo"),
))
STATE = Path(os.environ.get(
    "HARA_AVATAR_STATE",
    str(Path.home() / "Library" / "Caches" / "com.nanhara.hara" / "avatar-generation" / "zimage-state.jsonl"),
))
DONE = STATE.with_name("zimage-complete.json")
ASSET_ROOT = (ROOT / "public" / "avatars" / "talent").resolve()
NEGATIVE_PROMPT = (
    "text, letters, numbers, typography, watermark, signature, logo, badge, UI, frame, "
    "checkerboard, transparency, pixel art, chibi, anime, low-poly 3D, photorealistic, "
    "animation film, vector clipart, child, multiple people, duplicate person, extra limbs, "
    "large foreground prop, full body, cropped head, clutter, busy background, blurry face"
)


class DeadlineReached(RuntimeError):
    pass


def parse_clock(value: str) -> tuple[int, int]:
    try:
        hour, minute = (int(part) for part in value.split(":", 1))
    except (TypeError, ValueError) as error:
        raise argparse.ArgumentTypeError("clock must be HH:MM") from error
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise argparse.ArgumentTypeError("clock must be HH:MM")
    return hour, minute


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--window-start", default="03:00", type=parse_clock)
    parser.add_argument("--window-end", default="09:00", type=parse_clock)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--width", type=int, default=512)
    parser.add_argument("--height", type=int, default=512)
    parser.add_argument("--steps", type=int, default=9)
    parser.add_argument("--asset-size", type=int, default=256)
    parser.add_argument("--max-bytes", type=int, default=64 * 1024)
    parser.add_argument("--state-file", type=Path, default=STATE)
    parser.add_argument("--model", type=Path, default=MODEL)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def emit(event: str, **payload: Any) -> None:
    print(json.dumps({"at": datetime.now().isoformat(timespec="seconds"), "event": event, **payload}, ensure_ascii=False), flush=True)


def work_window(args: argparse.Namespace) -> tuple[datetime, datetime] | None:
    now = datetime.now()
    start = now.replace(hour=args.window_start[0], minute=args.window_start[1], second=0, microsecond=0)
    end = now.replace(hour=args.window_end[0], minute=args.window_end[1], second=0, microsecond=0)
    if end <= start:
        raise ValueError("overnight windows that cross midnight are not supported")
    return (start, end) if start <= now < end else None


def load_jobs() -> list[dict[str, Any]]:
    if not PINNED_NODE.exists():
        raise FileNotFoundError(f"pinned Node runtime is missing: {PINNED_NODE}")
    result = subprocess.run(
        [str(PINNED_NODE), "--experimental-strip-types", str(QUEUE), "--all"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    jobs = json.loads(result.stdout)
    if not isinstance(jobs, list):
        raise ValueError("Talent queue did not return a list")
    return jobs


def state_entries(path: Path) -> dict[str, dict[str, Any]]:
    entries: dict[str, dict[str, Any]] = {}
    if not path.exists():
        return entries
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(entry, dict) and isinstance(entry.get("username"), str):
            entries[entry["username"]] = entry
    return entries


def stable_seed(job: dict[str, Any]) -> int:
    raw = f"{job['id']}\0{job['username']}".encode()
    return int.from_bytes(hashlib.sha256(raw).digest()[:4], "big") & 0x7FFFFFFF


def digest_for(job: dict[str, Any], args: argparse.Namespace) -> str:
    payload = {
        "model": "Tongyi-MAI/Z-Image-Turbo",
        "prompt": job["prompt"],
        "seed": stable_seed(job),
        "width": args.width,
        "height": args.height,
        "steps": args.steps,
        "asset_size": args.asset_size,
        "style_revision": 1,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def safe_target(job: dict[str, Any]) -> Path:
    target = Path(job["outputPath"]).resolve()
    if not target.is_relative_to(ASSET_ROOT):
        raise ValueError(f"portrait target escapes asset root: {target}")
    return target


def resolve_model_snapshot(model: Path) -> Path:
    """Accept either a Diffusers snapshot or a Hugging Face cache repository root."""
    model = model.expanduser().resolve()
    if (model / "model_index.json").is_file():
        return model
    main_ref = model / "refs" / "main"
    if not main_ref.is_file():
        raise FileNotFoundError(f"Z-Image model_index.json is missing: {model}")
    revision = main_ref.read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"[0-9a-f]{7,64}", revision):
        raise ValueError(f"Z-Image cache has an invalid main revision: {model}")
    snapshot = (model / "snapshots" / revision).resolve()
    if not snapshot.is_relative_to((model / "snapshots").resolve()) or not (snapshot / "model_index.json").is_file():
        raise FileNotFoundError(f"Z-Image main snapshot is incomplete: {snapshot}")
    return snapshot


def select_jobs(jobs: list[dict[str, Any]], entries: dict[str, dict[str, Any]], args: argparse.Namespace) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    for job in jobs:
        target = safe_target(job)
        digest = digest_for(job, args)
        prior = entries.get(job["username"])
        completed = target.exists() and target.stat().st_size <= args.max_bytes and prior and prior.get("digest") == digest
        if completed:
            continue
        # Refresh all curated Hara roles once. Preserve already-packaged community art and generate only
        # the missing long tail, so an interrupted night never throws away useful work.
        if job.get("curated") or not target.exists():
            selected.append(job)
    curated = [job for job in selected if job.get("curated")]
    community = [job for job in selected if not job.get("curated")]
    ordered = curated + community
    return ordered[: args.limit] if args.limit > 0 else ordered


def save_webp(image: Image.Image, target: Path, args: argparse.Namespace) -> int:
    target.parent.mkdir(parents=True, exist_ok=True)
    fitted = ImageOps.fit(image.convert("RGB"), (args.asset_size, args.asset_size), method=Image.Resampling.LANCZOS, centering=(0.5, 0.45))
    partial = target.with_suffix(target.suffix + ".partial")
    try:
        for quality in (82, 78, 74, 70, 66, 62, 58, 54, 50):
            fitted.save(partial, format="WEBP", quality=quality, method=6, optimize=True)
            size = partial.stat().st_size
            if size <= args.max_bytes:
                os.replace(partial, target)
                return size
        raise RuntimeError(f"portrait remains larger than {args.max_bytes} bytes")
    finally:
        partial.unlink(missing_ok=True)


def main() -> int:
    args = arguments()
    jobs = load_jobs()
    entries = state_entries(args.state_file)
    selected = select_jobs(jobs, entries, args)
    emit("selection", total=len(jobs), selected=len(selected), curated=sum(bool(job.get("curated")) for job in selected))
    if args.dry_run or not selected:
        if not selected:
            args.state_file.parent.mkdir(parents=True, exist_ok=True)
            DONE.write_text(json.dumps({"completedAt": datetime.now().isoformat(), "total": len(jobs)}) + "\n", encoding="utf-8")
        return 0

    window = work_window(args)
    if window is None:
        emit("outside_window", start="%02d:%02d" % args.window_start, end="%02d:%02d" % args.window_end)
        return 0
    _, deadline = window
    model_snapshot = resolve_model_snapshot(args.model)

    import torch
    from diffusers import ZImagePipeline

    if not torch.backends.mps.is_available():
        raise RuntimeError("Apple MPS is unavailable")
    torch.set_grad_enabled(False)
    emit("loading_model", model=str(model_snapshot), device="mps", dtype="bfloat16")
    pipeline = ZImagePipeline.from_pretrained(
        str(model_snapshot),
        torch_dtype=torch.bfloat16,
        local_files_only=True,
    )
    pipeline.to("mps")
    pipeline.set_progress_bar_config(disable=True)
    emit("model_ready")

    args.state_file.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    saved = 0
    consecutive_failures = 0

    def stop_at_deadline(_pipeline: Any, _step: int, _timestep: Any, callback_kwargs: dict[str, Any]) -> dict[str, Any]:
        if datetime.now() >= deadline:
            raise DeadlineReached()
        return callback_kwargs

    with args.state_file.open("a", encoding="utf-8") as state_handle:
        for position, job in enumerate(selected, start=1):
            if datetime.now() >= deadline:
                emit("deadline", saved=saved, remaining=len(selected) - position + 1)
                break
            target = safe_target(job)
            item_started = time.monotonic()
            try:
                generator = torch.Generator(device="cpu").manual_seed(stable_seed(job))
                with torch.inference_mode():
                    image = pipeline(
                        prompt=job["prompt"],
                        negative_prompt=NEGATIVE_PROMPT,
                        width=args.width,
                        height=args.height,
                        num_inference_steps=args.steps,
                        guidance_scale=0.0,
                        generator=generator,
                        callback_on_step_end=stop_at_deadline,
                    ).images[0]
                bytes_written = save_webp(image, target, args)
                seconds = round(time.monotonic() - item_started, 1)
                entry = {
                    "username": job["username"],
                    "digest": digest_for(job, args),
                    "bytes": bytes_written,
                    "seconds": seconds,
                    "completedAt": datetime.now().isoformat(timespec="seconds"),
                }
                state_handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
                state_handle.flush()
                saved += 1
                consecutive_failures = 0
                average = (time.monotonic() - started) / saved
                emit(
                    "saved",
                    position=position,
                    selected=len(selected),
                    username=job["username"],
                    bytes=bytes_written,
                    seconds=seconds,
                    averageSeconds=round(average, 1),
                    estimatedMinutes=round((len(selected) - position) * average / 60, 1),
                )
                if saved % 8 == 0:
                    torch.mps.empty_cache()
            except DeadlineReached:
                emit("deadline", saved=saved, remaining=len(selected) - position + 1)
                break
            except Exception as error:  # continue past isolated bad prompts, stop on a broken runtime
                consecutive_failures += 1
                emit("failed", username=job["username"], error=str(error)[:500], consecutive=consecutive_failures)
                torch.mps.empty_cache()
                if consecutive_failures >= 3:
                    raise RuntimeError("three consecutive portrait generations failed") from error

    emit("finished_window", saved=saved, elapsedMinutes=round((time.monotonic() - started) / 60, 1))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        emit("fatal", error=str(error)[:800])
        raise
