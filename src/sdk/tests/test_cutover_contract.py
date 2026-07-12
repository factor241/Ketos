"""Filesystem and metadata contracts for the destructive SDK cutover."""

from __future__ import annotations

import pathlib

import tomllib

SDK_ROOT = pathlib.Path(__file__).parents[1]


def test_manifest_publishes_ketos_distribution_and_plugin() -> None:
    manifest = tomllib.loads((SDK_ROOT / "pyproject.toml").read_text())
    assert manifest["project"]["name"] == "ketos-sdk"
    assert manifest["project"]["entry-points"]["pytest11"] == {"ketos": "ketos_sdk.testing"}
    assert manifest["tool"]["hatch"]["build"]["targets"]["wheel"]["packages"] == ["src/ketos_sdk"]


def test_sdist_uses_a_package_local_allowlist() -> None:
    manifest = tomllib.loads((SDK_ROOT / "pyproject.toml").read_text())
    build = manifest["tool"]["hatch"]["build"]
    assert build["ignore-vcs"] is True
    sdist = build["targets"]["sdist"]
    assert sdist["include"] == [
        "src/ketos_sdk",
        "tests",
        "ketos-environments.toml.example",
        "Makefile",
        "README.md",
        "pyproject.toml",
    ]
    assert sdist["exclude"] == [".gitignore"]


def test_package_local_vcs_ignore_prevents_root_ignore_from_leaking_into_sdist() -> None:
    ignore_file = SDK_ROOT / ".gitignore"
    assert ignore_file.is_file()
    assert ignore_file.read_text() == "__pycache__/\n*.py[cod]\n.pytest_cache/\n.ruff_cache/\ndist/\n"


def test_only_ketos_environment_example_exists() -> None:
    assert (SDK_ROOT / "ketos-environments.toml.example").is_file()
    old_brand = "lang" + "flow"
    assert not (SDK_ROOT / f"{old_brand}-environments.toml.example").exists()


def test_sdk_tree_has_no_legacy_brand_residue() -> None:
    old_brand = "lang" + "flow"
    forbidden = (old_brand, old_brand.replace("g", "g_"), old_brand.replace("g", "g-"))
    offenders: list[str] = []
    for path in SDK_ROOT.rglob("*"):
        if any(part in {".venv", "dist", "__pycache__", ".pytest_cache"} for part in path.parts):
            continue
        relative = path.relative_to(SDK_ROOT).as_posix()
        if any(token in relative.casefold() for token in forbidden):
            offenders.append(relative)
            continue
        if path.is_file():
            try:
                text = path.read_text()
            except UnicodeDecodeError:
                continue
            if any(token in text.casefold() for token in forbidden):
                offenders.append(relative)
    assert offenders == []
