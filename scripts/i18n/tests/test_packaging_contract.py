from __future__ import annotations

from pathlib import Path

import tomllib

ROOT = Path(__file__).parents[3]
DOCKERIGNORE = ROOT / ".dockerignore"
LANGFLOW_BASE_PYPROJECT = ROOT / "src/backend/base/pyproject.toml"
STANDALONE_FRONTEND_DOCKERFILE = ROOT / "docker/frontend/build_and_push_frontend.Dockerfile"
UNIFIED_DOCKERFILE = ROOT / "docker/build_and_push.Dockerfile"


def test_unified_docker_context_excludes_generated_frontend_bundle() -> None:
    excluded_paths = DOCKERIGNORE.read_text(encoding="utf-8").splitlines()

    assert "src/backend/base/langflow/frontend" in excluded_paths  # noqa: S101


def test_langflow_base_wheel_includes_locales_and_unified_frontend() -> None:
    payload = tomllib.loads(LANGFLOW_BASE_PYPROJECT.read_text(encoding="utf-8"))
    wheel = payload["tool"]["hatch"]["build"]["targets"]["wheel"]

    assert "langflow/locales/*.json" in wheel["include"]  # noqa: S101
    assert "langflow/frontend/**/*" in wheel["include"]  # noqa: S101


def test_standalone_frontend_image_uses_reproducible_memory_safe_build() -> None:
    dockerfile = STANDALONE_FRONTEND_DOCKERFILE.read_text(encoding="utf-8")

    assert "FROM --platform=$BUILDPLATFORM node:22.14.0-bookworm-slim AS builder-base" in dockerfile  # noqa: S101
    assert "node:lts" not in dockerfile  # noqa: S101
    assert "npm ci" in dockerfile  # noqa: S101
    assert 'NODE_OPTIONS="--max-old-space-size=4096"' in dockerfile  # noqa: S101


def test_frontend_docker_builds_forward_the_russian_locale_rollback_flag() -> None:
    for dockerfile_path in (STANDALONE_FRONTEND_DOCKERFILE, UNIFIED_DOCKERFILE):
        dockerfile = dockerfile_path.read_text(encoding="utf-8")

        assert "ARG VITE_ENABLE_RUSSIAN_LOCALE=true" in dockerfile  # noqa: S101
        assert "ENV VITE_ENABLE_RUSSIAN_LOCALE=${VITE_ENABLE_RUSSIAN_LOCALE}" in dockerfile  # noqa: S101
