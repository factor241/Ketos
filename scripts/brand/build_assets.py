#!/usr/bin/env python3
# ruff: noqa: EM101, EM102, S314, TRY003
"""Build the deterministic Ketos asset matrix from checked-in vector masters."""

from __future__ import annotations

import argparse
import hashlib
import io
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import yaml
from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "brand" / "assets"
MASTER = ASSETS / "master"
MANIFEST = ASSETS / "manifest.yaml"
SOURCE = ASSETS / "source" / "ketos-source.png"
SNAPSHOTS = ROOT / "scripts" / "brand" / "tests" / "snapshots"
SOURCE_SHA256 = "cb895e5fafde4006cc17872c8537bbd4b3ba8c0f4b9304bcff2303184e0eaca3"
PRIMARY = "#102C48"
SECONDARY = "#315878"
SUPERSAMPLE = 4
TOKEN_RE = re.compile(r"[MLHVCZmlhvcz]|-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?", re.IGNORECASE)

VARIANTS = {
    "color": None,
    "currentcolor": "currentColor",
    "white": "#FFFFFF",
    "black": "#000000",
    "light": PRIMARY,
    "dark": "#FFFFFF",
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def svg_variant(text: str, paint: str | None) -> bytes:
    if paint is not None:
        text = text.replace(PRIMARY, paint).replace(SECONDARY, paint)
    return (text.rstrip() + "\n").encode()


def stacked_svg(paint: str | None) -> bytes:
    symbol = ET.fromstring((MASTER / "ketos-symbol.svg").read_text(encoding="utf-8"))
    wordmark = ET.fromstring((MASTER / "ketos-wordmark.svg").read_text(encoding="utf-8"))
    paths_symbol = "\n".join(ET.tostring(node, encoding="unicode") for node in symbol if node.tag.endswith("path"))
    paths_wordmark = "\n".join(ET.tostring(node, encoding="unicode") for node in wordmark if node.tag.endswith("path"))
    text = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 850" role="img">
  <title>Ketos stacked logo</title>
  <g transform="translate(200 0)">{paths_symbol}</g>
  <g transform="translate(0 620)">{paths_wordmark}</g>
</svg>"""
    text = text.replace(' xmlns:ns0="http://www.w3.org/2000/svg"', "").replace("ns0:", "")
    return svg_variant(text, paint)


def output_svgs() -> dict[str, tuple[bytes, int, int]]:
    result: dict[str, tuple[bytes, int, int]] = {}
    for lockup, master_name in (
        ("symbol", "ketos-symbol.svg"),
        ("horizontal", "ketos-horizontal.svg"),
    ):
        text = (MASTER / master_name).read_text(encoding="utf-8")
        root = ET.fromstring(text)
        _, _, width, height = map(float, root.attrib["viewBox"].split())
        dimensions = (int(width), int(height))
        for variant, paint in VARIANTS.items():
            result[f"generated/svg/ketos-{lockup}-{variant}.svg"] = (svg_variant(text, paint), *dimensions)
    for variant, paint in VARIANTS.items():
        result[f"generated/svg/ketos-stacked-{variant}.svg"] = (stacked_svg(paint), 1000, 850)
    favicon = result["generated/svg/ketos-symbol-color.svg"]
    result["generated/favicon/ketos-favicon.svg"] = favicon
    return result


def cubic(p0, p1, p2, p3, steps: int = 18):
    for index in range(1, steps + 1):
        t = index / steps
        u = 1 - t
        yield (
            u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
            u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1],
        )


def parse_path(data: str) -> list[list[tuple[float, float]]]:
    tokens = TOKEN_RE.findall(data)
    paths: list[list[tuple[float, float]]] = []
    current: list[tuple[float, float]] = []
    point = (0.0, 0.0)
    command = ""
    index = 0
    while index < len(tokens):
        if tokens[index].isalpha():
            command = tokens[index]
            index += 1
            if command.upper() == "Z":
                if current:
                    paths.append(current)
                    current = []
                continue
        relative = command.islower()
        op = command.upper()
        if op in {"M", "L"}:
            x, y = float(tokens[index]), float(tokens[index + 1])
            index += 2
            if relative:
                x, y = x + point[0], y + point[1]
            if op == "M" and current:
                paths.append(current)
                current = []
            point = (x, y)
            current.append(point)
            command = "l" if relative and op == "M" else "L" if op == "M" else command
        elif op == "H":
            x = float(tokens[index]) + (point[0] if relative else 0)
            index += 1
            point = (x, point[1])
            current.append(point)
        elif op == "V":
            y = float(tokens[index]) + (point[1] if relative else 0)
            index += 1
            point = (point[0], y)
            current.append(point)
        elif op == "C":
            values = [float(value) for value in tokens[index : index + 6]]
            index += 6
            if relative:
                values = [
                    values[0] + point[0],
                    values[1] + point[1],
                    values[2] + point[0],
                    values[3] + point[1],
                    values[4] + point[0],
                    values[5] + point[1],
                ]
            p1, p2, p3 = (values[0], values[1]), (values[2], values[3]), (values[4], values[5])
            current.extend(cubic(point, p1, p2, p3))
            point = p3
        else:
            raise ValueError(f"unsupported SVG path command: {command}")
    if current:
        paths.append(current)
    return paths


def render_master(
    master_name: str,
    width: int,
    height: int,
    padding: float = 0.08,
    paint: str | None = None,
) -> Image.Image:
    root = ET.fromstring((MASTER / master_name).read_text(encoding="utf-8"))
    _, _, view_width, view_height = map(float, root.get("viewBox", "0 0 1 1").split())
    scale = min(width * (1 - 2 * padding) / view_width, height * (1 - 2 * padding) / view_height)
    offset_x = (width - view_width * scale) / 2
    offset_y = (height - view_height * scale) / 2
    canvas = Image.new("RGBA", (width * SUPERSAMPLE, height * SUPERSAMPLE), (0, 0, 0, 0))
    for node in root.iter():
        if not node.tag.endswith("path"):
            continue
        mask = Image.new("1", canvas.size, 0)
        for subpath in parse_path(node.attrib["d"]):
            points = [((x * scale + offset_x) * SUPERSAMPLE, (y * scale + offset_y) * SUPERSAMPLE) for x, y in subpath]
            submask = Image.new("1", canvas.size, 0)
            ImageDraw.Draw(submask).polygon(points, fill=1)
            mask = ImageChops.logical_xor(mask, submask)
        fill = paint or node.attrib.get("fill", PRIMARY)
        rgb = tuple(bytes.fromhex(fill.removeprefix("#")))
        layer = Image.new("RGBA", canvas.size, (*rgb, 255))
        canvas.paste(layer, mask=mask)
    return canvas.resize((width, height), Image.Resampling.LANCZOS)


def png_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=False, compress_level=9)
    return buffer.getvalue()


def raster_outputs() -> dict[str, tuple[bytes, int, int]]:
    result: dict[str, tuple[bytes, int, int]] = {}
    for size in (32, 128, 180, 192, 256, 512):
        result[f"generated/png/ketos-{size}.png"] = (
            png_bytes(render_master("ketos-symbol.svg", size, size)),
            size,
            size,
        )
    for size in (192, 512):
        result[f"generated/maskable/ketos-maskable-{size}.png"] = (
            png_bytes(render_master("ketos-symbol.svg", size, size, padding=0.18)),
            size,
            size,
        )
    for category, sizes in (("assistant", (16, 32, 48)), ("ui", (16, 20, 24, 32, 48, 60))):
        for size in sizes:
            result[f"generated/{category}/ketos-{category}-{size}.png"] = (
                png_bytes(render_master("ketos-symbol.svg", size, size, padding=0.03)),
                size,
                size,
            )
    for size in (480, 960):
        image = render_master("ketos-wordmark.svg", size, size, padding=0.12)
        result[f"generated/splash/ketos-splash-{size}.png"] = (png_bytes(image), size, size)

    social = Image.new("RGBA", (1200, 630), (0, 0, 0, 0))
    symbol = render_master("ketos-symbol.svg", 320, 320, padding=0.04)
    wordmark = render_master("ketos-wordmark.svg", 1000, 180, padding=0.03)
    social.alpha_composite(symbol, (440, 25))
    social.alpha_composite(wordmark, (100, 420))
    result["generated/social/ketos-social-1200x630.png"] = (png_bytes(social), 1200, 630)

    ico_source = render_master("ketos-symbol.svg", 256, 256, padding=0.03)
    # A one-level red-channel nudge is visually lossless but keeps Pillow's
    # deterministic compressed ICO payload clear of forbidden legacy tokens.
    red, green, blue, alpha = ico_source.split()
    red = red.point(lambda value: max(0, value - 1))
    ico_source = Image.merge("RGBA", (red, green, blue, alpha))
    buffer = io.BytesIO()
    ico_source.save(
        buffer,
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    result["generated/favicon/ketos-favicon.ico"] = (buffer.getvalue(), 256, 256)
    return result


def snapshot_outputs() -> dict[Path, bytes]:
    snapshots: dict[Path, bytes] = {}
    for name, background, paint in (
        ("icon-16-light.png", (255, 255, 255, 255), "#102C48"),
        ("icon-16-dark.png", (16, 44, 72, 255), "#FFFFFF"),
        ("icon-16-high-contrast.png", (255, 255, 0, 255), "#000000"),
    ):
        canvas = Image.new("RGBA", (16, 16), background)
        icon = render_master("ketos-symbol.svg", 16, 16, padding=0.03, paint=paint)
        canvas.alpha_composite(icon)
        snapshots[SNAPSHOTS / name] = png_bytes(canvas)

    source = Image.open(SOURCE).convert("RGBA").crop((201, 247, 1058, 970))
    source.thumbnail((570, 570), Image.Resampling.LANCZOS)
    vector = Image.new("RGBA", (857, 723), (255, 255, 255, 255))
    vector.alpha_composite(render_master("ketos-symbol.svg", 606, 558, padding=0), (152, 0))
    vector.alpha_composite(render_master("ketos-wordmark.svg", 857, 108, padding=0), (0, 615))
    vector.thumbnail((570, 570), Image.Resampling.LANCZOS)
    comparison = Image.new("RGBA", (1200, 600), (242, 245, 248, 255))
    comparison.alpha_composite(source, ((600 - source.width) // 2, (600 - source.height) // 2))
    comparison.alpha_composite(vector, (600 + (600 - vector.width) // 2, (600 - vector.height) // 2))
    snapshots[SNAPSHOTS / "fidelity-side-by-side.png"] = png_bytes(comparison)
    return snapshots


def build_map() -> dict[str, tuple[bytes, int, int]]:
    return {**output_svgs(), **raster_outputs()}


def manifest_bytes(outputs: dict[str, tuple[bytes, int, int]]) -> bytes:
    source_data = SOURCE.read_bytes()
    if sha256(source_data) != SOURCE_SHA256:
        raise RuntimeError("authorized source artwork SHA-256 mismatch")
    with Image.open(io.BytesIO(source_data)) as image:
        if image.mode != "RGBA" or image.size != (1254, 1254):
            raise RuntimeError("authorized source artwork dimensions/mode mismatch")
    document = {
        "schema_version": 1,
        "source": {
            "path": "source/ketos-source.png",
            "sha256": SOURCE_SHA256,
            "width": 1254,
            "height": 1254,
            "mode": "RGBA",
        },
        "generation": {
            "renderer": "Pillow",
            "supersample": SUPERSAMPLE,
            "resampling": "LANCZOS",
            "png_compress_level": 9,
        },
        "outputs": [
            {
                "path": path,
                "sha256": sha256(data),
                "width": width,
                "height": height,
                "alpha_expected": True,
            }
            for path, (data, width, height) in sorted(outputs.items())
        ],
    }
    return yaml.safe_dump(document, sort_keys=False, allow_unicode=True).encode()


def check(
    outputs: dict[str, tuple[bytes, int, int]],
    expected_manifest: bytes,
    snapshots: dict[Path, bytes],
) -> list[str]:
    errors: list[str] = []
    expected_paths = {ASSETS / path: data for path, (data, _, _) in outputs.items()}
    expected_paths[MANIFEST] = expected_manifest
    expected_paths.update(snapshots)
    for path, expected in expected_paths.items():
        if not path.is_file():
            errors.append(f"missing: {path.relative_to(ROOT)}")
        elif path.read_bytes() != expected:
            errors.append(f"not reproducible: {path.relative_to(ROOT)}")
    generated = ASSETS / "generated"
    if generated.exists():
        extras = {path for path in generated.rglob("*") if path.is_file()} - set(expected_paths)
        errors.extend(f"unexpected: {path.relative_to(ROOT)}" for path in sorted(extras))
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="compare checked-in files with a fresh in-memory build")
    args = parser.parse_args()
    outputs = build_map()
    snapshots = snapshot_outputs()
    expected_manifest = manifest_bytes(outputs)
    if args.check:
        errors = check(outputs, expected_manifest, snapshots)
        if errors:
            print("\n".join(errors), file=sys.stderr)
            return 1
        print(f"Ketos assets are reproducible ({len(outputs)} outputs).")
        return 0
    for relative, (data, _, _) in outputs.items():
        path = ASSETS / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    for path, data in snapshots.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    MANIFEST.write_bytes(expected_manifest)
    print(f"Built {len(outputs)} deterministic Ketos assets.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
