from __future__ import annotations

# ruff: noqa: S101, S603 - pytest assertions and scanner subprocess scaffolding are intentional.
import subprocess
from copy import deepcopy
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

from conftest import commit_files, parse_json_output, scanner_command, write_yaml

INVALID_CONTRACT_EXIT_CODE = 2


def contracts(tmp_path: Path, brand: dict, legacy: dict) -> tuple[Path, Path]:
    return write_yaml(tmp_path / "brand.yaml", brand), write_yaml(tmp_path / "legacy.yaml", legacy)


def test_cli_exit_zero_and_json_are_deterministic_for_clean_repo(
    git_repo: Path, tmp_path: Path, valid_brand_contract: dict, valid_legacy_contract: dict
) -> None:
    sha = commit_files(git_repo, {"src/app.ts": 'export const title = "Ketos";\n'})
    legacy = deepcopy(valid_legacy_contract)
    legacy["baseline"] = {
        "commit": sha,
        "brand_file_count": 0,
        "brand_line_count": 0,
        "brand_path_count": 0,
        "official_url_file_count": 0,
        "env_tokens": [],
        "paths": [],
    }
    legacy["residues"] = []
    brand_path, legacy_path = contracts(tmp_path, valid_brand_contract, legacy)
    command = scanner_command(git_repo, brand_path, legacy_path)
    first = subprocess.run(command, text=True, capture_output=True, check=False)
    second = subprocess.run(command, text=True, capture_output=True, check=False)
    assert first.returncode == 0, first.stderr or first.stdout
    assert second.returncode == 0, second.stderr or second.stdout
    assert first.stdout == second.stdout
    assert parse_json_output(first.stdout)["violations"] == []


def test_cli_exit_one_for_brand_violation(
    git_repo: Path, tmp_path: Path, valid_brand_contract: dict, valid_legacy_contract: dict
) -> None:
    commit_files(git_repo, {"src/app.ts": 'export const title = "Langflow";\n'})
    brand_path, legacy_path = contracts(tmp_path, valid_brand_contract, valid_legacy_contract)
    completed = subprocess.run(
        scanner_command(git_repo, brand_path, legacy_path), text=True, capture_output=True, check=False
    )
    assert completed.returncode == 1
    assert parse_json_output(completed.stdout)["violations"]


def test_cli_exit_two_for_invalid_contract(
    git_repo: Path, tmp_path: Path, valid_brand_contract: dict, valid_legacy_contract: dict
) -> None:
    commit_files(git_repo, {"src/app.ts": "Ketos\n"})
    invalid = deepcopy(valid_brand_contract)
    invalid.pop("product_name")
    brand_path, legacy_path = contracts(tmp_path, invalid, valid_legacy_contract)
    completed = subprocess.run(
        scanner_command(git_repo, brand_path, legacy_path), text=True, capture_output=True, check=False
    )
    assert completed.returncode == INVALID_CONTRACT_EXIT_CODE
    payload = parse_json_output(completed.stdout)
    assert payload["contract_errors"]
    assert payload["violations"] == []
