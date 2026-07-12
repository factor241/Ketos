# ruff: noqa: PLR2004, PT018, S101, S314, S603
from __future__ import annotations

import hashlib
import importlib.util
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from itertools import pairwise
from pathlib import Path
from tempfile import TemporaryDirectory

import cv2
import numpy as np
import pytest
import yaml
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
ASSETS = ROOT / "brand" / "assets"
MANIFEST = ASSETS / "manifest.yaml"
SOURCE_SHA256 = "cb895e5fafde4006cc17872c8537bbd4b3ba8c0f4b9304bcff2303184e0eaca3"
PRIMARY = "#102C48"

SVG_VARIANTS = {
    f"generated/svg/ketos-{lockup}-{variant}.svg"
    for lockup in ("symbol", "horizontal", "stacked")
    for variant in ("color", "currentcolor", "white", "black", "light", "dark")
}
RASTER_OUTPUTS = {
    "generated/favicon/ketos-favicon.svg",
    "generated/favicon/ketos-favicon.ico",
    *(f"generated/png/ketos-{size}.png" for size in (32, 128, 180, 192, 256, 512)),
    *(f"generated/maskable/ketos-maskable-{size}.png" for size in (192, 512)),
    *(f"generated/assistant/ketos-assistant-{size}.png" for size in (16, 32, 48)),
    *(f"generated/ui/ketos-ui-{size}.png" for size in (16, 20, 24, 32, 48, 60)),
    *(f"generated/splash/ketos-splash-{size}.png" for size in (480, 960)),
    "generated/social/ketos-social-1200x630.png",
}
EXPECTED_OUTPUTS = SVG_VARIANTS | RASTER_OUTPUTS
SNAPSHOTS = ROOT / "scripts" / "brand" / "tests" / "snapshots"
FORBIDDEN_BRAND_BYTES = re.compile(rb"(?:lang(?:[-_ ]?flow)|" + b"l" + b"fx)", re.IGNORECASE)


def load_builder():
    path = ROOT / "scripts" / "brand" / "build_assets.py"
    spec = importlib.util.spec_from_file_location("ketos_build_assets", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def source_mask(box: tuple[int, int, int, int]) -> np.ndarray:
    with Image.open(ASSETS / "source" / "ketos-source.png") as image:
        rgb = np.asarray(image.convert("RGB"))
    mask = (np.min(255 - rgb, axis=2) > 16).astype(np.uint8)
    x, y, width, height = box
    return mask[y : y + height, x : x + width]


def components(mask: np.ndarray) -> list[np.ndarray]:
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    entries = []
    for label in range(1, count):
        x, y, width, height, area = map(int, stats[label])
        if area > 20:
            entries.append((x, labels[y : y + height, x : x + width] == label))
    return [entry[1].astype(np.uint8) for entry in sorted(entries)]


def normalized(mask: np.ndarray, size: int = 192) -> np.ndarray:
    points = cv2.findNonZero(mask.astype(np.uint8))
    assert points is not None
    x, y, width, height = cv2.boundingRect(points)
    crop = mask[y : y + height, x : x + width].astype(np.uint8)
    scale = min((size - 8) / width, (size - 8) / height)
    resized = cv2.resize(crop, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_NEAREST)
    canvas = np.zeros((size, size), dtype=np.uint8)
    top = (size - resized.shape[0]) // 2
    left = (size - resized.shape[1]) // 2
    canvas[top : top + resized.shape[0], left : left + resized.shape[1]] = resized
    return canvas


def iou(left: np.ndarray, right: np.ndarray) -> float:
    intersection = np.logical_and(left, right).sum()
    union = np.logical_or(left, right).sum()
    return float(intersection / union)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture(scope="module")
def manifest() -> dict:
    return yaml.safe_load(MANIFEST.read_text(encoding="utf-8"))


def test_source_artwork_is_exact_authorized_copy() -> None:
    source = ASSETS / "source" / "ketos-source.png"
    assert digest(source) == SOURCE_SHA256
    with Image.open(source) as image:
        assert image.mode == "RGBA"
        assert image.size == (1254, 1254)


@pytest.mark.parametrize("name", ["ketos-symbol.svg", "ketos-wordmark.svg", "ketos-horizontal.svg"])
def test_masters_are_transparent_path_only_svg(name: str) -> None:
    path = ASSETS / "master" / name
    root = ET.fromstring(path.read_text(encoding="utf-8"))
    assert root.tag.endswith("svg")
    assert root.get("viewBox")
    tags = {element.tag.rsplit("}", 1)[-1] for element in root.iter()}
    assert tags <= {"svg", "g", "path", "title", "desc"}
    assert "path" in tags
    text = path.read_text(encoding="utf-8").lower()
    assert not re.search(r"<(image|text|foreignobject)\b", text)
    assert "data:image" not in text
    assert "font-family" not in text
    assert "<rect" not in text


def test_symbol_master_faithfully_matches_source_silhouette() -> None:
    builder = load_builder()
    source = normalized(source_mask((353, 247, 606, 558)))
    rendered = builder.render_master("ketos-symbol.svg", 606, 558, padding=0).getchannel("A")
    score = iou(source, normalized(np.asarray(rendered) >= 128))
    assert score >= 0.96, score


def test_each_wordmark_letter_matches_source_outline_and_proportions() -> None:
    builder = load_builder()
    source_letters = components(source_mask((201, 862, 857, 108)))
    rendered = builder.render_master("ketos-wordmark.svg", 857, 108, padding=0).getchannel("A")
    rendered_letters = components(np.asarray(rendered) >= 128)
    assert len(source_letters) == len(rendered_letters) == 5
    scores = [
        iou(normalized(source), normalized(target))
        for source, target in zip(source_letters, rendered_letters, strict=True)
    ]
    assert min(scores) >= 0.94, scores


def test_canonical_masters_use_reviewable_curve_geometry() -> None:
    ceilings = {
        "ketos-symbol.svg": 220,
        "ketos-wordmark.svg": 130,
        "ketos-horizontal.svg": 350,
    }
    for name, ceiling in ceilings.items():
        root = ET.fromstring((ASSETS / "master" / name).read_text(encoding="utf-8"))
        data = " ".join(node.attrib["d"] for node in root.iter() if node.tag.endswith("path"))
        commands = re.findall(r"[MLCQZ]", data)
        assert "C" in commands or "Q" in commands, name
        assert len(commands) <= ceiling, (name, len(commands), ceiling)


def test_canonical_masters_have_no_raster_staircase_runs() -> None:
    for name in ("ketos-symbol.svg", "ketos-wordmark.svg"):
        root = ET.fromstring((ASSETS / "master" / name).read_text(encoding="utf-8"))
        for node in root.iter():
            if not node.tag.endswith("path"):
                continue
            line_points = [
                (float(x), float(y)) for x, y in re.findall(r"L\s*(-?[\d.]+)[ ,]+(-?[\d.]+)", node.attrib["d"])
            ]
            run = 0
            longest = 0
            for left, right in pairwise(line_points):
                one_pixel_step = max(abs(right[0] - left[0]), abs(right[1] - left[1])) <= 1.01
                run = run + 1 if one_pixel_step else 0
                longest = max(longest, run)
            assert longest <= 2, (name, longest)


def test_global_wordmark_geometry_spacing_via_independent_renderer() -> None:
    magick = shutil.which("magick")
    assert magick is not None
    with TemporaryDirectory() as temporary:
        output = Path(temporary) / "wordmark.png"
        subprocess.run(
            [
                magick,
                "-background",
                "none",
                str(ASSETS / "master/ketos-wordmark.svg"),
                "-resize",
                "857x108!",
                str(output),
            ],
            check=True,
            capture_output=True,
        )
        with Image.open(output) as image:
            rendered = (np.asarray(image.convert("RGBA"))[:, :, 3] >= 128).astype(np.uint8)
    source = source_mask((201, 862, 857, 108))
    assert iou(source, rendered) >= 0.93
    source_stats = [cv2.boundingRect(cv2.findNonZero(letter)) for letter in components(source)]
    rendered_stats = [cv2.boundingRect(cv2.findNonZero(letter)) for letter in components(rendered)]
    assert len(source_stats) == len(rendered_stats) == 5
    for source_box, rendered_box in zip(source_stats, rendered_stats, strict=True):
        assert max(abs(left - right) for left, right in zip(source_box, rendered_box, strict=True)) <= 2
    source_gaps = [source_stats[index + 1][0] - sum(source_stats[index][::2]) for index in range(4)]
    rendered_gaps = [rendered_stats[index + 1][0] - sum(rendered_stats[index][::2]) for index in range(4)]
    assert max(abs(left - right) for left, right in zip(source_gaps, rendered_gaps, strict=True)) <= 2


def test_manifest_has_exact_complete_output_matrix(manifest: dict) -> None:
    assert manifest["schema_version"] == 1
    assert manifest["source"]["path"] == "source/ketos-source.png"
    assert manifest["source"]["sha256"] == SOURCE_SHA256
    assert manifest["source"]["width"] == 1254
    assert manifest["source"]["height"] == 1254
    entries = {entry["path"] for entry in manifest["outputs"]}
    assert entries == EXPECTED_OUTPUTS


def test_manifest_hash_dimensions_and_alpha_are_true(manifest: dict) -> None:
    for entry in manifest["outputs"]:
        path = ASSETS / entry["path"]
        assert path.is_file(), entry["path"]
        assert digest(path) == entry["sha256"], entry["path"]
        assert entry["alpha_expected"] is True
        if path.suffix == ".png":
            with Image.open(path) as image:
                assert list(image.size) == [entry["width"], entry["height"]]
                assert image.mode == "RGBA"
                assert image.getchannel("A").getextrema()[0] == 0


def test_generated_paths_and_payloads_have_no_legacy_brand_bytes(manifest: dict) -> None:
    for entry in manifest["outputs"]:
        relative = entry["path"]
        assert FORBIDDEN_BRAND_BYTES.search(relative.encode()) is None, relative
        assert FORBIDDEN_BRAND_BYTES.search((ASSETS / relative).read_bytes()) is None, relative


def test_every_generated_svg_is_parseable_and_raster_free() -> None:
    manifest = yaml.safe_load(MANIFEST.read_text(encoding="utf-8"))
    dimensions = {entry["path"]: (entry["width"], entry["height"]) for entry in manifest["outputs"]}
    for relative in sorted(SVG_VARIANTS | {"generated/favicon/ketos-favicon.svg"}):
        text = (ASSETS / relative).read_text(encoding="utf-8")
        root = ET.fromstring(text)
        assert root.tag.endswith("svg")
        assert not re.search(r"<(image|text|foreignobject)\b|data:image|font-family", text, re.IGNORECASE)
        viewbox = tuple(map(float, root.attrib["viewBox"].split()))
        assert viewbox[:2] == (0, 0)
        assert viewbox[2:] == dimensions[relative]
        assert "style" not in root.attrib
        for node in root.iter():
            if node.tag.endswith("path"):
                assert node.attrib.get("fill") in {PRIMARY, "#315878", "#FFFFFF", "#000000", "currentColor"}
                assert node.attrib.get("opacity", "1") == "1"


def test_ico_contains_required_frames() -> None:
    path = ASSETS / "generated/favicon/ketos-favicon.ico"
    with Image.open(path) as image:
        assert set(image.info["sizes"]) == {
            (16, 16),
            (32, 32),
            (48, 48),
            (64, 64),
            (128, 128),
            (256, 256),
        }
        for size in image.info["sizes"]:
            frame = image.ico.getimage(size)
            assert frame.size == size
            assert frame.convert("RGBA").getchannel("A").getextrema()[0] == 0


@pytest.mark.parametrize("size", [192, 512])
def test_maskable_artwork_stays_inside_safe_area(size: int) -> None:
    with Image.open(ASSETS / f"generated/maskable/ketos-maskable-{size}.png") as image:
        bbox = image.getchannel("A").getbbox()
        assert bbox is not None
        margin = round(size * 0.1)
        assert bbox[0] >= margin and bbox[1] >= margin
        assert bbox[2] <= size - margin and bbox[3] <= size - margin
        alpha = np.asarray(image.getchannel("A")) > 0
        yy, xx = np.nonzero(alpha)
        radius = np.sqrt((xx - (size - 1) / 2) ** 2 + (yy - (size - 1) / 2) ** 2)
        assert radius.max() <= size * 0.4


@pytest.mark.parametrize(
    "relative",
    [
        "generated/assistant/ketos-assistant-16.png",
        "generated/ui/ketos-ui-16.png",
    ],
)
def test_small_icons_remain_legible(relative: str) -> None:
    with Image.open(ASSETS / relative) as image:
        alpha = image.getchannel("A")
        opaque = sum(value >= 128 for value in alpha.getdata())
        assert opaque >= 24
        assert alpha.getbbox() is not None


def test_social_lockup_keeps_symbol_and_wordmark_visually_separated() -> None:
    with Image.open(ASSETS / "generated/social/ketos-social-1200x630.png") as image:
        alpha = image.getchannel("A")
        empty_rows = [y for y in range(280, 390) if alpha.crop((0, y, image.width, y + 1)).getbbox() is None]
        assert len(empty_rows) >= 16


@pytest.mark.parametrize(
    ("name", "background", "foreground", "minimum_contrast"),
    [
        ("icon-16-light.png", (255, 255, 255), (16, 44, 72), 4.5),
        ("icon-16-dark.png", (16, 44, 72), (255, 255, 255), 4.5),
        ("icon-16-high-contrast.png", (255, 255, 0), (0, 0, 0), 7.0),
    ],
)
def test_actual_16px_contrast_snapshots(
    name: str,
    background: tuple[int, int, int],
    foreground: tuple[int, int, int],
    minimum_contrast: float,
) -> None:
    with Image.open(SNAPSHOTS / name) as image:
        assert image.size == (16, 16)
        assert image.mode == "RGBA"
        assert image.getpixel((0, 0))[:3] == background
        colors = image.convert("RGB").getcolors(maxcolors=256)
        assert colors is not None and len(colors) >= 2
        actual_foreground = min(
            (color for _, color in colors),
            key=lambda color: sum((actual - expected) ** 2 for actual, expected in zip(color, foreground, strict=True)),
        )
        assert max(abs(actual - expected) for actual, expected in zip(actual_foreground, foreground, strict=True)) <= 3

    def luminance(rgb: tuple[int, int, int]) -> float:
        values = [channel / 255 for channel in rgb]
        linear = [value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4 for value in values]
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]

    bright, dark = sorted((luminance(background), luminance(actual_foreground)), reverse=True)
    assert (bright + 0.05) / (dark + 0.05) >= minimum_contrast


def test_fidelity_side_by_side_snapshot_exists() -> None:
    with Image.open(SNAPSHOTS / "fidelity-side-by-side.png") as image:
        assert image.size == (1200, 600)
        assert image.mode == "RGBA"


def test_svg_contrast_variants_have_explicit_expected_paints() -> None:
    expected = {
        "currentcolor": "currentColor",
        "white": "#FFFFFF",
        "black": "#000000",
        "light": "#102C48",
        "dark": "#FFFFFF",
    }
    for variant, paint in expected.items():
        for lockup in ("symbol", "horizontal", "stacked"):
            text = (ASSETS / f"generated/svg/ketos-{lockup}-{variant}.svg").read_text()
            assert paint in text


def test_build_check_proves_reproducibility() -> None:
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts/brand/build_assets.py"), "--check"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
