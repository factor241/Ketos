from __future__ import annotations

# ruff: noqa: S101, S603, S607 - pytest assertions and fixed Git subprocess scaffolding are intentional.
import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from types import ModuleType

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
SCANNER_PATH = REPO_ROOT / "scripts/rebrand/check_brand.py"
BRAND_CONTRACT_PATH = REPO_ROOT / "brand/ketos-brand-contract.yaml"
LEGACY_CONTRACT_PATH = REPO_ROOT / "brand/legacy-langflow-contract.yaml"
FIXTURES = Path(__file__).with_name("fixtures")


def load_scanner() -> ModuleType:
    """Load the future scanner without making test collection depend on it."""
    assert SCANNER_PATH.is_file(), f"Stage 0 scanner is missing: {SCANNER_PATH}"
    spec = importlib.util.spec_from_file_location("ketos_brand_scanner", SCANNER_PATH)
    assert spec is not None, f"Cannot load {SCANNER_PATH}"
    assert spec.loader is not None, f"Cannot load {SCANNER_PATH}"
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def git(repo: Path, *args: str) -> str:
    completed = subprocess.run(["git", *args], cwd=repo, check=True, text=True, capture_output=True)
    return completed.stdout.strip()


@pytest.fixture
def git_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "config", "user.email", "brand-tests@example.invalid")
    git(repo, "config", "user.name", "Brand Contract Tests")
    return repo


def commit_files(repo: Path, files: dict[str, str], message: str = "fixture") -> str:
    for relative, content in files.items():
        path = repo / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    git(repo, "add", ".")
    git(repo, "commit", "-qm", message)
    return git(repo, "rev-parse", "HEAD")


def read_yaml(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert isinstance(value, dict)
    return value


def write_yaml(path: Path, value: dict[str, Any]) -> Path:
    path.write_text(yaml.safe_dump(value, sort_keys=False), encoding="utf-8")
    return path


@pytest.fixture
def valid_brand_contract() -> dict[str, Any]:
    return read_yaml(FIXTURES / "valid-brand-contract.yaml")


@pytest.fixture
def valid_legacy_contract() -> dict[str, Any]:
    return read_yaml(FIXTURES / "valid-legacy-contract.yaml")


def scanner_command(repo: Path, brand: Path, legacy: Path, *extra: str) -> list[str]:
    return [
        "uv",
        "run",
        "python",
        str(SCANNER_PATH),
        "--repo",
        str(repo),
        "--brand-contract",
        str(brand),
        "--legacy-contract",
        str(legacy),
        "--format",
        "json",
        *extra,
    ]


def parse_json_output(output: str) -> dict[str, Any]:
    value = json.loads(output)
    assert isinstance(value, dict)
    return value
