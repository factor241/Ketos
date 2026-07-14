from __future__ import annotations

# ruff: noqa: S101
import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[1] / "check_backend_locales.py"
SPEC = importlib.util.spec_from_file_location("check_backend_locales", SCRIPT)
assert SPEC
assert SPEC.loader
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)


def _valid_baseline() -> dict:
    return {
        "schema_version": 1,
        "baseline_commit": "def832f409c01f0acd3937b9317dde03d0273552",
        "reason": "Reviewed test debt.",
        "owner": "backend-localization",
        "review_date": "2026-07-11",
        "required_locales": ["en", "de"],
        "absent_locales": [],
        "shared_debt": {"locales": [], "missing": [], "extra": []},
        "locale_debt": {},
    }


def test_flat_catalog_rejects_nested_or_non_string_values(tmp_path: Path) -> None:
    path = tmp_path / "bad.json"
    path.write_text('{"ok": "text", "nested": {"bad": true}}', encoding="utf-8")

    with pytest.raises(checker.CatalogError, match="flat string"):
        checker.load_flat_catalog(path)


def test_audit_detects_unreviewed_missing_extra_empty_and_token_drift() -> None:
    source = {
        "greeting": "Hello {{name}} <0>now</0>",
        "kept": "Keep",
        "empty": "Not empty",
    }
    target = {
        "greeting": "Привет {{username}} <1>сейчас</1>",
        "empty": "",
        "extra": "Лишнее",
    }

    result = checker.audit_catalog(source, target, locale="ru", baseline={"missing": [], "extra": []})

    assert result.unapproved_missing == {"kept"}
    assert result.unapproved_extra == {"extra"}
    assert result.empty == {"empty"}
    assert result.interpolation_mismatch == {"greeting"}
    assert result.numeric_tag_mismatch == {"greeting"}
    assert not result.ok


def test_exact_reviewed_debt_passes_but_stale_or_new_debt_fails() -> None:
    source = {"a": "A", "b": "B"}

    reviewed = checker.audit_catalog(
        source,
        {"a": "A"},
        locale="de",
        baseline={"missing": ["b"], "extra": []},
    )
    assert reviewed.ok
    assert reviewed.reviewed_missing == {"b"}

    stale = checker.audit_catalog(
        source,
        {"a": "A", "b": "B"},
        locale="de",
        baseline={"missing": ["b"], "extra": []},
    )
    assert stale.stale_baseline_missing == {"b"}
    assert not stale.ok

    new_debt = checker.audit_catalog(
        {**source, "c": "C"},
        {"a": "A"},
        locale="de",
        baseline={"missing": ["b"], "extra": []},
    )
    assert new_debt.unapproved_missing == {"c"}
    assert not new_debt.ok


def test_russian_plural_contract_requires_all_categories() -> None:
    complete = {
        "items_one": "{{count}} элемент",
        "items_few": "{{count}} элемента",
        "items_many": "{{count}} элементов",
        "items_other": "{{count}} элемента",
    }
    incomplete = {key: value for key, value in complete.items() if not key.endswith("_many")}

    assert checker.find_incomplete_plural_groups(complete, "ru") == {}
    assert checker.find_incomplete_plural_groups(incomplete, "ru") == {"items": {"many"}}


def test_runtime_source_index_must_match_english_catalog() -> None:
    source = {"a": "A", "b": "B"}

    assert checker.audit_runtime_index(source, source).ok
    drift = checker.audit_runtime_index(source, {"a": "A", "c": "C"})
    assert drift.missing_from_catalog == {"c"}
    assert drift.stale_catalog_keys == {"b"}
    assert drift.value_mismatch == set()


def test_absent_required_locale_is_only_allowed_by_exact_baseline() -> None:
    assert checker.audit_absent_locales({"en", "de"}, {"ru"}, {"ru"}).ok

    new_absence = checker.audit_absent_locales({"en"}, {"de", "ru"}, {"ru"})
    assert new_absence.unapproved_absent == {"de"}
    assert not new_absence.ok

    stale = checker.audit_absent_locales({"en", "ru"}, {"ru"}, {"ru"})
    assert stale.stale_baseline_absent == {"ru"}
    assert not stale.ok


@pytest.mark.parametrize(
    ("locale", "target"),
    [
        (
            "ru",
            {
                "items_one": "{{count}} элемент",
                "items_few": "{{count}} элемента",
                "items_many": "{{count}} элементов",
                "items_other": "{{count}} элемента",
            },
        ),
        (
            "es",
            {
                "items_one": "{{count}} elemento",
                "items_many": "{{count}} elementos",
                "items_other": "{{count}} elementos",
            },
        ),
        (
            "pt",
            {
                "items_one": "{{count}} item",
                "items_many": "{{count}} itens",
                "items_other": "{{count}} itens",
            },
        ),
        ("ja", {"items_other": "{{count}} 件"}),
    ],
)
def test_complete_locale_specific_plural_group_passes_combined_audit(locale: str, target: dict[str, str]) -> None:
    source = {
        "items_one": "{{count}} item",
        "items_other": "{{count}} items",
    }

    audit = checker.audit_catalog(source, target, locale=locale, baseline={"missing": [], "extra": []})

    assert audit.ok
    assert checker.find_incomplete_plural_groups(target, locale) == {}


@pytest.mark.parametrize(
    ("locale", "expected"),
    [
        ("ru", {"one", "few", "many", "other"}),
        ("es", {"one", "many", "other"}),
        ("pt", {"one", "many", "other"}),
        ("ja", {"other"}),
    ],
)
def test_plural_categories_match_shipped_locale_cldr(locale: str, expected: set[str]) -> None:
    assert checker.plural_categories(locale) == expected


def test_interpolation_parity_rejects_missing_closing_braces() -> None:
    source = {"greeting": "Hello {{name}}"}
    target = {"greeting": "Привет {{name"}

    audit = checker.audit_catalog(source, target, locale="ru", baseline={"missing": [], "extra": []})

    assert audit.interpolation_mismatch == {"greeting"}
    assert not audit.ok


def test_interpolation_parity_preserves_repeated_token_counts() -> None:
    source = {"greeting": "Hello {{name}} {{name}}"}
    target = {"greeting": "Привет {{name}}"}

    audit = checker.audit_catalog(source, target, locale="ru", baseline={"missing": [], "extra": []})

    assert audit.interpolation_mismatch == {"greeting"}
    assert not audit.ok


@pytest.mark.parametrize(
    "override",
    [
        {"schema_version": 2},
        {"baseline_commit": "HEAD"},
        {"review_date": "today"},
        {"unexpected": True},
    ],
    ids=["schema-version", "commit-format", "date-format", "unknown-field"],
)
def test_baseline_rejects_non_exact_top_level_schema(tmp_path: Path, override: dict) -> None:
    baseline = {**_valid_baseline(), **override}
    path = tmp_path / "baseline.json"
    path.write_text(json.dumps(baseline), encoding="utf-8")

    with pytest.raises(checker.CatalogError):
        checker.load_baseline(path)


def test_baseline_rejects_broad_or_duplicate_debt_identity(tmp_path: Path) -> None:
    baseline = _valid_baseline()
    baseline["shared_debt"] = {
        "locales": ["de"],
        "missing": ["components.*", "components.*"],
        "extra": [],
    }
    path = tmp_path / "baseline.json"
    path.write_text(json.dumps(baseline), encoding="utf-8")

    with pytest.raises(checker.CatalogError):
        checker.load_baseline(path)


def test_unvisited_locale_debt_is_reported_as_stale(tmp_path: Path) -> None:
    locales_dir = tmp_path / "locales"
    locales_dir.mkdir()
    (locales_dir / "en.json").write_text('{"key":"English"}', encoding="utf-8")
    (locales_dir / "de.json").write_text('{"key":"Deutsch"}', encoding="utf-8")
    baseline = _valid_baseline()
    baseline["locale_debt"] = {"ghost": {"missing": ["old.key"], "extra": []}}
    baseline_path = tmp_path / "baseline.json"
    baseline_path.write_text(json.dumps(baseline), encoding="utf-8")

    ok, report = checker.run_check(locales_dir, baseline_path, check_runtime=False)

    assert not ok
    assert report["stale_baseline_locales"] == ["ghost"]


@pytest.mark.parametrize(
    ("source", "expected_incomplete", "expected_invalid"),
    [
        (
            {"items_few": "few", "items_other": "other"},
            {"items": ["one"]},
            {"items": ["few"]},
        ),
        (
            {"items_one": "one", "items_few": "few", "items_other": "other"},
            {},
            {"items": ["few"]},
        ),
    ],
    ids=["incomplete-and-invalid", "invalid-category"],
)
def test_run_check_rejects_invalid_source_english_plural_contract(
    tmp_path: Path,
    source: dict[str, str],
    expected_incomplete: dict[str, list[str]],
    expected_invalid: dict[str, list[str]],
) -> None:
    locales_dir = tmp_path / "locales"
    locales_dir.mkdir()
    (locales_dir / "en.json").write_text(json.dumps(source), encoding="utf-8")
    (locales_dir / "de.json").write_text(
        json.dumps({"items_one": "eins", "items_other": "andere"}),
        encoding="utf-8",
    )
    baseline_path = tmp_path / "baseline.json"
    baseline_path.write_text(json.dumps(_valid_baseline()), encoding="utf-8")

    ok, report = checker.run_check(locales_dir, baseline_path, check_runtime=False)

    assert not ok
    assert report["source_incomplete_plural_groups"] == expected_incomplete
    assert report["source_invalid_plural_categories"] == expected_invalid
