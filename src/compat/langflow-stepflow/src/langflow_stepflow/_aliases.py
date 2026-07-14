"""Lazy aliases for the frozen langflow-stepflow 0.1.0 module inventory."""

from __future__ import annotations

import importlib
import importlib.abc
import importlib.util
import sys
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from types import ModuleType


_MODULE_TARGETS = {
    "langflow_stepflow.exceptions": "ketos_stepflow.exceptions",
    "langflow_stepflow.translation": "ketos_stepflow.translation",
    "langflow_stepflow.translation.dependency_analyzer": "ketos_stepflow.translation.dependency_analyzer",
    "langflow_stepflow.translation.known_components": "ketos_stepflow.translation.known_components",
    "langflow_stepflow.translation.node_processor": "ketos_stepflow.translation.node_processor",
    "langflow_stepflow.translation.schema_mapper": "ketos_stepflow.translation.schema_mapper",
    "langflow_stepflow.translation.stepflow_tweaks": "ketos_stepflow.translation.stepflow_tweaks",
    "langflow_stepflow.translation.translator": "ketos_stepflow.translation.translator",
    "langflow_stepflow.worker": "ketos_stepflow.worker",
    "langflow_stepflow.worker.__main__": "ketos_stepflow.worker.__main__",
    "langflow_stepflow.worker.base_executor": "ketos_stepflow.worker.base_executor",
    "langflow_stepflow.worker.component_tool": "ketos_stepflow.worker.component_tool",
    "langflow_stepflow.worker.core_executor": "ketos_stepflow.worker.core_executor",
    "langflow_stepflow.worker.custom_code_executor": "ketos_stepflow.worker.custom_code_executor",
    "langflow_stepflow.worker.handlers": "ketos_stepflow.worker.handlers",
    "langflow_stepflow.worker.handlers.base": "ketos_stepflow.worker.handlers.base",
    "langflow_stepflow.worker.handlers.base_model": "ketos_stepflow.worker.handlers.base_model",
    "langflow_stepflow.worker.handlers.dataframe": "ketos_stepflow.worker.handlers.dataframe",
    "langflow_stepflow.worker.handlers.langflow_types": "ketos_stepflow.worker.handlers.ketos_types",
    "langflow_stepflow.worker.handlers.string_coercion": "ketos_stepflow.worker.handlers.string_coercion",
    "langflow_stepflow.worker.handlers.tool_wrapper": "ketos_stepflow.worker.handlers.tool_wrapper",
}

_WRAPPER_ALIASES = {
    "langflow_stepflow.exceptions": {
        "LangflowIntegrationError": "KetosIntegrationError",
    },
    "langflow_stepflow.translation": {
        "LangflowConverter": "KetosConverter",
    },
    "langflow_stepflow.translation.translator": {
        "LangflowConverter": "KetosConverter",
    },
    "langflow_stepflow.worker.handlers": {
        "LangflowTypeInputHandler": "KetosTypeInputHandler",
        "LangflowTypeOutputHandler": "KetosTypeOutputHandler",
    },
    "langflow_stepflow.worker.handlers.langflow_types": {
        "LangflowTypeInputHandler": "KetosTypeInputHandler",
        "LangflowTypeOutputHandler": "KetosTypeOutputHandler",
        "_langflow_type_name": "_ketos_type_name",
        "_is_langflow_type_dict": "_is_ketos_type_dict",
        "_has_langflow_type_marker": "_has_ketos_type_marker",
    },
    "langflow_stepflow.worker.component_tool": {
        "_map_langflow_type_to_json_schema": "_map_ketos_type_to_json_schema",
    },
}


def _export_compatibility_symbols(module: ModuleType, legacy_name: str, aliases: dict[str, str]) -> None:
    for legacy_symbol, canonical_symbol in aliases.items():
        setattr(module, legacy_symbol, getattr(module, canonical_symbol))

    if legacy_name == "langflow_stepflow.translation.schema_mapper":
        mapper = module.SchemaMapper
        mapper.langflow_to_json_schema = property(
            lambda instance: instance.ketos_to_json_schema,
            lambda instance, value: setattr(instance, "ketos_to_json_schema", value),
        )
        mapper._convert_langflow_outputs_to_schema = mapper._convert_ketos_outputs_to_schema  # noqa: SLF001
        mapper._convert_langflow_types_to_schema = mapper._convert_ketos_types_to_schema  # noqa: SLF001


class _CanonicalAliasLoader(importlib.abc.Loader):
    def __init__(self, canonical_name: str, legacy_name: str, aliases: dict[str, str]) -> None:
        self.canonical_name = canonical_name
        self.legacy_name = legacy_name
        self.aliases = aliases
        self._canonical_spec: importlib.machinery.ModuleSpec | None = None
        self._canonical_loader: object = None
        self._canonical_package: str | None = None

    def create_module(self, _spec: importlib.machinery.ModuleSpec) -> ModuleType:
        module = importlib.import_module(self.canonical_name)
        _export_compatibility_symbols(module, self.legacy_name, self.aliases)
        self._canonical_spec = module.__spec__
        self._canonical_loader = module.__loader__
        self._canonical_package = module.__package__
        return module

    def exec_module(self, module: ModuleType) -> None:
        module.__spec__ = self._canonical_spec
        module.__loader__ = self._canonical_loader
        module.__package__ = self._canonical_package


class _LegacyStepflowFinder(importlib.abc.MetaPathFinder):
    _langflow_stepflow_alias_finder = True

    def find_spec(
        self,
        fullname: str,
        _path: object = None,
        _target: ModuleType | None = None,
    ) -> importlib.machinery.ModuleSpec | None:
        canonical_name = _MODULE_TARGETS.get(fullname)
        if canonical_name is None:
            return None
        canonical_spec = importlib.util.find_spec(canonical_name)
        if canonical_spec is None:
            message = f"{fullname} maps to missing canonical module {canonical_name}"
            raise ModuleNotFoundError(message)
        aliases = _WRAPPER_ALIASES.get(fullname, {})
        loader = _CanonicalAliasLoader(canonical_name, fullname, aliases)
        return importlib.util.spec_from_loader(
            fullname,
            loader,
            is_package=canonical_spec.submodule_search_locations is not None,
        )


def install_aliases() -> None:
    """Install the compatibility finder exactly once per interpreter."""
    if any(getattr(finder, "_langflow_stepflow_alias_finder", False) for finder in sys.meta_path):
        return
    sys.meta_path.insert(0, _LegacyStepflowFinder())
