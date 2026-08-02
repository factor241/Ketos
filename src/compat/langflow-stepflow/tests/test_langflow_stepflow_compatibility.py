# ruff: noqa: S101, S603, S607

from __future__ import annotations

import importlib
import sys
import zipfile
from pathlib import Path

import tomllib

REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
PACKAGE_ROOT = REPOSITORY_ROOT / "src" / "compat" / "langflow-stepflow"
PACKAGE_SOURCE = PACKAGE_ROOT / "src"
CANONICAL_SOURCE = REPOSITORY_ROOT / "src" / "ketos-stepflow" / "src"


def _forget_stepflow_modules() -> None:
    for name in tuple(sys.modules):
        if name == "langflow_stepflow" or name.startswith("langflow_stepflow."):
            sys.modules.pop(name)


def test_distribution_uses_exact_compatibility_dependencies() -> None:
    project = tomllib.loads((PACKAGE_ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]

    assert project["name"] == "langflow-stepflow"
    assert project["version"] == "0.1.0"
    assert project["dependencies"] == [
        "ketos-stepflow==0.1.0",
        "lfx==1.10.2",
        "langflow-base==0.10.2",
    ]
    assert "entry-points" not in project


def test_unchanged_modules_are_loaded_as_canonical_module_objects(monkeypatch) -> None:
    monkeypatch.syspath_prepend(str(CANONICAL_SOURCE))
    monkeypatch.syspath_prepend(str(PACKAGE_SOURCE))
    _forget_stepflow_modules()

    importlib.import_module("langflow_stepflow")
    for suffix in (
        "translation.dependency_analyzer",
        "translation.node_processor",
        "translation.schema_mapper",
        "translation.stepflow_tweaks",
        "worker.base_executor",
        "worker.core_executor",
        "worker.handlers.base",
        "worker.handlers.dataframe",
    ):
        legacy = importlib.import_module(f"langflow_stepflow.{suffix}")
        canonical = importlib.import_module(f"ketos_stepflow.{suffix}")
        assert legacy is canonical


def test_renamed_converter_exception_and_handler_symbols_alias_canonical_objects(monkeypatch) -> None:
    monkeypatch.syspath_prepend(str(CANONICAL_SOURCE))
    monkeypatch.syspath_prepend(str(PACKAGE_SOURCE))
    _forget_stepflow_modules()

    legacy = importlib.import_module("langflow_stepflow")
    translator = importlib.import_module("langflow_stepflow.translation.translator")
    exceptions = importlib.import_module("langflow_stepflow.exceptions")
    handlers = importlib.import_module("langflow_stepflow.worker.handlers.langflow_types")
    canonical_translator = importlib.import_module("ketos_stepflow.translation.translator")
    canonical_exceptions = importlib.import_module("ketos_stepflow.exceptions")
    canonical_handlers = importlib.import_module("ketos_stepflow.worker.handlers.ketos_types")
    canonical_root = importlib.import_module("ketos_stepflow")

    assert legacy is canonical_root
    assert translator is canonical_translator
    assert exceptions is canonical_exceptions
    assert handlers is canonical_handlers

    assert legacy.LangflowConverter is canonical_translator.KetosConverter
    assert translator.LangflowConverter is canonical_translator.KetosConverter
    assert exceptions.LangflowIntegrationError is canonical_exceptions.KetosIntegrationError
    assert exceptions.ConversionError is canonical_exceptions.ConversionError
    assert exceptions.ValidationError is canonical_exceptions.ValidationError
    assert exceptions.ExecutionError is canonical_exceptions.ExecutionError
    assert handlers.LangflowTypeInputHandler is canonical_handlers.KetosTypeInputHandler
    assert handlers.LangflowTypeOutputHandler is canonical_handlers.KetosTypeOutputHandler


def test_all_renamed_stepflow_symbols_alias_canonical_objects(monkeypatch) -> None:
    monkeypatch.syspath_prepend(str(CANONICAL_SOURCE))
    monkeypatch.syspath_prepend(str(PACKAGE_SOURCE))
    _forget_stepflow_modules()

    importlib.import_module("langflow_stepflow")
    component_tool = importlib.import_module("langflow_stepflow.worker.component_tool")
    canonical_component_tool = importlib.import_module("ketos_stepflow.worker.component_tool")
    schema_module = importlib.import_module("langflow_stepflow.translation.schema_mapper")
    canonical_schema_module = importlib.import_module("ketos_stepflow.translation.schema_mapper")
    handlers = importlib.import_module("langflow_stepflow.worker.handlers.langflow_types")
    canonical_handlers = importlib.import_module("ketos_stepflow.worker.handlers.ketos_types")

    assert component_tool is canonical_component_tool
    assert schema_module is canonical_schema_module
    component_legacy = "_map_langflow_type_to_json_schema"
    component_canonical = "_map_ketos_type_to_json_schema"
    assert getattr(component_tool, component_legacy) is getattr(component_tool, component_canonical)
    for legacy_method, canonical_method in (
        ("_convert_langflow_outputs_to_schema", "_convert_ketos_outputs_to_schema"),
        ("_convert_langflow_types_to_schema", "_convert_ketos_types_to_schema"),
    ):
        assert getattr(schema_module.SchemaMapper, legacy_method) is getattr(
            schema_module.SchemaMapper, canonical_method
        )
    mapper = schema_module.SchemaMapper()
    assert mapper.langflow_to_json_schema is mapper.ketos_to_json_schema
    assert handlers is canonical_handlers
    for legacy_name, canonical_name in (
        ("_langflow_type_name", "_ketos_type_name"),
        ("_is_langflow_type_dict", "_is_ketos_type_dict"),
        ("_has_langflow_type_marker", "_has_ketos_type_marker"),
    ):
        assert getattr(handlers, legacy_name) is getattr(handlers, canonical_name)


def test_unknown_legacy_module_is_not_guessed(monkeypatch) -> None:
    monkeypatch.syspath_prepend(str(CANONICAL_SOURCE))
    monkeypatch.syspath_prepend(str(PACKAGE_SOURCE))
    _forget_stepflow_modules()
    importlib.import_module("langflow_stepflow")

    import pytest

    with pytest.raises(ModuleNotFoundError):
        importlib.import_module("langflow_stepflow.not_a_real_module")


def test_wheel_owns_only_the_legacy_namespace(tmp_path: Path) -> None:
    import subprocess

    subprocess.run(
        ["uv", "build", "--project", str(PACKAGE_ROOT), "--wheel", "--out-dir", str(tmp_path)],
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    wheel = next(tmp_path.glob("langflow_stepflow-0.1.0-*.whl"))
    with zipfile.ZipFile(wheel) as archive:
        names = archive.namelist()

    assert any(name.startswith("langflow_stepflow/") for name in names)
    assert not any(name.startswith("ketos_stepflow/") for name in names)
