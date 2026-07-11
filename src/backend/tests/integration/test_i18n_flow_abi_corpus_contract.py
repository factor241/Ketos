"""Contract tests for the shared, versioned localization flow ABI corpus."""

from __future__ import annotations

import json
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
CORPUS_ROOT = REPOSITORY_ROOT / "tests" / "fixtures" / "localization" / "flow-abi" / "v1"
EXPECTED_CASES = {
    "old-flow",
    "outdated-flow",
    "legacy-flow",
    "custom-label-flow",
    "assistant-modified-flow",
    "output-reordered-flow",
}


def test_versioned_corpus_manifest_declares_every_r9_case() -> None:
    manifest = json.loads((CORPUS_ROOT / "manifest.json").read_text(encoding="utf-8"))

    assert manifest["schema_version"] == 1
    assert {case["case_id"] for case in manifest["cases"]} == EXPECTED_CASES
    assert all((CORPUS_ROOT / case["fixture"]).is_file() for case in manifest["cases"])


def test_corpus_fixtures_keep_translation_metadata_out_of_identifiers() -> None:
    manifest = json.loads((CORPUS_ROOT / "manifest.json").read_text(encoding="utf-8"))

    for entry in manifest["cases"]:
        fixture = json.loads((CORPUS_ROOT / entry["fixture"]).read_text(encoding="utf-8"))
        assert fixture["schema_version"] == 1
        assert fixture["case_id"] == entry["case_id"]
        assert len(fixture["stable_ids"]["nodes"]) == 3
        assert len(fixture["stable_ids"]["edges"]) == 2
        identifiers = json.dumps(fixture["stable_ids"], ensure_ascii=False, sort_keys=True)
        assert "i18n" not in identifiers.lower()
        assert "translation" not in identifiers.lower()
        assert "\u0420\u0443\u0441:" not in identifiers
