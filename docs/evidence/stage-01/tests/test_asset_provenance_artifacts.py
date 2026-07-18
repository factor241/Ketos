from __future__ import annotations

import json
from pathlib import Path


BUNDLE = Path(__file__).resolve().parents[1]
BASELINE_SHA = "80878261d07c21ad257de017d98069f211ada2c2"


def load_json(relative: str) -> dict:
    return json.loads((BUNDLE / relative).read_text(encoding="utf-8"))


def test_graphify_and_asset_map_record_current_source_truth() -> None:
    graph = load_json("architecture/graphify-reconciliation.json")
    asset_map = (BUNDLE / "architecture/current-asset-map.md").read_text(encoding="utf-8")

    assert graph["source_baseline_sha"] == BASELINE_SHA
    assert graph["graph_built_at_commit"] == "572fad8ea2223e342508ecf095133091c7714e1b"
    assert graph["classification"] == "STALE_NAVIGATION_ONLY"
    assert graph["nodes"] == 65618
    assert graph["links"] == 131157
    assert graph["missing_link_endpoints"] == 0
    assert graph["self_loops"] == 17
    assert "36/36" in asset_map
    assert "source citations are authoritative" in asset_map


def test_telemetry_contract_is_bounded_and_never_fakes_an_observation_window() -> None:
    contract = load_json("telemetry/r34-contract.json")

    assert contract["source_baseline_sha"] == BASELINE_SHA
    assert contract["current_transport"] == "NO_OP"
    assert contract["observation"]["status"] == "BLOCKED_NO_EMITTED_EVENTS"
    assert contract["observation"]["window_days"] is None
    assert contract["observation"]["usage_counts"] is None
    assert contract["prohibited_fields"]
    assert all(event["bounded_dimensions"] for event in contract["proposed_events"])
    serialized = json.dumps(contract, sort_keys=True).lower()
    for prohibited in ("message_content", "prompt_content", "api_key", "raw_path", "raw_error"):
        assert prohibited in serialized


def test_lfx_desktop_xyflow_and_openswarm_pins_are_exact() -> None:
    lfx = load_json("compatibility/lfx-baseline.json")
    desktop = load_json("compatibility/desktop-status.json")
    xyflow = load_json("compatibility/xyflow-dependency.json")
    openswarm = (BUNDLE / "provenance/openswarm-ab982af.md").read_text(encoding="utf-8")

    assert lfx["source_commit"] == "87a5206ae925b1fb88f8ecc6bc248316128b64ee"
    assert lfx["source_python_files"] == 975
    assert lfx["logical_modules"] == 974
    assert lfx["legacy_modules_sha256"] == "1e26944c9961e2d15e394eefdf0730708135948675a114f1b6f61602af70c043"
    assert lfx["focused_suite"]["passed"] == 9
    assert desktop["disposition"] == "EXCLUDED_FROM_V1"
    assert desktop["current_checkout_shell"] == "ABSENT"
    assert desktop["external_prototypes_are_support_proof"] is False
    assert xyflow["xyflow_import_files"] == 45
    assert xyflow["legacy_reactflow_import_files"] == 0
    assert xyflow["legacy_reactflow_dependency_declared"] is True
    assert "ab982afcea63dbc775f8a40b74a1b1339a28097f" in openswarm
    assert "d45d05a6c6b60d74ea3d5f6b5ac7e5b7f4d6ad5c" in openswarm
    assert "No code was copied" in openswarm


def test_product_taxonomy_keeps_three_assistant_journeys_distinct() -> None:
    taxonomy = load_json("frontend/legacy-surface-taxonomy.json")
    audit = (BUNDLE / "frontend/product-design-audit.md").read_text(encoding="utf-8")

    assert taxonomy["source_baseline_sha"] == BASELINE_SHA
    assert {journey["id"] for journey in taxonomy["assistant_journeys"]} == {
        "public-playground",
        "private-flow-session-chat",
        "agentic-authoring-assistant",
    }
    assert taxonomy["analytics_call_counts"] == {"track": 23, "trackDataLoaded": 1, "trackFlowBuild": 2}
    assert "Browser verification status" in audit
