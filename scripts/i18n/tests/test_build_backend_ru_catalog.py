from __future__ import annotations

# ruff: noqa: RUF001, S101
import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[1] / "build_backend_ru_catalog.py"
SPEC = importlib.util.spec_from_file_location("build_backend_ru_catalog", SCRIPT)
assert SPEC
assert SPEC.loader
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


def test_build_catalog_reuses_unique_source_translations_for_every_key() -> None:
    english = {
        "components.a.display_name.1": "Input",
        "components.a.inputs.value.display_name.1": "Input",
        "components.b.description.2": "Use {{name}} with `index_name` and API_KEY.",
    }
    memory = {"Input": "Вход"}
    chunks = [{"Use {{name}} with `index_name` and API_KEY.": "Используйте {{name}} с `index_name` и API_KEY."}]

    assert builder.build_catalog(english, memory, chunks) == {
        "components.a.display_name.1": "Вход",
        "components.a.inputs.value.display_name.1": "Вход",
        "components.b.description.2": "Используйте {{name}} с `index_name` и API_KEY.",
    }


def test_build_catalog_rejects_missing_empty_or_unknown_sources() -> None:
    english = {"a": "One", "b": "Two"}

    with pytest.raises(builder.TranslationBuildError, match="missing source translation"):
        builder.build_catalog(english, {"One": "Один"}, [])
    with pytest.raises(builder.TranslationBuildError, match="empty translation"):
        builder.build_catalog(english, {"One": "Один", "Two": "  "}, [])
    with pytest.raises(builder.TranslationBuildError, match="unknown source"):
        builder.build_catalog(english, {"One": "Один", "Two": "Два", "Three": "Три"}, [])


@pytest.mark.parametrize(
    ("source", "target"),
    [
        ("Hello {{name}}", "Привет {{user}}"),
        ("Use <0>this</0>", "Используйте <1>это</1>"),
        ("Set `index_name`", "Укажите `имя_индекса`"),
        ("Set LANGCHAIN_VERBOSE=true", "Укажите LANGCHAIN=true"),
        ("Visit https://example.com/docs", "Откройте https://example.org/docs"),
    ],
)
def test_build_catalog_rejects_protected_token_drift(source: str, target: str) -> None:
    with pytest.raises(builder.TranslationBuildError, match="protected token drift"):
        builder.build_catalog({"key": source}, {source: target}, [])


def test_double_backtick_code_spans_are_protected_without_capturing_surrounding_prose() -> None:
    source = "Sort ``1`` ascending and ``-1`` descending."
    target = "Сортировка: ``1`` по возрастанию и ``-1`` по убыванию."

    assert builder.build_catalog({"key": source}, {source: target}, []) == {"key": target}


def test_uppercase_prose_is_translatable_but_environment_identifiers_are_protected() -> None:
    source = "This does NOT require OPENAI_API_KEY."
    target = "Для этого НЕ требуется OPENAI_API_KEY."

    assert builder.build_catalog({"key": source}, {source: target}, []) == {"key": target}
    with pytest.raises(builder.TranslationBuildError, match="protected token drift"):
        builder.build_catalog({"key": source}, {source: target.replace("OPENAI_API_KEY", "OTHER_API_KEY")}, [])
