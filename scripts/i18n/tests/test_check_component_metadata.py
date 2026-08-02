from __future__ import annotations

# ruff: noqa: S101
import importlib.util
from pathlib import Path

from ketos.utils.i18n_keys import component_field_key

SCRIPT = Path(__file__).parents[1] / "check_component_metadata.py"
SPEC = importlib.util.spec_from_file_location("check_component_metadata", SCRIPT)
assert SPEC
assert SPEC.loader
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)


def _index() -> dict:
    return {
        "metadata": {"num_components": 1, "num_modules": 1},
        "entries": [
            [
                "Demo",
                {
                    "DemoComponent": {
                        "display_name": "Demo",
                        "description": "Demo description",
                        "template": {
                            "mode": {
                                "name": "mode",
                                "display_name": "Mode",
                                "helper_text": "Choose a mode",
                                "options": ["fast", "safe"],
                                "options_metadata": [
                                    {"label": "Fast mode"},
                                    {"label": "Safe mode"},
                                ],
                                "external_options": {"label": "Add provider", "id": "add_provider"},
                            }
                        },
                        "outputs": [{"name": "result", "display_name": "Result", "info": "The result"}],
                    }
                },
            ]
        ],
    }


def _catalog() -> dict[str, str]:
    norm = "democomponent"
    values = {
        "display_name": "Demo",
        "description": "Demo description",
        "inputs.mode.display_name": "Mode",
        "inputs.mode.helper_text": "Choose a mode",
        "inputs.mode.options.label": "Fast mode",
        "inputs.mode.options.label.safe": "Safe mode",
        "inputs.mode.nested.label": "Add provider",
        "outputs.result.display_name": "Result",
        "outputs.result.info": "The result",
    }
    catalog: dict[str, str] = {}
    for path, value in values.items():
        actual_path = "inputs.mode.options.label" if path.endswith(".safe") else path
        catalog[component_field_key(norm, actual_path, value)] = value
    return catalog


def test_component_index_metadata_is_fully_covered() -> None:
    audit = checker.audit_component_index(_index(), _catalog())

    assert audit.ok
    assert audit.component_count == 1
    assert audit.expected_key_count == len(_catalog())


def test_missing_catalog_key_and_unknown_presentation_field_are_blocking() -> None:
    index = _index()
    index["entries"][0][1]["DemoComponent"]["template"]["mode"]["empty_state_text"] = "No modes"
    catalog = _catalog()
    catalog.pop(component_field_key("democomponent", "inputs.mode.helper_text", "Choose a mode"))

    audit = checker.audit_component_index(index, catalog)

    assert component_field_key("democomponent", "inputs.mode.helper_text", "Choose a mode") in audit.missing_keys
    assert audit.unknown_presentation_fields == {"empty_state_text"}
    assert not audit.ok


def test_object_option_labels_are_catalogued_without_treating_values_as_ui_text() -> None:
    index = _index()
    mode = index["entries"][0][1]["DemoComponent"]["template"]["mode"]
    mode["options"] = [
        {"value": "fast", "label": "Object fast mode"},
        {"value": "safe", "name": "Object safe mode", "icon": "shield"},
    ]
    mode["options_metadata"] = []
    catalog = _catalog()
    expected, _components, _unknown = checker.expected_component_index_catalog(index)
    fast_key = component_field_key("democomponent", "inputs.mode.options.label", "Object fast mode")
    safe_key = component_field_key("democomponent", "inputs.mode.options.label", "Object safe mode")
    catalog[fast_key] = "Object fast mode"
    catalog[safe_key] = "Object safe mode"

    audit = checker.audit_component_index(index, catalog)

    assert audit.ok
    assert expected[fast_key] == "Object fast mode"
    assert expected[safe_key] == "Object safe mode"
    assert not any(value in {"fast", "safe"} for value in checker.expected_component_index_catalog(index)[0].values())
