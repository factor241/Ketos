from __future__ import annotations

# ruff: noqa: S101 - assertions are the behavior under test.
from copy import deepcopy
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

from conftest import commit_files, load_scanner, write_yaml


def test_frozen_baseline_captures_commit_counts_paths_and_env_tokens(
    git_repo: Path, tmp_path: Path, valid_brand_contract: dict, valid_legacy_contract: dict
) -> None:
    sha = commit_files(
        git_repo,
        {
            "src/compat.py": "from langflow import load_flow\nLANGFLOW_API_KEY = 'legacy'\n",
            "src/ketos.py": "PRODUCT = 'Ketos'\n",
            "langflow-plugin/README.md": "Ketos compatibility package\n",
        },
    )
    legacy = deepcopy(valid_legacy_contract)
    legacy["baseline"] = {
        "commit": sha,
        "brand_file_count": 1,
        "brand_line_count": 2,
        "brand_path_count": 1,
        "official_url_file_count": 0,
        "env_tokens": ["LANGFLOW_API_KEY"],
        "paths": ["src/compat.py"],
    }
    legacy["residues"].append(
        {
            "path": "src/compat.py",
            "match": "LANGFLOW_API_KEY",
            "category": "env_alias",
            "owner": "settings-compatibility",
            "reason": "Reads the old environment variable during migration.",
            "compatibility_test": "tests/test_env_precedence.py",
            "removal_condition": "Remove after the documented environment migration window.",
        }
    )
    scanner = load_scanner()
    report = scanner.scan_repository(
        git_repo,
        write_yaml(tmp_path / "brand.yaml", valid_brand_contract),
        write_yaml(tmp_path / "legacy.yaml", legacy),
    )
    assert report["baseline"] == legacy["baseline"]
    assert report["violations"] == []


def test_baseline_drift_is_a_violation_even_when_residue_is_allowlisted(
    git_repo: Path, tmp_path: Path, valid_brand_contract: dict, valid_legacy_contract: dict
) -> None:
    commit_files(git_repo, {"src/compat.py": "from langflow import load_flow\n"})
    scanner = load_scanner()
    report = scanner.scan_repository(
        git_repo,
        write_yaml(tmp_path / "brand.yaml", valid_brand_contract),
        write_yaml(tmp_path / "legacy.yaml", valid_legacy_contract),
    )
    assert any(item["kind"] == "baseline_drift" for item in report["violations"])
