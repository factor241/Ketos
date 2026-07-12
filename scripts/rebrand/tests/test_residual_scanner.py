from __future__ import annotations

# ruff: noqa: S101 - assertions are the behavior under test.
from copy import deepcopy
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

from conftest import commit_files, load_scanner, write_yaml


def freeze_baseline(
    legacy: dict,
    *,
    commit: str,
    brand_file_count: int,
    brand_line_count: int,
    paths: list[str],
    official_url_file_count: int = 0,
) -> dict:
    frozen = deepcopy(legacy)
    frozen["baseline"] = {
        "commit": commit,
        "brand_file_count": brand_file_count,
        "brand_line_count": brand_line_count,
        "brand_path_count": 0,
        "official_url_file_count": official_url_file_count,
        "env_tokens": [],
        "paths": paths,
    }
    return frozen


def scan(scanner, repo: Path, tmp_path: Path, brand: dict, legacy: dict) -> dict:
    brand_path = write_yaml(tmp_path / "brand.yaml", brand)
    legacy_path = write_yaml(tmp_path / "legacy.yaml", legacy)
    report = scanner.scan_repository(repo, brand_path, legacy_path)
    assert isinstance(report, dict)
    assert isinstance(report.get("violations"), list)
    assert isinstance(report.get("allowed_residue"), list)
    return report


def kinds(report: dict) -> set[str]:
    return {item["kind"] for item in report["violations"]}


def test_scan_is_tracked_only(
    git_repo: Path, tmp_path: Path, valid_brand_contract: dict, valid_legacy_contract: dict
) -> None:
    sha = commit_files(git_repo, {"src/app.ts": 'export const title = "Ketos";\n'})
    (git_repo / "untracked.txt").write_text("Langflow should be ignored\n", encoding="utf-8")
    scanner = load_scanner()
    legacy = freeze_baseline(valid_legacy_contract, commit=sha, brand_file_count=0, brand_line_count=0, paths=[])
    legacy["residues"] = []
    report = scan(scanner, git_repo, tmp_path, valid_brand_contract, legacy)
    assert report["violations"] == []
    assert all(item["path"] != "untracked.txt" for item in report["allowed_residue"])


def test_user_visible_residue_is_not_allowlisted_by_default(
    git_repo: Path, tmp_path: Path, valid_brand_contract: dict, valid_legacy_contract: dict
) -> None:
    sha = commit_files(git_repo, {"src/app.ts": 'export const title = "Welcome to Langflow";\n'})
    legacy = freeze_baseline(
        valid_legacy_contract,
        commit=sha,
        brand_file_count=1,
        brand_line_count=1,
        paths=["src/app.ts"],
    )
    legacy["residues"] = []
    report = scan(load_scanner(), git_repo, tmp_path, valid_brand_contract, legacy)
    assert "user_visible" in kinds(report)


def test_official_url_is_rejected_but_provider_link_is_not(
    git_repo: Path, tmp_path: Path, valid_brand_contract: dict, valid_legacy_contract: dict
) -> None:
    sha = commit_files(
        git_repo,
        {
            "docs/official.md": "https://github.com/langflow-ai/langflow\n",
            "src/providers.ts": (
                'const githubApi = "https://api.github.com/repos/customer/project";\n'
                'const discordWebhook = "https://discord.com/api/webhooks/123/token";\n'
            ),
        },
    )
    legacy = freeze_baseline(
        valid_legacy_contract,
        commit=sha,
        brand_file_count=1,
        brand_line_count=1,
        paths=["docs/official.md"],
        official_url_file_count=1,
    )
    legacy["residues"] = []
    report = scan(load_scanner(), git_repo, tmp_path, valid_brand_contract, legacy)
    official = [item for item in report["violations"] if item["kind"] == "official_url"]
    assert [item["path"] for item in official] == ["docs/official.md"]


def test_null_contract_url_disables_feature_and_does_not_legalize_upstream_url(
    git_repo: Path, tmp_path: Path, valid_brand_contract: dict, valid_legacy_contract: dict
) -> None:
    assert valid_brand_contract["docs_url"] is None
    sha = commit_files(git_repo, {"docs/help.md": "Read https://docs.langflow.org/guide\n"})
    legacy = freeze_baseline(
        valid_legacy_contract,
        commit=sha,
        brand_file_count=1,
        brand_line_count=1,
        paths=["docs/help.md"],
        official_url_file_count=1,
    )
    legacy["residues"] = []
    report = scan(load_scanner(), git_repo, tmp_path, valid_brand_contract, legacy)
    assert "official_url" in kinds(report)


def test_exact_allowlisted_technical_residue_is_reported_as_allowed(
    git_repo: Path, tmp_path: Path, valid_brand_contract: dict, valid_legacy_contract: dict
) -> None:
    sha = commit_files(git_repo, {"src/compat.py": "from langflow import load_flow\n"})
    legacy = freeze_baseline(
        valid_legacy_contract,
        commit=sha,
        brand_file_count=1,
        brand_line_count=1,
        paths=["src/compat.py"],
    )
    report = scan(load_scanner(), git_repo, tmp_path, valid_brand_contract, legacy)
    assert report["violations"] == []
    assert report["allowed_residue"] == [
        {
            "path": "src/compat.py",
            "line": 1,
            "match": "from langflow import load_flow",
            "category": "import_alias",
            "owner": "backend-compatibility",
            "reason": "Existing integrations import the historical package.",
            "compatibility_test": "src/backend/tests/unit/test_langflow_components_compat_shim.py",
            "removal_condition": "Remove only after the published compatibility window ends.",
        }
    ]


def test_changed_or_new_technical_residue_fails_closed(
    git_repo: Path, tmp_path: Path, valid_brand_contract: dict, valid_legacy_contract: dict
) -> None:
    sha = commit_files(git_repo, {"src/compat.py": "from langflow import NEW_UNREVIEWED_API\n"})
    legacy = freeze_baseline(
        valid_legacy_contract,
        commit=sha,
        brand_file_count=1,
        brand_line_count=1,
        paths=["src/compat.py"],
    )
    report = scan(load_scanner(), git_repo, tmp_path, valid_brand_contract, legacy)
    assert "unallowlisted_technical" in kinds(report)
