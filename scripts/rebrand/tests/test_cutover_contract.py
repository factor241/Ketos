from __future__ import annotations

# ruff: noqa: S101, S603, S607 - assertions and fixed CLI subprocess are intentional.
import hashlib
import importlib.util
import io
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
    }
    path.write_text(yaml.safe_dump(value, sort_keys=False), encoding="utf-8")
    return path


def scan_root(scanner, root: Path, contract: Path, profile: str = "cutover") -> dict:
    report = scanner.scan_root(root, contract, profile=profile)
    assert isinstance(report, dict)
    return report


def violation_kinds(report: dict) -> set[str]:
    return {item["kind"] for item in report["violations"]}


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


def test_cutover_detects_content_case_separators_urls_emails_orgs_and_executor(tmp_path: Path) -> None:
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

    assert {item["path"] for item in report["violations"]} >= set(samples)
    assert violation_kinds(report) >= {"legacy_brand", "legacy_executor"}


def test_cutover_scans_binary_filenames_archives_and_generated_output(tmp_path: Path) -> None:
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
    paths = {item["path"] for item in report["violations"]}

    assert f"icon-{product}.png" in paths
    assert "dist/generated.js" in paths
    assert f"artifact.whl!package/{product}_runtime.py" in paths
    assert "artifact.whl!package/runtime.py" in paths
    assert "artifact.tar.gz!package/metadata.py" in paths


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

    assert scan_root(load_scanner(), tmp_path, contract)["violations"] == []

    license_path.write_text(f"MIT License\n{expected}\n", encoding="utf-8")
    moved = scan_root(load_scanner(), tmp_path, contract)
    assert "legal_mismatch" in violation_kinds(moved)

    license_path.write_text(f"MIT License\n\nDerived from {legacy_product()}\n", encoding="utf-8")
    changed = scan_root(load_scanner(), tmp_path, contract)
    assert "legal_mismatch" in violation_kinds(changed)


def test_cutover_verifies_whole_legal_file_integrity(tmp_path: Path) -> None:
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

    assert scan_root(load_scanner(), tmp_path, contract)["violations"] == []

    license_path.write_text(original + "Unreviewed legal addition.\n", encoding="utf-8")
    report = scan_root(load_scanner(), tmp_path, contract)
    assert "legal_file_mismatch" in violation_kinds(report)


def test_cutover_rejects_missing_required_legal_file_and_occurrence(tmp_path: Path) -> None:
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


def test_stage0_requires_monotonic_decrease_but_cutover_rejects_all_nonlegal(tmp_path: Path) -> None:
    product = legacy_product()
    (tmp_path / "src.txt").write_text(product + "\n", encoding="utf-8")
    contract = write_contract(tmp_path / "contract.yaml")
    scanner = load_scanner()

    assert scan_root(scanner, tmp_path, contract, profile="stage0")["violations"] == []
    assert "legacy_brand" in violation_kinds(scan_root(scanner, tmp_path, contract, profile="cutover"))

    strict = yaml.safe_load(contract.read_text(encoding="utf-8"))
    strict["baseline"] = {
        "brand_file_count": 0,
        "brand_match_count": 0,
        "brand_path_count": 0,
        "executor_file_count": 0,
        "executor_match_count": 0,
        "executor_path_count": 0,
        "upstream_endpoint_count": 0,
        "scan_issue_count": 0,
    }
    contract.write_text(yaml.safe_dump(strict, sort_keys=False), encoding="utf-8")
    assert "baseline_increase" in violation_kinds(scan_root(scanner, tmp_path, contract, profile="stage0"))


def test_stage0_dirty_worktree_rejects_compensated_addition(tmp_path: Path) -> None:
    product = legacy_product()
    repo = init_repo(tmp_path / "repo", {"old.txt": product + "\n" + product + "\n"})
    (repo / "old.txt").write_text(product + "\n", encoding="utf-8")
    (repo / "new.txt").write_text(product + "\n", encoding="utf-8")
    git(repo, "add", "new.txt")
    contract = write_contract(tmp_path / "contract.yaml")

    report = load_scanner().scan_repository(repo, contract, profile="stage0")

    additions = [item for item in report["violations"] if item["kind"] == "monotonic_increase"]
    assert any(item["path"] == "new.txt" and item["match"] == "brand_match_count" for item in additions)


def test_stage0_clean_commit_compares_head_with_first_parent(tmp_path: Path) -> None:
    product = legacy_product()
    repo = init_repo(tmp_path / "repo", {"app.txt": product + "\n"})
    (repo / "app.txt").write_text(product + "\n" + product + "\n", encoding="utf-8")
    git(repo, "add", "app.txt")
    git(repo, "commit", "-qm", "increase")
    contract = write_contract(tmp_path / "contract.yaml")

    report = load_scanner().scan_repository(repo, contract, profile="stage0")

    assert "monotonic_increase" in violation_kinds(report)


def test_stage0_tracks_upstream_endpoint_growth_independently(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "repo", {"telemetry.txt": "Ketos\n", "community.txt": "Ketos\n"})
    (repo / "telemetry.txt").write_text(upstream_pixel_url() + "\n", encoding="utf-8")
    (repo / "community.txt").write_text(upstream_invite_url() + "\n", encoding="utf-8")
    contract = write_contract(tmp_path / "contract.yaml")

    report = load_scanner().scan_repository(repo, contract, profile="stage0")

    assert report["baseline"]["upstream_endpoint_count"] == UPSTREAM_ENDPOINT_FIXTURE_COUNT
    assert any(
        item["kind"] == "monotonic_increase" and item["match"] == "upstream_endpoint_count"
        for item in report["violations"]
    )


def test_stage0_does_not_exclude_scanner_test_paths(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "repo", {"scripts/rebrand/tests/example.py": "PRODUCT = 'Ketos'\n"})
    product = legacy_product()
    (repo / "scripts/rebrand/tests/example.py").write_text(f"PRODUCT = '{product}'\n", encoding="utf-8")
    contract = write_contract(tmp_path / "contract.yaml")

    report = load_scanner().scan_repository(repo, contract, profile="stage0")

    assert any(
        item["kind"] == "monotonic_increase" and item["path"] == "scripts/rebrand/tests/example.py"
        for item in report["violations"]
    )


def test_path_count_counts_paths_not_matches_within_one_path(tmp_path: Path) -> None:
    product = legacy_product()
    repeated_path = tmp_path / f"{product.lower()}-{product.lower()}.txt"
    repeated_path.write_text("Ketos\n", encoding="utf-8")
    contract = write_contract(tmp_path / "contract.yaml")

    report = scan_root(load_scanner(), tmp_path, contract)

    assert report["baseline"]["brand_path_count"] == 1


def test_cli_accepts_cutover_and_scan_root(tmp_path: Path) -> None:
    (tmp_path / "clean.txt").write_text("Ketos\n", encoding="utf-8")
    contract = write_contract(tmp_path / "contract.yaml")
    completed = subprocess.run(
        [
            "uv",
            "run",
            "python",
            str(SCANNER_PATH),
            "--profile",
            "cutover",
            "--scan-root",
            str(tmp_path),
            "--zero-residue-contract",
            str(contract),
        ],
        check=False,
        text=True,
        capture_output=True,
    )
    assert completed.returncode == 0, completed.stderr or completed.stdout


def test_ci_runs_stage0_gate_and_publishes_cutover_report() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "PYTHONDONTWRITEBYTECODE=1 uv run pytest -p no:cacheprovider scripts/rebrand/tests -q" in text
    assert "scripts/rebrand/check_brand.py --profile stage0" in text
    assert "scripts/rebrand/check_brand.py --profile cutover --format json" in text
    assert "ketos-zero-residue-contract.yaml" in text
    assert "legacy-" + legacy_product().lower() + "-contract.yaml" not in text


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

    assert scan_root(load_scanner(), tmp_path, contract)["violations"] == []

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


def test_stage0_new_archive_bound_issue_is_monotonic_increase(tmp_path: Path) -> None:
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

    report = load_scanner().scan_repository(repo, contract, profile="stage0")

    assert any(
        item["kind"] == "monotonic_increase"
        and item["path"].startswith("bundle.zip")
        and item["match"] == "scan_issue_count"
        for item in report["violations"]
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

    report = load_scanner().scan_repository(repo, contract, profile="stage0")

    assert any(
        item["kind"] == "monotonic_increase" and item["path"] == sentinel_path and item["match"] == "scan_issue_count"
        for item in report["violations"]
    )
