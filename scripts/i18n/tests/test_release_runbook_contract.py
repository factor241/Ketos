from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).parents[3]
RUNBOOK = ROOT / "docs/localization/ru/release-rollout-rollback.md"


def _runbook() -> str:
    assert RUNBOOK.is_file(), f"missing release runbook: {RUNBOOK}"  # noqa: S101
    return RUNBOOK.read_text(encoding="utf-8")


def test_release_runbook_covers_every_required_production_topology() -> None:
    text = _runbook()

    required_contracts = (
        "Unified Python package/static SPA",
        "Standalone frontend Nginx + backend",
        "Wheel installation smoke",
        "docker/build_and_push.Dockerfile",
        "docker/frontend/build_and_push_frontend.Dockerfile",
        "uv build --package ketos-base --wheel",
        "ketos/locales/ru.json",
        "ketos/frontend/assets/ru-",
        "localization-russian-routes.spec.ts",
        "localization-russian-errors.spec.ts",
    )
    for contract in required_contracts:
        assert contract in text, f"runbook is missing {contract!r}"  # noqa: S101


def test_release_runbook_makes_proxy_and_cache_validation_executable() -> None:
    text = _runbook()

    assert "Content-Language" in text  # noqa: S101
    assert "Accept-Language" in text  # noqa: S101
    assert re.search(r"\bVary\b", text)  # noqa: S101
    assert "Cache-Control" in text  # noqa: S101
    assert "index.html" in text  # noqa: S101
    assert re.search(r"ru-\[A-Za-z0-9_\\-\]\{8,\}\\\.js", text)  # noqa: S101


def test_release_runbook_has_measurable_canary_and_non_destructive_rollback() -> None:
    text = _runbook()

    assert "canary не выполнен" in text.lower()  # noqa: S101
    assert "fallback = 0" in text  # noqa: S101
    assert "missing-key = 0" in text  # noqa: S101
    assert "failed-loading = 0" in text  # noqa: S101
    assert "VITE_ENABLE_RUSSIAN_LOCALE=false" in text  # noqa: S101
    assert "shipped: false" in text  # noqa: S101
    assert "недостаточно" in text.lower()  # noqa: S101
    assert "не изменять `preferred_locale`" in text  # noqa: S101
    assert "не удалять `ru.json`" in text  # noqa: S101
    assert "предыдущий digest" in text.lower()  # noqa: S101


def test_release_runbook_links_machine_readable_r11_contracts() -> None:
    text = _runbook()

    required_contracts = (
        "r11-zero-budget-metrics.json",
        "r11-canary-evidence.template.json",
        "check_r11_release_evidence.py --evidence",
        "unknown_error_code",
        "BLOCKED_NOT_EXECUTED",
    )
    for contract in required_contracts:
        assert contract in text, f"runbook is missing R11 evidence contract {contract!r}"  # noqa: S101


def test_release_runbook_has_executable_persistent_rollback_rehearsal() -> None:
    text = _runbook()

    required_contracts = (
        "rollback_rehearsal_cleanup()",
        "trap rollback_rehearsal_cleanup EXIT",
        'ROLLBACK_DATA_VOLUME="ketos-ru-rehearsal-${RELEASE_ID}"',
        '-v "${ROLLBACK_DATA_VOLUME}:/app/ketos"',
        'ROLLBACK_PHASE="enabled-before"',
        'ROLLBACK_PHASE="disabled"',
        'ROLLBACK_PHASE="enabled-after"',
        "/api/v1/users/whoami",
        'profile.preferred_locale !== "ru"',
        "document.documentElement.lang",
        'localStorage.getItem("languagePreference")',
        "languagePreference:${profileId}",
        'page.getByRole("option", { name: "Русский", exact: true })',
        "preferencePatchRequests.length",
    )
    for contract in required_contracts:
        assert contract in text, f"runbook is missing executable rollback contract {contract!r}"  # noqa: S101

    enabled_before = text.index('ROLLBACK_PHASE="enabled-before"')
    disabled = text.index('ROLLBACK_PHASE="disabled"')
    enabled_after = text.index('ROLLBACK_PHASE="enabled-after"')
    assert enabled_before < disabled < enabled_after  # noqa: S101


def test_release_runbook_separates_local_ids_registry_digests_and_locale_artifacts() -> None:
    text = _runbook()

    assert "docker image inspect" in text  # noqa: S101
    assert "{{.Id}}" in text  # noqa: S101
    assert "docker push" in text  # noqa: S101
    assert "{{json .RepoDigests}}" in text  # noqa: S101
    assert 'startswith(f"{repository}@")' in text  # noqa: S101
    assert text.index("docker push") < text.index("{{json .RepoDigests}}")  # noqa: S101
    assert "backend raw catalog `ketos/locales/ru.json`" in text  # noqa: S101
    assert "compiled frontend chunk `ketos/frontend/assets/ru-<hash>.js`" in text  # noqa: S101
    assert "оба `ru.json`" not in text  # noqa: RUF001, S101


def test_release_runbook_publishes_and_captures_exact_disabled_registry_digest() -> None:
    text = _runbook()

    required_contracts = (
        'ROLLBACK_REGISTRY_REPOSITORY="${CANARY_REGISTRY_REPOSITORY}"',
        'ROLLBACK_UNIFIED_PUBLISH_IMAGE="${ROLLBACK_REGISTRY_REPOSITORY}:ru-disabled-${RELEASE_ID}"',
        'docker push "${ROLLBACK_UNIFIED_PUBLISH_IMAGE}"',
        "RepoDigests",
        'startswith(f"{repository}@")',
        "rollback-disabled-registry-digest.txt",
        "test -s .artifacts/i18n-release/rollback-disabled-registry-digest.txt",
    )
    for contract in required_contracts:
        assert contract in text, f"runbook is missing immutable disabled publish contract {contract!r}"  # noqa: S101

    push = text.index('docker push "${ROLLBACK_UNIFIED_PUBLISH_IMAGE}"')
    capture = text.index("rollback-disabled-registry-digest.txt")
    assert push < capture  # noqa: S101


def test_release_runbook_builds_and_rehearses_disabled_wheel() -> None:
    text = _runbook()

    required_contracts = (
        "VITE_ENABLE_RUSSIAN_LOCALE=false make build_frontend",
        "rollback-wheel-disabled-dist",
        "rollback-wheel-enabled-dist",
        "rollback-wheel-disabled-venv",
        "rollback-wheel-enabled-venv",
        'assert "ketos/locales/ru.json" in names',
        "assert len(ru_chunks) == 1",
        'EXPECTED_LANG="en"',
        'EXPECTED_RU_OPTION_COUNT="0"',
        'EXPECTED_LANG="ru"',
        'EXPECTED_RU_OPTION_COUNT="1"',
        "wheel_rollback_cleanup()",
        "trap wheel_rollback_cleanup EXIT",
    )
    for contract in required_contracts:
        assert contract in text, f"runbook is missing disabled wheel rehearsal contract {contract!r}"  # noqa: S101


def test_release_runbook_executes_disabled_image_artifact_and_selector_assertions() -> None:
    text = _runbook()

    required_contracts = (
        'assert_disabled_unified_artifacts "${ROLLBACK_UNIFIED_IMAGE}"',
        'assert_disabled_standalone_artifacts "${BACKEND_IMAGE}" "${ROLLBACK_FRONTEND_IMAGE}"',
        'assert root.joinpath("locales", "ru.json").is_file()',
        "assert len(chunks) == 1",
        "EXPECTED_RU_OPTION_COUNT",
        'EXPECTED_RU_OPTION_COUNT="0"',
    )
    for contract in required_contracts:
        assert contract in text, f"runbook is missing executable disabled artifact contract {contract!r}"  # noqa: S101


def test_release_runbook_smoke_blocks_install_cleanup_traps() -> None:
    text = _runbook()

    required_contracts = (
        "unified_smoke_cleanup()",
        "trap unified_smoke_cleanup EXIT",
        "standalone_smoke_cleanup()",
        "trap standalone_smoke_cleanup EXIT",
        "wheel_smoke_cleanup()",
        "trap wheel_smoke_cleanup EXIT",
    )
    for contract in required_contracts:
        assert contract in text, f"runbook is missing cleanup trap {contract!r}"  # noqa: S101


def test_release_runbook_uses_only_current_ketos_kfx_product_identities() -> None:
    text = _runbook().casefold()

    required_contracts = ("ketos-base", "ketos/locales", "ketos/frontend", "/app/ketos", "kfx")
    for contract in required_contracts:
        assert contract in text, f"runbook is missing current product identity {contract!r}"  # noqa: S101
