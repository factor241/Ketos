from __future__ import annotations

# ruff: noqa: S101, S603, S607 - assertions and fixed CLI subprocess are intentional.
import hashlib
import importlib.util
import io
import json
import subprocess
import sys
import tarfile
import warnings
import zipfile
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
SCANNER_PATH = REPO_ROOT / "scripts/rebrand/check_brand.py"
ZERO_RESIDUE_CONTRACT = REPO_ROOT / "brand/ketos-zero-residue-contract.yaml"
LEGACY_CONTRACT = REPO_ROOT / ("brand/legacy-" + "lang" + "flow" + "-contract.yaml")
WORKFLOW = REPO_ROOT / ".github/workflows/brand-contract.yml"
UPSTREAM_ENDPOINT_FIXTURE_COUNT = 2


def legacy_product() -> str:
    return "Lang" + "flow"


def legacy_executor() -> str:
    return "l" + "fx"


def upstream_pixel_url() -> str:
    return "https://api." + "sc" + "arf.sh/v1/pixel"


def upstream_invite_url() -> str:
    return "https://discord." + "gg/EqksyE2EX9"


def product_variant(separator: str) -> str:
    return "lang" + separator + "flow"


def load_scanner():
    spec = importlib.util.spec_from_file_location("ketos_zero_residue_scanner", SCANNER_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def write_contract(
    path: Path,
    *,
    legal_allowlist: list[dict] | None = None,
    legal_files: list[dict] | None = None,
    negative_test_allowlist: list[dict] | None = None,
) -> Path:
    value = {
        "version": 1,
        "analysis_commit": "de591b28cbade3483b2040aa338906a8834d6400",
        "baseline": {
            "brand_file_count": 3375,
            "brand_match_count": 48991,
            "brand_path_count": 879,
            "executor_file_count": 2051,
            "executor_match_count": 20085,
            "executor_path_count": 1408,
            "upstream_endpoint_count": 39,
            "scan_issue_count": 0,
        },
        "legal_files": legal_files or [],
        "legal_allowlist": legal_allowlist or [],
        "negative_test_allowlist": negative_test_allowlist or [],
    }
    path.write_text(yaml.safe_dump(value, sort_keys=False), encoding="utf-8")
    return path


def write_pending_legacy_contract(path: Path, repo: Path) -> Path:
    """Create a repository-bound semantic ledger for isolated scanner fixtures."""
    head = git(repo, "rev-parse", "HEAD")
    pending = {profile: {"verdict": "PENDING", "sha256": None} for profile in load_scanner().PROFILES}
    exclusions: list[dict] = []
    value = {
        "version": 1,
        "baseline": {
            "original_commit": head,
            "evidence_base_commit": head,
            "frozen_upstream_remote": "https://github.com/" + "lang" + "flow-ai/" + "lang" + "flow.git",
            "visible_count": 0,
            "official_url_count": 0,
            "technical_compatibility_count": 0,
            "paths": [],
            "paths_sha256": None,
            "scanner_outputs": pending,
            "untracked_exclusions": exclusions,
            "untracked_exclusions_sha256": hashlib.sha256(
                json.dumps(exclusions, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
            ).hexdigest(),
        },
        "occurrences": [],
    }
    path.write_text(yaml.safe_dump(value, sort_keys=False), encoding="utf-8")
    return path


def scan_root(scanner, root: Path, contract: Path, profile: str = "technical-compatibility") -> dict:
    report = scanner.scan_root(root, contract, profile=profile, legacy_contract_path=LEGACY_CONTRACT)
    assert isinstance(report, dict)
    return report


def actionable_violations(report: dict) -> list[dict]:
    """Return substantive fixture findings, excluding baseline-evidence bookkeeping."""
    return [item for item in report["violations"] if item["kind"] != "baseline_evidence_pending"]


def violation_kinds(report: dict) -> set[str]:
    return {item["kind"] for item in actionable_violations(report)}


def git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args],
        cwd=repo,
        check=True,
        text=True,
        capture_output=True,
    ).stdout.strip()


def init_repo(path: Path, files: dict[str, str]) -> Path:
    path.mkdir()
    git(path, "init", "-q")
    git(path, "config", "user.name", "Scanner Tests")
    git(path, "config", "user.email", "scanner@example.invalid")
    for relative, content in files.items():
        target = path / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    git(path, "add", ".")
    git(path, "commit", "-qm", "baseline")
    return path


def test_repository_zero_residue_contract_exists_and_is_valid() -> None:
    assert ZERO_RESIDUE_CONTRACT.is_file()
    assert load_scanner().validate_zero_residue_contract(ZERO_RESIDUE_CONTRACT) == []


def test_technical_profile_detects_content_case_separators_urls_emails_orgs_and_executor(tmp_path: Path) -> None:
    product = legacy_product()
    executor = legacy_executor()
    samples = {
        "plain.txt": product,
        "mixed.txt": product.swapcase(),
        "hyphen.txt": product_variant("-"),
        "underscore.txt": product_variant("_"),
        "space.txt": product_variant(" "),
        "url.txt": f"https://docs.{product.lower()}.org/guide",
        "email.txt": f"security@{product.lower()}.org",
        "org.txt": f"https://github.com/{product.lower()}-ai/project",
        "executor.txt": executor,
    }
    for relative, content in samples.items():
        (tmp_path / relative).write_text(content + "\n", encoding="utf-8")
    contract = write_contract(tmp_path / "contract.yaml")

    report = scan_root(load_scanner(), tmp_path, contract)

    assert {item["path"] for item in actionable_violations(report)} >= set(samples)
    assert violation_kinds(report) == {"unledgered_technical_residue"}


def test_technical_profile_scans_binary_filenames_archives_and_generated_output(tmp_path: Path) -> None:
    product = legacy_product().lower()
    executor = legacy_executor()
    (tmp_path / f"icon-{product}.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    generated = tmp_path / "dist" / "generated.js"
    generated.parent.mkdir()
    generated.write_text(f"window.product = '{product}';\n", encoding="utf-8")

    with zipfile.ZipFile(tmp_path / "artifact.whl", "w") as archive:
        archive.writestr(f"package/{product}_runtime.py", "PRODUCT = 'Ketos'\n")
        archive.writestr("package/runtime.py", f"import {executor}\n")

    tar_payload = io.BytesIO()
    with tarfile.open(fileobj=tar_payload, mode="w:gz") as archive:
        content = f"name = '{product}'\n".encode()
        member = tarfile.TarInfo("package/metadata.py")
        member.size = len(content)
        archive.addfile(member, io.BytesIO(content))
    (tmp_path / "artifact.tar.gz").write_bytes(tar_payload.getvalue())
    contract = write_contract(tmp_path / "contract.yaml")

    report = scan_root(load_scanner(), tmp_path, contract)
    paths = {item["path"] for item in actionable_violations(report)}

    assert f"icon-{product}.png" in paths
    assert "dist/generated.js" in paths
    assert f"artifact.whl!package/{product}_runtime.py" in paths
    assert "artifact.whl!package/runtime.py" in paths
    assert "artifact.tar.gz!package/metadata.py" in paths


def test_technical_profile_does_not_treat_compressed_binary_bytes_as_semantic_identity(tmp_path: Path) -> None:
    product = legacy_product().lower().encode()
    (tmp_path / "current-image.png").write_bytes(b"\x89PNG\r\n\x1a\n\x00" + product)
    (tmp_path / "opaque.bin").write_bytes(b"\x00" + product)
    contract = write_contract(tmp_path / "contract.yaml")

    report = scan_root(load_scanner(), tmp_path, contract)

    assert {item["path"] for item in actionable_violations(report)} == {"opaque.bin"}


def test_technical_profile_does_not_allow_legacy_negative_test_bypasses(tmp_path: Path) -> None:
    expected = f"rejected = '{legacy_product()}'"
    fixture = tmp_path / "tests" / "negative.py"
    fixture.parent.mkdir()
    fixture.write_text(expected + "\n", encoding="utf-8")
    contract = write_contract(
        tmp_path / "contract.yaml",
        negative_test_allowlist=[
            {
                "path": "tests/negative.py",
                "line": 1,
                "kind": "legacy_brand",
                "expected_text": expected,
                "sha256": hashlib.sha256(expected.encode()).hexdigest(),
            }
        ],
    )

    rejected = scan_root(load_scanner(), tmp_path, contract)
    assert violation_kinds(rejected) == {"unledgered_technical_residue"}
    assert rejected["allowed_residue"] == []

    fixture.write_text(f"runtime_default = '{legacy_product()}'\n", encoding="utf-8")
    changed = scan_root(load_scanner(), tmp_path, contract)
    assert violation_kinds(changed) == {"unledgered_technical_residue"}


def test_only_exact_legal_path_line_text_and_fingerprint_is_allowed(tmp_path: Path) -> None:
    expected = f"Copyright (c) 2024 {legacy_product()}"
    allowlist = [
        {
            "path": "LICENSE",
            "line": 3,
            "expected_text": expected,
            "sha256": hashlib.sha256(expected.encode()).hexdigest(),
        }
    ]
    license_path = tmp_path / "LICENSE"
    license_path.write_text(f"MIT License\n\n{expected}\n", encoding="utf-8")
    legal_files = [{"path": "LICENSE", "sha256": hashlib.sha256(license_path.read_bytes()).hexdigest()}]
    contract = write_contract(
        tmp_path / "contract.yaml",
        legal_allowlist=allowlist,
        legal_files=legal_files,
    )

    assert actionable_violations(scan_root(load_scanner(), tmp_path, contract)) == []

    license_path.write_text(f"MIT License\n{expected}\n", encoding="utf-8")
    moved = scan_root(load_scanner(), tmp_path, contract)
    assert violation_kinds(moved) >= {
        "legal_file_mismatch",
        "missing_legal_occurrence",
        "unledgered_technical_residue",
    }

    license_path.write_text(f"MIT License\n\nDerived from {legacy_product()}\n", encoding="utf-8")
    changed = scan_root(load_scanner(), tmp_path, contract)
    assert violation_kinds(changed) >= {
        "legal_file_mismatch",
        "missing_legal_occurrence",
        "unledgered_technical_residue",
    }


def test_profiles_verify_whole_legal_file_integrity(tmp_path: Path) -> None:
    expected = f"Copyright (c) 2024 {legacy_product()}"
    original = f"MIT License\n\n{expected}\nPermission is granted.\n"
    license_path = tmp_path / "LICENSE"
    license_path.write_text(original, encoding="utf-8")
    contract = write_contract(
        tmp_path / "contract.yaml",
        legal_allowlist=[
            {
                "path": "LICENSE",
                "line": 3,
                "expected_text": expected,
                "sha256": hashlib.sha256(expected.encode()).hexdigest(),
            }
        ],
        legal_files=[{"path": "LICENSE", "sha256": hashlib.sha256(original.encode()).hexdigest()}],
    )

    assert actionable_violations(scan_root(load_scanner(), tmp_path, contract)) == []

    license_path.write_text(original + "Unreviewed legal addition.\n", encoding="utf-8")
    report = scan_root(load_scanner(), tmp_path, contract)
    assert "legal_file_mismatch" in violation_kinds(report)


def test_profiles_reject_missing_required_legal_file_and_occurrence(tmp_path: Path) -> None:
    expected = f"Copyright (c) 2024 {legacy_product()}"
    contract = write_contract(
        tmp_path / "contract.yaml",
        legal_allowlist=[
            {
                "path": "LICENSE",
                "line": 3,
                "expected_text": expected,
                "sha256": hashlib.sha256(expected.encode()).hexdigest(),
            }
        ],
        legal_files=[{"path": "LICENSE", "sha256": "0" * 64}],
    )

    report = scan_root(load_scanner(), tmp_path, contract)

    assert violation_kinds(report) >= {"missing_legal_file", "missing_legal_occurrence"}


def test_visible_and_technical_profiles_reject_their_own_residue_classes(tmp_path: Path) -> None:
    product = legacy_product()
    (tmp_path / "README.md").write_text(product + "\n", encoding="utf-8")
    (tmp_path / "src.txt").write_text(product + "\n", encoding="utf-8")
    contract = write_contract(tmp_path / "contract.yaml")
    scanner = load_scanner()

    visible = scan_root(scanner, tmp_path, contract, profile="visible")
    technical = scan_root(scanner, tmp_path, contract, profile="technical-compatibility")

    assert any(item["path"] == "README.md" and item["kind"] == "visible_residue" for item in visible["violations"])
    assert any(
        item["path"] == "src.txt" and item["kind"] == "unledgered_technical_residue" for item in technical["violations"]
    )


def test_technical_profile_rejects_new_residue_in_a_dirty_worktree(tmp_path: Path) -> None:
    product = legacy_product()
    repo = init_repo(tmp_path / "repo", {"old.txt": product + "\n" + product + "\n"})
    (repo / "old.txt").write_text(product + "\n", encoding="utf-8")
    (repo / "new.txt").write_text(product + "\n", encoding="utf-8")
    git(repo, "add", "new.txt")
    contract = write_contract(tmp_path / "contract.yaml")
    legacy_contract = write_pending_legacy_contract(tmp_path / "legacy.yaml", repo)

    report = load_scanner().scan_repository(
        repo,
        contract,
        profile="technical-compatibility",
        legacy_contract_path=legacy_contract,
    )

    assert any(
        item["path"] == "new.txt" and item["kind"] == "unledgered_technical_residue"
        for item in actionable_violations(report)
    )


def test_technical_profile_scans_the_current_clean_commit(tmp_path: Path) -> None:
    product = legacy_product()
    repo = init_repo(tmp_path / "repo", {"app.txt": product + "\n"})
    (repo / "app.txt").write_text(product + "\n" + product + "\n", encoding="utf-8")
    git(repo, "add", "app.txt")
    git(repo, "commit", "-qm", "increase")
    contract = write_contract(tmp_path / "contract.yaml")
    legacy_contract = write_pending_legacy_contract(tmp_path / "legacy.yaml", repo)

    report = load_scanner().scan_repository(
        repo,
        contract,
        profile="technical-compatibility",
        legacy_contract_path=legacy_contract,
    )

    assert any(
        item["path"] == "app.txt" and item["kind"] == "unledgered_technical_residue"
        for item in actionable_violations(report)
    )


def test_official_url_profile_tracks_upstream_endpoints_independently(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "repo", {"telemetry.txt": "Ketos\n", "community.txt": "Ketos\n"})
    (repo / "telemetry.txt").write_text(upstream_pixel_url() + "\n", encoding="utf-8")
    (repo / "community.txt").write_text(upstream_invite_url() + "\n", encoding="utf-8")
    contract = write_contract(tmp_path / "contract.yaml")
    legacy_contract = write_pending_legacy_contract(tmp_path / "legacy.yaml", repo)

    report = load_scanner().scan_repository(
        repo,
        contract,
        profile="official-url",
        legacy_contract_path=legacy_contract,
    )

    assert report["baseline"]["upstream_endpoint_count"] == UPSTREAM_ENDPOINT_FIXTURE_COUNT
    assert {
        item["path"] for item in actionable_violations(report) if item["kind"] in {"official_url", "upstream_endpoint"}
    } == {"community.txt", "telemetry.txt"}


def test_technical_profile_does_not_exclude_scanner_test_paths(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "repo", {"scripts/rebrand/tests/example.py": "PRODUCT = 'Ketos'\n"})
    product = legacy_product()
    (repo / "scripts/rebrand/tests/example.py").write_text(f"PRODUCT = '{product}'\n", encoding="utf-8")
    contract = write_contract(tmp_path / "contract.yaml")
    legacy_contract = write_pending_legacy_contract(tmp_path / "legacy.yaml", repo)

    report = load_scanner().scan_repository(
        repo,
        contract,
        profile="technical-compatibility",
        legacy_contract_path=legacy_contract,
    )

    assert any(
        item["kind"] == "unledgered_technical_residue" and item["path"] == "scripts/rebrand/tests/example.py"
        for item in actionable_violations(report)
    )


def test_path_count_counts_paths_not_matches_within_one_path(tmp_path: Path) -> None:
    product = legacy_product()
    repeated_path = tmp_path / f"{product.lower()}-{product.lower()}.txt"
    repeated_path.write_text("Ketos\n", encoding="utf-8")
    contract = write_contract(tmp_path / "contract.yaml")

    report = scan_root(load_scanner(), tmp_path, contract)

    assert report["baseline"]["brand_path_count"] == 1


def test_cli_accepts_technical_profile_and_scan_root(tmp_path: Path) -> None:
    (tmp_path / "residue.txt").write_text(legacy_product() + "\n", encoding="utf-8")
    contract = write_contract(tmp_path / "contract.yaml")
    completed = subprocess.run(
        [
            "uv",
            "run",
            "python",
            str(SCANNER_PATH),
            "--profile",
            "technical-compatibility",
            "--scan-root",
            str(tmp_path),
            "--zero-residue-contract",
            str(contract),
            "--legacy-contract",
            str(LEGACY_CONTRACT),
        ],
        check=False,
        text=True,
        capture_output=True,
    )
    assert completed.returncode == 1, completed.stderr or completed.stdout
    assert "unledgered_technical_residue residue.txt:1" in completed.stdout


def test_ci_runs_all_compatibility_first_profiles_and_publishes_reports() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")
    assert '-m "not slow"' in text
    assert "-m slow" in text
    for profile in ("visible", "official-url", "technical-compatibility"):
        assert f"scripts/rebrand/check_brand.py --profile {profile} --format json" in text
    assert "Upload categorized brand reports" in text
    assert "--profile stage0" not in text
    assert "--profile cutover" not in text


def test_zero_contract_rejects_duplicate_keys_and_malformed_legal_files(tmp_path: Path) -> None:
    duplicate = tmp_path / "duplicate.yaml"
    duplicate.write_text("version: 1\nversion: 1\n", encoding="utf-8")
    scanner = load_scanner()
    assert any("duplicate key" in error for error in scanner.validate_zero_residue_contract(duplicate))

    malformed = yaml.safe_load(write_contract(tmp_path / "malformed.yaml").read_text(encoding="utf-8"))
    malformed["legal_files"] = [{"path": "../NOTICE", "sha256": "not-a-digest", "extra": True}]
    malformed_path = tmp_path / "malformed.yaml"
    malformed_path.write_text(yaml.safe_dump(malformed, sort_keys=False), encoding="utf-8")
    errors = scanner.validate_zero_residue_contract(malformed_path)
    assert any("legal_files[0].path" in error for error in errors)
    assert any("legal_files[0].sha256" in error for error in errors)
    assert any("legal_files[0].extra" in error for error in errors)


def test_archive_member_can_be_exact_legal_file_with_whole_member_hash(tmp_path: Path) -> None:
    expected = f"Copyright (c) 2024 {legacy_product()}"
    content = f"MIT License\n\n{expected}\n".encode()
    archive_path = tmp_path / "artifact.whl"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("LICENSE", content)
    member_path = "artifact.whl!LICENSE"
    contract = write_contract(
        tmp_path / "contract.yaml",
        legal_files=[{"path": member_path, "sha256": hashlib.sha256(content).hexdigest()}],
        legal_allowlist=[
            {
                "path": member_path,
                "line": 3,
                "expected_text": expected,
                "sha256": hashlib.sha256(expected.encode()).hexdigest(),
            }
        ],
    )

    assert actionable_violations(scan_root(load_scanner(), tmp_path, contract)) == []

    changed = content + b"unreviewed\n"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("LICENSE", changed)
    assert "legal_file_mismatch" in violation_kinds(scan_root(load_scanner(), tmp_path, contract))


def test_nested_archives_are_scanned_to_final_bundle_depth(tmp_path: Path) -> None:
    product = legacy_product()
    inner = io.BytesIO()
    with zipfile.ZipFile(inner, "w") as archive:
        archive.writestr("metadata.txt", product)
    outer = tmp_path / "bundle.zip"
    with zipfile.ZipFile(outer, "w") as archive:
        archive.writestr("inner.whl", inner.getvalue())
    contract = write_contract(tmp_path / "contract.yaml")

    report = scan_root(load_scanner(), tmp_path, contract)

    assert any(item["path"] == "bundle.zip!inner.whl!metadata.txt" for item in report["violations"])


def test_archive_depth_bound_fails_closed(tmp_path: Path) -> None:
    payload = b"Ketos"
    member_name = "payload.txt"
    for depth in range(4):
        nested = io.BytesIO()
        with zipfile.ZipFile(nested, "w") as archive:
            archive.writestr(member_name, payload)
        payload = nested.getvalue()
        member_name = f"level-{depth}.zip"
    outer = tmp_path / "bundle.zip"
    outer.write_bytes(payload)
    contract = write_contract(tmp_path / "contract.yaml")

    report = scan_root(load_scanner(), tmp_path, contract)

    assert "archive_depth_limit" in violation_kinds(report)


def test_malformed_zip_and_tar_fail_closed(tmp_path: Path) -> None:
    (tmp_path / "malformed.zip").write_bytes(b"PK\x03\x04truncated")
    (tmp_path / "malformed.tar.gz").write_bytes(b"not a tar archive")
    contract = write_contract(tmp_path / "contract.yaml")

    report = scan_root(load_scanner(), tmp_path, contract)

    malformed = [item for item in report["violations"] if item["kind"] == "malformed_archive"]
    assert {item["path"] for item in malformed} == {
        "malformed.tar.gz!<archive>",
        "malformed.zip!<archive>",
    }


def test_duplicate_legal_archive_member_is_ambiguous_and_not_allowlisted(tmp_path: Path) -> None:
    product = legacy_product()
    first = f"Ketos Notice\n\nDerived from {product}\n".encode()
    second = f"Ketos Notice\n\nAlso derived from {product}\n".encode()
    archive_path = tmp_path / "artifact.zip"
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with zipfile.ZipFile(archive_path, "w") as archive:
            archive.writestr("NOTICE", first)
            archive.writestr("NOTICE", second)
    member_path = "artifact.zip!NOTICE"
    expected = f"Derived from {product}"
    contract = write_contract(
        tmp_path / "contract.yaml",
        legal_files=[{"path": member_path, "sha256": hashlib.sha256(first).hexdigest()}],
        legal_allowlist=[
            {
                "path": member_path,
                "line": 3,
                "expected_text": expected,
                "sha256": hashlib.sha256(expected.encode()).hexdigest(),
            }
        ],
    )

    report = scan_root(load_scanner(), tmp_path, contract)

    assert "duplicate_archive_member" in violation_kinds(report)
    assert "missing_legal_occurrence" in violation_kinds(report)
    assert report["allowed_residue"] == []


def test_technical_profile_fails_closed_on_a_new_archive_bound_issue(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "repo", {"README.md": "Ketos\n"})
    payload = b"Ketos"
    member_name = "payload.txt"
    for depth in range(4):
        nested = io.BytesIO()
        with zipfile.ZipFile(nested, "w") as archive:
            archive.writestr(member_name, payload)
        payload = nested.getvalue()
        member_name = f"level-{depth}.zip"
    (repo / "bundle.zip").write_bytes(payload)
    git(repo, "add", "bundle.zip")
    contract = write_contract(tmp_path / "contract.yaml")
    legacy_contract = write_pending_legacy_contract(tmp_path / "legacy.yaml", repo)

    report = load_scanner().scan_repository(
        repo,
        contract,
        profile="technical-compatibility",
        legacy_contract_path=legacy_contract,
    )

    assert any(
        item["kind"] == "archive_depth_limit" and item["path"].startswith("bundle.zip")
        for item in actionable_violations(report)
    )


def test_synthetic_archive_issue_path_cannot_be_overwritten_by_real_path(tmp_path: Path) -> None:
    sentinel_path = "new.zip!<archive>"
    repo = init_repo(tmp_path / "repo", {sentinel_path: "ordinary tracked file\n"})
    (repo / "old.zip").write_bytes(b"PK\x03\x04truncated-old")
    git(repo, "add", "old.zip")
    git(repo, "commit", "-qm", "malformed baseline archive")

    (repo / "old.zip").unlink()
    (repo / "new.zip").write_bytes(b"PK\x03\x04truncated-new")
    git(repo, "add", "-A")
    contract = write_contract(tmp_path / "contract.yaml")
    legacy_contract = write_pending_legacy_contract(tmp_path / "legacy.yaml", repo)

    report = load_scanner().scan_repository(
        repo,
        contract,
        profile="technical-compatibility",
        legacy_contract_path=legacy_contract,
    )

    assert any(
        item["kind"] == "duplicate_scan_path" and item["path"] == sentinel_path
        for item in actionable_violations(report)
    )
