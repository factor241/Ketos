"""Helpers for unchanged deep-module identity aliases."""

from __future__ import annotations

import importlib
import sys


def alias_module(legacy_name: str, canonical_name: str) -> None:
    """Replace an importing wrapper with its canonical module object."""
    sys.modules[legacy_name] = importlib.import_module(canonical_name)
