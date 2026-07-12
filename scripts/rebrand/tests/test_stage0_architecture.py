from __future__ import annotations

# ruff: noqa: S101, S603, S607 - pytest assertions and fixed CLI/Git subprocess scaffolding are intentional.
import subprocess
from copy import deepcopy
from pathlib import Path

import yaml
from conftest import commit_files, load_scanner, write_yaml

SHA256_HEX_LENGTH = 64


def freeze(scanner, repo: Path, path: Path) -> dict:
    contract = scanner.freeze_contract(repo)
    write_yaml(path, contract)
    return contract


def scan(scanner, repo: Path, tmp_path: Path, brand: dict, legacy: dict, profile: str = "stage0") -> dict:
    return scanner.scan_repository(
        repo,
        write_yaml(tmp_path / "brand.yaml", brand),
        write_yaml(tmp_path / "legacy.yaml", legacy),
        profile=profile,
    )


def test_stage0_is_stable_after_an_unrelated_next_commit(
    git_repo: Path, tmp_path: Path, valid_brand_contract: dict
) -> None:
    commit_files(git_repo, {"src/compat.py": "from langflow import load_flow\n"})
    scanner = load_scanner()
    legacy = freeze(scanner, git_repo, tmp_path / "legacy.yaml")
    commit_files(git_repo, {"README.md": "Ketos\n"}, message="unrelated next commit")
    report = scan(scanner, git_repo, tmp_path, valid_brand_contract, legacy)
    assert report["violations"] == []


def test_duplicate_of_a_frozen_line_is_an_addition(git_repo: Path, tmp_path: Path, valid_brand_contract: dict) -> None:
    commit_files(git_repo, {"src/compat.py": "from langflow import load_flow\n"})
    scanner = load_scanner()
    legacy = freeze(scanner, git_repo, tmp_path / "legacy.yaml")
    commit_files(
        git_repo,
        {"src/compat.py": "from langflow import load_flow\nfrom langflow import load_flow\n"},
        message="duplicate",
    )
    report = scan(scanner, git_repo, tmp_path, valid_brand_contract, legacy)
    assert "debt_addition" in {item["kind"] for item in report["violations"]}


def test_same_path_same_count_user_visible_substitution_is_an_addition(
    git_repo: Path, tmp_path: Path, valid_brand_contract: dict
) -> None:
    commit_files(git_repo, {"src/app.ts": 'export const title = "Welcome to Langflow";\n'})
    scanner = load_scanner()
    legacy = freeze(scanner, git_repo, tmp_path / "legacy.yaml")
    commit_files(
        git_repo,
        {"src/app.ts": 'export const title = "Launch Langflow";\n'},
        message="substitute user-visible residue",
    )
    report = scan(scanner, git_repo, tmp_path, valid_brand_contract, legacy)
    assert "debt_addition" in {item["kind"] for item in report["violations"]}


def test_same_path_same_count_official_url_substitution_is_an_addition(
    git_repo: Path, tmp_path: Path, valid_brand_contract: dict
) -> None:
    commit_files(git_repo, {"docs/telemetry.md": "https://api.scarf.sh/v1/pixel\n"})
    scanner = load_scanner()
    legacy = freeze(scanner, git_repo, tmp_path / "legacy.yaml")
    commit_files(
        git_repo,
        {"docs/telemetry.md": "https://docs.langflow.org/guide\n"},
        message="substitute official URL residue",
    )
    report = scan(scanner, git_repo, tmp_path, valid_brand_contract, legacy)
    assert "debt_addition" in {item["kind"] for item in report["violations"]}


def test_removed_technical_residue_is_reported_stale(
    git_repo: Path, tmp_path: Path, valid_brand_contract: dict
) -> None:
    commit_files(git_repo, {"src/compat.py": "from langflow import load_flow\n"})
    scanner = load_scanner()
    legacy = freeze(scanner, git_repo, tmp_path / "legacy.yaml")
    commit_files(git_repo, {"src/compat.py": "from ketos import load_flow\n"}, message="migrated")
    report = scan(scanner, git_repo, tmp_path, valid_brand_contract, legacy)
    assert "stale_technical_debt" in {item["kind"] for item in report["violations"]}


def test_official_url_without_langflow_literal_is_detected(
    git_repo: Path, tmp_path: Path, valid_brand_contract: dict
) -> None:
    commit_files(git_repo, {"src/telemetry.py": 'URL = "https://api.scarf.sh/v1/pixel"\n'})
    scanner = load_scanner()
    legacy = freeze(scanner, git_repo, tmp_path / "legacy.yaml")
    report = scan(scanner, git_repo, tmp_path, valid_brand_contract, legacy, profile="final")
    assert "official_url" in {item["kind"] for item in report["violations"]}


def test_unrelated_third_party_discord_invite_is_not_official(
    git_repo: Path, tmp_path: Path, valid_brand_contract: dict
) -> None:
    commit_files(git_repo, {"docs/provider.md": "https://discord.gg/third-party-provider\n"})
    scanner = load_scanner()
    legacy = freeze(scanner, git_repo, tmp_path / "legacy.yaml")
    report = scan(scanner, git_repo, tmp_path, valid_brand_contract, legacy, profile="final")
    assert report["violations"] == []


def test_schema_store_and_telemetry_upstream_urls_are_official() -> None:
    scanner = load_scanner()
    assert scanner.is_official_url("https://schemas.langflow.org/extension/v1.json")
    assert scanner.is_official_url("https://api.langflow.store")
    assert scanner.is_official_url("https://api.scarf.sh/v1/pixel")


def test_brand_residue_in_a_filename_is_scanned(git_repo: Path, tmp_path: Path, valid_brand_contract: dict) -> None:
    commit_files(git_repo, {"src/langflow_adapter.py": "Ketos compatibility adapter\n"})
    scanner = load_scanner()
    legacy = freeze(scanner, git_repo, tmp_path / "legacy.yaml")
    report = scan(scanner, git_repo, tmp_path, valid_brand_contract, legacy, profile="final")
    assert "filename" in {item["kind"] for item in report["violations"]}


def test_tracked_symlink_is_read_as_a_git_blob_without_disclosing_target(git_repo: Path, tmp_path: Path) -> None:
    secret = tmp_path / "outside-secret.txt"
    secret.write_text("SECRET_TOKEN=top-secret Langflow\n", encoding="utf-8")
    link = git_repo / "safe-link"
    link.symlink_to(secret)
    subprocess.run(["git", "add", "safe-link"], cwd=git_repo, check=True)
    subprocess.run(["git", "commit", "-qm", "symlink"], cwd=git_repo, check=True)
    scanner = load_scanner()
    inventory = scanner.inventory_repository(git_repo)
    rendered = yaml.safe_dump(inventory)
    assert "SECRET_TOKEN" not in rendered
    assert "top-secret" not in rendered


def test_brand_contract_enforces_canonical_ketos_values(tmp_path: Path, valid_brand_contract: dict) -> None:
    scanner = load_scanner()
    invalid = deepcopy(valid_brand_contract)
    invalid["product_name"] = "Ketos Enterprise"
    errors = scanner.validate_brand_contract(write_yaml(tmp_path / "brand.yaml", invalid))
    assert any("product_name" in error and "canonical" in error for error in errors)


def test_profiles_keep_stage0_debt_but_final_does_not_legalize_it(
    git_repo: Path, tmp_path: Path, valid_brand_contract: dict
) -> None:
    commit_files(git_repo, {"src/app.ts": 'export const title = "Langflow";\n'})
    scanner = load_scanner()
    legacy = freeze(scanner, git_repo, tmp_path / "legacy.yaml")
    assert scan(scanner, git_repo, tmp_path, valid_brand_contract, legacy, profile="stage0")["violations"] == []
    final = scan(scanner, git_repo, tmp_path, valid_brand_contract, legacy, profile="final")
    assert "user_visible" in {item["kind"] for item in final["violations"]}


def test_frozen_migration_debt_is_separate_from_all_eight_technical_categories(git_repo: Path) -> None:
    commit_files(
        git_repo,
        {
            "src/app.ts": 'const title = "Langflow";\n',
            "src/compat.py": "from langflow import load_flow\n",
        },
    )
    contract = load_scanner().freeze_contract(git_repo)
    assert set(contract["migration_debt"]) == {"user_visible", "official_url", "filename"}
    assert set(contract["technical_debt"]) == set(load_scanner().LEGACY_CATEGORIES)
    for group in contract["migration_debt"].values():
        assert set(group) == {
            "owner",
            "reason",
            "compatibility_test",
            "removal_condition",
            "occurrences",
        }
        assert all(
            set(entry) == {"path", "count", "fingerprints"}
            and entry["count"] == len(entry["fingerprints"])
            and all(len(fingerprint) == SHA256_HEX_LENGTH for fingerprint in entry["fingerprints"])
            for entry in group["occurrences"]
        )


def test_cli_supports_freeze_and_all_profiles(git_repo: Path, tmp_path: Path) -> None:
    commit_files(git_repo, {"src/app.ts": "Ketos\n"})
    scanner_path = Path(__file__).resolve().parents[1] / "check_brand.py"
    frozen = tmp_path / "frozen.yaml"
    freeze_run = subprocess.run(
        ["uv", "run", "python", str(scanner_path), "--repo", str(git_repo), "--freeze", str(frozen)],
        check=False,
        text=True,
        capture_output=True,
    )
    assert freeze_run.returncode == 0, freeze_run.stderr
    assert frozen.is_file()
    for profile in ("stage0", "final", "release"):
        help_run = subprocess.run(
            ["uv", "run", "python", str(scanner_path), "--profile", profile, "--help"],
            check=False,
            text=True,
            capture_output=True,
        )
        assert help_run.returncode == 0
