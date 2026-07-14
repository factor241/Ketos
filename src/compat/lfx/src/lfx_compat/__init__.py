"""Versioned LFX-to-KFX compatibility metadata and lazy import aliases."""

from lfx_compat.aliases import (
    MissingCanonicalTargetError,
    install_aliases,
    load_module_map,
    resolve_legacy_module,
)

__all__ = [
    "MissingCanonicalTargetError",
    "install_aliases",
    "load_module_map",
    "resolve_legacy_module",
]
