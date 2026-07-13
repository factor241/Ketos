# ruff: noqa: S101

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]


@pytest.mark.parametrize(
    ("relative_path", "constant", "suffix"),
    [
        ("scripts/gp/extract_backend_strings.py", "OUTPUT_PATH", "src/backend/base/ketos/locales/en.json"),
        (
            "scripts/gp/extract_backend_strings.py",
            "STARTER_PROJECTS_DIR",
            "src/backend/base/ketos/initial_setup/starter_projects",
        ),
        (
            "scripts/gp/extract_backend_strings.py",
            "COMPONENT_INDEX_PATH",
            "src/kfx/src/kfx/_assets/component_index.json",
        ),
        ("scripts/i18n/check_component_metadata.py", "DEFAULT_CATALOG", "src/backend/base/ketos/locales/en.json"),
        (
            "scripts/i18n/check_component_metadata.py",
            "DEFAULT_INDEX",
            "src/kfx/src/kfx/_assets/component_index.json",
        ),
        ("scripts/i18n/check_backend_locales.py", "DEFAULT_LOCALES_DIR", "src/backend/base/ketos/locales"),
        ("scripts/i18n/build_backend_ru_catalog.py", "DEFAULT_ENGLISH", "src/backend/base/ketos/locales/en.json"),
        ("scripts/i18n/build_backend_ru_catalog.py", "DEFAULT_OUTPUT", "src/backend/base/ketos/locales/ru.json"),
    ],
)
def test_producer_default_paths_are_canonical_ketos_paths(relative_path: str, constant: str, suffix: str) -> None:
    script = ROOT / relative_path
    spec = importlib.util.spec_from_file_location(f"producer_{script.stem}_{constant}", script)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    assert getattr(module, constant) == ROOT / suffix


@pytest.mark.parametrize(
    "relative_path",
    [
        "scripts/gp/upload.py",
        "scripts/gp/download.py",
        "scripts/gp/check_backend_status.py",
    ],
)
def test_backend_bundle_default_is_canonical_ketos(relative_path: str, monkeypatch) -> None:
    monkeypatch.delenv("GP_BACKEND_BUNDLE", raising=False)
    script = ROOT / relative_path
    monkeypatch.syspath_prepend(str(script.parent))
    spec = importlib.util.spec_from_file_location(f"bundle_{script.stem}", script)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    assert module.GP_BACKEND_BUNDLE == "ketos-ui-backend-v2"
