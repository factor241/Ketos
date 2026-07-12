from __future__ import annotations

import asyncio
import copy

import pytest
from ketos.utils import i18n as i18n_utils


@pytest.fixture(autouse=True)
def isolated_translations(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        i18n_utils,
        "_translations",
        {
            "en": {
                "system.saved": "Saved",
                "system.missing": "Missing",
                "system.outer": "Outer",
                "system.inner": "Inner",
                "system.first": "First",
                "system.second": "Second",
                "notes.example": "Example note",
            },
            "ru": {"system.saved": "Сохранено"},
        },
    )


def test_strict_ru_mode_raises_on_english_fallback() -> None:
    with (
        i18n_utils.strict_translation_test_mode("ru"),
        pytest.raises(i18n_utils.MissingSystemTranslationError, match=r"system\.missing"),
    ):
        i18n_utils.translate("system.missing", "ru", "Raw default")

    assert i18n_utils.get_strict_translation_diagnostics() == [
        {"locale": "ru", "key": "system.missing", "fallback": "en"}
    ]


def test_strict_ru_mode_allows_present_translation() -> None:
    with i18n_utils.strict_translation_test_mode("ru"):
        assert i18n_utils.translate("system.saved", "ru", "Raw default") == "Сохранено"

    assert i18n_utils.get_strict_translation_diagnostics() == []


def test_normal_runtime_keeps_compatibility_fallback() -> None:
    assert i18n_utils.translate("system.missing", "ru", "Raw default") == "Missing"


def test_strict_ru_mode_does_not_reclassify_user_or_diagnostic_defaults() -> None:
    with i18n_utils.strict_translation_test_mode("ru", system_owned=False):
        assert i18n_utils.translate("user.flow_name", "ru", "My English Flow") == "My English Flow"


def test_nested_strict_contexts_preserve_all_outer_diagnostics() -> None:
    with i18n_utils.strict_translation_test_mode("ru"):
        with pytest.raises(i18n_utils.MissingSystemTranslationError):
            i18n_utils.translate("system.outer", "ru", "Outer")

        with (
            i18n_utils.strict_translation_test_mode("ru"),
            pytest.raises(i18n_utils.MissingSystemTranslationError),
        ):
            i18n_utils.translate("system.inner", "ru", "Inner")

        assert i18n_utils.get_strict_translation_diagnostics() == [
            {"locale": "ru", "key": "system.outer", "fallback": "en"},
            {"locale": "ru", "key": "system.inner", "fallback": "en"},
        ]


@pytest.mark.asyncio
async def test_strict_context_diagnostics_are_isolated_between_async_tasks() -> None:
    async def collect(key: str) -> list[dict[str, str]]:
        with i18n_utils.strict_translation_test_mode("ru"):
            await asyncio.sleep(0)
            with pytest.raises(i18n_utils.MissingSystemTranslationError):
                i18n_utils.translate(key, "ru", key)
            await asyncio.sleep(0)
            return i18n_utils.get_strict_translation_diagnostics()

    first, second = await asyncio.gather(collect("system.first"), collect("system.second"))

    assert first == [{"locale": "ru", "key": "system.first", "fallback": "en"}]
    assert second == [{"locale": "ru", "key": "system.second", "fallback": "en"}]


def test_component_dict_strict_fallback_raises_without_mutating_source() -> None:
    all_types = {
        "inputs": {
            "ExampleComponent": {
                "display_name": "Example Component",
                "description": "Example description.",
                "template": {
                    "value": {
                        "display_name": "Value",
                        "info": "Example value.",
                        "placeholder": "Enter a value",
                    }
                },
                "outputs": [{"name": "result", "display_name": "Result", "info": "Example result."}],
            }
        }
    }
    original = copy.deepcopy(all_types)

    with (
        i18n_utils.strict_translation_test_mode("ru"),
        pytest.raises(i18n_utils.MissingSystemTranslationError, match="fallback=default"),
    ):
        i18n_utils.translate_component_dict(all_types, "ru")

    assert all_types == original


def test_flow_note_strict_fallback_raises_without_mutating_source() -> None:
    nodes = [
        {
            "type": "noteNode",
            "data": {"node": {"i18n_key": "notes.example", "description": "Example note"}},
        }
    ]
    original = copy.deepcopy(nodes)

    with (
        i18n_utils.strict_translation_test_mode("ru"),
        pytest.raises(i18n_utils.MissingSystemTranslationError, match="fallback=en"),
    ):
        i18n_utils.translate_flow_notes(nodes, "ru")

    assert nodes == original
