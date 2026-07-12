from __future__ import annotations

# ruff: noqa: S101 - assertions are the behavior under test.
from copy import deepcopy
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

import pytest
from conftest import commit_files, load_scanner, write_yaml

CATEGORIES = (
    "import_alias",
    "env_alias",
    "data_path",
    "historical_migration",
    "historical_fixture",
    "wire_protocol",
    "external_resource_id",
    "legal_provenance",
)
RESIDUE_FIELDS = (
    "path",
    "match",
    "category",
    "owner",
    "reason",
    "compatibility_test",
    "removal_condition",
)
BASELINE_FIELDS = (
    "commit",
    "brand_file_count",
    "brand_line_count",
    "brand_path_count",
    "official_url_file_count",
    "env_tokens",
    "paths",
)


def validate(tmp_path: Path, contract: dict) -> list[str]:
    scanner = load_scanner()
    path = write_yaml(tmp_path / "legacy.yaml", contract)
    result = scanner.validate_legacy_contract(path)
    assert isinstance(result, list)
    return result


def test_legacy_contract_schema_and_categories_are_exact(tmp_path: Path, valid_legacy_contract: dict) -> None:
    scanner = load_scanner()
    assert tuple(scanner.LEGACY_CATEGORIES) == CATEGORIES
    assert tuple(scanner.LEGACY_RESIDUE_FIELDS) == RESIDUE_FIELDS
    assert tuple(scanner.BASELINE_FIELDS) == BASELINE_FIELDS
    assert validate(tmp_path, valid_legacy_contract) == []


@pytest.mark.parametrize("field", ["owner", "reason", "compatibility_test", "removal_condition"])
def test_each_residue_requires_exact_ownership_metadata(
    tmp_path: Path, valid_legacy_contract: dict, field: str
) -> None:
    contract = deepcopy(valid_legacy_contract)
    contract["residues"][0].pop(field)
    errors = validate(tmp_path, contract)
    assert any(field in error and "missing" in error.lower() for error in errors)


def test_unknown_allowlist_category_is_rejected(tmp_path: Path, valid_legacy_contract: dict) -> None:
    contract = deepcopy(valid_legacy_contract)
    contract["residues"][0]["category"] = "temporary_exception"
    errors = validate(tmp_path, contract)
    assert any("temporary_exception" in error and "category" in error.lower() for error in errors)


def test_baseline_requires_full_commit_counts_and_sorted_paths(tmp_path: Path, valid_legacy_contract: dict) -> None:
    contract = deepcopy(valid_legacy_contract)
    contract["baseline"]["commit"] = "main"
    contract["baseline"]["paths"] = ["z.py", "a.py"]
    errors = validate(tmp_path, contract)
    assert any("commit" in error for error in errors)
    assert any("paths" in error and "sorted" in error.lower() for error in errors)


@pytest.mark.parametrize("field", ["owner", "reason", "compatibility_test", "removal_condition"])
def test_each_migration_debt_group_requires_ownership_metadata(git_repo: Path, tmp_path: Path, field: str) -> None:
    scanner = load_scanner()
    commit_files(git_repo, {"src/app.ts": 'export const title = "Langflow";\n'})
    contract = scanner.freeze_contract(git_repo)
    contract["migration_debt"]["user_visible"].pop(field)
    errors = validate(tmp_path, contract)
    assert any(f"migration_debt.user_visible.{field}" in error and "missing" in error for error in errors)


def test_migration_debt_occurrences_require_stable_fingerprints(git_repo: Path, tmp_path: Path) -> None:
    scanner = load_scanner()
    commit_files(git_repo, {"src/app.ts": 'export const title = "Langflow";\n'})
    contract = scanner.freeze_contract(git_repo)
    contract["migration_debt"]["user_visible"]["occurrences"][0].pop("fingerprints")
    errors = validate(tmp_path, contract)
    assert any("fingerprints" in error and "exactly" in error for error in errors)
