"""Russian backend component and starter-content localization contracts."""
# ruff: noqa: RUF001

from __future__ import annotations

import copy
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

from langflow.utils import i18n as i18n_utils

ROOT = Path(__file__).resolve().parents[4]
LOCALES = ROOT / "src/backend/base/langflow/locales"


def _catalog(locale: str) -> dict[str, str]:
    return json.loads((LOCALES / f"{locale}.json").read_text(encoding="utf-8"))


def test_russian_catalog_is_complete_nonempty_and_uses_reviewed_core_terms():
    english = _catalog("en")
    russian = _catalog("ru")

    assert set(russian) == set(english)
    assert all(value.strip() for value in russian.values())

    reviewed_terms = {
        "API Key": "API-ключ",
        "Input": "Вход",
        "Output": "Выход",
        "Provider": "Провайдер",
        "Tool": "Инструмент",
        "Toolset": "Набор инструментов",
    }
    for source, expected in reviewed_terms.items():
        matching_keys = [key for key, value in english.items() if value == source]
        assert matching_keys, source
        assert {russian[key] for key in matching_keys} == {expected}


def test_all_indexed_builtin_component_display_names_have_russian_entries():
    english = _catalog("en")
    russian = _catalog("ru")
    index = json.loads((ROOT / "src/lfx/src/lfx/_assets/component_index.json").read_text(encoding="utf-8"))
    expected_display_names: dict[str, str] = {}
    for _category, components in index["entries"]:
        for component_name, node in components.items():
            display_name = node.get("display_name")
            if isinstance(display_name, str) and display_name:
                norm = i18n_utils.normalize_component_key(component_name)
                key = i18n_utils.component_field_key(norm, "display_name", display_name)
                expected_display_names[key] = display_name

    assert len(expected_display_names) == index["metadata"]["num_components"]
    assert expected_display_names.items() <= english.items()
    assert set(expected_display_names) <= set(russian)
    assert all(russian[key].strip() for key in expected_display_names)


def test_component_translation_is_immutable_and_concurrency_safe(monkeypatch):
    english = _catalog("en")
    russian = _catalog("ru")
    monkeypatch.setattr(i18n_utils, "_translations", {"en": english, "ru": russian})

    source = {
        "Inputs": {
            "ChatInput": {
                "display_name": "Chat Input",
                "description": "Get chat inputs from the Playground.",
                "template": {
                    "input_value": {
                        "display_name": "Input Text",
                        "info": "Message to be passed as input.",
                    }
                },
                "outputs": [{"name": "message", "display_name": "Chat Message"}],
            }
        }
    }
    original = copy.deepcopy(source)

    def translate(locale: str):
        return i18n_utils.translate_component_dict(source, locale)

    locales = ["en", "ru"] * 20
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(translate, locales))

    assert source == original
    for locale, result in zip(locales, results, strict=True):
        component = result["Inputs"]["ChatInput"]
        if locale == "en":
            assert component["display_name"] == "Chat Input"
        else:
            assert component["display_name"] == russian["components.chatinput.display_name.a33cb48e"]
            assert component["display_name"] != "Chat Input"


def test_component_display_names_include_stable_output_translation_sets(monkeypatch):
    source = {
        "Inputs": {
            "Demo": {
                "display_name": "Demo",
                "description": "Demo component",
                "template": {},
                "outputs": [
                    {
                        "name": "primary",
                        "display_name": "Primary",
                        "info": "Primary output help",
                    },
                    {"name": "legacy_without_labels"},
                ],
            }
        }
    }
    display_name_key = i18n_utils.component_field_key("demo", "outputs.primary.display_name", "Primary")
    info_key = i18n_utils.component_field_key("demo", "outputs.primary.info", "Primary output help")
    monkeypatch.setattr(
        i18n_utils,
        "_translations",
        {
            "en": {
                display_name_key: "Primary",
                info_key: "Primary output help",
            },
            "ru": {
                display_name_key: "Первый",
                info_key: "Справка о первом выходе",
            },
        },
    )

    metadata = i18n_utils.build_component_display_names(source)

    assert set(metadata["demo"]["outputs"]["primary"]["display_name"]) == {
        "Primary",
        "Первый",
    }
    assert set(metadata["demo"]["outputs"]["primary"]["info"]) == {
        "Primary output help",
        "Справка о первом выходе",
    }
    assert metadata["demo"]["outputs"]["legacy_without_labels"] == {}


def test_component_display_names_include_every_input_and_nested_presentation_set(monkeypatch):
    norm = "demo"
    field_name = "mode"
    direct_values = {field_name: f"English {field_name}" for field_name in i18n_utils.COMPONENT_INPUT_TEXT_FIELDS}
    english: dict[str, str] = {}
    russian: dict[str, str] = {}
    for presentation_field, source_value in direct_values.items():
        key = i18n_utils.component_field_key(
            norm,
            f"inputs.{field_name}.{presentation_field}",
            source_value,
        )
        english[key] = source_value
        russian[key] = f"Русский {presentation_field}"

    nested_sources = {
        ("options.label", "Safe"): "Безопасно",
        ("nested.tooltip", "Recommended"): "Рекомендуется",
        ("nested.title", "Choose a mode"): "Выберите режим",
        ("nested.label", "Region"): "Регион",
    }
    for (key_path, source_value), translated_value in nested_sources.items():
        key = i18n_utils.component_field_key(norm, f"inputs.{field_name}.{key_path}", source_value)
        english[key] = source_value
        russian[key] = translated_value

    monkeypatch.setattr(i18n_utils, "_translations", {"en": english, "ru": russian})
    option = {"id": "safe", "name": "Safe", "icon": "shield"}
    source = {
        "Inputs": {
            "Demo": {
                "display_name": "Demo",
                "description": "Demo component",
                "template": {
                    field_name: {
                        **direct_values,
                        "value": {"id": "safe", "name": "Safe"},
                        "options": [option],
                        "options_metadata": [{"tooltip": "Recommended"}],
                        "dialog_inputs": {
                            "title": "Choose a mode",
                            "fields": [{"label": "Region"}],
                        },
                    }
                },
                "outputs": [],
            }
        }
    }

    metadata = i18n_utils.build_component_display_names(source)
    presentation = metadata[norm]["fields"][field_name]["presentation"]

    for presentation_field, source_value in direct_values.items():
        assert set(presentation[presentation_field]) == {
            source_value,
            f"Русский {presentation_field}",
        }
    assert set(presentation["options_metadata.label"]) == {"Safe", "Безопасно"}
    assert set(presentation["options_metadata.tooltip"]) == {"Recommended", "Рекомендуется"}
    assert set(presentation["dialog_inputs.title"]) == {"Choose a mode", "Выберите режим"}
    assert set(presentation["dialog_inputs.fields.label"]) == {"Region", "Регион"}


def test_extension_known_sets_are_isolated_and_support_en_ru_en_with_object_options(monkeypatch):
    namespaced_id = "ext:demo_bundle:Widget@official"
    core_key = i18n_utils.component_field_key("widget", "display_name", "Widget")
    monkeypatch.setattr(
        i18n_utils,
        "_translations",
        {
            "en": {core_key: "Core Widget"},
            "ru": {core_key: "Подмена из core"},
        },
    )
    option = {"id": "safe", "name": "Safe", "icon": "shield"}
    selected_value = {"id": "safe", "name": "Safe"}
    source = {
        "Extensions": {
            namespaced_id: {
                "extension": "demo-extension",
                "namespaced_id": namespaced_id,
                "extension_locale_bundle": {
                    "namespace": "demo-extension",
                    "locales": {
                        "en": {
                            "components.widget.display_name": "Widget",
                            "components.widget.inputs.mode.info": "Mode help",
                            "components.widget.inputs.mode.options.label": "Safe",
                            "components.widget.inputs.mode.nested.title": "Choose a mode",
                        },
                        "ru": {
                            "components.widget.display_name": "Виджет расширения",
                            "components.widget.inputs.mode.info": "Справка о режиме",
                            "components.widget.inputs.mode.options.label": "Безопасно",
                            "components.widget.inputs.mode.nested.title": "Выберите режим",
                        },
                    },
                },
                "display_name": "Widget",
                "template": {
                    "mode": {
                        "display_name": "Mode",
                        "info": "Mode help",
                        "value": selected_value,
                        "options": [option],
                        "dialog_inputs": {"title": "Choose a mode"},
                    }
                },
                "outputs": [],
            }
        }
    }
    original = copy.deepcopy(source)

    metadata = i18n_utils.build_component_display_names(source)
    known = metadata[i18n_utils.normalize_component_key(namespaced_id)]
    presentation = known["fields"]["mode"]["presentation"]
    russian = i18n_utils.translate_component_dict(source, "ru")
    english_again = i18n_utils.translate_component_dict(russian, "en")

    assert source == original
    assert set(known["display_name"]) == {"Widget", "Виджет расширения"}
    assert "Подмена из core" not in known["display_name"]
    assert set(presentation["info"]) == {"Mode help", "Справка о режиме"}
    assert set(presentation["options_metadata.label"]) == {"Safe", "Безопасно"}
    assert set(presentation["dialog_inputs.title"]) == {"Choose a mode", "Выберите режим"}

    russian_node = russian["Extensions"][namespaced_id]
    assert russian_node["display_name"] == "Виджет расширения"
    assert russian_node["template"]["mode"]["info"] == "Справка о режиме"
    assert russian_node["template"]["mode"]["value"] == selected_value
    assert russian_node["template"]["mode"]["options"] == [option]
    assert russian_node["template"]["mode"]["options_metadata"] == [{"value": option, "label": "Безопасно"}]
    assert russian_node["template"]["mode"]["dialog_inputs"] == {"title": "Выберите режим"}

    english_node = english_again["Extensions"][namespaced_id]
    assert english_node["display_name"] == "Widget"
    assert english_node["template"]["mode"]["info"] == "Mode help"
    assert english_node["template"]["mode"]["value"] == selected_value
    assert english_node["template"]["mode"]["options"] == [option]
    assert english_node["template"]["mode"]["options_metadata"] == [{"value": option, "label": "Safe"}]
    assert english_node["template"]["mode"]["dialog_inputs"] == {"title": "Choose a mode"}


def test_dynamic_input_presentation_translates_without_mutating_option_values(monkeypatch):
    norm = "demo"
    field_name = "policy"
    input_values = {
        "helper_text": "Choose a policy.",
        "refresh_button_text": "Refresh policies",
        "list_add_label": "Add Policy",
        "auth_tooltip": "Connect first",
        "min_label": "Strict",
        "max_label": "Permissive",
        "trigger_text": "Open policies",
    }
    english: dict[str, str] = {}
    russian: dict[str, str] = {}
    for subfield, value in input_values.items():
        key = i18n_utils.component_field_key(norm, f"inputs.{field_name}.{subfield}", value)
        english[key] = value
        russian[key] = f"ru:{value}"
    for option, translated in (("Strict", "Строго"), ("Permissive", "Свободно")):
        key = i18n_utils.component_field_key(norm, f"inputs.{field_name}.options.label", option)
        english[key] = option
        russian[key] = translated
    nested_key = i18n_utils.component_field_key(
        norm,
        f"inputs.{field_name}.nested.label",
        "Connect other models",
    )
    english[nested_key] = "Connect other models"
    russian[nested_key] = "Подключить другие модели"
    monkeypatch.setattr(i18n_utils, "_translations", {"en": english, "ru": russian})

    source = {
        "display_name": "Demo",
        "template": {
            field_name: {
                **input_values,
                "value": "Strict",
                "options": ["Strict", "Permissive"],
                "options_metadata": [{"icon": "lock"}, {"icon": "lock-open"}],
                "external_options": {"label": "Connect other models", "id": "connect_other_models"},
            }
        },
    }
    original = copy.deepcopy(source)

    translated = i18n_utils.translate_component_node("Demo", source, "ru")
    translated_field = translated["template"][field_name]

    assert source == original
    for subfield, value in input_values.items():
        assert translated_field[subfield] == f"ru:{value}"
    assert translated_field["value"] == "Strict"
    assert translated_field["options"] == ["Strict", "Permissive"]
    assert translated_field["options_metadata"] == [
        {"icon": "lock", "value": "Strict", "label": "Строго"},
        {"icon": "lock-open", "value": "Permissive", "label": "Свободно"},
    ]
    assert translated_field["external_options"] == {
        "label": "Подключить другие модели",
        "id": "connect_other_models",
    }


def test_dynamic_option_and_nested_labels_share_the_extractor_namespace(monkeypatch):
    option_source = "Dynamic safe mode"
    nested_source = "Connect a dynamic provider"
    option_key = i18n_utils.component_field_key("demo", "dynamic.label", option_source)
    nested_key = i18n_utils.component_field_key("demo", "dynamic.label", nested_source)
    monkeypatch.setattr(
        i18n_utils,
        "_translations",
        {
            "en": {option_key: option_source, nested_key: nested_source},
            "ru": {
                option_key: "Динамический безопасный режим",
                nested_key: "Подключить динамического провайдера",
            },
        },
    )
    source = {
        "display_name": "Demo",
        "template": {
            "mode": {
                "value": "safe",
                "options": ["safe"],
                "options_metadata": [{"label": option_source}],
                "external_options": {"label": nested_source, "id": "connect_provider"},
            }
        },
    }

    translated = i18n_utils.translate_component_node("Demo", source, "ru")

    assert translated["template"]["mode"]["options_metadata"][0] == {
        "label": "Динамический безопасный режим",
        "value": "safe",
    }
    assert translated["template"]["mode"]["external_options"] == {
        "label": "Подключить динамического провайдера",
        "id": "connect_provider",
    }


def test_dynamic_template_translation_preserves_runtime_parameters(monkeypatch):
    source_template = "Missing required: {fields}"
    template_key = i18n_utils.component_field_key("demo", "dynamic.helper_text", source_template)
    monkeypatch.setattr(
        i18n_utils,
        "_translations",
        {
            "en": {template_key: source_template},
            "ru": {template_key: "Не заполнены обязательные поля: {fields}"},
        },
    )
    source = {
        "display_name": "Demo",
        "template": {"auth_mode": {"helper_text": "Missing required: client_id, client_secret"}},
    }

    translated = i18n_utils.translate_component_node("Demo", source, "ru")

    assert translated["template"]["auth_mode"]["helper_text"] == (
        "Не заполнены обязательные поля: client_id, client_secret"
    )


def test_user_custom_component_metadata_remains_verbatim(monkeypatch):
    display_key = i18n_utils.component_field_key("mycustom", "display_name", "My Custom")
    field_key = i18n_utils.component_field_key(
        "mycustom",
        "inputs.prompt.display_name",
        "Custom Prompt",
    )
    monkeypatch.setattr(
        i18n_utils,
        "_translations",
        {
            "en": {display_key: "My Custom", field_key: "Custom Prompt"},
            "ru": {display_key: "Подменённое имя", field_key: "Подменённое поле"},
        },
    )
    source = {
        "Custom": {
            "MyCustom": {
                "display_name": "My Custom",
                "metadata": {"module": "custom_components.my_custom"},
                "template": {"prompt": {"display_name": "Custom Prompt", "value": "user text"}},
            }
        }
    }

    translated = i18n_utils.translate_component_dict(source, "ru")

    assert translated["Custom"]["MyCustom"] == source["Custom"]["MyCustom"]
    assert translated["Custom"]["MyCustom"] is source["Custom"]["MyCustom"]


def test_extension_component_uses_only_its_namespaced_locale_bundle(monkeypatch):
    core_key = i18n_utils.component_field_key("widget", "display_name", "Widget")
    monkeypatch.setattr(
        i18n_utils,
        "_translations",
        {
            "en": {core_key: "Widget"},
            "ru": {core_key: "Подмена из core"},
        },
    )
    source = {
        "extension": "demo-extension",
        "namespaced_id": "ext:demo_bundle:Widget@official",
        "extension_locale_bundle": {
            "namespace": "demo-extension",
            "locales": {
                "en": {
                    "components.widget.display_name": "Widget",
                    "components.widget.inputs.mode.display_name": "Mode",
                    "components.widget.inputs.mode.options.label": "Safe",
                },
                "ru": {
                    "components.widget.display_name": "Виджет расширения",
                    "components.widget.inputs.mode.display_name": "Режим",
                    "components.widget.inputs.mode.options.label": "Безопасный",
                },
            },
        },
        "display_name": "Widget",
        "template": {
            "mode": {
                "display_name": "Mode",
                "value": "safe",
                "options": ["safe"],
                "options_metadata": [{"label": "Safe"}],
            }
        },
    }

    translated = i18n_utils.translate_component_node(source["namespaced_id"], source, "ru")

    assert translated["display_name"] == "Виджет расширения"
    assert translated["display_name"] != "Подмена из core"
    assert translated["template"]["mode"]["display_name"] == "Режим"
    assert translated["template"]["mode"]["options"] == ["safe"]
    assert translated["template"]["mode"]["value"] == "safe"
    assert translated["template"]["mode"]["options_metadata"][0] == {
        "label": "Безопасный",
        "value": "safe",
    }


def test_extension_mark_policy_without_ru_never_falls_into_core_catalog(monkeypatch):
    core_key = i18n_utils.component_field_key("widget", "display_name", "Widget")
    monkeypatch.setattr(
        i18n_utils,
        "_translations",
        {"en": {core_key: "Widget"}, "ru": {core_key: "Подмена из core"}},
    )
    source = {
        "extension": "demo-extension",
        "namespaced_id": "ext:demo_bundle:Widget@official",
        "extension_ru_missing": True,
        "extension_locale_bundle": {
            "namespace": "demo-extension",
            "locales": {"en": {"components.widget.display_name": "Extension Widget"}},
        },
        "display_name": "Widget",
        "template": {},
    }

    translated = i18n_utils.translate_component_node(source["namespaced_id"], source, "ru")

    assert translated["display_name"] == "Extension Widget"
    assert translated["extension_ru_missing"] is True


def test_starter_names_descriptions_and_keyed_notes_translate_without_mutation(monkeypatch):
    english = _catalog("en")
    russian = _catalog("ru")
    monkeypatch.setattr(i18n_utils, "_translations", {"en": english, "ru": russian})

    flow = SimpleNamespace(name="Basic Prompting", description="Perform basic prompting with an OpenAI model.")
    source_note_key = next(key for key in english if key.startswith("template_notes."))
    note = {
        "type": "noteNode",
        "data": {"node": {"i18n_key": source_note_key, "description": english[source_note_key]}},
    }
    original_note = copy.deepcopy(note)

    translated_flow = i18n_utils.translate_starter_flows([flow], "ru")[0]
    translated_note = i18n_utils.translate_flow_notes([note], "ru")[0]

    assert flow.name == "Basic Prompting"
    assert translated_flow.name == russian["starter_flows.basic_prompting.name"]
    assert translated_flow.description == russian["starter_flows.basic_prompting.description"]
    assert note == original_note
    assert translated_note["data"]["node"]["description"] == russian[source_note_key]
