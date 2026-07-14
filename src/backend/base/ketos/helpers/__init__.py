"""Lightweight public helpers facade.

Data helpers are imported on first attribute access so importing ``ketos`` does
not eagerly initialize the dataframe and document dependency graph.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .data import data_to_text, docs_to_data, messages_to_text, safe_convert

__all__ = ["data_to_text", "docs_to_data", "messages_to_text", "safe_convert"]


def __getattr__(name: str) -> Any:
    if name not in __all__:
        raise AttributeError(name)

    from . import data

    value = getattr(data, name)
    globals()[name] = value
    return value
