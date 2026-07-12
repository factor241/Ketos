"""Regression contracts for the irreversible LFX-to-KFX cutover."""

from __future__ import annotations

import os
import re
import subprocess
import sys
import zipfile
from importlib.machinery import PathFinder
from pathlib import Path

import pytest
import tomllib

PACKAGE_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = Path(__file__).resolve().parents[4]
SOURCE_ROOT = PACKAGE_ROOT / "src"
BUNDLES = ("arxiv", "docling", "duckduckgo", "ibm")
OLD_PRODUCT_BRAND = re.compile(r"(?i)(?<![a-z0-9])lang[-_]?flow(?=$|[^a-z0-9])|(?<![a-z0-9])lfx(?=$|[^a-z0-9])")

OLD_PRODUCT_BRAND_VARIANTS = (
    "langflow",
    "LangFlow",
    "lang-flow",
    "lang_flow",
    "langflow_utils.py",
    "kfx.compat.langflow_utils",
    "kfx-1.0.data/purelib/langflow_utils.py",
)

PROTECTED_THIRD_PARTY_BRANDS = (
    "LangChain",
    "LangSmith",
    "LangWatch",
    "langchain_core.tools",
    "integrations/langsmith_client.py",
    "wheel/langwatch-1.0.dist-info/METADATA",
)


def _shipping_source_roots() -> list[Path]:
    roots = [SOURCE_ROOT / "kfx"]
    roots.extend(REPO_ROOT / "src" / "bundles" / name / "src" / f"kfx_{name}" for name in BUNDLES)
    return roots


def _old_brand_hits_in_source() -> list[str]:
    hits: list[str] = []
    for root in _shipping_source_roots():
        for path in root.rglob("*.py"):
            for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
                if OLD_PRODUCT_BRAND.search(line):
                    hits.append(f"{path.relative_to(REPO_ROOT)}:{line_number}:{line.strip()}")
    return hits


@pytest.mark.parametrize("candidate", OLD_PRODUCT_BRAND_VARIANTS)
def test_old_product_brand_regex_detects_text_filename_module_and_wheel_variants(candidate: str) -> None:
    assert OLD_PRODUCT_BRAND.search(candidate) is not None


@pytest.mark.parametrize("candidate", PROTECTED_THIRD_PARTY_BRANDS)
def test_old_product_brand_regex_preserves_protected_third_party_names(candidate: str) -> None:
    assert OLD_PRODUCT_BRAND.search(candidate) is None


def test_kfx_namespace_imports_without_lfx_compatibility_package() -> None:
    result = subprocess.run(
        [sys.executable, "-c", "import kfx; print(kfx.__name__)"],
        cwd=REPO_ROOT,
        env={**os.environ, "PYTHONPATH": str(SOURCE_ROOT)},
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "kfx"
    assert PathFinder.find_spec("lfx", [str(SOURCE_ROOT)]) is None
    assert not (SOURCE_ROOT / "lfx").exists()


def test_kfx_module_cli_exposes_canonical_help() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "kfx", "--help"],
        cwd=REPO_ROOT,
        env={**os.environ, "PYTHONPATH": str(SOURCE_ROOT)},
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "Ketos Flow Executor" in result.stdout
    assert "lfx" not in result.stdout.lower()


def test_kfx_component_executes() -> None:
    from kfx.utils.ketos_utils import _KetosModule

    _KetosModule.set_available(False)
    from kfx.custom import Component

    class EchoComponent(Component):
        def echo(self, value: str) -> str:
            return value

    assert EchoComponent().echo("ketos") == "ketos"


@pytest.mark.parametrize("bundle", BUNDLES)
def test_bundle_uses_canonical_kfx_distribution_module_and_extension_entrypoint(bundle: str) -> None:
    bundle_root = REPO_ROOT / "src" / "bundles" / bundle
    module_name = f"kfx_{bundle}"
    distribution_name = f"kfx-{bundle}"
    project = tomllib.loads((bundle_root / "pyproject.toml").read_text())
    manifest = __import__("json").loads((bundle_root / "src" / module_name / "extension.json").read_text())

    assert project["project"]["name"] == distribution_name
    assert project["project"]["entry-points"]["ketos.extensions"] == {distribution_name: module_name}
    assert project["tool"]["hatch"]["build"]["targets"]["wheel"]["packages"] == [f"src/{module_name}"]
    assert manifest["$schema"] == "https://schemas.ketos.test/extension/v1.json"
    assert manifest["id"] == distribution_name
    assert manifest["kfx"] == {"compat": ["1"]}
    assert "lfx" not in manifest


def test_shipping_python_sources_contain_no_old_product_brand() -> None:
    assert _old_brand_hits_in_source() == []


def test_built_wheels_contain_no_old_product_brand(tmp_path: Path) -> None:
    projects = [PACKAGE_ROOT, *(REPO_ROOT / "src" / "bundles" / name for name in BUNDLES)]
    for project in projects:
        result = subprocess.run(
            ["uv", "build", str(project), "--out-dir", str(tmp_path / project.name)],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, result.stderr

    hits: list[str] = []
    for wheel in tmp_path.rglob("*.whl"):
        with zipfile.ZipFile(wheel) as archive:
            for member in archive.namelist():
                if OLD_PRODUCT_BRAND.search(member):
                    hits.append(f"{wheel.name}:{member}")
                try:
                    content = archive.read(member).decode("utf-8")
                except UnicodeDecodeError:
                    continue
                for line_number, line in enumerate(content.splitlines(), start=1):
                    if OLD_PRODUCT_BRAND.search(line):
                        hits.append(f"{wheel.name}:{member}:{line_number}:{line.strip()}")

    assert hits == []
