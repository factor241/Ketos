from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).parents[3]
RUNBOOK = ROOT / "docs/localization/ru/release-rollout-rollback.md"
SIDEBAR_PLAN = ROOT / "PLAN_SIDEBAR_ACCOUNT_REDESIGN.md"
SURFACE_MANIFEST = ROOT / "docs/localization/ru/surface-manifest.csv"
FRONTEND_LOCALES = ROOT / "src/frontend/src/locales"
BACKEND_LOCALES = ROOT / "src/backend/base/ketos/locales"


def _runbook() -> str:
    assert RUNBOOK.is_file(), f"missing release runbook: {RUNBOOK}"  # noqa: S101
    return RUNBOOK.read_text(encoding="utf-8")


def _rollback_section() -> str:
    text = _runbook()
    return text[text.index("## 8. Rollback") : text.index("## 9. Release evidence")]


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
    assert "не изменять `preferred_locale`" in text  # noqa: S101
    assert "не удалять `ru.json`" in text  # noqa: S101
    assert "предыдущий совместимый digest" in text.lower()  # noqa: S101


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


def test_release_runbook_has_executable_previous_digest_rollback_rehearsal() -> None:
    text = _runbook()

    required_contracts = (
        "rollback_rehearsal_cleanup()",
        "trap rollback_rehearsal_cleanup EXIT",
        'ROLLBACK_DATA_VOLUME="ketos-ru-rehearsal-${RELEASE_ID}"',
        '-v "${ROLLBACK_DATA_VOLUME}:/app/ketos"',
        'ROLLBACK_PHASE="current-before"',
        'ROLLBACK_PHASE="previous-compatible"',
        'ROLLBACK_PHASE="current-after"',
        'start_rollback_rehearsal "${PREVIOUS_COMPATIBLE_DIGEST}"',
        "/api/v1/users/whoami",
        'profile.preferred_locale !== "ru"',
        "document.documentElement.lang",
        'localStorage.getItem("ketos-language-preference")',
        'page.getByRole("option", { name: "Русский", exact: true })',
        "preferencePatchRequests.length",
    )
    for contract in required_contracts:
        assert contract in text, f"runbook is missing executable rollback contract {contract!r}"  # noqa: S101

    current_before = text.index('ROLLBACK_PHASE="current-before"')
    previous = text.index('ROLLBACK_PHASE="previous-compatible"')
    current_after = text.index('ROLLBACK_PHASE="current-after"')
    assert current_before < previous < current_after  # noqa: S101


def test_release_runbook_uses_only_the_current_language_storage_key() -> None:
    text = _runbook()

    assert "ketos-language-preference" in text  # noqa: S101
    assert 'localStorage.getItem("languagePreference")' not in text  # noqa: S101
    assert "languagePreference:${profileId}" not in text  # noqa: S101


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


def test_release_runbook_requires_a_pinned_previous_compatible_registry_digest() -> None:
    text = _rollback_section()

    required_contracts = (
        "PREVIOUS_COMPATIBLE_DIGEST",
        "@sha256:",
        'docker pull "${PREVIOUS_COMPATIBLE_DIGEST}"',
        "previous-compatible-registry-digest.txt",
        "test -s .artifacts/i18n-release/previous-compatible-registry-digest.txt",
    )
    for contract in required_contracts:
        assert contract in text, f"runbook is missing previous digest contract {contract!r}"  # noqa: S101


def test_release_runbook_removes_locale_kill_switch_and_disabled_artifacts() -> None:
    text = _runbook()

    forbidden_contracts = (
        "_".join(("VITE", "ENABLE", "RUSSIAN", "LOCALE")),  # noqa: FLY002
        "shipped: false",
        "ru-disabled",
        "rollback-disabled",
        "ROLLBACK_UNIFIED_IMAGE",
        "ROLLBACK_FRONTEND_IMAGE",
        "DISABLED_WHEEL",
        'EXPECTED_RU_OPTION_COUNT="0"',
    )
    for contract in forbidden_contracts:
        assert contract not in text, f"runbook still contains obsolete contract {contract!r}"  # noqa: S101


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


def test_sidebar_plan_targets_only_en_and_ru_locales() -> None:
    text = SIDEBAR_PLAN.read_text(encoding="utf-8")

    assert "2 локали (en, ru)" in text  # noqa: S101
    assert not re.search(r"\b8\s+(?:файлов\s+)?локал", text)  # noqa: S101
    assert "{en,ru,de,ja,fr,es,pt,zh-Hans}.json" not in text  # noqa: S101


def test_surface_manifest_names_exact_en_ru_catalog_baselines() -> None:
    text = SURFACE_MANIFEST.read_text(encoding="utf-8")

    frontend_en = len(json.loads((FRONTEND_LOCALES / "en.json").read_text(encoding="utf-8")))
    frontend_ru = len(json.loads((FRONTEND_LOCALES / "ru.json").read_text(encoding="utf-8")))
    backend_en = len(json.loads((BACKEND_LOCALES / "en.json").read_text(encoding="utf-8")))
    backend_ru = len(json.loads((BACKEND_LOCALES / "ru.json").read_text(encoding="utf-8")))

    assert f"frontend_en_{frontend_en}_ru_{frontend_ru}" in text  # noqa: S101
    assert f"backend_en_{backend_en}_ru_{backend_ru}" in text  # noqa: S101
    assert "frontend_locales_7x2068" not in text  # noqa: S101
    assert "backend_en_6781_targets_6x6761" not in text  # noqa: S101
