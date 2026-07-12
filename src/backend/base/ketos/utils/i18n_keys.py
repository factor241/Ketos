"""Shared i18n key-building functions.

Imported by both the runtime translator (utils/i18n.py) and the extraction
scripts (scripts/gp/extract_backend_strings.py) to guarantee byte-identical
keys. If these functions diverge, component translations silently fall back
to English with no error — a class of bug that is impossible to catch with
unit tests because both copies would be tested against themselves.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any

COMPONENT_INPUT_TEXT_FIELDS = (
    "display_name",
    "info",
    "placeholder",
    "helper_text",
    "refresh_button_text",
    "list_add_label",
    "auth_tooltip",
    "min_label",
    "max_label",
    "trigger_text",
)

COMPONENT_NESTED_TEXT_KEYS = frozenset(
    {
        "description",
        "display_name",
        "helper_text",
        "label",
        "text",
        "title",
        "tooltip",
    }
)


def safe_flow_key(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9]+", "_", name).strip("_").lower()


def normalize_component_key(name: str) -> str:
    """Normalize a component name for locale key prefixes and frontend lookups.

    Removes all whitespace and lowercases, so that "Prompt Template",
    "PromptTemplate", and "prompt template" all map to "prompttemplate".
    Used both as the locale key prefix and in the frontend syncNodeTranslations()
    to resolve stored node.data.type values against the live registry.
    """
    return name.replace(" ", "").lower()


def content_hash(english: str) -> str:
    """Return the first 8 hex chars of SHA-256(english).

    Used as a suffix on component locale keys so that any change to the English
    source string produces a new key, forcing GP to issue a fresh translation.
    """
    return hashlib.sha256(english.encode()).hexdigest()[:8]


def component_field_key(norm_name: str, field_path: str, english: str) -> str:
    """Build the full locale key for a component field.

    Format: components.{norm_name}.{field_path}.{sha256[:8]}

    Args:
        norm_name:  Normalized component name (no spaces, lowercase).
        field_path: Dot-separated path to the field, e.g.
                    "display_name", "inputs.template.display_name",
                    "outputs.message.display_name".
        english:    The current English source string (used to compute the hash).
    """
    return f"components.{norm_name}.{field_path}.{content_hash(english)}"


def component_dynamic_field_path(field_path: str) -> str:
    """Return the shared dynamic namespace for a presentation field.

    Dynamic values can surface at several runtime shapes (for example a direct
    ``helper_text``, an option ``label``, or a nested metadata ``label``).  The
    declarative component contract is intentionally keyed by the final
    presentation field so extraction and runtime fallback cannot drift into
    incompatible ``dynamic.options.*`` and ``dynamic.nested.*`` namespaces.
    """
    return f"dynamic.{field_path.rsplit('.', maxsplit=1)[-1]}"


def component_option_label(option: Any, metadata: Any = None) -> str | None:
    """Return an option's presentation label without rewriting its raw value."""
    if isinstance(metadata, dict):
        metadata_label = metadata.get("label")
        if isinstance(metadata_label, str) and metadata_label:
            return metadata_label
    if isinstance(option, str):
        return option or None
    if isinstance(option, dict):
        for field_name in ("label", "name"):
            label = option.get(field_name)
            if isinstance(label, str) and label:
                return label
    return None
