"""Lazy module aliases for the frozen LFX 1.10.2 public module inventory."""

from __future__ import annotations

import importlib
import importlib.abc
import importlib.resources
import importlib.util
import json
import sys
from functools import cache
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from types import ModuleType


class MissingCanonicalTargetError(ModuleNotFoundError):
    """Raised when a frozen legacy module has no canonical implementation."""


@cache
def load_module_map() -> dict[str, Any]:
    """Load the immutable, versioned compatibility map shipped in the wheel."""
    resource = importlib.resources.files("lfx_compat").joinpath("module-map-v1.json")
    return json.loads(resource.read_text(encoding="utf-8"))


@cache
def _entries_by_legacy() -> dict[str, dict[str, str]]:
    manifest = load_module_map()
    entries = {}
    for compact in manifest["modules"]:
        legacy = manifest["legacy_prefix"] + compact["suffix"]
        entry = {
            "legacy": legacy,
            "canonical": manifest["canonical_prefix"] + compact.get("target_suffix", compact["suffix"]),
            "status": compact["status"],
        }
        if "reason" in compact:
            entry["reason"] = compact["reason"]
        entries[legacy] = entry
    return entries


def resolve_legacy_module(fullname: str) -> str:
    """Return the canonical target or raise an actionable compatibility error."""
    entry = _entries_by_legacy().get(fullname)
    if entry is None:
        raise KeyError(fullname)
    if entry["status"] == "blocked":
        blocked = [
            f"{item['legacy']} -> {item['canonical']}"
            for item in _entries_by_legacy().values()
            if item["status"] == "blocked"
        ]
        message = (
            f"{fullname} has no canonical target ({entry['canonical']}): "
            f"{entry['reason']}; blocked legacy modules: {', '.join(blocked)}"
        )
        raise MissingCanonicalTargetError(message)
    return entry["canonical"]


class _CanonicalModuleLoader(importlib.abc.Loader):
    def __init__(self, canonical_name: str) -> None:
        self.canonical_name = canonical_name
        self._canonical_spec: importlib.machinery.ModuleSpec | None = None
        self._canonical_loader: object = None
        self._canonical_package: str | None = None

    def create_module(self, _spec: importlib.machinery.ModuleSpec) -> ModuleType:
        module = importlib.import_module(self.canonical_name)
        self._canonical_spec = module.__spec__
        self._canonical_loader = module.__loader__
        self._canonical_package = module.__package__
        return module

    def exec_module(self, module: ModuleType) -> None:
        # Import machinery temporarily writes the alias spec onto the returned
        # object. Restore canonical metadata so introspection and reload stay valid.
        module.__spec__ = self._canonical_spec
        module.__loader__ = self._canonical_loader
        module.__package__ = self._canonical_package


class _LegacyAliasFinder(importlib.abc.MetaPathFinder):
    _lfx_compat_alias_finder = True

    def find_spec(
        self,
        fullname: str,
        _path: object = None,
        _target: ModuleType | None = None,
    ) -> importlib.machinery.ModuleSpec | None:
        if not fullname.startswith("lfx."):
            return None
        try:
            canonical_name = resolve_legacy_module(fullname)
        except KeyError:
            return None
        canonical_spec = importlib.util.find_spec(canonical_name)
        if canonical_spec is None:
            message = f"{fullname} maps to {canonical_name}, but the canonical module is not installed"
            raise MissingCanonicalTargetError(message)
        return importlib.util.spec_from_loader(
            fullname,
            _CanonicalModuleLoader(canonical_name),
            is_package=canonical_spec.submodule_search_locations is not None,
        )


def install_aliases() -> None:
    """Install one process-wide lazy alias finder, idempotently."""
    if any(getattr(finder, "_lfx_compat_alias_finder", False) for finder in sys.meta_path):
        return
    sys.meta_path.insert(0, _LegacyAliasFinder())
