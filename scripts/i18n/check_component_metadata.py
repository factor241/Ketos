#!/usr/bin/env python3
"""Fail closed when built-in component presentation metadata escapes i18n."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any, NamedTuple

from ketos.utils.i18n_keys import (
    COMPONENT_INPUT_TEXT_FIELDS,
    COMPONENT_NESTED_TEXT_KEYS,
    component_field_key,
    component_option_label,
    normalize_component_key,
)

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INDEX = ROOT / "src/kfx/src/kfx/_assets/component_index.json"
DEFAULT_CATALOG = ROOT / "src/backend/base/ketos/locales/en.json"
RUNTIME_EXTRACTOR = ROOT / "scripts/gp/extract_backend_strings.py"

PRESENTATION_SUFFIXES = ("_label", "_text", "_tooltip")
PRESENTATION_NAMES = frozenset(
    {"description", "display_name", "info", "label", "placeholder", "text", "title", "tooltip"}
)
INDEX_ENTRY_LENGTH = 2


class ComponentMetadataAudit(NamedTuple):
    component_count: int
    expected_key_count: int
    missing_keys: set[str]
    value_mismatch: set[str]
    unknown_presentation_fields: set[str]
    index_count_mismatch: bool

    @property
    def ok(self) -> bool:
        return not any(
            (
                self.missing_keys,
                self.value_mismatch,
                self.unknown_presentation_fields,
                self.index_count_mismatch,
            )
        )


def _nested_presentation_strings(value: Any, *, skip_keys: frozenset[str] = frozenset()):
    if isinstance(value, list):
        for item in value:
            yield from _nested_presentation_strings(item, skip_keys=skip_keys)
        return
    if not isinstance(value, dict):
        return
    for key, item in value.items():
        if key in COMPONENT_NESTED_TEXT_KEYS and key not in skip_keys and isinstance(item, str) and item:
            yield key, item
        else:
            yield from _nested_presentation_strings(item, skip_keys=skip_keys)


def _is_presentation_candidate(field_name: str) -> bool:
    return field_name in PRESENTATION_NAMES or field_name.endswith(PRESENTATION_SUFFIXES)


def expected_component_index_catalog(index: dict[str, Any]) -> tuple[dict[str, str], set[str], set[str]]:
    """Return expected static catalog entries, component ids, and unknown UI fields."""
    expected: dict[str, str] = {}
    components: set[str] = set()
    unknown_fields: set[str] = set()
    allowed_input_fields = frozenset(COMPONENT_INPUT_TEXT_FIELDS)

    entries = index.get("entries")
    if not isinstance(entries, list):
        msg = "component index entries must be a list"
        raise TypeError(msg)

    for entry in entries:
        if not isinstance(entry, list) or len(entry) != INDEX_ENTRY_LENGTH or not isinstance(entry[1], dict):
            msg = "component index entry must be [category, components]"
            raise TypeError(msg)
        for component_name, node in entry[1].items():
            if not isinstance(component_name, str) or not isinstance(node, dict):
                msg = "component index contains an invalid component entry"
                raise TypeError(msg)
            components.add(component_name)
            norm = normalize_component_key(component_name)

            for field_name in ("display_name", "description"):
                value = node.get(field_name)
                if isinstance(value, str) and value:
                    expected[component_field_key(norm, field_name, value)] = value

            template = node.get("template", {})
            if isinstance(template, dict):
                for input_name, field in template.items():
                    if not isinstance(field, dict):
                        continue
                    for field_name, value in field.items():
                        if (
                            isinstance(value, str)
                            and value
                            and _is_presentation_candidate(field_name)
                            and field_name not in allowed_input_fields
                        ):
                            unknown_fields.add(field_name)
                    for field_name in COMPONENT_INPUT_TEXT_FIELDS:
                        value = field.get(field_name)
                        if isinstance(value, str) and value:
                            path = f"inputs.{input_name}.{field_name}"
                            expected[component_field_key(norm, path, value)] = value

                    options = field.get("options")
                    metadata = field.get("options_metadata")
                    metadata_list = metadata if isinstance(metadata, list) else []
                    if isinstance(options, list):
                        for option_index, option in enumerate(options):
                            existing = (
                                metadata_list[option_index]
                                if option_index < len(metadata_list) and isinstance(metadata_list[option_index], dict)
                                else {}
                            )
                            label = component_option_label(option, existing)
                            if label is None:
                                continue
                            path = f"inputs.{input_name}.options.label"
                            expected[component_field_key(norm, path, label)] = label

                    nested_sources = (
                        (field.get("dialog_inputs"), frozenset()),
                        (field.get("external_options"), frozenset()),
                        (field.get("button_metadata"), frozenset()),
                        (metadata, frozenset({"label"})),
                    )
                    for nested, skipped_keys in nested_sources:
                        for leaf_name, value in _nested_presentation_strings(nested, skip_keys=skipped_keys):
                            path = f"inputs.{input_name}.nested.{leaf_name}"
                            expected[component_field_key(norm, path, value)] = value

            outputs = node.get("outputs", [])
            if isinstance(outputs, list):
                for output in outputs:
                    if not isinstance(output, dict):
                        continue
                    output_name = output.get("name")
                    if not isinstance(output_name, str) or not output_name:
                        continue
                    for field_name in ("display_name", "info"):
                        value = output.get(field_name)
                        if isinstance(value, str) and value:
                            path = f"outputs.{output_name}.{field_name}"
                            expected[component_field_key(norm, path, value)] = value

    return expected, components, unknown_fields


def audit_component_index(index: dict[str, Any], catalog: dict[str, str]) -> ComponentMetadataAudit:
    expected, components, unknown_fields = expected_component_index_catalog(index)
    common = set(expected) & set(catalog)
    declared_count = index.get("metadata", {}).get("num_components")
    return ComponentMetadataAudit(
        component_count=len(components),
        expected_key_count=len(expected),
        missing_keys=set(expected) - set(catalog),
        value_mismatch={key for key in common if expected[key] != catalog[key]},
        unknown_presentation_fields=unknown_fields,
        index_count_mismatch=not isinstance(declared_count, int) or declared_count != len(components),
    )


def _load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        msg = f"{path}: expected a JSON object"
        raise TypeError(msg)
    return payload


def _runtime_catalog() -> dict[str, str]:
    spec = importlib.util.spec_from_file_location("extract_backend_strings_for_component_audit", RUNTIME_EXTRACTOR)
    if spec is None or spec.loader is None:
        msg = f"Could not load runtime extractor at {RUNTIME_EXTRACTOR}"
        raise RuntimeError(msg)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.collect_strings()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", type=Path, default=DEFAULT_INDEX)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--skip-runtime", action="store_true")
    args = parser.parse_args()

    index = _load_json_object(args.index)
    catalog_payload = _load_json_object(args.catalog)
    catalog = {key: value for key, value in catalog_payload.items() if isinstance(key, str) and isinstance(value, str)}
    if len(catalog) != len(catalog_payload):
        print("FAIL: English catalog must be a flat string map", file=sys.stderr)
        raise SystemExit(1)

    audit = audit_component_index(index, catalog)
    failures: list[str] = []
    if audit.missing_keys:
        failures.append(f"index metadata missing from catalog: {len(audit.missing_keys)}")
    if audit.value_mismatch:
        failures.append(f"index/catalog value mismatch: {len(audit.value_mismatch)}")
    if audit.unknown_presentation_fields:
        failures.append("unregistered presentation fields: " + ", ".join(sorted(audit.unknown_presentation_fields)))
    if audit.index_count_mismatch:
        failures.append("component index metadata count does not match its entries")

    dynamic_count = 0
    if not args.skip_runtime:
        runtime = _runtime_catalog()
        runtime_missing = set(runtime) - set(catalog)
        runtime_stale = set(catalog) - set(runtime)
        runtime_mismatch = {key for key in set(runtime) & set(catalog) if runtime[key] != catalog[key]}
        dynamic_count = sum(".dynamic." in key for key in runtime)
        if runtime_missing:
            failures.append(f"runtime metadata missing from catalog: {len(runtime_missing)}")
        if runtime_stale:
            failures.append(f"stale catalog keys: {len(runtime_stale)}")
        if runtime_mismatch:
            failures.append(f"runtime/catalog value mismatch: {len(runtime_mismatch)}")

    if failures:
        for failure in failures:
            print(f"FAIL: {failure}", file=sys.stderr)
        raise SystemExit(1)

    print(
        "PASS: "
        f"components={audit.component_count}, static_keys={audit.expected_key_count}, "
        f"dynamic_keys={dynamic_count}, skipped_imports=0"
    )


if __name__ == "__main__":
    main()
