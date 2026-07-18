from __future__ import annotations

import hashlib
import json
from pathlib import Path

import tomllib

ROOT = Path(__file__).parents[3]
DOCKERIGNORE = ROOT / ".dockerignore"
KETOS_BASE_PYPROJECT = ROOT / "src/backend/base/pyproject.toml"
BACKEND_LOCALE_BASELINE = ROOT / "scripts/i18n/allowlists/backend-locale-debt.json"
FRONTEND_CONTRACT_BASELINE = ROOT / "scripts/i18n/allowlists/frontend-contract-baseline.json"
STANDALONE_FRONTEND_DOCKERFILE = ROOT / "docker/frontend/build_and_push_frontend.Dockerfile"
UNIFIED_DOCKERFILE = ROOT / "docker/build_and_push.Dockerfile"
HATCHLING_BUILD_REQUIREMENT = "hatchling==1.31.0"
MIT_LICENSE_SHA256 = "48d4a7496209a9e1f2f549384251b69319360c3a38127cf513473590be383359"
MIT_NOTICE_SHA256 = "dad6ed5d6468b1962f598e35f334ecc661408b3cf137289073a03b3cfd77442e"
APACHE_LICENSE_SHA256 = "b04c8850fdf64d17233f0acbe4eb632f03bd663094233c949bdbe788858bb841"
APACHE_NOTICE_SHA256 = "d5fe5257f43692583fb8f66bb222dd0250a277fcab482bb50de6d124e9243cd4"
PYTHON_DISTRIBUTIONS = {
    ROOT / "pyproject.toml": ("MIT", MIT_LICENSE_SHA256, MIT_NOTICE_SHA256),
    ROOT / "src/backend/base/pyproject.toml": ("MIT", MIT_LICENSE_SHA256, MIT_NOTICE_SHA256),
    ROOT / "src/sdk/pyproject.toml": ("MIT", MIT_LICENSE_SHA256, MIT_NOTICE_SHA256),
    ROOT / "src/ketos-stepflow/pyproject.toml": ("Apache-2.0", APACHE_LICENSE_SHA256, APACHE_NOTICE_SHA256),
    ROOT / "src/kfx/pyproject.toml": ("MIT", MIT_LICENSE_SHA256, MIT_NOTICE_SHA256),
    ROOT / "src/bundles/arxiv/pyproject.toml": ("MIT", MIT_LICENSE_SHA256, MIT_NOTICE_SHA256),
    ROOT / "src/bundles/docling/pyproject.toml": ("MIT", MIT_LICENSE_SHA256, MIT_NOTICE_SHA256),
    ROOT / "src/bundles/duckduckgo/pyproject.toml": ("MIT", MIT_LICENSE_SHA256, MIT_NOTICE_SHA256),
    ROOT / "src/bundles/ibm/pyproject.toml": ("MIT", MIT_LICENSE_SHA256, MIT_NOTICE_SHA256),
}


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_all_python_distributions_pin_build_backend_and_exact_legal_payload() -> None:
    for pyproject, (license_expression, license_sha256, notice_sha256) in PYTHON_DISTRIBUTIONS.items():
        payload = tomllib.loads(pyproject.read_text(encoding="utf-8"))
        project = payload["project"]

        assert payload["build-system"]["requires"] == [HATCHLING_BUILD_REQUIREMENT], pyproject  # noqa: S101
        assert project["license"] == license_expression, pyproject  # noqa: S101
        assert project["license-files"] == ["LICENSE", "NOTICE"], pyproject  # noqa: S101
        assert _sha256(pyproject.parent / "LICENSE") == license_sha256, pyproject  # noqa: S101
        assert _sha256(pyproject.parent / "NOTICE") == notice_sha256, pyproject  # noqa: S101


def test_unified_docker_context_excludes_generated_frontend_bundle() -> None:
    excluded_paths = DOCKERIGNORE.read_text(encoding="utf-8").splitlines()

    assert "src/backend/base/ketos/frontend" in excluded_paths  # noqa: S101


def test_ketos_base_wheel_includes_locales_and_unified_frontend() -> None:
    payload = tomllib.loads(KETOS_BASE_PYPROJECT.read_text(encoding="utf-8"))
    wheel = payload["tool"]["hatch"]["build"]["targets"]["wheel"]

    assert "ketos/locales/*.json" in wheel["include"]  # noqa: S101
    assert "ketos/frontend/**/*" in wheel["include"]  # noqa: S101


def test_standalone_frontend_image_uses_reproducible_memory_safe_build() -> None:
    dockerfile = STANDALONE_FRONTEND_DOCKERFILE.read_text(encoding="utf-8")

    assert "FROM --platform=$BUILDPLATFORM node:22.14.0-bookworm-slim AS builder-base" in dockerfile  # noqa: S101
    assert "node:lts" not in dockerfile  # noqa: S101
    assert "npm ci" in dockerfile  # noqa: S101
    assert 'NODE_OPTIONS="--max-old-space-size=4096"' in dockerfile  # noqa: S101


def test_frontend_docker_builds_forbid_removed_russian_locale_rollback_flag() -> None:
    removed_flag = "_".join(("VITE", "ENABLE", "RUSSIAN", "LOCALE"))  # noqa: FLY002
    for dockerfile_path in (STANDALONE_FRONTEND_DOCKERFILE, UNIFIED_DOCKERFILE):
        dockerfile = dockerfile_path.read_text(encoding="utf-8")

        assert removed_flag not in dockerfile  # noqa: S101


def test_locale_contract_baselines_only_reference_english_and_russian() -> None:
    backend = json.loads(BACKEND_LOCALE_BASELINE.read_text(encoding="utf-8"))
    frontend = json.loads(FRONTEND_CONTRACT_BASELINE.read_text(encoding="utf-8"))

    assert backend["required_locales"] == ["en", "ru"]  # noqa: S101
    assert set(backend.get("absent_locales", [])) <= {"en", "ru"}  # noqa: S101
    assert set(backend.get("locale_debt", {})) <= {"en", "ru"}  # noqa: S101
    assert {entry["locale"] for entry in frontend["issues"]["locales"]} <= {"en", "ru"}  # noqa: S101
