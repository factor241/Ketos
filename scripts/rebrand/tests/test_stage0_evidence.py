from __future__ import annotations

# ruff: noqa: S101, S603, S607, SLF001 - assertions, fixed Git commands, and private helpers define the contract.
import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import sys
from copy import deepcopy
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[3]
SCANNER = ROOT / "scripts/rebrand/check_brand.py"
LEGACY = ROOT / "brand" / ("legacy-" + "lang" + "flow-contract.yaml")
ZERO = ROOT / "brand/ketos-zero-residue-contract.yaml"


def load_scanner():
    spec = importlib.util.spec_from_file_location("stage0_evidence_scanner", SCANNER)
    assert spec
    assert spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def canonical_sha256(value: object) -> str:
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
    return hashlib.sha256(payload).hexdigest()


def write_yaml(path: Path, value: dict) -> Path:
    path.write_text(yaml.safe_dump(value, sort_keys=False), encoding="utf-8")
    return path


def pending_legacy_contract() -> dict:
    contract = yaml.safe_load(LEGACY.read_text(encoding="utf-8"))
    contract["baseline"]["paths_sha256"] = None
    contract["baseline"]["scanner_outputs"] = {
        profile: {"verdict": "PENDING", "sha256": None}
        for profile in ("visible", "official-url", "technical-compatibility")
    }
    return contract


def occurrence_source_path(item: dict) -> Path:
    locator_prefix = item["category"]
    if item["subtype"] is not None:
        locator_prefix += f":{item['subtype']}"
    locator_body = item["locator"].removeprefix(locator_prefix + ":")
    locator_path, separator, locator_line = locator_body.rpartition(":")
    assert separator == ":"
    assert locator_line.isdigit()
    return Path(locator_path)


def test_self_contract_locator_uses_exact_loaded_path_and_escaped_real_line() -> None:
    scanner = load_scanner()
    relative_path = LEGACY.relative_to(ROOT).as_posix()
    contract_text = LEGACY.read_text(encoding="utf-8")
    contract = yaml.safe_load(contract_text)
    document = yaml.compose(contract_text)
    assert isinstance(document, yaml.MappingNode)
    baseline_node = next(value for key, value in document.value if key.value == "baseline")
    assert isinstance(baseline_node, yaml.MappingNode)
    paths_node = next(value for key, value in baseline_node.value if key.value == "paths")
    assert isinstance(paths_node, yaml.SequenceNode)
    self_path_node = next(node for node in paths_node.value if node.value == relative_path)
    real_line = self_path_node.start_mark.line + 1
    raw_line = contract_text.splitlines()[real_line - 1]

    assert relative_path in contract["baseline"]["paths"]
    assert "\\u0066" in raw_line
    assert scanner._technical_locator(relative_path, real_line, raw_line, "legacy_brand") is None
    assert scanner._technical_locator(relative_path, 0, relative_path, "legacy_brand") == (
        f"historical_fixture:{relative_path}:0"
    )
    assert scanner._technical_locator("brand/other-contract.yaml", 0, relative_path, "legacy_brand") is None


def test_legacy_contract_uses_ancestral_evidence_base_commit(tmp_path: Path) -> None:
    scanner = load_scanner()
    contract = yaml.safe_load(LEGACY.read_text(encoding="utf-8"))
    base_commit = contract["baseline"]["evidence_base_commit"]

    assert "current_commit" not in contract["baseline"]
    assert re.fullmatch(r"[0-9a-f]{40}", base_commit)
    assert (
        subprocess.run(
            ["git", "merge-base", "--is-ancestor", base_commit, "HEAD"],
            cwd=ROOT,
            check=False,
        ).returncode
        == 0
    )
    assert scanner.validate_legacy_contract(LEGACY) == []

    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "Stage Zero"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.email", "stage0@example.invalid"], cwd=repo, check=True)
    referenced = {LEGACY.relative_to(ROOT)}
    referenced.update(occurrence_source_path(item) for item in contract["occurrences"])
    referenced.update(Path(item["compatibility_test"]) for item in contract["occurrences"])
    for relative in sorted(referenced):
        destination = repo / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / relative, destination)
    subprocess.run(["git", "add", "."], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", "evidence base"], cwd=repo, check=True)
    ancestor = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo, check=True, capture_output=True, text=True
    ).stdout.strip()
    copied_contract = repo / LEGACY.relative_to(ROOT)
    copied_contract.write_text(
        copied_contract.read_text(encoding="utf-8").replace(base_commit, ancestor, 1),
        encoding="utf-8",
    )
    subprocess.run(["git", "add", copied_contract.relative_to(repo)], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", "descendant candidate"], cwd=repo, check=True)

    assert scanner.validate_legacy_contract(copied_contract, repository_root=repo) == []

    tree = subprocess.run(["git", "write-tree"], cwd=repo, check=True, capture_output=True, text=True).stdout.strip()
    unrelated = subprocess.run(
        ["git", "commit-tree", tree, "-m", "unrelated"], cwd=repo, check=True, capture_output=True, text=True
    ).stdout.strip()
    copied_contract.write_text(
        copied_contract.read_text(encoding="utf-8").replace(ancestor, unrelated, 1),
        encoding="utf-8",
    )

    errors = scanner.validate_legacy_contract(copied_contract, repository_root=repo)
    assert any("evidence_base_commit" in error and "ancestor" in error for error in errors)


def test_legacy_semantics_digest_excludes_only_scanner_outputs() -> None:
    scanner = load_scanner()
    contract = yaml.safe_load(LEGACY.read_text(encoding="utf-8"))
    original = scanner._legacy_semantics_sha256(contract)

    changed_outputs = deepcopy(contract)
    changed_outputs["baseline"]["scanner_outputs"]["visible"] = {"verdict": "PASS", "sha256": "a" * 64}
    assert scanner._legacy_semantics_sha256(changed_outputs) == original

    changed_count = deepcopy(contract)
    changed_count["baseline"]["technical_compatibility_count"] += 1
    assert scanner._legacy_semantics_sha256(changed_count) != original

    changed_ledger = deepcopy(contract)
    changed_ledger["occurrences"][0]["reason"] += " Changed."
    assert scanner._legacy_semantics_sha256(changed_ledger) != original


def test_evidence_states_are_atomic_pending_or_pass(tmp_path: Path) -> None:
    scanner = load_scanner()
    contract = pending_legacy_contract()
    contract["baseline"]["scanner_outputs"]["visible"] = {"verdict": "PASS", "sha256": "a" * 64}

    errors = scanner.validate_legacy_contract(write_yaml(tmp_path / "legacy.yaml", contract))

    assert any("atomic" in error and "PENDING" in error and "PASS" in error for error in errors)

    contract = pending_legacy_contract()
    contract["baseline"]["scanner_outputs"]["visible"] = {"verdict": "FAIL", "sha256": "a" * 64}
    errors = scanner.validate_legacy_contract(write_yaml(tmp_path / "legacy.yaml", contract))
    assert any("verdict" in error and "PENDING or PASS" in error for error in errors)


def test_prepare_baseline_evidence_is_read_only_and_canonical(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    scanner = load_scanner()
    checked_in_before = LEGACY.read_bytes()
    contract = pending_legacy_contract()
    pending = write_yaml(tmp_path / "pending.yaml", contract)
    pending_before = pending.read_bytes()

    packet = scanner.prepare_baseline_evidence(ROOT, ZERO, pending)

    assert pending.read_bytes() == pending_before
    assert LEGACY.read_bytes() == checked_in_before
    assert set(packet) == {"effective_source_sha256", "contract_patch", "source_scope", "payloads"}
    assert packet["effective_source_sha256"] == canonical_sha256(packet["source_scope"])

    patch = packet["contract_patch"]
    legacy_path = LEGACY.relative_to(ROOT).as_posix()
    scoped_legacy = next(item for item in packet["source_scope"] if item["path"] == legacy_path)
    draft_contract = deepcopy(contract)
    draft_contract["baseline"].update({key: value for key, value in patch.items() if key != "scanner_outputs"})
    assert scoped_legacy["sha256"] == scanner._legacy_semantics_sha256(draft_contract)

    expected_locators = {item["locator"] for item in contract["occurrences"]}
    technical = packet["payloads"]["technical-compatibility"]
    assert set(technical["matched_legacy_locators"]) == expected_locators
    assert patch["technical_compatibility_count"] == len(expected_locators)
    assert patch["paths"] == sorted({item["path"] for item in technical["matched_legacy_occurrences"]})
    assert patch["paths_sha256"] == canonical_sha256(patch["paths"])
    assert patch["visible_count"] == 0
    assert patch["official_url_count"] == 0

    assert set(patch["scanner_outputs"]) == set(scanner.PROFILES)
    assert set(packet["payloads"]) == set(scanner.PROFILES)
    for profile in scanner.PROFILES:
        output = patch["scanner_outputs"][profile]
        payload = packet["payloads"][profile]
        assert output == {"verdict": "PASS", "sha256": canonical_sha256(payload)}
        assert payload["effective_source_sha256"] == packet["effective_source_sha256"]

    exit_code = scanner.main(["--prepare-baseline-evidence", "--legacy-contract", str(pending)])
    printed = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert printed == packet
    assert pending.read_bytes() == pending_before
    assert LEGACY.read_bytes() == checked_in_before


def test_pass_evidence_is_recomputed_and_rejects_forged_hash(tmp_path: Path) -> None:
    scanner = load_scanner()
    contract = pending_legacy_contract()
    pending = write_yaml(tmp_path / "pending.yaml", contract)
    packet = scanner.prepare_baseline_evidence(ROOT, ZERO, pending)
    contract["baseline"].update(packet["contract_patch"])
    contract["baseline"]["scanner_outputs"]["visible"]["sha256"] = "0" * 64
    forged = write_yaml(tmp_path / "legacy.yaml", contract)

    report = scanner.scan_repository(ROOT, ZERO, profile="visible", legacy_contract_path=forged)

    assert any("stale or forged" in error for error in report["contract_errors"])


def test_pass_evidence_rejects_forged_sibling_profile_hash(tmp_path: Path) -> None:
    scanner = load_scanner()
    contract = pending_legacy_contract()
    pending = write_yaml(tmp_path / "pending.yaml", contract)
    packet = scanner.prepare_baseline_evidence(ROOT, ZERO, pending)
    contract["baseline"].update(packet["contract_patch"])
    contract["baseline"]["scanner_outputs"]["official-url"]["sha256"] = "0" * 64
    forged = write_yaml(tmp_path / "legacy.yaml", contract)

    report = scanner.scan_repository(ROOT, ZERO, profile="visible", legacy_contract_path=forged)

    assert any(
        "stale or forged" in error and "scanner_outputs.official-url" in error for error in report["contract_errors"]
    )


def test_one_ledger_locator_cannot_authorize_same_line_duplicates() -> None:
    scanner = load_scanner()
    zero = yaml.safe_load(ZERO.read_text(encoding="utf-8"))
    fixture_path = "scripts/rebrand/tests/fixtures/legacy-package-alias.txt"
    locator = f"import_alias:package_alias:{fixture_path}:1"
    duplicate_line = f"import {scanner._LEGACY_EXECUTOR_TEXT}; import {scanner._LEGACY_EXECUTOR_TEXT}\n".encode()

    report = scanner._scan_blobs(
        [scanner.Blob(fixture_path, duplicate_line)],
        zero,
        profile="technical-compatibility",
        excluded_path=None,
        legacy_locators={locator},
    )

    duplicates = [item for item in report["violations"] if item["kind"] == "duplicate_ledgered_technical_residue"]
    assert len(duplicates) == 1
    assert duplicates[0]["locator"] == locator


def test_prepare_requires_exact_technical_locator_set(tmp_path: Path) -> None:
    scanner = load_scanner()
    contract = pending_legacy_contract()
    contract["occurrences"] = contract["occurrences"][:-1]
    incomplete = write_yaml(tmp_path / "legacy.yaml", contract)

    with pytest.raises(ValueError, match="technical locator set"):
        scanner.prepare_baseline_evidence(ROOT, ZERO, incomplete)
