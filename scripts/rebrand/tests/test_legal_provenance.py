"""Regression contract for Ketos legal provenance and community contacts."""

# ruff: noqa: S101, S603, S607, SLF001 - assertions, fixed builds, and scanner-unit access are intentional.

from __future__ import annotations

import hashlib
import importlib.util
import re
import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
SCANNER_PATH = REPO_ROOT / "scripts/rebrand/check_brand.py"

LICENSE_SHA256 = "87e722df5720438fc0ee8fe0e3e05e6d4cc95ef70c4d6d05f7391ddaedc8ebb9"
NOTICE_SHA256 = "6529dbd64a3927d0c49f29bbdcb62c63986099e3e70143dc26c6ee54779dbceb"
STEPFLOW_LICENSE_SHA256 = "b04c8850fdf64d17233f0acbe4eb632f03bd663094233c949bdbe788858bb841"
STEPFLOW_NOTICE_SHA256 = "d5fe5257f43692583fb8f66bb222dd0250a277fcab482bb50de6d124e9243cd4"
LEGACY_PRODUCT = "Lang" + "flow"
LEGACY_PRODUCT_LOWER = LEGACY_PRODUCT.lower()
NOTICE_LINES = {
    3: (
        f"Ketos is an independent, unofficial derivative of {LEGACY_PRODUCT}, originally available at "
        f"https://github.com/{LEGACY_PRODUCT_LOWER}-ai/{LEGACY_PRODUCT_LOWER} and licensed under the MIT License."
    ),
    5: (
        f"Portions derived from {LEGACY_PRODUCT} retain their original copyright and MIT license notices, "
        f"including Copyright (c) 2024 {LEGACY_PRODUCT}."
    ),
    7: (
        "Original Ketos-specific modifications authored by Daria Shemelina are copyrighted by Daria Shemelina, "
        'carry the notice "Portions Copyright (c) 2026 Daria Shemelina", and are also released under the MIT License.'
    ),
    11: (
        f"Ketos is not affiliated with, endorsed by, or sponsored by {LEGACY_PRODUCT} or its copyright holders. "
        "The Ketos-specific notice does not replace, diminish, or claim ownership of the upstream material."
    ),
}

COMMUNITY_DOCUMENTS = ("SECURITY.md", "CODE_OF_CONDUCT.md", "CONTRIBUTING.md")
LEGACY_BRAND = re.compile(r"lang[-_ ]?flow", re.IGNORECASE)
UPSTREAM_ADDRESSES = (
    f"github.com/{LEGACY_PRODUCT_LOWER}-ai",
    f"{LEGACY_PRODUCT_LOWER}.org",
    "hackerone.com/ibm",
)
ROOT_DISTRIBUTION_ARTIFACT_COUNT = 2
PYTHON_DISTRIBUTIONS = {
    "ketos": ("MIT", LICENSE_SHA256, NOTICE_SHA256),
    "ketos-base": ("MIT", LICENSE_SHA256, NOTICE_SHA256),
    "ketos-sdk": ("MIT", LICENSE_SHA256, NOTICE_SHA256),
    "ketos-stepflow": ("Apache-2.0", STEPFLOW_LICENSE_SHA256, STEPFLOW_NOTICE_SHA256),
    "kfx": ("MIT", LICENSE_SHA256, NOTICE_SHA256),
    "kfx-arxiv": ("MIT", LICENSE_SHA256, NOTICE_SHA256),
    "kfx-docling": ("MIT", LICENSE_SHA256, NOTICE_SHA256),
    "kfx-duckduckgo": ("MIT", LICENSE_SHA256, NOTICE_SHA256),
    "kfx-ibm": ("MIT", LICENSE_SHA256, NOTICE_SHA256),
}


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _load_scanner():
    spec = importlib.util.spec_from_file_location("ketos_legal_provenance_scanner", SCANNER_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _artifact_legal_files(path: Path) -> dict[str, bytes]:
    if path.suffix == ".whl":
        with zipfile.ZipFile(path) as archive:
            members = [name for name in archive.namelist() if Path(name).name in {"LICENSE", "NOTICE"}]
            assert [Path(name).name for name in members].count("LICENSE") == 1
            assert [Path(name).name for name in members].count("NOTICE") == 1
            return {Path(name).name: archive.read(name) for name in members}

    with tarfile.open(path, "r:gz") as archive:
        members = [member for member in archive.getmembers() if Path(member.name).name in {"LICENSE", "NOTICE"}]
        assert [Path(member.name).name for member in members].count("LICENSE") == 1
        assert [Path(member.name).name for member in members].count("NOTICE") == 1
        return {
            Path(member.name).name: extracted.read()
            for member in members
            if (extracted := archive.extractfile(member)) is not None
        }


def _write_fixture_contract(path: Path, license_bytes: bytes, notice_bytes: bytes) -> Path:
    notice_lines = notice_bytes.decode().splitlines()
    license_line = license_bytes.decode().splitlines()[2]
    allowlist = [
        {
            "path": "LICENSE",
            "line": 3,
            "expected_text": license_line,
            "sha256": hashlib.sha256(license_line.encode()).hexdigest(),
        },
        *(
            {
                "path": "NOTICE",
                "line": line_number,
                "expected_text": notice_lines[line_number - 1],
                "sha256": hashlib.sha256(notice_lines[line_number - 1].encode()).hexdigest(),
            }
            for line_number in (3, 5, 11)
        ),
    ]
    contract = {
        "version": 1,
        "analysis_commit": "de591b28cbade3483b2040aa338906a8834d6400",
        "baseline": {
            "brand_file_count": 10,
            "brand_match_count": 10,
            "brand_path_count": 10,
            "executor_file_count": 10,
            "executor_match_count": 10,
            "executor_path_count": 10,
            "upstream_endpoint_count": 10,
            "scan_issue_count": 0,
        },
        "legal_files": [
            {"path": "LICENSE", "sha256": hashlib.sha256(license_bytes).hexdigest()},
            {"path": "NOTICE", "sha256": hashlib.sha256(notice_bytes).hexdigest()},
        ],
        "legal_allowlist": allowlist,
    }
    path.write_text(yaml.safe_dump(contract, sort_keys=False), encoding="utf-8")
    return path


def test_root_license_is_preserved_byte_for_byte() -> None:
    assert _sha256(REPO_ROOT / "LICENSE") == LICENSE_SHA256


def test_root_notice_matches_the_frozen_contract() -> None:
    notice = REPO_ROOT / "NOTICE"
    assert _sha256(notice) == NOTICE_SHA256

    lines = notice.read_text(encoding="utf-8").splitlines()
    for line_number, expected_text in NOTICE_LINES.items():
        assert lines[line_number - 1] == expected_text


def test_all_wheels_and_sdists_include_exact_legal_files_and_metadata(tmp_path: Path) -> None:
    for distribution, (license_expression, license_sha256, notice_sha256) in PYTHON_DISTRIBUTIONS.items():
        dist_dir = tmp_path / distribution
        subprocess.run(
            [
                "uv",
                "build",
                "--package",
                distribution,
                "--wheel",
                "--sdist",
                "--out-dir",
                str(dist_dir),
                "--no-create-gitignore",
            ],
            cwd=REPO_ROOT,
            check=True,
            capture_output=True,
            text=True,
        )

        artifacts = [*dist_dir.glob("*.whl"), *dist_dir.glob("*.tar.gz")]
        assert len(artifacts) == ROOT_DISTRIBUTION_ARTIFACT_COUNT, distribution
        for artifact in artifacts:
            legal_files = _artifact_legal_files(artifact)
            assert set(legal_files) == {"LICENSE", "NOTICE"}, artifact.name
            assert hashlib.sha256(legal_files["LICENSE"]).hexdigest() == license_sha256
            assert hashlib.sha256(legal_files["NOTICE"]).hexdigest() == notice_sha256

        wheel = next(dist_dir.glob("*.whl"))
        with zipfile.ZipFile(wheel) as archive:
            metadata_path = next(name for name in archive.namelist() if name.endswith(".dist-info/METADATA"))
            metadata = archive.read(metadata_path).decode("utf-8").splitlines()
        assert f"License-Expression: {license_expression}" in metadata, distribution
        assert [line for line in metadata if line.startswith("License-File: ")] == [
            "License-File: LICENSE",
            "License-File: NOTICE",
        ], distribution


def test_compatibility_profiles_reject_upstream_address_outside_legal_paths(tmp_path: Path) -> None:
    license_bytes = (REPO_ROOT / "LICENSE").read_bytes()
    fixture_license = tmp_path / "LICENSE"
    fixture_notice = tmp_path / "NOTICE"
    fixture_license.write_bytes(license_bytes)
    fixture_notice.write_bytes((REPO_ROOT / "NOTICE").read_bytes())
    upstream = "https://github.com/" + "lang" + "flow-ai/" + "lang" + "flow"
    (tmp_path / "community.md").write_text(upstream + "\n", encoding="utf-8")
    contract = _write_fixture_contract(tmp_path / "contract.yaml", license_bytes, fixture_notice.read_bytes())
    scanner = _load_scanner()

    visible = scanner.scan_root(tmp_path, contract, profile="visible")
    official = scanner.scan_root(tmp_path, contract, profile="official-url")
    assert any(
        violation["path"] == "community.md" and violation["kind"] == "visible_residue"
        for violation in visible["violations"]
    )
    assert any(
        violation["path"] == "community.md" and violation["kind"] == "official_url"
        for violation in official["violations"]
    )


def test_exact_public_attribution_reference_can_be_allowlisted_without_freezing_document(
    tmp_path: Path,
) -> None:
    license_bytes = (REPO_ROOT / "LICENSE").read_bytes()
    notice_bytes = (REPO_ROOT / "NOTICE").read_bytes()
    expected = f"Portions derived from {LEGACY_PRODUCT} retain their original MIT license notices."
    readme = tmp_path / "README.md"
    readme.write_text(f"# Project\n\n{expected}\n", encoding="utf-8")
    contract_path = _write_fixture_contract(tmp_path / "contract.yaml", license_bytes, notice_bytes)
    contract = yaml.safe_load(contract_path.read_text(encoding="utf-8"))
    contract["legal_allowlist"].append(
        {
            "path": "README.md",
            "line": 3,
            "expected_text": expected,
            "sha256": hashlib.sha256(expected.encode()).hexdigest(),
        }
    )
    contract_path.write_text(yaml.safe_dump(contract, sort_keys=False), encoding="utf-8")
    scanner = _load_scanner()
    blobs = [
        scanner.Blob("LICENSE", license_bytes),
        scanner.Blob("NOTICE", notice_bytes),
        scanner.Blob("README.md", readme.read_bytes()),
    ]

    assert scanner.validate_zero_residue_contract(contract_path) == []
    accepted = scanner._scan_blobs(
        blobs,
        contract,
        profile="visible",
        excluded_path=None,
        legacy_locators=set(),
    )
    assert accepted["violations"] == []

    readme.write_text(f"# Project\n{expected}\n", encoding="utf-8")
    moved = scanner._scan_blobs(
        [*blobs[:2], scanner.Blob("README.md", readme.read_bytes())],
        contract,
        profile="visible",
        excluded_path=None,
        legacy_locators=set(),
    )
    assert {item["kind"] for item in moved["violations"]} >= {"missing_legal_occurrence", "visible_residue"}


def test_community_documents_are_legacy_free_and_use_no_upstream_addresses() -> None:
    for relative_path in COMMUNITY_DOCUMENTS:
        text = (REPO_ROOT / relative_path).read_text(encoding="utf-8")
        assert LEGACY_BRAND.search(text) is None, relative_path
        for address in UPSTREAM_ADDRESSES:
            assert address not in text.lower(), f"{relative_path}: {address}"


def test_community_contacts_are_explicitly_test_only() -> None:
    security = (REPO_ROOT / "SECURITY.md").read_text(encoding="utf-8")
    conduct = (REPO_ROOT / "CODE_OF_CONDUCT.md").read_text(encoding="utf-8")

    assert re.search(r"security@ketos\.test[^\n]*test-only", security, re.IGNORECASE)
    assert re.search(r"support@ketos\.test[^\n]*test-only", conduct, re.IGNORECASE)
