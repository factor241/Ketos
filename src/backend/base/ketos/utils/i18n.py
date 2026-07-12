"""Backend i18n utility.

Loads flat JSON locale files from ketos/locales/ and provides a translate()
function used to substitute component display_names in API responses.

## Component key scheme

Component strings use a hybrid key: human-readable path + content hash suffix.

    "components.{norm_name}.{field_path}.{sha256[:8]}"

Examples:
    "components.prompttemplate.display_name.a1b2c3d4": "Prompt Template"
    "components.prompttemplate.inputs.template.display_name.f9e8d7c6": "Template"
    "components.chatinput.outputs.message.display_name.12345678": "Chat Message"

The norm_name is the component registry key with spaces removed and lowercased
("Prompt Template" → "prompttemplate"), making it stable across space/case renames.

The 8-char SHA-256 suffix is derived from the English value. When a string
changes (e.g. "Prompt Template" → "New Prompt Template"), the hash suffix
changes, the old key becomes orphaned, and the new key is picked up by GP on
the next upload/translate/download cycle — guaranteeing fresh translations.

Other namespaces keep human-readable keys:
    "starter_flows.{slug}.name"
    "notes.{hash}"

Fallback chain: requested locale → "en" → raw default string.
"""

from __future__ import annotations

import copy
import json
import logging
import re
import string
import threading
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Iterator

from kfx.base.tools.constants import TOOL_OUTPUT_NAME

from ketos.utils.i18n_keys import (
    COMPONENT_INPUT_TEXT_FIELDS,
    COMPONENT_NESTED_TEXT_KEYS,
    component_dynamic_field_path,
    component_field_key,
    component_option_label,
    normalize_component_key,
)
from ketos.utils.i18n_keys import (
    safe_flow_key as _safe_flow_key,
)

logger = logging.getLogger(__name__)

DEFAULT_LOCALE = "en"
SUPPORTED_LOCALES = ("en", "de", "es", "fr", "ja", "pt", "zh-Hans", "ru")

_SUPPORTED_LOCALE_LOOKUP = {locale.casefold(): locale for locale in SUPPORTED_LOCALES}
_LOCALE_ALIASES = {
    "zh": "zh-Hans",
    "zh-cn": "zh-Hans",
    "zh-sg": "zh-Hans",
}

_LOCALES_DIR = Path(__file__).parent.parent / "locales"

_translations: dict[str, dict[str, str]] = {}
_translations_lock = threading.Lock()
_strict_translation_settings: ContextVar[tuple[str, bool] | None] = ContextVar(
    "strict_translation_settings", default=None
)
_strict_translation_diagnostics: ContextVar[tuple[dict[str, str], ...]] = ContextVar(
    "strict_translation_diagnostics", default=()
)


class MissingSystemTranslationError(LookupError):
    """Raised only inside explicit strict test mode when a system key would fall back."""


@contextmanager
def strict_translation_test_mode(locale: str = "ru", *, system_owned: bool = True) -> Iterator[None]:
    """Make system-owned fallback blocking for an integration-test context.

    Normal runtime compatibility fallback is unchanged. Tests must opt in
    explicitly, which keeps user/provider/diagnostic content outside the
    system-translation contract.
    """
    parent_settings = _strict_translation_settings.get()
    settings_token = _strict_translation_settings.set((locale, system_owned))
    diagnostics_token = _strict_translation_diagnostics.set(())
    try:
        yield
    finally:
        context_diagnostics = _strict_translation_diagnostics.get()
        _strict_translation_diagnostics.reset(diagnostics_token)
        if parent_settings is None:
            merged_diagnostics = context_diagnostics
        else:
            parent_diagnostics = _strict_translation_diagnostics.get()
            merged_diagnostics = (*parent_diagnostics, *context_diagnostics)
        unique_diagnostics: list[dict[str, str]] = []
        seen_diagnostics: set[tuple[str, str, str]] = set()
        for item in merged_diagnostics:
            identity = (item["locale"], item["key"], item["fallback"])
            if identity not in seen_diagnostics:
                seen_diagnostics.add(identity)
                unique_diagnostics.append(item)
        _strict_translation_diagnostics.set(tuple(unique_diagnostics))
        _strict_translation_settings.reset(settings_token)


def get_strict_translation_diagnostics() -> list[dict[str, str]]:
    """Return a copy of fallback diagnostics from the latest strict test context."""
    diagnostics = _strict_translation_diagnostics.get()
    return [dict(item) for item in diagnostics]


def _load_translations() -> None:
    """Load all *.json files from the locales directory into memory.

    Uses double-checked locking: the fast path (already loaded) skips the lock,
    the slow path (first load) acquires it and re-checks to avoid duplicate work
    from concurrent callers at cold start.
    """
    with _translations_lock:
        if _translations:
            return
        if not _LOCALES_DIR.exists():
            return
        for path in _LOCALES_DIR.glob("*.json"):
            locale_code = path.stem  # "en", "fr", "zh-Hans", etc.
            try:
                with path.open(encoding="utf-8") as f:
                    _translations[locale_code] = json.load(f)
            except (OSError, json.JSONDecodeError) as exc:
                logger.warning("Failed to load locale %s: %s", locale_code, exc)


def translate(key: str, locale: str, default: str) -> str:
    """Return the translated string for key in locale, with fallback.

    Fallback chain:
      1. Requested locale dict
      2. English ("en") dict
      3. Raw default string (original English value from API cache)
    """
    if not _translations:
        _load_translations()

    result = _translations.get(locale, {}).get(key)
    if result is not None:
        return result

    strict_settings = _strict_translation_settings.get()
    if strict_settings is not None:
        strict_locale, system_owned = strict_settings
        requested_base = locale.lower().split("-")[0]
        strict_base = strict_locale.lower().split("-")[0]
        if system_owned and requested_base == strict_base:
            fallback = "en" if key in _translations.get("en", {}) else "default"
            diagnostic = {"locale": locale, "key": key, "fallback": fallback}
            diagnostics = _strict_translation_diagnostics.get()
            if diagnostic not in diagnostics:
                _strict_translation_diagnostics.set((*diagnostics, diagnostic))
            msg = f"Strict {strict_locale} translation is missing system-owned key {key!r}; fallback={fallback}"
            raise MissingSystemTranslationError(msg)

    result = _translations.get("en", {}).get(key)
    if result is not None:
        return result

    return default


def get_supported_locales() -> list[str]:
    """Return list of locale codes that have a locale file loaded."""
    if not _translations:
        _load_translations()
    return list(_translations.keys())


def _component_translation_key(
    norm: str,
    field_name: str,
    field_path: str,
    value: str,
) -> str:
    """Prefer a field-specific key and fall back to a declared dynamic key."""
    if not _translations:
        _load_translations()
    specific_key = component_field_key(norm, f"inputs.{field_name}.{field_path}", value)
    if specific_key in _translations.get("en", {}):
        return specific_key
    return component_field_key(norm, component_dynamic_field_path(field_path), value)


def _dynamic_template_parameters(source_template: str, value: str) -> dict[str, str] | None:
    """Match a runtime value against a declarative dynamic source template."""
    pattern_parts: list[str] = []
    fields: set[str] = set()
    try:
        parsed = tuple(string.Formatter().parse(source_template))
    except ValueError:
        return None
    if not any(field_name is not None for _literal, field_name, _spec, _conversion in parsed):
        return None
    for literal, field_name, _format_spec, _conversion in parsed:
        pattern_parts.append(re.escape(literal))
        if field_name is None:
            continue
        if not field_name.isidentifier():
            return None
        if field_name in fields:
            pattern_parts.append(f"(?P={field_name})")
        else:
            fields.add(field_name)
            pattern_parts.append(f"(?P<{field_name}>.*?)")
    match = re.fullmatch("".join(pattern_parts), value, flags=re.DOTALL)
    return match.groupdict() if match is not None else None


def _translate_dynamic_template(norm: str, dynamic_path: str, locale: str, default: str) -> str | None:
    """Translate a declared template while preserving its runtime parameters."""
    if not _translations:
        _load_translations()
    prefix = f"components.{norm}.{dynamic_path}."
    for key, source_template in _translations.get(DEFAULT_LOCALE, {}).items():
        if not key.startswith(prefix):
            continue
        parameters = _dynamic_template_parameters(source_template, default)
        if parameters is None:
            continue
        translated_template = translate(key, locale, source_template)
        try:
            return translated_template.format_map(parameters)
        except (KeyError, ValueError):
            logger.warning("Invalid dynamic component translation template for key %s", key)
            return default
    return None


def _extension_component_norm(comp_name: str, node: dict[str, Any]) -> str:
    """Resolve the class segment from ``ext:<bundle>:<Class>@<slot>``."""
    identifier = node.get("namespaced_id")
    if not isinstance(identifier, str):
        identifier = comp_name
    if identifier.startswith("ext:") and ":" in identifier and "@" in identifier:
        class_segment = identifier.split(":", maxsplit=2)[-1].rsplit("@", maxsplit=1)[0]
        if class_segment:
            return normalize_component_key(class_segment)
    return normalize_component_key(comp_name)


def _translate_component_field(
    node: dict[str, Any],
    norm: str,
    field_path: str,
    locale: str,
    default: str,
    *,
    dynamic_path: str | None = None,
) -> str:
    """Resolve a core or isolated extension component presentation value."""
    extension_id = node.get("extension")
    if isinstance(extension_id, str):
        bundle = node.get("extension_locale_bundle")
        if not isinstance(bundle, dict) or bundle.get("namespace") != extension_id:
            return default
        locales = bundle.get("locales")
        if not isinstance(locales, dict):
            return default
        requested = locales.get(locale)
        english = locales.get(DEFAULT_LOCALE)
        requested_catalog = requested if isinstance(requested, dict) else {}
        english_catalog = english if isinstance(english, dict) else {}
        hashed_key = component_field_key(norm, field_path, default)
        stable_key = f"components.{norm}.{field_path}"
        for catalog in (requested_catalog, english_catalog):
            for key in (hashed_key, stable_key):
                value = catalog.get(key)
                if isinstance(value, str) and value:
                    return value
        return default

    key = component_field_key(norm, field_path, default)
    if dynamic_path is not None:
        if not _translations:
            _load_translations()
        if key not in _translations.get(DEFAULT_LOCALE, {}):
            key = component_field_key(norm, dynamic_path, default)
            if key not in _translations.get(DEFAULT_LOCALE, {}):
                templated = _translate_dynamic_template(norm, dynamic_path, locale, default)
                if templated is not None:
                    return templated
    return translate(key, locale, default)


def _translate_nested_input_presentation(
    value: Any,
    translate_leaf,
) -> Any:
    """Copy nested metadata while translating only explicit presentation leaves."""
    if isinstance(value, list):
        return [_translate_nested_input_presentation(item, translate_leaf) for item in value]
    if not isinstance(value, dict):
        return value

    translated: dict[str, Any] = {}
    for key, item in value.items():
        if key in COMPONENT_NESTED_TEXT_KEYS and isinstance(item, str) and item:
            translated[key] = translate_leaf(key, item)
        else:
            translated[key] = _translate_nested_input_presentation(item, translate_leaf)
    return translated


def normalize_supported_locale(locale: str | None) -> str | None:
    """Return the canonical supported locale for a language tag, or ``None``.

    User preferences and request headers share this normalizer so their aliases,
    region handling, and case handling cannot drift. Chinese maps to the shipped
    ``zh-Hans`` catalog; other supported region tags map to their base language.
    """
    if not isinstance(locale, str):
        return None

    normalized = locale.strip().replace("_", "-").casefold()
    if not normalized or normalized == "*":
        return None

    if normalized in _LOCALE_ALIASES:
        return _LOCALE_ALIASES[normalized]
    if normalized.startswith("zh-hans-"):
        return "zh-Hans"
    if normalized in _SUPPORTED_LOCALE_LOOKUP:
        return _SUPPORTED_LOCALE_LOOKUP[normalized]

    base_language = normalized.split("-", maxsplit=1)[0]
    return _SUPPORTED_LOCALE_LOOKUP.get(base_language)


def resolve_accept_language(accept_language: str | None) -> str:
    """Resolve a weighted ``Accept-Language`` header to a supported locale.

    Unsupported, wildcard, zero-quality, and malformed entries are ignored.
    Equal-quality entries preserve header order. If no supported entry remains,
    the backend's safe default locale is returned.
    """
    if not accept_language:
        return DEFAULT_LOCALE

    best_locale: str | None = None
    best_quality = -1.0

    for entry in accept_language.split(","):
        parts = [part.strip() for part in entry.split(";")]
        locale = normalize_supported_locale(parts[0])
        if locale is None:
            continue

        quality = 1.0
        malformed_quality = False
        for parameter in parts[1:]:
            name, separator, raw_value = parameter.partition("=")
            if name.strip().casefold() != "q":
                continue
            if not separator:
                malformed_quality = True
                break
            try:
                quality = float(raw_value.strip())
            except ValueError:
                malformed_quality = True
                break
            if not 0.0 <= quality <= 1.0:
                malformed_quality = True
                break

        if malformed_quality or quality == 0.0:
            continue
        if quality > best_quality:
            best_locale = locale
            best_quality = quality

    return best_locale or DEFAULT_LOCALE


def translate_starter_flows(flow_reads: list, locale: str) -> list:
    """Return copies of flow_reads with name/description translated for locale."""
    result = []
    for flow in flow_reads:
        key = _safe_flow_key(flow.name or "")
        flow_copy = copy.copy(flow)
        flow_copy.name_key = key
        flow_copy.name = translate(f"starter_flows.{key}.name", locale, flow.name or "")
        flow_copy.description = (
            translate(f"starter_flows.{key}.description", locale, flow.description or "") or flow_copy.description
        )
        result.append(flow_copy)
    return result


def translate_flow_notes(nodes: list[dict], locale: str) -> list[dict]:
    """Return a copy of nodes with note node descriptions translated for locale.

    Reads i18n_key from node.data.node (baked in by bake_note_keys.py) and
    substitutes the translated markdown. Nodes without i18n_key are passed through
    unchanged. Never mutates the input list.
    """
    result = []
    for node in nodes:
        if node.get("type") == "noteNode":
            i18n_key = node.get("data", {}).get("node", {}).get("i18n_key")
            if i18n_key:
                translated_node = copy.deepcopy(node)
                description = translated_node["data"]["node"].get("description", "")
                translated_node["data"]["node"]["description"] = translate(i18n_key, locale, description)
                result.append(translated_node)
                continue
        result.append(node)
    return result


def _component_known_locales(node: dict[str, Any]) -> tuple[str, ...]:
    """Return catalog locales available to a core or isolated extension node."""
    extension_id = node.get("extension")
    if not isinstance(extension_id, str):
        return tuple(_translations)

    bundle = node.get("extension_locale_bundle")
    if not isinstance(bundle, dict) or bundle.get("namespace") != extension_id:
        return ()
    locales = bundle.get("locales")
    if not isinstance(locales, dict):
        return ()
    return tuple(locale for locale, catalog in locales.items() if isinstance(locale, str) and isinstance(catalog, dict))


def _known_component_field_values(
    node: dict[str, Any],
    norm: str,
    field_path: str,
    default: str,
    *,
    dynamic_path: str | None = None,
) -> set[str]:
    """Collect every value a presentation field may receive from its allowed catalogs."""
    values = {default}
    for locale in _component_known_locales(node):
        translated = _translate_component_field(
            node,
            norm,
            field_path,
            locale,
            default,
            dynamic_path=dynamic_path,
        )
        if translated:
            values.add(translated)
    return values


def _nested_presentation_sources(
    value: Any,
    path: str,
) -> Iterator[tuple[str, str, str]]:
    """Yield frontend-flat path, leaf key, and source for nested presentation strings."""
    if isinstance(value, list):
        for item in value:
            yield from _nested_presentation_sources(item, path)
        return
    if not isinstance(value, dict):
        return

    for key, item in value.items():
        item_path = f"{path}.{key}" if path else key
        if key in COMPONENT_NESTED_TEXT_KEYS and isinstance(item, str) and item:
            yield item_path, key, item
        else:
            yield from _nested_presentation_sources(item, item_path)


def build_component_display_names(all_types_en: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Build the set of all known translations for display_name and description per component.

    Also includes all known translations for every explicit input presentation
    field, nested metadata leaf, option label, and each output's display_name/info.
    The frontend uses these sets to distinguish translated defaults from
    user-authored overrides while switching locales.

    Iterates every catalog allowed for the node. Core components use the core
    catalogs; extension components use only their manifest-provided locale
    bundle. The source value is always included as the baseline.

    Returns a dict keyed by normalized component key (e.g. "textinput") where each value is:
        {
            "display_name": [...all locale values...],
            "description": [...all locale values...],
            "fields": {
                "field_name": {
                    "display_name": [...all locale values...],
                    "presentation": {
                        "info": [...all locale values...],
                        "options_metadata.label": [...all locale values...],
                        "dialog_inputs.title": [...all locale values...]
                    }
                }
            },
            "outputs": {
                "output_name": {
                    "display_name": [...all locale values...],
                    "info": [...all locale values...]
                }
            }
        }
    """
    if not _translations:
        _load_translations()

    result: dict[str, dict[str, Any]] = {}

    for components in all_types_en.values():
        for name, data in components.items():
            result_norm = normalize_component_key(name)
            lookup_norm = (
                _extension_component_norm(name, data) if isinstance(data.get("extension"), str) else result_norm
            )
            if result_norm not in result:
                result[result_norm] = {
                    "display_name": set(),
                    "description": set(),
                    "fields": {},
                    "outputs": {},
                }

            dn_en = data.get("display_name", "")
            desc_en = data.get("description", "")

            if dn_en:
                result[result_norm]["display_name"].update(
                    _known_component_field_values(data, lookup_norm, "display_name", dn_en)
                )

            if desc_en:
                result[result_norm]["description"].update(
                    _known_component_field_values(data, lookup_norm, "description", desc_en)
                )

            # Collect all known direct and nested presentation values.  Paths in
            # ``presentation`` mirror the frontend recursion exactly (arrays do
            # not add an index), so existing-canvas guards can compare values.
            template = data.get("template", {})
            for field_name, field_data in template.items():
                if not isinstance(field_data, dict):
                    continue
                known_field = result[result_norm]["fields"].setdefault(
                    field_name,
                    {"display_name": set(), "presentation": {}},
                )
                for presentation_field in COMPONENT_INPUT_TEXT_FIELDS:
                    source_value = field_data.get(presentation_field)
                    if not isinstance(source_value, str) or not source_value:
                        continue
                    known_values = _known_component_field_values(
                        data,
                        lookup_norm,
                        f"inputs.{field_name}.{presentation_field}",
                        source_value,
                        dynamic_path=component_dynamic_field_path(presentation_field),
                    )
                    known_field["presentation"].setdefault(presentation_field, set()).update(known_values)
                    if presentation_field == "display_name":
                        known_field["display_name"].update(known_values)

                options = field_data.get("options")
                raw_metadata = field_data.get("options_metadata")
                metadata = raw_metadata if isinstance(raw_metadata, list) else []
                if isinstance(options, list):
                    for index, option in enumerate(options):
                        existing = (
                            metadata[index] if index < len(metadata) and isinstance(metadata[index], dict) else {}
                        )
                        label = component_option_label(option, existing)
                        if label is not None:
                            known_field["presentation"].setdefault("options_metadata.label", set()).update(
                                _known_component_field_values(
                                    data,
                                    lookup_norm,
                                    f"inputs.{field_name}.options.label",
                                    label,
                                    dynamic_path=component_dynamic_field_path("label"),
                                )
                            )
                        for flat_path, leaf, source_value in _nested_presentation_sources(
                            existing,
                            "options_metadata",
                        ):
                            if flat_path == "options_metadata.label":
                                continue
                            known_field["presentation"].setdefault(flat_path, set()).update(
                                _known_component_field_values(
                                    data,
                                    lookup_norm,
                                    f"inputs.{field_name}.nested.{leaf}",
                                    source_value,
                                    dynamic_path=component_dynamic_field_path(leaf),
                                )
                            )

                for nested_field in ("dialog_inputs", "external_options", "button_metadata"):
                    for flat_path, leaf, source_value in _nested_presentation_sources(
                        field_data.get(nested_field),
                        nested_field,
                    ):
                        known_field["presentation"].setdefault(flat_path, set()).update(
                            _known_component_field_values(
                                data,
                                lookup_norm,
                                f"inputs.{field_name}.nested.{leaf}",
                                source_value,
                                dynamic_path=component_dynamic_field_path(leaf),
                            )
                        )

            # Output matching is always by the stable machine-facing ``name``.
            # Collecting every known localized presentation value lets the
            # frontend translate defaults without overwriting custom labels.
            outputs = data.get("outputs", [])
            if isinstance(outputs, list):
                for output in outputs:
                    if not isinstance(output, dict):
                        continue
                    output_name = output.get("name", "")
                    if not output_name:
                        continue
                    output_norm = "_toolmode" if output_name == TOOL_OUTPUT_NAME else lookup_norm
                    known_output = result[result_norm]["outputs"].setdefault(
                        output_name,
                        {"display_name": set(), "info": set()},
                    )
                    for output_field in ("display_name", "info"):
                        english_value = output.get(output_field, "")
                        if not english_value:
                            continue
                        known_output[output_field].update(
                            _known_component_field_values(
                                data,
                                output_norm,
                                f"outputs.{output_name}.{output_field}",
                                english_value,
                            )
                        )

    return {
        k: {
            "display_name": list(v["display_name"]),
            "description": list(v["description"]),
            "fields": {
                field_name: {
                    "display_name": list(field_data["display_name"]),
                    "presentation": {
                        path: list(values) for path, values in field_data["presentation"].items() if values
                    },
                }
                for field_name, field_data in v["fields"].items()
            },
            "outputs": {
                output_name: {field_name: list(values) for field_name, values in output_fields.items() if values}
                for output_name, output_fields in v["outputs"].items()
            },
        }
        for k, v in result.items()
    }


def translate_component_node(comp_name: str, node: dict[str, Any], locale: str) -> dict[str, Any]:
    """Translate display strings in a single component's frontend node dict.

    Covers three tiers:
      - component-level display_name and description
      - template field display_name, info, placeholder
      - output display_name and info

    Translation is idempotent: if a field already holds a translated value its
    hash won't match the English key, so translate() falls back to the value
    unchanged.  Never mutates the input dict.
    """
    translated: dict[str, Any] = {**node}
    norm = (
        _extension_component_norm(comp_name, node)
        if isinstance(node.get("extension"), str)
        else normalize_component_key(comp_name)
    )

    # Tier 1 — component-level strings
    for field in ("display_name", "description"):
        val = node.get(field, "")
        if val:
            translated[field] = _translate_component_field(node, norm, field, locale, val)

    # Tier 2 — template field presentation. Raw values/options stay stable;
    # localized option labels travel in aligned metadata entries.
    if "template" in node and isinstance(node["template"], dict):
        translated["template"] = {**node["template"]}
        for field_name, field in node["template"].items():
            if isinstance(field, dict):
                field_updates: dict[str, Any] = {}
                for sub in COMPONENT_INPUT_TEXT_FIELDS:
                    val = field.get(sub, "")
                    if val:
                        field_updates[sub] = _translate_component_field(
                            node,
                            norm,
                            f"inputs.{field_name}.{sub}",
                            locale,
                            val,
                            dynamic_path=component_dynamic_field_path(sub),
                        )

                options = field.get("options")
                if isinstance(options, list) and options:
                    raw_metadata = field.get("options_metadata")
                    metadata = raw_metadata if isinstance(raw_metadata, list) else []
                    localized_metadata: list[dict[str, Any]] = []
                    for index, option in enumerate(options):
                        existing = (
                            metadata[index] if index < len(metadata) and isinstance(metadata[index], dict) else {}
                        )
                        localized_entry = _translate_nested_input_presentation(
                            existing,
                            lambda leaf, item, current_field=field_name: _translate_component_field(
                                node,
                                norm,
                                f"inputs.{current_field}.nested.{leaf}",
                                locale,
                                item,
                                dynamic_path=component_dynamic_field_path(leaf),
                            ),
                        )
                        label = component_option_label(option, existing)
                        if label is not None:
                            localized_entry = {
                                **localized_entry,
                                "value": existing.get("value", option) if isinstance(option, dict) else option,
                                "label": _translate_component_field(
                                    node,
                                    norm,
                                    f"inputs.{field_name}.options.label",
                                    locale,
                                    label,
                                    dynamic_path=component_dynamic_field_path("label"),
                                ),
                            }
                        localized_metadata.append(localized_entry)
                    field_updates["options_metadata"] = localized_metadata

                for nested_field in ("dialog_inputs", "external_options", "button_metadata"):
                    nested_value = field.get(nested_field)
                    if isinstance(nested_value, (dict, list)):
                        field_updates[nested_field] = _translate_nested_input_presentation(
                            nested_value,
                            lambda leaf, item, current_field=field_name: _translate_component_field(
                                node,
                                norm,
                                f"inputs.{current_field}.nested.{leaf}",
                                locale,
                                item,
                                dynamic_path=component_dynamic_field_path(leaf),
                            ),
                        )
                if field_updates:
                    translated["template"][field_name] = {**field, **field_updates}

    # Tier 3 — output display_name and info
    if "outputs" in node and isinstance(node["outputs"], list):
        translated["outputs"] = []
        for out in node["outputs"]:
            if not isinstance(out, dict):
                translated["outputs"].append(out)
                continue
            out_name = out.get("name", "")
            # The tool-mode output is injected dynamically (not a static class output), so
            # it's stored under the sentinel norm "_toolmode" shared across all components.
            out_norm = "_toolmode" if out_name == TOOL_OUTPUT_NAME else norm
            out_updates = {}
            for sub in ("display_name", "info"):
                val = out.get(sub, "")
                if val:
                    out_updates[sub] = _translate_component_field(
                        node,
                        out_norm,
                        f"outputs.{out_name}.{sub}",
                        locale,
                        val,
                    )
            translated["outputs"].append({**out, **out_updates} if out_updates else out)

    return translated


def is_user_custom_component_node(node: dict[str, Any]) -> bool:
    """Return whether a node is user-authored and outside the core i18n contract."""
    metadata = node.get("metadata")
    if not isinstance(metadata, dict):
        return False
    module_name = metadata.get("module")
    return isinstance(module_name, str) and (
        module_name == "custom_components" or module_name.startswith("custom_components.")
    )


def translate_component_dict(all_types: dict[str, Any], locale: str) -> dict[str, Any]:
    """Return a copy of all_types with display_names substituted for locale.

    Never mutates the original dict (which is the shared component cache).
    Translates:
      - component-level display_name and description
      - template field display_names, info, and placeholders (inputs)
      - output display_names and info

    Keys are hybrid: human-readable path + content hash suffix.
    See module docstring for key format details.

    Args:
        all_types: The cached component dict from get_and_cache_all_types_dict()
        locale: Normalised locale code e.g. "fr", "zh-Hans"

    Returns:
        New dict with translated strings; untranslated keys fall back to English.
    """
    result: dict[str, Any] = {}
    for category, components in all_types.items():
        result[category] = {}
        for name, data in components.items():
            result[category][name] = (
                data if is_user_custom_component_node(data) else translate_component_node(name, data, locale)
            )
    return result
