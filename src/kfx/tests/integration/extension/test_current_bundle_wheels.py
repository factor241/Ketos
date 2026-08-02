"""Build, install, and discover all canonical in-repo Extension wheels."""

from __future__ import annotations

import json
import shutil
import subprocess
from importlib import metadata as importlib_metadata
from pathlib import Path

import pytest
from kfx.extension import discover_installed_extensions

REPO_ROOT = Path(__file__).resolve().parents[5]
BUNDLE_ROOT = REPO_ROOT / "src" / "bundles"
BUNDLES = ("arxiv", "docling", "duckduckgo", "ibm")


@pytest.mark.integration
def test_build_install_and_discover_all_current_bundle_wheels(tmp_path: Path) -> None:
    """Four real wheels remain self-describing after an isolated install."""
    uv = shutil.which("uv")
    if uv is None:
        pytest.fail("uv is required to prove canonical bundle wheel packaging")

    wheelhouse = tmp_path / "wheelhouse"
    target = tmp_path / "site-packages"
    wheelhouse.mkdir()
    target.mkdir()

    for bundle in BUNDLES:
        subprocess.run(  # noqa: S603 - uv path and in-repo project paths are trusted
            [
                uv,
                "build",
                "--wheel",
                "--project",
                str(BUNDLE_ROOT / bundle),
                "--out-dir",
                str(wheelhouse),
            ],
            cwd=REPO_ROOT,
            check=True,
            timeout=180,
        )

    wheels = sorted(wheelhouse.glob("*.whl"))
    assert len(wheels) == 4
    subprocess.run(  # noqa: S603 - uv path and locally built wheel paths are trusted
        [
            uv,
            "pip",
            "install",
            "--target",
            str(target),
            "--no-deps",
            *map(str, wheels),
        ],
        cwd=REPO_ROOT,
        check=True,
        timeout=180,
    )

    distributions = list(importlib_metadata.distributions(path=[str(target)]))
    extensions, errors = discover_installed_extensions(distributions=distributions)

    assert errors == [], [error.to_dict() for error in errors]
    assert {extension.extension_id for extension in extensions} == {
        "kfx-arxiv",
        "kfx-docling",
        "kfx-duckduckgo",
        "kfx-ibm",
    }
    assert {extension.version for extension in extensions} == {"0.1.1"}
    assert {extension.source_kind for extension in extensions} == {"installed"}
    assert {extension.slot for extension in extensions} == {"official"}

    for bundle in BUNDLES:
        package_name = f"kfx_{bundle}"
        manifest_path = target / package_name / "extension.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        assert manifest["version"] == "0.1.1"
        assert manifest["$schema"] == "https://schemas.ketos.test/extension/v1.json"
