from __future__ import annotations

# Assertions are the contract surface in this pytest module.
# ruff: noqa: S101
import json
import os
import shutil
import subprocess
import sys
import tarfile
from collections import defaultdict
from pathlib import Path
from zipfile import ZipFile

import pytest
import tomllib

ROOT = Path(__file__).resolve().parents[3]
OLD_PRODUCT = "lang" + "flow"
OLD_EXECUTOR = "l" + "fx"


def _root_manifest() -> dict:
    with (ROOT / "pyproject.toml").open("rb") as handle:
        return tomllib.load(handle)


def _wheel_name_and_top_level_packages(wheel: Path) -> tuple[str, set[str]]:
    with ZipFile(wheel) as archive:
        names = archive.namelist()
        metadata_name = next(name for name in names if name.endswith(".dist-info/METADATA"))
        metadata = archive.read(metadata_name).decode()
    distribution = next(line.removeprefix("Name: ") for line in metadata.splitlines() if line.startswith("Name: "))
    packages = {
        name.partition("/")[0]
        for name in names
        if "/" in name and ".dist-info/" not in name and not name.startswith(".")
    }
    return distribution, packages


def _assert_canonical_namespace_owners(wheels: list[Path]) -> dict[str, set[str]]:
    owners: defaultdict[str, set[str]] = defaultdict(set)
    for wheel in wheels:
        distribution, packages = _wheel_name_and_top_level_packages(wheel)
        for package in packages:
            owners[package].add(distribution)
    assert owners.get("ketos") == {"ketos-base"}, owners
    return dict(owners)


@pytest.fixture(scope="module")
def root_artifacts(tmp_path_factory: pytest.TempPathFactory) -> Path:
    output = tmp_path_factory.mktemp("root-artifacts")
    uv = shutil.which("uv")
    assert uv is not None
    result = subprocess.run(  # noqa: S603 - resolved executable, fixed arguments
        [uv, "build", "--package", "ketos", "--no-sources", "--out-dir", str(output)],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=90,
    )
    assert result.returncode == 0, result.stderr
    base_result = subprocess.run(  # noqa: S603 - resolved executable, fixed arguments
        [uv, "build", "--wheel", "--out-dir", str(output), str(ROOT / "src/backend/base")],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=90,
    )
    assert base_result.returncode == 0, base_result.stderr
    return output


def test_root_is_code_free_ketos_metapackage() -> None:
    manifest = _root_manifest()

    assert manifest["project"]["name"] == "ketos"
    assert manifest["project"]["scripts"] == {"ketos": "ketos.ketos_launcher:main"}
    assert manifest["tool"]["hatch"]["build"]["targets"]["wheel"] == {
        "bypass-selection": True,
    }
    assert manifest["project"]["dependencies"][0] == "ketos-base[complete]>=0.10.2"
    assert manifest["project"]["readme"] == {
        "text": "Ketos is a visual workflow builder for AI-powered agents.\n",
        "content-type": "text/plain",
    }
    assert manifest["tool"]["hatch"]["build"]["targets"]["sdist"] == {
        "only-include": ["pyproject.toml", "LICENSE", "NOTICE"],
    }


def test_workspace_contains_every_canonical_package_once() -> None:
    manifest = _root_manifest()
    sources = manifest["tool"]["uv"]["sources"]
    members = manifest["tool"]["uv"]["workspace"]["members"]

    assert members == [
        "src/backend/base",
        ".",
        "src/kfx",
        "src/ketos-stepflow",
        "src/sdk",
        "src/bundles/duckduckgo",
        "src/bundles/arxiv",
        "src/bundles/ibm",
        "src/bundles/docling",
    ]
    assert len(members) == len(set(members))
    workspace_sources = {
        "ketos-base",
        "ketos",
        "kfx",
        "ketos-sdk",
        "ketos-stepflow",
        "kfx-duckduckgo",
        "kfx-arxiv",
        "kfx-ibm",
        "kfx-docling",
    }
    assert set(sources) == workspace_sources | {"torch", "torchvision"}
    assert all(sources[name] == {"workspace": True} for name in workspace_sources)
    assert sources["torch"] == {"index": "pytorch-cpu"}
    assert sources["torchvision"] == {"index": "pytorch-cpu"}


def test_bundle_dependencies_and_sources_use_kfx_names() -> None:
    manifest = _root_manifest()
    dependencies = manifest["project"]["dependencies"]
    sources = manifest["tool"]["uv"]["sources"]

    for suffix in ("duckduckgo", "arxiv", "ibm", "docling"):
        assert any(item.startswith(f"kfx-{suffix}") for item in dependencies)
        assert sources[f"kfx-{suffix}"] == {"workspace": True}


def test_root_tool_paths_use_canonical_namespaces() -> None:
    manifest_text = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    make_text = "\n".join((ROOT / name).read_text(encoding="utf-8") for name in ("Makefile", "Makefile.frontend"))

    for forbidden in (
        OLD_PRODUCT,
        "src/" + OLD_EXECUTOR,
        OLD_EXECUTOR.upper() + "_DEV",
        OLD_PRODUCT.upper() + "_AUTO_LOGIN",
        OLD_PRODUCT.upper() + "_HOST",
    ):
        assert forbidden not in manifest_text
        assert forbidden not in make_text

    assert "src/backend/base/ketos/frontend" in make_text
    assert "KFX_DEV=1" in make_text
    assert "KETOS_AUTO_LOGIN=$(login)" in make_text
    assert "KETOS_HOST=$(locust_host)" in make_text
    assert "uv run ketos run --frontend-path src/frontend/build" in make_text

    for relative in ("scripts/ci/sync_bundle_kfx_pin.py",):
        assert (ROOT / relative).is_file(), f"Makefile calls missing path: {relative}"


def test_root_build_artifacts_are_code_free_and_metadata_clean(root_artifacts: Path) -> None:
    wheel = next(root_artifacts.glob("ketos-*.whl"))
    sdist = next(root_artifacts.glob("ketos-*.tar.gz"))

    with ZipFile(wheel) as archive:
        wheel_names = archive.namelist()
        metadata_name = next(name for name in wheel_names if name.endswith(".dist-info/METADATA"))
        metadata = archive.read(metadata_name).decode()
    assert not any(name.startswith("ketos/") for name in wheel_names)
    assert OLD_PRODUCT not in metadata.casefold()

    with tarfile.open(sdist, "r:gz") as archive:
        sdist_names = [name.removeprefix("ketos-1.10.2/") for name in archive.getnames()]
        pkg_info_name = next(name for name in archive.getnames() if name.endswith("/PKG-INFO"))
        pkg_info = archive.extractfile(pkg_info_name)
        assert pkg_info is not None
        metadata = pkg_info.read().decode()
    assert set(sdist_names) <= {"", ".gitignore", "LICENSE", "NOTICE", "PKG-INFO", "pyproject.toml"}
    assert OLD_PRODUCT not in metadata.casefold()


def test_duplicate_namespace_owner_adversary_is_rejected(root_artifacts: Path, tmp_path: Path) -> None:
    root_wheel = next(root_artifacts.glob("ketos-*.whl"))
    base_wheel = next(root_artifacts.glob("ketos_base-*.whl"))
    assert _assert_canonical_namespace_owners([root_wheel, base_wheel]) == {"ketos": {"ketos-base"}}

    duplicate = tmp_path / "duplicate.whl"
    with ZipFile(duplicate, "w") as archive:
        archive.writestr("ketos/__init__.py", "")
        archive.writestr("ketos-duplicate.dist-info/METADATA", "Name: ketos-duplicate\nVersion: 0\n")
    with pytest.raises(AssertionError, match="ketos-duplicate"):
        _assert_canonical_namespace_owners([root_wheel, base_wheel, duplicate])


def test_fresh_root_cli_uses_base_namespace_owner(root_artifacts: Path, tmp_path: Path) -> None:
    uv = shutil.which("uv")
    assert uv is not None
    environment = tmp_path / "venv"
    subprocess.run(  # noqa: S603
        [uv, "venv", "--python", f"{sys.version_info.major}.{sys.version_info.minor}", str(environment)],
        check=True,
    )
    kfx_output = tmp_path / "kfx"
    subprocess.run(  # noqa: S603
        [uv, "build", "--wheel", "--out-dir", str(kfx_output), str(ROOT / "src/kfx")],
        cwd=ROOT,
        check=True,
    )
    wheels = [
        next(root_artifacts.glob("ketos-*.whl")),
        next(root_artifacts.glob("ketos_base-*.whl")),
        next(kfx_output.glob("kfx-*.whl")),
    ]
    subprocess.run(  # noqa: S603
        [uv, "pip", "install", "--python", str(environment / "bin/python"), "--no-deps", *map(str, wheels)],
        check=True,
    )

    env = os.environ.copy()
    env["PYTHONPATH"] = next(path for path in sys.path if path.endswith("site-packages"))
    result = subprocess.run(  # noqa: S603
        [str(environment / "bin/ketos"), "--help"],
        env=env,
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert "Run Ketos" in result.stdout

    negative_import = subprocess.run(  # noqa: S603
        [
            str(environment / "bin/python"),
            "-c",
            (
                "import importlib.util; "
                "assert importlib.util.find_spec('lang' + 'flow') is None; "
                "assert importlib.util.find_spec('l' + 'fx') is None"
            ),
        ],
        env=env,
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert negative_import.returncode == 0, negative_import.stderr


def test_root_node_manifest_has_ketos_identity() -> None:
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    assert package["name"] == "ketos"
    assert package["private"] is True
