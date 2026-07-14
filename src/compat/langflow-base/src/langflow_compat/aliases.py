"""Lazy, identity-preserving aliases from legacy backend imports to Ketos."""

from __future__ import annotations

import importlib
import importlib.abc
import importlib.util
import json
import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from types import ModuleType


_RENAMED_EXPORTS: dict[str, dict[str, str]] = {
    "ketos.agentic.services.flow_preparation": {
        "inject_lfx_components_path": "inject_kfx_components_path",
    },
    "ketos.api.utils.core": {
        "check_langflow_version": "check_ketos_version",
    },
    "ketos.cli.progress": {
        "create_langflow_progress": "create_ketos_progress",
        "create_langflow_shutdown_progress": "create_ketos_shutdown_progress",
    },
    "ketos.server": {
        "LangflowApplication": "KetosApplication",
        "LangflowUvicornWorker": "KetosUvicornWorker",
    },
    "ketos.services.authorization.service": {
        "LangflowAuthorizationService": "KetosAuthorizationService",
    },
    "ketos.services.flow.flow_runner": {
        "LangflowRunnerExperimental": "KetosRunnerExperimental",
    },
    "ketos.services.adapters.deployment.watsonx_orchestrate.core.tools": {
        "_resolve_lfx_requirement": "_resolve_kfx_requirement",
        "build_langflow_artifact_bytes": "build_ketos_artifact_bytes",
        "ensure_langflow_connections_binding": "ensure_ketos_connections_binding",
        "extract_langflow_artifact_from_zip": "extract_ketos_artifact_from_zip",
        "extract_langflow_connections_binding": "extract_ketos_connections_binding",
        "verify_langflow_owned": "verify_ketos_owned",
    },
    "ketos.services.adapters.deployment.watsonx_orchestrate.payloads": {
        "build_langflow_wxo_resource_name": "build_ketos_wxo_resource_name",
    },
}


def _load_module_map() -> dict[str, str]:
    inventory_path = Path(__file__).with_name("module-map-v1.json")
    inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    if inventory.get("schema_version") != 1:
        msg = f"unsupported langflow compatibility module map: {inventory.get('schema_version')!r}"
        raise RuntimeError(msg)

    result: dict[str, str] = {}
    for group in inventory["groups"]:
        legacy_prefix = group["legacy_prefix"]
        canonical_prefix = group["canonical_prefix"]
        for suffix in group["suffixes"]:
            legacy_name = f"{legacy_prefix}{suffix}"
            canonical_name = f"{canonical_prefix}{suffix}"
            if legacy_name in result:
                msg = f"duplicate legacy module in compatibility map: {legacy_name}"
                raise RuntimeError(msg)
            result[legacy_name] = canonical_name
    for legacy_name, canonical_name in inventory["exact"].items():
        if legacy_name in result:
            msg = f"duplicate legacy module in compatibility map: {legacy_name}"
            raise RuntimeError(msg)
        result[legacy_name] = canonical_name

    expected_count = inventory["source"]["mapped_module_count"]
    if len(result) != expected_count:
        msg = f"legacy module map has {len(result)} entries; expected {expected_count}"
        raise RuntimeError(msg)
    return result


_MODULE_MAP = _load_module_map()


def resolve_legacy_module(fullname: str) -> str:
    """Resolve a supported legacy dotted path to its canonical module."""
    return _MODULE_MAP[fullname]


def _export_renamed_symbols(module: ModuleType, canonical_name: str) -> None:
    for legacy_name, canonical_name_attr in _RENAMED_EXPORTS.get(
        canonical_name, {}
    ).items():
        setattr(module, legacy_name, getattr(module, canonical_name_attr))


class _CanonicalModuleLoader(importlib.abc.Loader):
    """Return the already-imported canonical module for a legacy name."""

    def __init__(self, canonical_name: str) -> None:
        self.canonical_name = canonical_name
        self._canonical_spec: importlib.machinery.ModuleSpec | None = None
        self._canonical_loader: object = None
        self._canonical_package: str | None = None

    def create_module(self, _spec: importlib.machinery.ModuleSpec) -> ModuleType:
        module = importlib.import_module(self.canonical_name)
        _export_renamed_symbols(module, self.canonical_name)
        self._canonical_spec = module.__spec__
        self._canonical_loader = module.__loader__
        self._canonical_package = module.__package__
        return module

    def exec_module(self, module: ModuleType) -> None:
        # Import machinery temporarily assigns the legacy spec to the returned
        # object. Restore canonical metadata for introspection and reload.
        module.__spec__ = self._canonical_spec
        module.__loader__ = self._canonical_loader
        module.__package__ = self._canonical_package


class _LegacyAliasFinder(importlib.abc.MetaPathFinder):
    _langflow_compat_alias_finder = True

    def find_spec(
        self,
        fullname: str,
        _path: object = None,
        _target: ModuleType | None = None,
    ) -> importlib.machinery.ModuleSpec | None:
        if not fullname.startswith("langflow."):
            return None
        canonical_name = resolve_legacy_module(fullname)
        canonical_spec = importlib.util.find_spec(canonical_name)
        if canonical_spec is None:
            message = f"{fullname} maps to {canonical_name}, but the canonical module is not installed"
            raise ModuleNotFoundError(message)
        return importlib.util.spec_from_loader(
            fullname,
            _CanonicalModuleLoader(canonical_name),
            is_package=canonical_spec.submodule_search_locations is not None,
        )


def install_aliases() -> None:
    """Install the process-wide legacy alias finder exactly once."""
    if any(
        getattr(finder, "_langflow_compat_alias_finder", False)
        for finder in sys.meta_path
    ):
        return
    sys.meta_path.insert(0, _LegacyAliasFinder())
