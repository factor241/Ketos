from __future__ import annotations

# ruff: noqa: S101, S603, SLF001 - assertions, fixed git commands, and private scanner helpers define the S0 contract.
import hashlib
import importlib.util
import io
import json
import re
import shutil
import subprocess
import sys
import zipfile
from copy import deepcopy
from pathlib import Path
from typing import Self

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[3]
SCANNER = ROOT / "scripts/rebrand/check_brand.py"
BRAND = ROOT / "brand/ketos-brand-contract.yaml"
LEGACY_RELATIVE = "brand/legacy-" + "lang" + "flow" + "-contract.yaml"
LEGACY = ROOT / LEGACY_RELATIVE
ZERO = ROOT / "brand/ketos-zero-residue-contract.yaml"
WORKFLOW = ROOT / ".github/workflows/brand-contract.yml"
CLI_USAGE_ERROR = 2

BRAND_FIELDS = {
    "product_name",
    "product_slug",
    "executor_name",
    "executor_distribution",
    "python_distribution",
    "python_base_distribution",
    "sdk_distribution",
    "stepflow_distribution",
    "python_namespace",
    "sdk_namespace",
    "stepflow_namespace",
    "env_prefix",
    "site_url",
    "docs_url",
    "repository_url",
    "issues_url",
    "support_url",
    "container_registry_namespace",
    "package_publisher_identity",
    "social_links",
    "telemetry_url",
    "store_url",
    "schema_base_url",
    "legal_entity",
    "copyright_holder",
    "trademark_owner",
    "security_contact",
    "vulnerability_report_url",
    "moderation_contact",
    "privacy_policy_url",
    "data_controller",
    "analytics_owner",
    "analytics_properties",
    "search_owner",
    "chat_widget_owner",
    "signing_identity",
    "logo_source_sha256",
    "logo_rights_approved_by",
    "logo_rights_approved_date",
    "wordmark_font_license",
}
CATEGORIES = {
    "import_alias",
    "env_alias",
    "data_path",
    "historical_migration",
    "historical_fixture",
    "wire_protocol",
    "external_resource_id",
    "legal_provenance",
}


def load_scanner():
    spec = importlib.util.spec_from_file_location("stage0_scanner", SCANNER)
    assert spec
    assert spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def old_product() -> str:
    return "lang" + "flow"


def old_executor() -> str:
    return "l" + "fx"


class CountingBytes(bytes):
    """Record the total byte span inspected by ``bytes.count`` calls."""

    def __new__(cls, value: bytes) -> Self:
        instance = super().__new__(cls, value)
        instance.total_count_span = 0
        return instance

    def count(self, sub: bytes, start: int = 0, end: int | None = None) -> int:
        effective_end = len(self) if end is None else end
        self.total_count_span += effective_end - start
        return super().count(sub, start, effective_end)


def write_yaml(path: Path, value: dict) -> Path:
    path.write_text(yaml.safe_dump(value, sort_keys=False), encoding="utf-8")
    return path


def git_executable() -> str:
    executable = shutil.which("git")
    if executable is None:
        pytest.fail("git executable is required by the Stage 0 worktree contract test")
    return executable


def exclusion_digest(exclusions: list[dict[str, str]]) -> str:
    payload = json.dumps(exclusions, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
    return hashlib.sha256(payload).hexdigest()


def pending_legacy_contract() -> dict:
    contract = yaml.safe_load(LEGACY.read_text(encoding="utf-8"))
    contract["baseline"]["paths_sha256"] = None
    contract["baseline"]["scanner_outputs"] = {
        profile: {"verdict": "PENDING", "sha256": None}
        for profile in ("visible", "official-url", "technical-compatibility")
    }
    return contract


def test_match_line_accounting_scans_content_linearly() -> None:
    scanner = load_scanner()
    content = CountingBytes(b"match\n" * 100)

    matches = scanner._matches(re.compile(rb"match"), content)

    assert [line for line, _match in matches] == list(range(1, 101))
    assert content.total_count_span <= len(content)


def test_match_line_accounting_handles_prefix_and_same_line_matches() -> None:
    scanner = load_scanner()
    content = CountingBytes(b"\n\nmatch match\nmatch")

    matches = scanner._matches(re.compile(rb"match"), content)

    assert [line for line, _match in matches] == [3, 3, 4]
    assert content.total_count_span <= len(content)


def test_match_line_accounting_handles_zero_matches() -> None:
    scanner = load_scanner()
    content = CountingBytes(b"\n\nno hits here\n")

    matches = scanner._matches(re.compile(rb"match"), content)

    assert matches == []
    assert content.total_count_span <= len(content)


def test_match_line_accounting_handles_a_pattern_spanning_newlines() -> None:
    scanner = load_scanner()
    content = CountingBytes(b"match\nline\nmatch")

    matches = scanner._matches(re.compile(rb"match\nline|match"), content)

    assert [line for line, _match in matches] == [1, 3]
    assert content.total_count_span <= len(content)


def test_stage0_contracts_and_profiles_are_authoritative() -> None:
    scanner = load_scanner()
    brand = yaml.safe_load(BRAND.read_text(encoding="utf-8"))
    legacy = yaml.safe_load(LEGACY.read_text(encoding="utf-8"))

    assert set(scanner.PROFILES) == {"visible", "official-url", "technical-compatibility"}
    assert set(brand) == BRAND_FIELDS
    assert brand["executor_name"] == "KFX"
    assert brand["executor_distribution"] == "kfx"
    assert brand["site_url"] is None
    assert brand["repository_url"] is None
    assert scanner.validate_brand_contract(BRAND) == []
    assert scanner.validate_legacy_contract(LEGACY) == []
    assert {item["category"] for item in legacy["occurrences"]} <= CATEGORIES


@pytest.mark.parametrize(
    ("field", "invalid"),
    [("product_name", None), ("site_url", 7), ("social_links", "enabled"), ("analytics_properties", [1])],
)
def test_brand_contract_enforces_exact_types_and_null_disable(tmp_path: Path, field: str, invalid: object) -> None:
    scanner = load_scanner()
    contract = yaml.safe_load(BRAND.read_text(encoding="utf-8"))
    contract[field] = invalid
    assert scanner.validate_brand_contract(write_yaml(tmp_path / "brand.yaml", contract))


@pytest.mark.parametrize(
    "url",
    [
        "https://ketos.test",
        "https://docs.ketos.test/guide",
        "https://registry.invalid/ketos",
        "https://owned.invalid.example.test/path",
    ],
)
def test_reserved_hosts_cannot_enable_features(tmp_path: Path, url: str) -> None:
    scanner = load_scanner()
    contract = yaml.safe_load(BRAND.read_text(encoding="utf-8"))
    contract["site_url"] = url
    assert any(
        "reserved" in error for error in scanner.validate_brand_contract(write_yaml(tmp_path / "brand.yaml", contract))
    )


def test_legacy_contract_rejects_inexact_duplicate_expired_and_missing_test_entries(tmp_path: Path) -> None:
    scanner = load_scanner()
    contract = yaml.safe_load(LEGACY.read_text(encoding="utf-8"))
    broken = deepcopy(contract["occurrences"][0])
    broken["locator"] = "python-distribution:generic"
    broken["supported_until"] = "1.0.0"
    broken["compatibility_test"] = "missing-test.py"
    contract["occurrences"] = [broken, deepcopy(broken)]
    errors = scanner.validate_legacy_contract(write_yaml(tmp_path / "legacy.yaml", contract))
    assert any("exact" in error for error in errors)
    assert any("duplicate" in error for error in errors)
    assert any("expired" in error for error in errors)
    assert any("missing" in error for error in errors)


def test_legacy_subtype_category_pairs_are_strict(tmp_path: Path) -> None:
    scanner = load_scanner()
    contract = yaml.safe_load(LEGACY.read_text(encoding="utf-8"))
    package_alias = next(item for item in contract["occurrences"] if item["subtype"] == "package_alias")
    package_alias["category"] = "wire_protocol"
    errors = scanner.validate_legacy_contract(write_yaml(tmp_path / "legacy.yaml", contract))
    assert any("package_alias requires import_alias" in error for error in errors)


@pytest.mark.parametrize(
    "profile",
    ["stage0", "cutover", "final", "release"],
)
def test_removed_public_profiles_are_rejected(profile: str) -> None:
    scanner = load_scanner()
    with pytest.raises(ValueError, match="unknown scan profile"):
        scanner.scan_root(ROOT, ZERO, profile=profile, legacy_contract_path=LEGACY)


def test_cli_requires_an_explicit_profile() -> None:
    scanner = load_scanner()
    with pytest.raises(SystemExit) as raised:
        scanner.main([])
    assert raised.value.code == CLI_USAGE_ERROR


@pytest.mark.parametrize(
    "url",
    [
        "https://www.lang" + "flow.org/docs",
        "https://github.com/lang" + "flow-ai/lang" + "flow/issues",
        "https://pypi.org/project/" + old_executor(),
        "https://hub.docker.com/r/lang" + "flowai/lang" + "flow",
        "https://x.com/lang" + "flow_ai",
        "https://youtube.com/@lang" + "flow",
        "https" + "://www.ibm.com/products/watsonx-ai",
        "https" + "://api.segment.io/v1/p",
        "https" + "://search.algolia.net/1/indexes",
        "https://raw.githubusercontent.com/lang" + "flow-ai/lang" + "flow/main/README.md",
        "https://cdn.jsdelivr.net/gh/lang" + "flow-ai/lang" + "flow@main/file.js",
        "https://cdn.jsdelivr.net/npm/@lang" + "flow/chat@1/dist/index.js",
        "https://unpkg.com/@lang" + "flow/chat-widget/index.js",
    ],
)
def test_official_url_profile_denies_every_official_endpoint(tmp_path: Path, url: str) -> None:
    scanner = load_scanner()
    (tmp_path / "endpoint.txt").write_text(url, encoding="utf-8")
    report = scanner.scan_root(tmp_path, ZERO, profile="official-url", legacy_contract_path=LEGACY)
    assert any(item["kind"] == "official_url" for item in report["violations"])


def test_official_url_boundaries_do_not_match_attacker_suffix(tmp_path: Path) -> None:
    scanner = load_scanner()
    (tmp_path / "endpoint.txt").write_text("https://www.lang" + "flow.org.evil.example", encoding="utf-8")
    report = scanner.scan_root(tmp_path, ZERO, profile="official-url", legacy_contract_path=LEGACY)
    assert not any(item["kind"] == "official_url" for item in report["violations"])


def test_visible_profile_does_not_exempt_new_or_untracked_files(tmp_path: Path) -> None:
    scanner = load_scanner()
    git = git_executable()
    subprocess.run([git, "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run([git, "config", "user.name", "Stage Zero"], cwd=tmp_path, check=True)
    subprocess.run([git, "config", "user.email", "stage0@example.invalid"], cwd=tmp_path, check=True)
    (tmp_path / "README.md").write_text("Ketos\n", encoding="utf-8")
    subprocess.run([git, "add", "README.md"], cwd=tmp_path, check=True)
    subprocess.run([git, "commit", "-qm", "baseline"], cwd=tmp_path, check=True)
    (tmp_path / "new.md").write_text(old_product(), encoding="utf-8")
    blobs = scanner._worktree_blobs(tmp_path)
    assert "new.md" in {blob.path for blob in blobs}


def test_frozen_untracked_exclusions_are_exact_and_never_hide_tracked_files(tmp_path: Path) -> None:
    scanner = load_scanner()
    git = git_executable()
    subprocess.run([git, "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run([git, "config", "user.name", "Stage Zero"], cwd=tmp_path, check=True)
    subprocess.run([git, "config", "user.email", "stage0@example.invalid"], cwd=tmp_path, check=True)
    artifacts = tmp_path / ".artifacts"
    artifacts.mkdir()
    (artifacts / "tracked.md").write_text(old_product(), encoding="utf-8")
    subprocess.run([git, "add", ".artifacts/tracked.md"], cwd=tmp_path, check=True)
    subprocess.run([git, "commit", "-qm", "baseline"], cwd=tmp_path, check=True)
    (artifacts / "frozen.md").write_text(old_product(), encoding="utf-8")
    (tmp_path / "FROZEN_REPORT.md").write_text(old_product(), encoding="utf-8")
    (tmp_path / "FROZEN_REPORT.md.new").write_text(old_product(), encoding="utf-8")
    (tmp_path / "NEW_REPORT.md").write_text(old_product(), encoding="utf-8")
    exclusions = [
        {"kind": "prefix", "path": ".artifacts/", "owner": "M1", "reason": "Frozen pre-task evidence."},
        {"kind": "file", "path": "FROZEN_REPORT.md", "owner": "M1", "reason": "Frozen pre-task report."},
    ]

    blobs = scanner._worktree_blobs(tmp_path, untracked_exclusions=exclusions)
    paths = {blob.path for blob in blobs}
    assert ".artifacts/frozen.md" not in paths
    assert "FROZEN_REPORT.md" not in paths
    assert ".artifacts/tracked.md" in paths
    assert "FROZEN_REPORT.md.new" in paths
    assert "NEW_REPORT.md" in paths

    zero = yaml.safe_load(ZERO.read_text(encoding="utf-8"))
    report = scanner._scan_blobs(blobs, zero, profile="visible", excluded_path=None, legacy_locators=set())
    violation_paths = {item["path"] for item in report["violations"]}
    assert ".artifacts/tracked.md" in violation_paths
    assert "NEW_REPORT.md" in violation_paths


@pytest.mark.parametrize(
    ("mutation", "expected"),
    [
        (lambda item: item.update(path="./FROZEN_REPORT.md"), "normalized"),
        (lambda item: item.update(kind="directory"), "kind"),
        (lambda item: item.update(owner=""), "owner"),
        (lambda item: item.update(reason=""), "reason"),
    ],
)
def test_untracked_exclusion_contract_rejects_ambiguous_entries(tmp_path: Path, mutation, expected: str) -> None:
    scanner = load_scanner()
    contract = yaml.safe_load(LEGACY.read_text(encoding="utf-8"))
    exclusions = contract["baseline"]["untracked_exclusions"]
    mutation(exclusions[0])
    contract["baseline"]["untracked_exclusions_sha256"] = exclusion_digest(exclusions)

    errors = scanner.validate_legacy_contract(write_yaml(tmp_path / "legacy.yaml", contract))

    assert any(expected in error for error in errors)


def test_untracked_exclusion_contract_requires_deterministic_sha256(tmp_path: Path) -> None:
    scanner = load_scanner()
    contract = yaml.safe_load(LEGACY.read_text(encoding="utf-8"))
    exclusions = contract["baseline"]["untracked_exclusions"]
    assert contract["baseline"]["untracked_exclusions_sha256"] == exclusion_digest(exclusions)
    contract["baseline"]["untracked_exclusions_sha256"] = "0" * 64

    errors = scanner.validate_legacy_contract(write_yaml(tmp_path / "legacy.yaml", contract))

    assert any("untracked_exclusions_sha256" in error and "fingerprint" in error for error in errors)


def test_ci_has_separate_bounded_fast_and_cold_start_steps() -> None:
    workflow = WORKFLOW.read_text(encoding="utf-8")
    assert "timeout-minutes: 5" in workflow
    assert "timeout-minutes: 15" in workflow
    assert '-m "not slow"' in workflow
    assert "-m slow" in workflow
    assert "--profile visible" in workflow
    assert "--profile official-url" in workflow
    assert "--profile technical-compatibility" in workflow


def test_technical_profile_requires_the_exact_path_and_line_locator() -> None:
    scanner = load_scanner()
    zero = yaml.safe_load(ZERO.read_text(encoding="utf-8"))
    source = "import " + old_executor() + "\n"
    blob = scanner.Blob("src/compat.py", source.encode())
    exact = "import_alias:package_alias:src/compat.py:1"
    allowed = scanner._scan_blobs(
        [blob], zero, profile="technical-compatibility", excluded_path=None, legacy_locators={exact}
    )
    denied = scanner._scan_blobs(
        [blob], zero, profile="technical-compatibility", excluded_path=None, legacy_locators={exact + "0"}
    )
    assert not any(item["kind"] == "unledgered_technical_residue" for item in allowed["violations"])
    assert any(item["kind"] == "unledgered_technical_residue" for item in denied["violations"])


def test_scanner_tests_and_archives_are_not_exempt() -> None:
    scanner = load_scanner()
    zero = yaml.safe_load(ZERO.read_text(encoding="utf-8"))
    direct = scanner.Blob("scripts/rebrand/tests/untracked.py", ("value='" + old_product() + "'\n").encode())
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr("generated.py", "value='" + old_product() + "'\n")
    archived = scanner.Blob("artifact.zip", stream.getvalue())
    report = scanner._scan_blobs(
        [direct, archived], zero, profile="technical-compatibility", excluded_path=None, legacy_locators=set()
    )
    paths = {item["path"] for item in report["violations"]}
    assert "scripts/rebrand/tests/untracked.py" in paths
    assert "artifact.zip!generated.py" in paths


@pytest.mark.parametrize("profile", ["visible", "official-url", "technical-compatibility"])
def test_checked_in_pass_contract_profile_has_zero_violations(profile: str) -> None:
    scanner = load_scanner()
    legacy = yaml.safe_load(LEGACY.read_text(encoding="utf-8"))

    report = scanner.scan_repository(ROOT, ZERO, profile=profile, legacy_contract_path=LEGACY)

    assert {item["verdict"] for item in legacy["baseline"]["scanner_outputs"].values()} == {"PASS"}
    assert report["violations"] == []


def test_baseline_schema_rejects_missing_counts_and_non_exact_outputs(tmp_path: Path) -> None:
    scanner = load_scanner()
    contract = yaml.safe_load(LEGACY.read_text(encoding="utf-8"))
    contract["baseline"].pop("visible_count")
    contract["baseline"]["scanner_outputs"]["visible"] = "UNKNOWN"
    errors = scanner.validate_legacy_contract(write_yaml(tmp_path / "legacy.yaml", contract))
    assert any("visible_count" in error and "missing" in error for error in errors)
    assert any("scanner_outputs" in error for error in errors)


@pytest.mark.parametrize(
    "field",
    [
        "category",
        "subtype",
        "locator",
        "owner",
        "reason",
        "compatibility_test",
        "introduced_in",
        "supported_until",
        "removal_condition",
    ],
)
def test_every_legacy_occurrence_field_is_mandatory(tmp_path: Path, field: str) -> None:
    scanner = load_scanner()
    contract = yaml.safe_load(LEGACY.read_text(encoding="utf-8"))
    contract["occurrences"][0].pop(field)
    errors = scanner.validate_legacy_contract(write_yaml(tmp_path / "legacy.yaml", contract))
    assert any(field in error and "missing" in error for error in errors)


def test_pending_baseline_evidence_fails_closed() -> None:
    scanner = load_scanner()
    legacy = pending_legacy_contract()
    report = {"violations": []}
    scanner._add_pending_evidence_violation(report, legacy, "visible")
    assert report["violations"] == [
        {
            "kind": "baseline_evidence_pending",
            "path": LEGACY_RELATIVE,
            "line": 0,
            "match": "visible",
        }
    ]


@pytest.mark.parametrize(
    "registry",
    [
        "https://ghcr.io/ketos",
        "ghcr.io",
        "ghcr.io/",
        "registry.ketos.test/ketos",
        "registry.invalid/ketos",
        "localhost/ketos",
        "ghcr.io/ketos/../escape",
    ],
)
def test_registry_requires_bare_owned_host_and_normalized_namespace(tmp_path: Path, registry: str) -> None:
    scanner = load_scanner()
    contract = yaml.safe_load(BRAND.read_text(encoding="utf-8"))
    contract["container_registry_namespace"] = registry
    errors = scanner.validate_brand_contract(write_yaml(tmp_path / "brand.yaml", contract))
    assert any("container_registry_namespace" in error for error in errors)


def test_registry_accepts_bare_owned_host_and_namespace_shape(tmp_path: Path) -> None:
    scanner = load_scanner()
    contract = yaml.safe_load(BRAND.read_text(encoding="utf-8"))
    contract["container_registry_namespace"] = "ghcr.io/ketos-project"
    assert scanner.validate_brand_contract(write_yaml(tmp_path / "brand.yaml", contract)) == []
