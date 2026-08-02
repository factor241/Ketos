#!/usr/bin/env python3
# ruff: noqa: EM101, S314, TRY003
"""Validate the authorized artwork and independent canonical SVG masters.

This command never writes masters. It validates the manually reviewed curves,
then uses ImageMagick as an independent renderer for source-mask fidelity.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from itertools import pairwise
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "brand" / "assets"
SOURCE = ASSETS / "source" / "ketos-source.png"
EXPECTED_SHA256 = "cb895e5fafde4006cc17872c8537bbd4b3ba8c0f4b9304bcff2303184e0eaca3"
MASTERS = ("ketos-symbol.svg", "ketos-wordmark.svg", "ketos-horizontal.svg")
ALLOWED_TAGS = {"svg", "g", "path", "title", "desc"}
ARTWORK_THRESHOLD = 16
SYMBOL_BOX = (353, 247, 606, 558)
WORDMARK_BOX = (201, 862, 857, 108)
EXPECTED_VIEWBOXES = {
    "ketos-symbol.svg": (0.0, 0.0, 606.0, 558.0),
    "ketos-wordmark.svg": (0.0, 0.0, 857.0, 108.0),
    "ketos-horizontal.svg": (0.0, 0.0, 1500.0, 558.0),
}
COMMAND_CEILINGS = {
    "ketos-symbol.svg": 220,
    "ketos-wordmark.svg": 130,
    "ketos-horizontal.svg": 350,
}
ALPHA_THRESHOLD = 128
ONE_PIXEL_STEP_LIMIT = 1.01
MAX_STAIRCASE_RUN = 2
SYMBOL_IOU_MINIMUM = 0.96
WORDMARK_IOU_MINIMUM = 0.93


def artwork_mask() -> np.ndarray:
    with Image.open(SOURCE) as image:
        rgb = np.asarray(image.convert("RGB"), dtype=np.int16)
    return np.min(255 - rgb, axis=2) > ARTWORK_THRESHOLD


def crop(mask: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
    x, y, width, height = box
    return mask[y : y + height, x : x + width]


def iou(left: np.ndarray, right: np.ndarray) -> float:
    return float(np.logical_and(left, right).sum() / np.logical_or(left, right).sum())


def independent_render_mask(path: Path, width: int, height: int) -> np.ndarray:
    magick = shutil.which("magick")
    if magick is None:
        raise RuntimeError("ImageMagick is required for independent SVG fidelity validation")
    with TemporaryDirectory() as temporary:
        output = Path(temporary) / "render.png"
        subprocess.run(  # noqa: S603 - executable is resolved from the trusted local PATH.
            [magick, "-background", "none", str(path), "-resize", f"{width}x{height}!", str(output)],
            check=True,
            capture_output=True,
        )
        with Image.open(output) as image:
            return np.asarray(image.convert("RGBA"))[:, :, 3] >= ALPHA_THRESHOLD


def longest_staircase_run(path_data: str) -> int:
    line_points = [(float(x), float(y)) for x, y in re.findall(r"L\s*(-?[\d.]+)[ ,]+(-?[\d.]+)", path_data)]
    run = 0
    longest = 0
    for left, right in pairwise(line_points):
        one_pixel_step = max(abs(right[0] - left[0]), abs(right[1] - left[1])) <= ONE_PIXEL_STEP_LIMIT
        run = run + 1 if one_pixel_step else 0
        longest = max(longest, run)
    return longest


def validate() -> list[str]:
    errors: list[str] = []
    if not SOURCE.is_file():
        return [f"missing authorized source: {SOURCE}"]
    if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != EXPECTED_SHA256:
        errors.append("authorized source SHA-256 mismatch")
    with Image.open(SOURCE) as image:
        if image.mode != "RGBA" or image.size != (1254, 1254):
            errors.append(f"unexpected source image contract: {image.mode} {image.size}")

    for name in MASTERS:
        path = ASSETS / "master" / name
        if not path.is_file():
            errors.append(f"missing master: {path}")
            continue
        text = path.read_text(encoding="utf-8")
        try:
            root = ET.fromstring(text)
        except ET.ParseError as exc:
            errors.append(f"invalid XML in {name}: {exc}")
            continue
        tags = {node.tag.rsplit("}", 1)[-1] for node in root.iter()}
        unexpected = tags - ALLOWED_TAGS
        if unexpected:
            errors.append(f"non-path SVG tags in {name}: {sorted(unexpected)}")
        paths = [node for node in root.iter() if node.tag.endswith("path")]
        if not paths:
            errors.append(f"master contains no paths: {name}")
            continue
        if re.search(r"<(image|text|foreignobject)\b|data:image|font-family", text, re.IGNORECASE):
            errors.append(f"embedded raster or font dependency in {name}")
        if tuple(map(float, root.attrib.get("viewBox", "").split())) != EXPECTED_VIEWBOXES[name]:
            errors.append(f"unexpected canonical viewBox in {name}")
        path_data = " ".join(node.attrib["d"] for node in paths)
        commands = re.findall(r"[MLCQZ]", path_data)
        if not ({"C", "Q"} & set(commands)):
            errors.append(f"canonical master has no curve commands: {name}")
        if len(commands) > COMMAND_CEILINGS[name]:
            errors.append(f"canonical command ceiling exceeded in {name}: {len(commands)}")
        if longest_staircase_run(path_data) > MAX_STAIRCASE_RUN:
            errors.append(f"raster staircase sequence remains in {name}")

    try:
        mask = artwork_mask()
        symbol = independent_render_mask(ASSETS / "master/ketos-symbol.svg", 606, 558)
        wordmark = independent_render_mask(ASSETS / "master/ketos-wordmark.svg", 857, 108)
        symbol_score = iou(crop(mask, SYMBOL_BOX), symbol)
        wordmark_score = iou(crop(mask, WORDMARK_BOX), wordmark)
        if symbol_score < SYMBOL_IOU_MINIMUM:
            errors.append(f"symbol source fidelity below {SYMBOL_IOU_MINIMUM}: {symbol_score:.6f}")
        if wordmark_score < WORDMARK_IOU_MINIMUM:
            errors.append(f"wordmark source fidelity below {WORDMARK_IOU_MINIMUM}: {wordmark_score:.6f}")
    except (RuntimeError, subprocess.CalledProcessError) as exc:
        errors.append(f"independent fidelity validation failed: {exc}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate checked-in masters")
    parser.parse_args()
    errors = validate()
    if errors:
        print("\n".join(f"ERROR: {error}" for error in errors), file=sys.stderr)
        return 1
    print("Ketos source and independent canonical curve masters are faithful and valid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
