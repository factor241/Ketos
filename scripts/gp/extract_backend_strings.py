"""Extract translatable strings from Langflow component classes.

Walks the lfx.components package, reads class-level display_name/description
and field-level display_names directly from component class definitions
(no running server needed), and writes a flat GP-compatible JSON file.

Output format — hybrid key: human-readable path + content-hash suffix:
    "components.chatinput.display_name.a1b2c3d4": "Chat Input"
    "components.chatinput.description.f9e8d7c6": "Get chat inputs from the Playground."
    "components.chatinput.inputs.input_value.display_name.12345678": "Input Text"
    "components.chatinput.outputs.message.display_name.abcdef01": "Chat Message"

The norm_name is the component registry key lowercased with spaces removed.
The 8-char suffix is SHA-256(english_value)[:8].  When an English string
changes, its hash changes, the old key is orphaned, and GP issues a fresh
translation for the new key on the next upload/download cycle.

Usage:
    # From repo root with the backend virtualenv active:
    python scripts/gp/extract_backend_strings.py

    # Check only (exit 1 if en.json would change — use in CI):
    python scripts/gp/extract_backend_strings.py --check
"""

from __future__ import annotations

import argparse
import ast
import importlib
import inspect
import json
import pkgutil
import sys
import textwrap
from pathlib import Path
from typing import Any, NamedTuple

ROOT = Path(__file__).resolve().parents[2]
OUTPUT_PATH = ROOT / "src/backend/base/langflow/locales/en.json"
STARTER_PROJECTS_DIR = ROOT / "src/backend/base/langflow/initial_setup/starter_projects"
COMPONENT_INDEX_PATH = ROOT / "src/lfx/src/lfx/_assets/component_index.json"
COMPONENT_METADATA_CHECKER = ROOT / "scripts/i18n/check_component_metadata.py"
MIN_COMPONENT_KEY_SEGMENTS = 3


class SkippedImport(NamedTuple):
    """A component module that could not be imported during extraction."""

    module: str
    error_type: str
    message: str


class SkippedImportsError(RuntimeError):
    """Raised when extraction would otherwise silently omit component metadata."""

    def __init__(self, skipped_imports: list[SkippedImport], partial_strings: dict[str, str] | None = None) -> None:
        super().__init__(f"{len(skipped_imports)} component module import(s) failed")
        self.skipped_imports = tuple(skipped_imports)
        self.partial_strings = dict(partial_strings or {})


class DynamicPresentationViolation(NamedTuple):
    """A runtime presentation expression lacking an explicit i18n policy."""

    component: str
    module: str
    field: str
    expression: str


class UnregisteredDynamicPresentationError(RuntimeError):
    """Raised when a built-in runtime UI expression is neither translated nor verbatim."""

    def __init__(
        self,
        violations: list[DynamicPresentationViolation],
        partial_strings: dict[str, str] | None = None,
    ) -> None:
        super().__init__(f"{len(violations)} dynamic presentation expression(s) lack an i18n policy")
        self.violations = tuple(violations)
        self.partial_strings = dict(partial_strings or {})


def count_component_keys(strings: dict[str, str]) -> int:
    """Count component identities in hybrid-hash catalog keys.

    A component-level key ends in a content hash, so checking whether a key
    literally ends in ``.display_name`` always reports zero. The stable
    normalized component identity is instead the second path segment.
    """
    return len(
        {
            parts[1]
            for key in strings
            if (parts := key.split("."))[0] == "components"
            and len(parts) >= MIN_COMPONENT_KEY_SEGMENTS
            and parts[1] != "_toolmode"
        }
    )


def _nested_presentation_strings(
    value: Any,
    *,
    leaf_keys: frozenset[str],
    skip_keys: frozenset[str] = frozenset(),
):
    """Yield explicit human-readable leaves without treating raw values as labels."""
    if isinstance(value, list):
        for item in value:
            yield from _nested_presentation_strings(item, leaf_keys=leaf_keys, skip_keys=skip_keys)
        return
    if not isinstance(value, dict):
        serializer = getattr(value, "to_dict", None)
        if callable(serializer):
            try:
                serialized = serializer()
            except (TypeError, ValueError):
                return
            yield from _nested_presentation_strings(serialized, leaf_keys=leaf_keys, skip_keys=skip_keys)
            return
        model_dump = getattr(value, "model_dump", None)
        if callable(model_dump):
            try:
                serialized = model_dump(by_alias=True, exclude_none=True)
            except (TypeError, ValueError):
                return
            yield from _nested_presentation_strings(serialized, leaf_keys=leaf_keys, skip_keys=skip_keys)
        return
    for key, item in value.items():
        if key in leaf_keys and key not in skip_keys and isinstance(item, str) and item:
            yield key, item
        else:
            yield from _nested_presentation_strings(item, leaf_keys=leaf_keys, skip_keys=skip_keys)


def _dynamic_presentation_nodes(tree: ast.AST, presentation_fields: frozenset[str]):
    """Yield presentation field/value AST pairs from dynamic config construction."""
    seen: set[tuple[str, int]] = set()

    def emit(field_name: object, value_node: ast.AST):
        if not isinstance(field_name, str) or field_name not in presentation_fields:
            return
        identity = (field_name, id(value_node))
        if identity not in seen:
            seen.add(identity)
            yield field_name, value_node

    for node in ast.walk(tree):
        if isinstance(node, ast.Dict):
            for key_node, value_node in zip(node.keys, node.values, strict=False):
                key = key_node.value if isinstance(key_node, ast.Constant) else None
                yield from emit(key, value_node)
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else (node.target,)
            for target in targets:
                if not isinstance(target, ast.Subscript):
                    continue
                key_node = target.slice
                key = key_node.value if isinstance(key_node, ast.Constant) else None
                yield from emit(key, node.value)
        elif isinstance(node, ast.Call):
            for keyword in node.keywords:
                yield from emit(keyword.arg, keyword.value)


def _dynamic_method_tree(component_class: type) -> ast.AST | None:
    method = getattr(component_class, "update_build_config", None)
    if method is None:
        return None
    try:
        return ast.parse(textwrap.dedent(inspect.getsource(method)))
    except (OSError, TypeError, IndentationError, SyntaxError):
        return None


def _declared_dynamic_fields(component_class: type) -> frozenset[str]:
    declared = getattr(component_class, "dynamic_i18n", None)
    if not isinstance(declared, dict):
        return frozenset()
    return frozenset(field_name.rsplit(".", maxsplit=1)[-1] for field_name in declared if isinstance(field_name, str))


def unregistered_dynamic_presentation_fields(
    component_class: type,
    presentation_fields: frozenset[str],
) -> frozenset[str]:
    """Return runtime UI fields missing a translated or explicit verbatim policy."""
    tree = _dynamic_method_tree(component_class)
    if tree is None:
        return frozenset()
    declared = _declared_dynamic_fields(component_class)
    verbatim_raw = getattr(component_class, "dynamic_i18n_verbatim", frozenset())
    verbatim = (
        frozenset(field.rsplit(".", maxsplit=1)[-1] for field in verbatim_raw if isinstance(field, str))
        if isinstance(verbatim_raw, (set, frozenset, tuple))
        else frozenset()
    )
    return frozenset(
        field_name
        for field_name, value_node in _dynamic_presentation_nodes(tree, presentation_fields)
        if not (isinstance(value_node, ast.Constant) and isinstance(value_node.value, str))
        and field_name not in declared
        and field_name not in verbatim
    )


def _dynamic_presentation_strings(component_class: type, presentation_fields: frozenset[str]):
    """Yield literal UI strings registered by ``update_build_config``.

    Built-ins may also declare ``dynamic_i18n`` as ``{field: value | [values]}``
    when a runtime branch constructs text indirectly. Literal assignments are
    discovered from the method AST so existing declarative build-config updates
    cannot silently bypass extraction.
    """
    seen: set[tuple[str, str]] = set()

    declared = getattr(component_class, "dynamic_i18n", None)
    if isinstance(declared, dict):
        for declared_field, raw_values in declared.items():
            field_name = declared_field.rsplit(".", maxsplit=1)[-1] if isinstance(declared_field, str) else None
            if field_name not in presentation_fields:
                continue
            values = raw_values if isinstance(raw_values, (list, tuple, set, frozenset)) else (raw_values,)
            for value in values:
                if isinstance(value, str) and value:
                    item = (field_name, value)
                    if item not in seen:
                        seen.add(item)
                        yield item

    tree = _dynamic_method_tree(component_class)
    if tree is None:
        return

    def emit(field_name: object, value_node: ast.AST):
        if (
            isinstance(field_name, str)
            and field_name in presentation_fields
            and isinstance(value_node, ast.Constant)
            and isinstance(value_node.value, str)
            and value_node.value
        ):
            item = (field_name, value_node.value)
            if item not in seen:
                seen.add(item)
                return item
        return None

    for field_name, value_node in _dynamic_presentation_nodes(tree, presentation_fields):
        if item := emit(field_name, value_node):
            yield item


def _input_value(input_object: Any, serialized: dict[str, Any], key: str) -> Any:
    return serialized[key] if key in serialized else getattr(input_object, key, None)


def _component_index_strings() -> dict[str, str]:
    """Load generated template-only metadata that class-level inputs omit."""
    spec = importlib.util.spec_from_file_location("component_metadata_for_extractor", COMPONENT_METADATA_CHECKER)
    if spec is None or spec.loader is None:
        msg = f"Could not load component metadata contract at {COMPONENT_METADATA_CHECKER}"
        raise RuntimeError(msg)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    index = json.loads(COMPONENT_INDEX_PATH.read_text(encoding="utf-8"))
    expected, _components, _unknown_fields = module.expected_component_index_catalog(index)
    return expected


def _report_payload(
    strings: dict[str, str],
    *,
    ok: bool,
    skipped_imports: tuple[SkippedImport, ...] | list[SkippedImport] = (),
    dynamic_violations: tuple[DynamicPresentationViolation, ...] | list[DynamicPresentationViolation] = (),
) -> dict[str, object]:
    payload: dict[str, object] = {
        "component_count": count_component_keys(strings),
        "key_count": len(strings),
        "ok": ok,
        "skipped_imports": [item._asdict() for item in skipped_imports],
    }
    if dynamic_violations:
        payload["unregistered_dynamic_presentation"] = [item._asdict() for item in dynamic_violations]
    return payload


def _write_report(path: Path | None, payload: dict[str, object]) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def collect_strings() -> dict[str, str]:
    """Walk lfx.components and extract all translatable display_name strings."""
    from langflow.utils.i18n_keys import COMPONENT_INPUT_TEXT_FIELDS, COMPONENT_NESTED_TEXT_KEYS
    from langflow.utils.i18n_keys import component_dynamic_field_path as _component_dynamic_field_path
    from langflow.utils.i18n_keys import component_field_key as _component_field_key
    from langflow.utils.i18n_keys import component_option_label as _component_option_label
    from langflow.utils.i18n_keys import normalize_component_key as _normalize_component_key
    from langflow.utils.i18n_keys import safe_flow_key as _safe_key

    try:
        import lfx.components as components_pkg
    except ImportError:
        print("ERROR: Could not import lfx.components. Run this script from inside the backend virtualenv.")
        sys.exit(1)

    flat: dict[str, str] = {}
    seen_names: set[str] = set()
    skipped_imports: list[SkippedImport] = []
    dynamic_violations: list[DynamicPresentationViolation] = []

    for _finder, modname, _ispkg in pkgutil.walk_packages(components_pkg.__path__, components_pkg.__name__ + "."):
        if "deactivated" in modname:
            continue

        try:
            module = importlib.import_module(modname)
        except Exception as e:  # noqa: BLE001
            skipped_imports.append(
                SkippedImport(module=modname, error_type=type(e).__name__, message=str(e))
            )
            continue

        for cls in vars(module).values():
            if not isinstance(cls, type):
                continue
            # Only process classes defined in this module (avoid re-processing imports)
            if getattr(cls, "__module__", None) != modname:
                continue
            # Component marker set by the base class
            if not getattr(cls, "code_class_base_inheritance", None):
                continue
            display_name = getattr(cls, "display_name", None)
            # Skip if not a plain string (e.g. @property descriptors on the class)
            if not isinstance(display_name, str) or not display_name:
                continue

            # Use cls.name if defined (stable identifier used in API), else class name
            component_key = getattr(cls, "name", None) or cls.__name__
            if not isinstance(component_key, str):
                component_key = cls.__name__

            if component_key in seen_names:
                continue
            seen_names.add(component_key)

            norm_key = _normalize_component_key(component_key)

            # Tier 1 — component-level
            flat[_component_field_key(norm_key, "display_name", display_name)] = display_name
            # If description is a @property, getattr on the class returns the descriptor
            # object (not a string).  Fall back to _base_description when that happens.
            raw_desc = cls.__dict__.get("description")
            if isinstance(raw_desc, property):
                description = getattr(cls, "_base_description", "") or ""
            else:
                description = getattr(cls, "description", "") or ""
            if isinstance(description, str) and description:
                flat[_component_field_key(norm_key, "description", description)] = description

            # Tier 2 — explicit input presentation fields, stable option labels,
            # and nested presentation-only metadata. Raw option values are never
            # rewritten by the runtime translator.
            for inp in getattr(cls, "inputs", []) or []:
                serialized_input: dict[str, Any] = {}
                serializer = getattr(inp, "to_dict", None)
                if callable(serializer):
                    try:
                        serialized = serializer()
                    except (TypeError, ValueError):
                        serialized = None
                    if isinstance(serialized, dict):
                        serialized_input = serialized

                field_name = _input_value(inp, serialized_input, "name")
                if isinstance(field_name, str) and field_name:
                    for presentation_field in COMPONENT_INPUT_TEXT_FIELDS:
                        value = _input_value(inp, serialized_input, presentation_field)
                        if isinstance(value, str) and value:
                            path = f"inputs.{field_name}.{presentation_field}"
                            flat[_component_field_key(norm_key, path, value)] = value

                    options = _input_value(inp, serialized_input, "options")
                    metadata = _input_value(inp, serialized_input, "options_metadata")
                    if isinstance(options, list):
                        metadata_list = metadata if isinstance(metadata, list) else []
                        for index, option in enumerate(options):
                            existing = (
                                metadata_list[index]
                                if index < len(metadata_list) and isinstance(metadata_list[index], dict)
                                else {}
                            )
                            label = _component_option_label(option, existing)
                            if label is None:
                                continue
                            path = f"inputs.{field_name}.options.label"
                            flat[_component_field_key(norm_key, path, label)] = label

                    nested_sources = (
                        (_input_value(inp, serialized_input, "dialog_inputs"), frozenset()),
                        (_input_value(inp, serialized_input, "external_options"), frozenset()),
                        (_input_value(inp, serialized_input, "button_metadata"), frozenset()),
                        (metadata, frozenset({"label"})),
                    )
                    for nested, skipped_keys in nested_sources:
                        for leaf_name, value in _nested_presentation_strings(
                            nested,
                            leaf_keys=COMPONENT_NESTED_TEXT_KEYS,
                            skip_keys=skipped_keys,
                        ):
                            path = f"inputs.{field_name}.nested.{leaf_name}"
                            flat[_component_field_key(norm_key, path, value)] = value

            dynamic_fields = frozenset((*COMPONENT_INPUT_TEXT_FIELDS, *COMPONENT_NESTED_TEXT_KEYS))
            for presentation_field, value in _dynamic_presentation_strings(cls, dynamic_fields):
                path = _component_dynamic_field_path(presentation_field)
                flat[_component_field_key(norm_key, path, value)] = value
            unregistered_fields = unregistered_dynamic_presentation_fields(cls, dynamic_fields)
            if unregistered_fields:
                tree = _dynamic_method_tree(cls)
                if tree is None:
                    continue
                for field_name, value_node in _dynamic_presentation_nodes(tree, dynamic_fields):
                    if field_name in unregistered_fields and not (
                        isinstance(value_node, ast.Constant) and isinstance(value_node.value, str)
                    ):
                        dynamic_violations.append(
                            DynamicPresentationViolation(
                                component=component_key,
                                module=modname,
                                field=field_name,
                                expression=ast.unparse(value_node),
                            )
                        )

            # Tier 2 — output display_names and info
            for out in getattr(cls, "outputs", []) or []:
                out_display = getattr(out, "display_name", None)
                out_name = getattr(out, "name", None)
                out_info = getattr(out, "info", None)
                if isinstance(out_name, str) and out_name:
                    if isinstance(out_display, str) and out_display:
                        flat[_component_field_key(norm_key, f"outputs.{out_name}.display_name", out_display)] = (
                            out_display
                        )
                    if isinstance(out_info, str) and out_info:
                        flat[_component_field_key(norm_key, f"outputs.{out_name}.info", out_info)] = out_info

    # The generated component template contains a small number of presentation
    # strings synthesized during serialization (for example supported-file
    # extension help). Merge that exact static contract while retaining the
    # class AST pass above for dynamic update_build_config variants.
    flat.update(_component_index_strings())

    if skipped_imports:
        raise SkippedImportsError(skipped_imports, flat)
    if dynamic_violations:
        raise UnregisteredDynamicPresentationError(dynamic_violations, flat)

    # Tier 3 — starter project names & descriptions (auto-discovered from JSON files)
    starter_count = 0
    for project_file in sorted(STARTER_PROJECTS_DIR.glob("*.json")):
        try:
            with project_file.open(encoding="utf-8") as f:
                project = json.load(f)
        except Exception:  # noqa: BLE001, S112
            continue
        name = project.get("name")
        description = project.get("description", "")
        if name and isinstance(name, str):
            key = _safe_key(name)
            flat[f"starter_flows.{key}.name"] = name
            starter_count += 1
            if description and isinstance(description, str):
                flat[f"starter_flows.{key}.description"] = description

    print(f"Found {starter_count} starter project(s) in {STARTER_PROJECTS_DIR.name}/")

    # Tier 4 — note node descriptions in starter projects (keys baked by bake_note_keys.py)
    note_count = 0
    missing_keys: list[str] = []
    for project_file in sorted(STARTER_PROJECTS_DIR.glob("*.json")):
        try:
            with project_file.open(encoding="utf-8") as f:
                project = json.load(f)
        except Exception:  # noqa: BLE001, S112
            continue
        nodes = project.get("data", {}).get("nodes", [])
        for node in nodes:
            if node.get("type") != "noteNode":
                continue
            node_data = node.get("data", {}).get("node", {})
            i18n_key = node_data.get("i18n_key")
            description = node_data.get("description", "")
            if not i18n_key:
                missing_keys.append(project_file.name)
                continue
            if description and isinstance(description, str):
                flat[i18n_key] = description
                note_count += 1

    if missing_keys:
        print(
            f"WARNING: {len(missing_keys)} noteNode(s) are missing i18n_key. "
            "Run scripts/gp/bake_note_keys.py to assign keys."
        )
    print(f"Found {note_count} note node(s) across starter projects.")

    # Tier 5 — stable system-folder display labels. Persisted DB names remain
    # unchanged; only the API read layer resolves these catalog keys.
    from langflow.initial_setup.constants import (
        ASSISTANT_FOLDER_NAME,
        ASSISTANT_FOLDER_NAME_I18N_KEY,
        STARTER_FOLDER_NAME,
        STARTER_FOLDER_NAME_I18N_KEY,
    )
    from langflow.services.database.models.folder.constants import (
        DEFAULT_FOLDER_DISPLAY_NAME,
        DEFAULT_FOLDER_NAME_I18N_KEY,
    )

    flat[DEFAULT_FOLDER_NAME_I18N_KEY] = DEFAULT_FOLDER_DISPLAY_NAME
    flat[STARTER_FOLDER_NAME_I18N_KEY] = STARTER_FOLDER_NAME
    flat[ASSISTANT_FOLDER_NAME_I18N_KEY] = ASSISTANT_FOLDER_NAME

    # Shared tool-mode output — injected dynamically on every component when tool_mode is
    # enabled, so it's never part of any component's static output list.  Uses the sentinel
    # norm "_toolmode" so the runtime translator can look it up with a single shared key.
    # Constants are inlined (not imported from lfx.base) so this script can run without
    # the full lfx package installed, matching the pattern used in bake_note_keys.py.
    _tool_output_name = "component_as_tool"
    _tool_output_display_name = "Toolset"
    flat[_component_field_key("_toolmode", f"outputs.{_tool_output_name}.display_name", _tool_output_display_name)] = (
        _tool_output_display_name
    )

    return dict(sorted(flat.items()))


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract backend component strings to locales/en.json")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Diff mode: exit 1 if en.json would change (use in CI)",
    )
    parser.add_argument(
        "--report-json",
        type=Path,
        help="Write a machine-readable extraction report (including skipped imports)",
    )
    args = parser.parse_args()

    print("Scanning lfx.components for translatable strings...")
    try:
        strings = collect_strings()
    except SkippedImportsError as exc:
        payload = _report_payload(exc.partial_strings, ok=False, skipped_imports=exc.skipped_imports)
        _write_report(args.report_json, payload)
        print(f"SKIPPED_IMPORTS_JSON={json.dumps(payload['skipped_imports'], ensure_ascii=False)}")
        print(f"FAIL: {exc}")
        raise SystemExit(1) from exc
    except UnregisteredDynamicPresentationError as exc:
        payload = _report_payload(exc.partial_strings, ok=False, dynamic_violations=exc.violations)
        _write_report(args.report_json, payload)
        print(
            "UNREGISTERED_DYNAMIC_PRESENTATION_JSON="
            f"{json.dumps(payload['unregistered_dynamic_presentation'], ensure_ascii=False)}"
        )
        print(f"FAIL: {exc}")
        raise SystemExit(1) from exc

    payload = _report_payload(strings, ok=True)
    _write_report(args.report_json, payload)
    print(
        f"Found {len(strings)} translatable keys across "
        f"{count_component_keys(strings)}"
        " components."
    )

    new_content = json.dumps(strings, ensure_ascii=False, indent=2) + "\n"

    if args.check:
        if OUTPUT_PATH.exists():
            existing = OUTPUT_PATH.read_text(encoding="utf-8")
            if existing == new_content:
                print("OK: locales/en.json is up to date.")
                sys.exit(0)
            else:
                payload["ok"] = False
                _write_report(args.report_json, payload)
                print("FAIL: locales/en.json is out of sync. Run extract_backend_strings.py to update it.")
                sys.exit(1)
        else:
            payload["ok"] = False
            _write_report(args.report_json, payload)
            print("FAIL: locales/en.json does not exist. Run extract_backend_strings.py to create it.")
            sys.exit(1)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(new_content, encoding="utf-8")
    print(f"Written to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
