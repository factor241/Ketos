#!/usr/bin/env python3
# ruff: noqa: EM101, EM102, TRY003
"""Strict backend locale and runtime-index contract checker.

Reviewed baseline debt is reported but does not hide new or stale debt. The
pre-Russian baseline explicitly records the absent ``ru`` catalog; Task 13
must remove that entry when the catalog is created.
"""

from __future__ import annotations

import argparse
import contextlib
import importlib.util
import io
import json
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any, NamedTuple

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LOCALES_DIR = ROOT / "src/backend/base/ketos/locales"
DEFAULT_BASELINE = Path(__file__).resolve().parent / "allowlists/backend-locale-debt.json"
RUNTIME_EXTRACTOR = ROOT / "scripts/gp/extract_backend_strings.py"

INTERPOLATION_RE = re.compile(r"{{\s*([A-Za-z_][\w.:-]*)\s*}}")
INTERPOLATION_START_RE = re.compile(r"{{\s*[A-Za-z_]")
NUMERIC_TAG_RE = re.compile(r"</?\d+>")
PLURAL_SUFFIX_RE = re.compile(r"^(.*)_(zero|one|two|few|many|other)$")
LOCALE_RE = re.compile(r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")
GIT_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
REVIEW_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
GLOB_CHARACTERS = frozenset("*?[]")

# Kept explicit so this checker remains usable on Python 3.14, where Babel is
# not currently installed by the workspace lock. These sets are covered by a
# contract test against the shipped locales' Intl.PluralRules cardinal output.
INTL_CARDINAL_CATEGORIES: dict[str, frozenset[str]] = {
    "en": frozenset({"one", "other"}),
    "ru": frozenset({"one", "few", "many", "other"}),
}


class CatalogError(ValueError):
    """Raised when a locale file violates the flat string schema."""


class CatalogAudit(NamedTuple):
    locale: str
    reviewed_missing: set[str]
    reviewed_extra: set[str]
    unapproved_missing: set[str]
    unapproved_extra: set[str]
    stale_baseline_missing: set[str]
    stale_baseline_extra: set[str]
    empty: set[str]
    interpolation_mismatch: set[str]
    numeric_tag_mismatch: set[str]

    @property
    def ok(self) -> bool:
        return not any(
            (
                self.unapproved_missing,
                self.unapproved_extra,
                self.stale_baseline_missing,
                self.stale_baseline_extra,
                self.empty,
                self.interpolation_mismatch,
                self.numeric_tag_mismatch,
            )
        )


class RuntimeAudit(NamedTuple):
    missing_from_catalog: set[str]
    stale_catalog_keys: set[str]
    value_mismatch: set[str]

    @property
    def ok(self) -> bool:
        return not any(self)


class AbsentLocaleAudit(NamedTuple):
    reviewed_absent: set[str]
    unapproved_absent: set[str]
    stale_baseline_absent: set[str]

    @property
    def ok(self) -> bool:
        return not self.unapproved_absent and not self.stale_baseline_absent


def load_flat_catalog(path: Path) -> dict[str, str]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CatalogError(f"{path}: invalid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise CatalogError(f"{path}: catalog must be a JSON object")
    for key, value in payload.items():
        if not isinstance(key, str) or not key:
            raise CatalogError(f"{path}: every key must be a non-empty string")
        if not isinstance(value, str):
            raise CatalogError(f"{path}: flat string schema required at {key!r}")
    return payload


def _has_malformed_interpolation(value: str) -> bool:
    """Return whether an identifier-like ``{{`` opener lacks a valid close.

    Double braces used in JSON/code examples (for example ``{{"filter"``)
    are not interpolation candidates and therefore remain outside this check.
    """
    for match in INTERPOLATION_START_RE.finditer(value):
        closing_index = value.find("}}", match.start() + 2)
        if closing_index < 0:
            return True
        candidate = value[match.start() : closing_index + 2]
        if INTERPOLATION_RE.fullmatch(candidate) is None:
            return True
    return False


def _tokens(value: str) -> tuple[Counter[str], Counter[str], bool]:
    return (
        Counter(INTERPOLATION_RE.findall(value)),
        Counter(NUMERIC_TAG_RE.findall(value)),
        _has_malformed_interpolation(value),
    )


def _plural_candidates(catalog: dict[str, str]) -> dict[str, dict[str, str]]:
    candidates: dict[str, dict[str, str]] = {}
    for key in catalog:
        match = PLURAL_SUFFIX_RE.match(key)
        if match:
            candidates.setdefault(match.group(1), {})[match.group(2)] = key
    return candidates


def _plural_groups(catalog: dict[str, str]) -> dict[str, dict[str, str]]:
    """Return source plural groups, avoiding accidental suffix-like keys."""
    return {base: forms for base, forms in _plural_candidates(catalog).items() if "other" in forms and len(forms) > 1}


def audit_catalog(
    source: dict[str, str],
    target: dict[str, str],
    *,
    locale: str,
    baseline: dict[str, Any],
) -> CatalogAudit:
    source_groups = _plural_groups(source)
    target_candidates = _plural_candidates(target)
    source_plural_keys = {key for forms in source_groups.values() for key in forms.values()}
    target_plural_keys: set[str] = set()
    value_pairs: list[tuple[str, str]] = []

    for base, source_forms in source_groups.items():
        target_forms = target_candidates.get(base, {})
        for category in plural_categories(locale):
            target_key = target_forms.get(category)
            if target_key is None:
                continue
            target_plural_keys.add(target_key)
            source_key = source_forms.get(category) or source_forms["other"]
            value_pairs.append((source_key, target_key))

    source_non_plural = set(source) - source_plural_keys
    target_non_plural = set(target) - target_plural_keys
    missing = source_non_plural - target_non_plural
    extra = target_non_plural - source_non_plural
    baseline_missing = set(baseline.get("missing", []))
    baseline_extra = set(baseline.get("extra", []))
    common = source_non_plural & target_non_plural
    value_pairs.extend((key, key) for key in common)
    interpolation_mismatch: set[str] = set()
    numeric_tag_mismatch: set[str] = set()
    checked_target_keys: set[str] = set()
    for source_key, target_key in value_pairs:
        checked_target_keys.add(target_key)
        source_interpolation, source_tags, source_malformed = _tokens(source[source_key])
        target_interpolation, target_tags, target_malformed = _tokens(target[target_key])
        if source_malformed or target_malformed or source_interpolation != target_interpolation:
            interpolation_mismatch.add(target_key)
        if source_tags != target_tags:
            numeric_tag_mismatch.add(target_key)
    return CatalogAudit(
        locale=locale,
        reviewed_missing=missing & baseline_missing,
        reviewed_extra=extra & baseline_extra,
        unapproved_missing=missing - baseline_missing,
        unapproved_extra=extra - baseline_extra,
        stale_baseline_missing=baseline_missing - missing,
        stale_baseline_extra=baseline_extra - extra,
        empty={key for key in checked_target_keys if not target[key].strip()},
        interpolation_mismatch=interpolation_mismatch,
        numeric_tag_mismatch=numeric_tag_mismatch,
    )


def plural_categories(locale: str) -> set[str]:
    normalized = locale.replace("_", "-").lower()
    categories = INTL_CARDINAL_CATEGORIES.get(normalized)
    if categories is None:
        categories = INTL_CARDINAL_CATEGORIES.get(normalized.split("-")[0])
    if categories is None:
        raise CatalogError(f"No reviewed Intl.PluralRules contract for locale {locale!r}")
    return set(categories)


def find_incomplete_plural_groups(catalog: dict[str, str], locale: str) -> dict[str, set[str]]:
    groups = {base: set(forms) for base, forms in _plural_candidates(catalog).items()}
    required = plural_categories(locale)
    return {base: required - categories for base, categories in groups.items() if required - categories}


def find_invalid_plural_categories(catalog: dict[str, str], locale: str) -> dict[str, set[str]]:
    groups = {base: set(forms) for base, forms in _plural_candidates(catalog).items()}
    allowed = plural_categories(locale)
    return {base: categories - allowed for base, categories in groups.items() if categories - allowed}


def find_missing_plural_groups(source: dict[str, str], target: dict[str, str], locale: str) -> dict[str, set[str]]:
    """Find missing target categories for every plural group in the source."""
    target_groups = _plural_candidates(target)
    required = plural_categories(locale)
    missing: dict[str, set[str]] = {}
    for base in _plural_groups(source):
        absent = required - set(target_groups.get(base, {}))
        if absent:
            missing[base] = absent
    return missing


def audit_runtime_index(english: dict[str, str], runtime: dict[str, str]) -> RuntimeAudit:
    common = set(english) & set(runtime)
    return RuntimeAudit(
        missing_from_catalog=set(runtime) - set(english),
        stale_catalog_keys=set(english) - set(runtime),
        value_mismatch={key for key in common if english[key] != runtime[key]},
    )


def audit_absent_locales(present: set[str], required: set[str], baseline_absent: set[str]) -> AbsentLocaleAudit:
    absent = required - present
    return AbsentLocaleAudit(
        reviewed_absent=absent & baseline_absent,
        unapproved_absent=absent - baseline_absent,
        stale_baseline_absent=baseline_absent - absent,
    )


def _assert_exact_object(value: Any, allowed_fields: set[str], label: str, path: Path) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise CatalogError(f"{path}: {label} must be an object")
    unknown = set(value) - allowed_fields
    if unknown:
        raise CatalogError(f"{path}: {label} contains unknown field(s): {', '.join(sorted(unknown))}")
    return value


def _validate_exact_string_list(
    value: Any,
    *,
    label: str,
    path: Path,
    locale_codes: bool = False,
    forbid_globs: bool = False,
) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) or not item.strip() for item in value):
        raise CatalogError(f"{path}: {label} must be an array of non-empty strings")
    if len(value) != len(set(value)):
        raise CatalogError(f"{path}: {label} contains a duplicate identity")
    if locale_codes and any(LOCALE_RE.fullmatch(item) is None for item in value):
        raise CatalogError(f"{path}: {label} contains an invalid locale code")
    if forbid_globs and any(any(character in item for character in GLOB_CHARACTERS) for item in value):
        raise CatalogError(f"{path}: {label} must contain exact keys; glob patterns are forbidden")
    return value


def _validate_debt_block(value: Any, *, label: str, path: Path) -> dict[str, list[str]]:
    block = _assert_exact_object(value, {"missing", "extra"}, label, path)
    missing = _validate_exact_string_list(block.get("missing"), label=f"{label}.missing", path=path, forbid_globs=True)
    extra = _validate_exact_string_list(block.get("extra"), label=f"{label}.extra", path=path, forbid_globs=True)
    overlap = set(missing) & set(extra)
    if overlap:
        raise CatalogError(f"{path}: {label} repeats identities across missing and extra")
    return {"missing": missing, "extra": extra}


def load_baseline(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CatalogError(f"{path}: invalid baseline JSON: {exc}") from exc
    payload = _assert_exact_object(
        payload,
        {
            "schema_version",
            "baseline_commit",
            "reason",
            "owner",
            "review_date",
            "required_locales",
            "absent_locales",
            "shared_debt",
            "locale_debt",
        },
        "baseline",
        path,
    )
    if payload.get("schema_version") != 1:
        raise CatalogError(f"{path}: baseline.schema_version must equal 1")
    for field in ("reason", "owner"):
        if not isinstance(payload.get(field), str) or not payload[field].strip():
            raise CatalogError(f"{path}: baseline field {field!r} is required")
    if not isinstance(payload.get("baseline_commit"), str) or GIT_SHA_RE.fullmatch(payload["baseline_commit"]) is None:
        raise CatalogError(f"{path}: baseline.baseline_commit must be a 40-character lowercase Git SHA")
    review_date = payload.get("review_date")
    if not isinstance(review_date, str) or REVIEW_DATE_RE.fullmatch(review_date) is None:
        raise CatalogError(f"{path}: baseline.review_date must use YYYY-MM-DD")
    try:
        date.fromisoformat(review_date)
    except ValueError as exc:
        raise CatalogError(f"{path}: baseline.review_date is not a valid calendar date") from exc

    required = _validate_exact_string_list(
        payload.get("required_locales"), label="baseline.required_locales", path=path, locale_codes=True
    )
    absent = _validate_exact_string_list(
        payload.get("absent_locales"), label="baseline.absent_locales", path=path, locale_codes=True
    )
    if "en" not in required:
        raise CatalogError(f"{path}: baseline.required_locales must include source locale 'en'")
    if not set(absent) <= set(required):
        raise CatalogError(f"{path}: baseline.absent_locales must be a subset of required_locales")

    shared = _assert_exact_object(
        payload.get("shared_debt"), {"locales", "missing", "extra"}, "baseline.shared_debt", path
    )
    shared_locales = _validate_exact_string_list(
        shared.get("locales"), label="baseline.shared_debt.locales", path=path, locale_codes=True
    )
    shared_debt = _validate_debt_block(
        {"missing": shared.get("missing"), "extra": shared.get("extra")},
        label="baseline.shared_debt",
        path=path,
    )
    if not set(shared_locales) <= set(required):
        raise CatalogError(f"{path}: baseline.shared_debt.locales must be required locales")
    if set(shared_locales) & set(absent):
        raise CatalogError(f"{path}: absent locales cannot carry shared debt")

    locale_debt = payload.get("locale_debt", {})
    if not isinstance(locale_debt, dict):
        raise CatalogError(f"{path}: baseline.locale_debt must be an object")
    validated_locale_debt: dict[str, dict[str, list[str]]] = {}
    for locale, block in locale_debt.items():
        if (
            not isinstance(locale, str)
            or not locale.strip()
            or any(character in locale for character in GLOB_CHARACTERS)
        ):
            raise CatalogError(f"{path}: baseline.locale_debt requires an exact non-empty locale identity")
        if locale in shared_locales:
            raise CatalogError(f"{path}: locale {locale!r} appears in shared and locale-specific debt")
        validated_locale_debt[locale] = _validate_debt_block(block, label=f"baseline.locale_debt.{locale}", path=path)

    payload["shared_debt"] = {"locales": shared_locales, **shared_debt}
    payload["locale_debt"] = validated_locale_debt
    return payload


def baseline_for_locale(baseline: dict[str, Any], locale: str) -> dict[str, list[str]]:
    shared = baseline.get("shared_debt", {})
    if locale in shared.get("locales", []):
        return {"missing": list(shared.get("missing", [])), "extra": list(shared.get("extra", []))}
    return dict(baseline.get("locale_debt", {}).get(locale, {"missing": [], "extra": []}))


def load_runtime_index() -> dict[str, str]:
    spec = importlib.util.spec_from_file_location("extract_backend_strings_runtime", RUNTIME_EXTRACTOR)
    if not spec or not spec.loader:
        raise CatalogError(f"Could not load runtime extractor: {RUNTIME_EXTRACTOR}")
    module = importlib.util.module_from_spec(spec)
    with contextlib.redirect_stdout(io.StringIO()):
        spec.loader.exec_module(module)
        runtime = module.collect_strings()
    if not isinstance(runtime, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in runtime.items()):
        raise CatalogError("Runtime component index is not a flat string mapping")
    return runtime


def _set_payload(values: set[str]) -> list[str]:
    return sorted(values)


def run_check(locales_dir: Path, baseline_path: Path, *, check_runtime: bool) -> tuple[bool, dict[str, Any]]:
    baseline = load_baseline(baseline_path)
    english_path = locales_dir / "en.json"
    english = load_flat_catalog(english_path)
    source_incomplete_plurals = find_incomplete_plural_groups(english, "en")
    source_invalid_plurals = find_invalid_plural_categories(english, "en")
    locale_paths = sorted(locales_dir.glob("*.json"))
    present = {path.stem for path in locale_paths}
    required = set(baseline.get("required_locales", []))
    absent_audit = audit_absent_locales(present, required, set(baseline.get("absent_locales", [])))
    baseline_debt_locales = set(baseline.get("shared_debt", {}).get("locales", [])) | set(
        baseline.get("locale_debt", {})
    )
    stale_baseline_locales = baseline_debt_locales - (present - {"en"})
    unapproved_present_locales = present - required
    ok = (
        absent_audit.ok
        and not stale_baseline_locales
        and not unapproved_present_locales
        and not source_incomplete_plurals
        and not source_invalid_plurals
    )
    report: dict[str, Any] = {
        "source_keys": len(english),
        "source_incomplete_plural_groups": {
            key: sorted(value) for key, value in sorted(source_incomplete_plurals.items())
        },
        "source_invalid_plural_categories": {
            key: sorted(value) for key, value in sorted(source_invalid_plurals.items())
        },
        "stale_baseline_locales": _set_payload(stale_baseline_locales),
        "unapproved_present_locales": _set_payload(unapproved_present_locales),
        "absent_locales": {
            "reviewed": _set_payload(absent_audit.reviewed_absent),
            "unapproved": _set_payload(absent_audit.unapproved_absent),
            "stale_baseline": _set_payload(absent_audit.stale_baseline_absent),
        },
        "locales": {},
    }
    for path in locale_paths:
        locale = path.stem
        if locale == "en":
            continue
        target = load_flat_catalog(path)
        audit = audit_catalog(english, target, locale=locale, baseline=baseline_for_locale(baseline, locale))
        incomplete_plurals = find_missing_plural_groups(english, target, locale)
        locale_ok = audit.ok and not incomplete_plurals
        ok = ok and locale_ok
        report["locales"][locale] = {
            "keys": len(target),
            "reviewed_missing": _set_payload(audit.reviewed_missing),
            "reviewed_extra": _set_payload(audit.reviewed_extra),
            "unapproved_missing": _set_payload(audit.unapproved_missing),
            "unapproved_extra": _set_payload(audit.unapproved_extra),
            "stale_baseline_missing": _set_payload(audit.stale_baseline_missing),
            "stale_baseline_extra": _set_payload(audit.stale_baseline_extra),
            "empty": _set_payload(audit.empty),
            "interpolation_mismatch": _set_payload(audit.interpolation_mismatch),
            "numeric_tag_mismatch": _set_payload(audit.numeric_tag_mismatch),
            "incomplete_plural_groups": {key: sorted(value) for key, value in sorted(incomplete_plurals.items())},
            "ok": locale_ok,
        }
    if check_runtime:
        runtime_audit = audit_runtime_index(english, load_runtime_index())
        ok = ok and runtime_audit.ok
        report["runtime_index"] = {
            "missing_from_catalog": _set_payload(runtime_audit.missing_from_catalog),
            "stale_catalog_keys": _set_payload(runtime_audit.stale_catalog_keys),
            "value_mismatch": _set_payload(runtime_audit.value_mismatch),
            "ok": runtime_audit.ok,
        }
    report["ok"] = ok
    return ok, report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--locales-dir", type=Path, default=DEFAULT_LOCALES_DIR)
    parser.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    parser.add_argument(
        "--skip-runtime", action="store_true", help="Skip the expensive live component index comparison"
    )
    parser.add_argument("--json", action="store_true", help="Emit a machine-readable report")
    args = parser.parse_args(argv)
    try:
        ok, report = run_check(args.locales_dir, args.baseline, check_runtime=not args.skip_runtime)
    except CatalogError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    else:
        absent = report["absent_locales"]
        print(f"Backend source catalog: {report['source_keys']} keys")
        if absent["reviewed"]:
            print(f"REVIEWED DEBT absent locales: {', '.join(absent['reviewed'])}")
        for locale, result in sorted(report["locales"].items()):
            status = "PASS" if result["ok"] else "FAIL"
            print(
                f"{status} {locale}: {result['keys']} keys; "
                f"reviewed missing={len(result['reviewed_missing'])}, extra={len(result['reviewed_extra'])}"
            )
        if "runtime_index" in report:
            print(f"{'PASS' if report['runtime_index']['ok'] else 'FAIL'} runtime component index")
        print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
