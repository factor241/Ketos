"""Task 16 contracts for the current corpus and destructive name cutover."""

from __future__ import annotations

import json
from importlib.machinery import PathFinder
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
CORPUS_MANIFEST = ROOT / "scripts" / "ci" / "task16_current_corpus.json"
STARTER_ROOT = ROOT / "src" / "backend" / "base" / "ketos" / "initial_setup" / "starter_projects"
OLD_PRODUCT = "lang" + "flow"
OLD_EXECUTOR = "l" + "fx"
DELETED_PATHS = (
    f"src/{OLD_PRODUCT}-stepflow",
    f"src/kfx/src/{OLD_EXECUTOR}",
    f"src/sdk/{OLD_PRODUCT}-environments.toml.example",
    f"src/kfx/tests/unit/cli/test_run_starter_projects_backward_{'compatibility'}.py",
    "src/kfx/tests/data/starter_projects_1_6_0",
    "src/kfx/tests/fixtures/starter_flows/v1.9.0",
    "tests/fixtures/localization/flow-abi/v1",
    "src/frontend/tests/assets/outdated_flow.json",
    f"src/frontend/tests/extended/features/{OLD_PRODUCT}Shortcuts.spec.ts",
    "src/frontend/tests/extended/features/outdated-actions.spec.ts",
    "src/frontend/tests/extended/features/outdated-message.spec.ts",
    f"src/frontend/tests/utils/add-flow-to-test-on-empty-{OLD_PRODUCT}.ts",
    "src/frontend/tests/utils/add-legacy-components.ts",
    "src/frontend/tests/utils/clean-old-folders.ts",
    "src/frontend/tests/utils/dismiss-legacy-warnings.ts",
    f"src/frontend/tests/utils/login-{OLD_PRODUCT}.ts",
    "src/frontend/tests/utils/remove-old-api-keys.ts",
    "src/frontend/tests/utils/update-old-components.ts",
)
ACTIVE_CONSUMER_ROOTS = (
    ROOT / "src" / "backend" / "tests",
    ROOT / "src" / "frontend" / "src",
    ROOT / "src" / "frontend" / "tests",
    ROOT / "src" / "kfx" / "tests",
    ROOT / "docs" / "localization" / "ru",
)
DANGLING_REFERENCE_MARKERS = (
    "flow-abi/v1",
    "starter_projects_1_6_0",
    "starter_flows/v1.9.0",
    "test_run_starter_projects_backward_compatibility",
    "outdated_flow",
    f"{OLD_PRODUCT}Shortcuts",
    "outdated-actions",
    "outdated-message",
    f"add-flow-to-test-on-empty-{OLD_PRODUCT}",
    "add-legacy-components",
    "clean-old-folders",
    "dismiss-legacy-warnings",
    f"login-{OLD_PRODUCT}",
    "remove-old-api-keys",
    "update-old-components",
)
TEXT_SUFFIXES = {".js", ".json", ".md", ".py", ".ts", ".tsx"}


def test_current_starter_corpus_has_task16_ownership_and_task17_producer_provenance() -> None:
    manifest = json.loads(CORPUS_MANIFEST.read_text(encoding="utf-8"))
    starter_paths = sorted(path.relative_to(ROOT).as_posix() for path in STARTER_ROOT.glob("*.json"))

    assert manifest == {
        "schema_version": 1,
        "corpus": "current-ketos-starter-projects",
        "task16_ownership": "current-corpus-inputs",
        "task17_producer": "scripts/ci/update_starter_projects.py",
        "historical_compatibility": False,
        "inputs": starter_paths,
    }
    assert len(starter_paths) == 33


def test_current_starter_corpus_contains_only_canonical_serialized_imports() -> None:
    old_imports = (f"from {OLD_PRODUCT}", f"import {OLD_PRODUCT}", f"from {OLD_EXECUTOR}", f"import {OLD_EXECUTOR}")
    offenders: list[str] = []

    for path in sorted(STARTER_ROOT.glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        serialized = json.dumps(payload, ensure_ascii=False)
        if any(marker in serialized for marker in old_imports):
            offenders.append(path.relative_to(ROOT).as_posix())

    assert offenders == []


def test_old_package_names_are_not_importable_from_current_source_roots() -> None:
    source_roots = [
        ROOT / "src" / "backend" / "base",
        ROOT / "src" / "kfx" / "src",
        ROOT / "src" / "sdk" / "src",
        ROOT / "src" / "ketos-stepflow" / "src",
    ]

    assert PathFinder.find_spec(OLD_PRODUCT, [str(path) for path in source_roots]) is None
    assert PathFinder.find_spec(OLD_EXECUTOR, [str(path) for path in source_roots]) is None


def test_old_environment_prefix_is_ignored(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from kfx.services.settings.base import Settings

    old_config = tmp_path / "old-config"
    monkeypatch.setenv(f"{OLD_PRODUCT.upper()}_CONFIG_DIR", str(old_config))
    monkeypatch.delenv("KETOS_CONFIG_DIR", raising=False)

    assert Path(Settings().config_dir) != old_config
    assert not old_config.exists()


def test_old_http_header_is_rejected() -> None:
    from kfx.cli.serve_app import FlowRegistry, create_multi_serve_app

    response = TestClient(create_multi_serve_app(registry=FlowRegistry())).get(
        "/flows",
        headers={f"x-{OLD_PRODUCT}-global-var-secret": "rejected"},
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "Legacy HTTP headers are not supported"}


@pytest.mark.parametrize(
    ("validator_name", "value", "error"),
    [
        ("step", OLD_PRODUCT + "_node", "Legacy Stepflow step ID"),
        ("route", "/" + OLD_PRODUCT + "/core/prompt", "Legacy Stepflow component route"),
        ("queue", OLD_PRODUCT, "Legacy Stepflow queue"),
    ],
)
def test_old_stepflow_protocol_values_are_rejected(validator_name: str, value: str, error: str) -> None:
    from ketos_stepflow.protocol import validate_component_route, validate_queue_name, validate_step_id

    validators = {"step": validate_step_id, "route": validate_component_route, "queue": validate_queue_name}
    with pytest.raises(ValueError, match=error):
        validators[validator_name](value)


def test_old_stepflow_type_marker_is_rejected() -> None:
    from ketos_stepflow.worker.handlers.ketos_types import KetosTypeInputHandler

    with pytest.raises(ValueError, match="Legacy Stepflow type marker"):
        KetosTypeInputHandler().matches(
            template_field={},
            value={f"__{OLD_PRODUCT}_type__": "Message", "text": "rejected"},
        )


@pytest.mark.parametrize(
    "relative_path",
    DELETED_PATHS,
)
def test_deleted_historical_paths_are_absent(relative_path: str) -> None:
    path = ROOT / relative_path
    assert not path.is_file()
    assert not path.is_dir() or not any(path.iterdir())


def test_active_consumers_do_not_reference_deleted_historical_paths() -> None:
    offenders: list[str] = []

    for root in ACTIVE_CONSUMER_ROOTS:
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
                continue
            text = path.read_text(encoding="utf-8")
            relative_path = path.relative_to(ROOT).as_posix()
            offenders.extend(f"{relative_path}: {marker}" for marker in DANGLING_REFERENCE_MARKERS if marker in text)

    assert offenders == []
