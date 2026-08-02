"""Contract tests for the current-only localization flow ABI corpus."""

from __future__ import annotations

import json
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
CORPUS_ROOT = REPOSITORY_ROOT / "tests" / "fixtures" / "localization" / "flow-abi" / "current"
EXPECTED_CASES = {
    "base-flow",
    "custom-label-flow",
    "assistant-modified-flow",
    "output-reordered-flow",
}
EXPECTED_TOPOLOGY_HANDLES = {
    "text-regex-output": (("text", "input_text"), ("text", "input_value")),
    "chat-prompt-output": (("message", "var1"), ("prompt", "input_value")),
}


def test_current_corpus_manifest_declares_every_fixture() -> None:
    manifest = json.loads((CORPUS_ROOT / "manifest.json").read_text(encoding="utf-8"))
    fixture_names = {path.name for path in CORPUS_ROOT.glob("*.json")} - {"manifest.json"}

    assert manifest["schema_version"] == 1
    assert {case["case_id"] for case in manifest["cases"]} == EXPECTED_CASES
    assert {case["fixture"] for case in manifest["cases"]} == fixture_names
    assert all((CORPUS_ROOT / case["fixture"]).is_file() for case in manifest["cases"])


def test_current_corpus_fixtures_keep_presentation_out_of_serialized_identifiers() -> None:
    manifest = json.loads((CORPUS_ROOT / "manifest.json").read_text(encoding="utf-8"))

    for entry in manifest["cases"]:
        fixture = json.loads((CORPUS_ROOT / entry["fixture"]).read_text(encoding="utf-8"))
        assert fixture["schema_version"] == 1
        assert fixture["case_id"] == entry["case_id"]
        assert fixture["source_format_version"] == "current"
        assert fixture["topology"] in EXPECTED_TOPOLOGY_HANDLES

        node_ids = fixture["stable_ids"]["nodes"]
        edge_ids = fixture["stable_ids"]["edges"]
        expected_component_types = fixture["expected_component_types"]
        assert len(node_ids) == len(set(node_ids)) == 3
        assert len(edge_ids) == len(set(edge_ids)) == 2
        assert len(expected_component_types) == len(node_ids)
        assert all(isinstance(component_type, str) and component_type for component_type in expected_component_types)

        expected_handles = EXPECTED_TOPOLOGY_HANDLES[fixture["topology"]]
        expected_edge_ids = {
            f"edge:{source}:{source_handle}:{target}:{target_handle}"
            for source, target, (source_handle, target_handle) in zip(
                node_ids[:-1],
                node_ids[1:],
                expected_handles,
                strict=True,
            )
        }
        assert set(edge_ids) == expected_edge_ids

        identifiers = json.dumps(fixture["stable_ids"], ensure_ascii=False, sort_keys=True)
        assert "i18n" not in identifiers.lower()
        assert "translation" not in identifiers.lower()
        assert "\u0420\u0443\u0441:" not in identifiers

        serialized = json.dumps(fixture, ensure_ascii=False, sort_keys=True)
        assert '"legacy"' not in serialized
        assert '"replacement"' not in serialized
        assert '"removed_outputs"' not in serialized
