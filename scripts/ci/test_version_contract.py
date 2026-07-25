# ruff: noqa: E501
from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.ci import version_contract

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "ci" / "version_contract.py"
VERSION_OWNED_FILES = {
    "pyproject.toml",
    "src/backend/base/pyproject.toml",
    "src/frontend/package.json",
    "src/kfx/pyproject.toml",
}


def _root_pyproject(version: str = "1.10.2") -> str:
    return f"""\
[project]
name = "ketos"
version = "{version}"
dependencies = [
    "ketos-base[complete]>=0.10.2",
]

[tool.ketos.version-family]
canonical = "pyproject.toml"
members = [
    {{ path = "pyproject.toml", format = "toml-project", relation = "exact" }},
    {{ path = "src/kfx/pyproject.toml", format = "toml-project", relation = "exact" }},
    {{ path = "src/frontend/package.json", format = "package-json", relation = "exact" }},
    {{ path = "src/backend/base/pyproject.toml", format = "toml-project", relation = "zero-major" }},
]
private_exclusions = [
    {{ path = "src/copilot-runtime/package.json", format = "package-json", expected = "0.0.0-private", reason = "private-runtime" }},
]
dependency_pins = [
    {{ path = "pyproject.toml", name = "ketos-base[complete]", operator = ">=", relation = "zero-major" }},
    {{ path = "src/backend/base/pyproject.toml", name = "kfx", operator = "~=", relation = "exact" }},
]
"""


def _write_fixture(
    root: Path,
    *,
    product: str = "1.10.2",
    kfx: str = "1.10.2",
    frontend: str = "1.10.2",
    backend: str = "0.10.2",
    private: str = "0.0.0-private",
) -> None:
    files = {
        "pyproject.toml": _root_pyproject(product),
        "src/kfx/pyproject.toml": f'[project]\nname = "kfx"\nversion = "{kfx}"\n',
        "src/backend/base/pyproject.toml": (
            f'[project]\nname = "ketos-base"\nversion = "{backend}"\ndependencies = ["kfx~=1.10.2"]\n'
        ),
        "src/frontend/package.json": (
            f'{{\n  "name": "ketos-frontend",\n  "version": "{frontend}",\n  "private": true\n}}\n'
        ),
        "src/copilot-runtime/package.json": (
            f'{{\n  "name": "@ketos/copilot-runtime",\n  "version": "{private}",\n  "private": true\n}}\n'
        ),
        "notes.txt": "not version owned\n",
    }
    for relative_path, contents in files.items():
        path = root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(contents, encoding="utf-8")


def _run(root: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603
        [sys.executable, str(SCRIPT), "--root", str(root), *arguments],
        check=False,
        capture_output=True,
        text=True,
    )


def _hashes(root: Path) -> dict[str, str]:
    return {
        str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def test_current_repository_version_family_passes() -> None:
    result = _run(REPO_ROOT, "check")

    assert result.returncode == 0, result.stdout + result.stderr
    output = result.stdout + result.stderr
    assert "file=pyproject.toml actual=1.10.2 expected=1.10.2 relation=exact" in output
    assert "file=src/kfx/pyproject.toml actual=1.10.2 expected=1.10.2 relation=exact" in output
    assert "file=src/frontend/package.json actual=1.10.2 expected=1.10.2 relation=exact" in output
    assert "file=src/backend/base/pyproject.toml actual=0.10.2 expected=0.10.2 relation=zero-major" in output
    assert (
        "file=src/copilot-runtime/package.json actual=0.0.0-private "
        "expected=0.0.0-private relation=excluded:private-runtime"
    ) in output


@pytest.mark.parametrize(
    ("overrides", "diagnostic"),
    [
        (
            {"kfx": "1.10.1"},
            "file=src/kfx/pyproject.toml actual=1.10.1 expected=1.10.2 relation=exact",
        ),
        (
            {"backend": "0.10.1"},
            "file=src/backend/base/pyproject.toml actual=0.10.1 expected=0.10.2 relation=zero-major",
        ),
        (
            {"private": "1.10.2"},
            (
                "file=src/copilot-runtime/package.json actual=1.10.2 "
                "expected=0.0.0-private relation=excluded:private-runtime"
            ),
        ),
    ],
)
def test_check_reports_relation_drift(tmp_path: Path, overrides: dict[str, str], diagnostic: str) -> None:
    _write_fixture(tmp_path, **overrides)

    result = _run(tmp_path, "check")

    assert result.returncode == 1
    assert diagnostic in result.stdout + result.stderr


def test_check_rejects_malformed_semver(tmp_path: Path) -> None:
    _write_fixture(tmp_path, product="1.10")

    result = _run(tmp_path, "check")

    assert result.returncode == 2
    assert "file=pyproject.toml actual=1.10 expected=X.Y.Z relation=canonical-semver" in result.stderr


def test_check_rejects_malformed_member_semver(tmp_path: Path) -> None:
    _write_fixture(tmp_path, frontend="1.10")

    result = _run(tmp_path, "check")

    assert result.returncode == 2
    assert "file=src/frontend/package.json actual=1.10 expected=X.Y.Z relation=member-semver" in result.stderr


def test_check_rejects_missing_member(tmp_path: Path) -> None:
    _write_fixture(tmp_path)
    (tmp_path / "src/frontend/package.json").unlink()

    result = _run(tmp_path, "check")

    assert result.returncode == 2
    assert "file=src/frontend/package.json actual=<missing> expected=<present> relation=member-path" in result.stderr


def test_fixture_only_bump_changes_exact_version_owned_files(tmp_path: Path) -> None:
    _write_fixture(tmp_path)
    before = _hashes(tmp_path)

    result = _run(tmp_path, "bump", "--version", "1.10.3")

    assert result.returncode == 0, result.stdout + result.stderr
    after = _hashes(tmp_path)
    changed = {path for path in before if before[path] != after[path]}
    assert changed == VERSION_OWNED_FILES
    assert 'version = "1.10.3"' in (tmp_path / "pyproject.toml").read_text(encoding="utf-8")
    assert '"ketos-base[complete]>=0.10.3"' in (tmp_path / "pyproject.toml").read_text(encoding="utf-8")
    assert 'version = "0.10.3"' in (tmp_path / "src/backend/base/pyproject.toml").read_text(encoding="utf-8")
    assert '"kfx~=1.10.3"' in (tmp_path / "src/backend/base/pyproject.toml").read_text(encoding="utf-8")
    assert '"version": "1.10.3"' in (tmp_path / "src/frontend/package.json").read_text(encoding="utf-8")
    assert '"version": "0.0.0-private"' in (tmp_path / "src/copilot-runtime/package.json").read_text(encoding="utf-8")
    assert (tmp_path / "notes.txt").read_text(encoding="utf-8") == "not version owned\n"


@pytest.mark.parametrize("target", ["1.10", "v1.10.3", "1.10.3-rc1", "01.10.3"])
def test_invalid_bump_target_is_non_mutating(tmp_path: Path, target: str) -> None:
    _write_fixture(tmp_path)
    before = _hashes(tmp_path)

    result = _run(tmp_path, "bump", "--version", target)

    assert result.returncode == 2
    assert _hashes(tmp_path) == before


def test_bump_refuses_drifted_source_without_mutation(tmp_path: Path) -> None:
    _write_fixture(tmp_path, kfx="1.10.1")
    before = _hashes(tmp_path)

    result = _run(tmp_path, "bump", "--version", "1.10.3")

    assert result.returncode == 1
    assert _hashes(tmp_path) == before


def test_bump_rolls_back_when_post_check_fails(tmp_path: Path, monkeypatch) -> None:
    _write_fixture(tmp_path)
    before = _hashes(tmp_path)
    post_failure = version_contract.Finding(
        file="src/frontend/package.json",
        actual="corrupt",
        expected="1.10.3",
        relation="exact",
        passed=False,
    )
    monkeypatch.setattr(version_contract, "check_contract", lambda _root: (post_failure,))

    with pytest.raises(version_contract.ContractError, match="post-bump contract check failed"):
        version_contract.bump(tmp_path, "1.10.3")

    assert _hashes(tmp_path) == before


def test_make_patch_uses_contract_and_exact_file_set() -> None:
    source = (REPO_ROOT / "Makefile").read_text(encoding="utf-8")
    recipe = source.split("patch:", maxsplit=1)[1].split(
        "######################\n# LOAD TESTING",
        maxsplit=1,
    )[0]

    assert 'version_contract.py bump --version "$$KETOS_VERSION"' in recipe
    assert "python -c" not in recipe
    assert "Expected at least 6 changed files" not in recipe
    assert "ACTUAL_FILES=" in recipe
    assert "EXPECTED_FILES=" in recipe
    assert "--planned-changed-files" in recipe
    assert "AUTHORIZED_BUNDLE_FILES=" in recipe
    assert "BASELINE_UNTRACKED=" in recipe
    assert "ACTUAL_UNTRACKED=" in recipe
    assert "version_contract.py check" in recipe
