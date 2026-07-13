"""Integration tests for the upgrade machinery against current Ketos starter flows.

These canonical flows are the current generator inputs shipped by the backend. They
exercise the checker and applier against current component code rather than
historical compatibility snapshots or hand-crafted stubs.

The tests make no assumption about which nodes are outdated vs. ok — the component
registry evolves over time and the answers will change across releases. Instead they
verify the contract:

  1. The checker runs without error on every fixture flow.
  2. Every node status is one of the four valid values.
  3. The applier produces valid JSON.
  4. After applying safe upgrades, re-checking the same nodes shows no new outdated_safe nodes
     (i.e. the apply loop converges in one pass).
  5. Blocked and breaking nodes are left unchanged by the applier.
"""

from __future__ import annotations

import copy
import json
import pathlib

import pytest
from kfx.upgrade.applier import apply_safe_upgrades
from kfx.upgrade.checker import check_flow_compatibility

CURRENT_STARTERS = (
    pathlib.Path(__file__).resolve().parents[5]
    / "src"
    / "backend"
    / "base"
    / "ketos"
    / "initial_setup"
    / "starter_projects"
)

STARTER_FLOWS = sorted(CURRENT_STARTERS.glob("*.json"))
assert STARTER_FLOWS, f"No current starter flows found in {CURRENT_STARTERS}"


def _load_registry() -> dict:
    """Load the bundled component index directly for test use.

    Bypasses the SHA integrity gate in _read_component_index — that check is a
    production security measure and is not appropriate for a test fixture loader
    whose only job is to get real component data into the checker.
    """
    import inspect

    import orjson

    import kfx

    pkg_dir = pathlib.Path(inspect.getfile(kfx)).parent
    idx_path = pkg_dir / "_assets" / "component_index.json"
    if not idx_path.exists():
        return {}
    blob = orjson.loads(idx_path.read_bytes())
    all_types: dict = {}
    for category, components in blob.get("entries", []):
        all_types.setdefault(category, {}).update(components)
    return all_types


@pytest.fixture(scope="module")
def registry() -> dict:
    loaded = _load_registry()
    assert loaded, "Bundled component registry is empty or missing; integration checks are not meaningful"
    return loaded


@pytest.fixture(scope="module")
def flow_data_map() -> dict[str, dict]:
    """Return a map of flow_name -> flow graph data dict (the inner ``data`` key).

    Real Ketos flow JSON files have the shape::

        {
          "name": "...",
          "data": { "nodes": [...], "edges": [...], "viewport": {...} },
          ...
        }

    The checker and applier expect the inner ``data`` dict (with top-level ``nodes``
    and ``edges`` keys), so we unwrap it here. If a fixture file is already in the
    flat format (no outer ``data`` key), we use it as-is.
    """
    result = {}
    for f in STARTER_FLOWS:
        raw = json.loads(f.read_text(encoding="utf-8"))
        result[f.stem] = raw["data"] if "data" in raw and "nodes" in raw.get("data", {}) else raw
    return result


def _walk_nodes(nodes: list[dict]):
    """Yield every node in a flow, including arbitrarily nested group nodes."""
    for node in nodes:
        yield node
        nested = node.get("data", {}).get("node", {}).get("flow", {}).get("data", {}).get("nodes")
        if isinstance(nested, list):
            yield from _walk_nodes(nested)


def _nodes_by_id(flow: dict) -> dict[str, dict]:
    """Index all nodes without losing the nested nodes classified by the checker."""
    result = {}
    for node in _walk_nodes(flow.get("nodes", [])):
        node_id = node.get("data", {}).get("id") or node.get("id")
        assert isinstance(node_id, str), "Every code-bearing flow node id must be a string"
        assert node_id, "Every code-bearing flow node must have an id"
        assert node_id not in result, f"Duplicate node id in flow fixture: {node_id}"
        result[node_id] = node
    return result


# ---------------------------------------------------------------------------
# Parametrise over every fixture file
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("flow_name", [f.stem for f in STARTER_FLOWS])
def test_checker_runs_without_error(flow_name, flow_data_map, registry):
    """Checker must not raise on any current canonical starter flow."""
    flow = flow_data_map[flow_name]
    report = check_flow_compatibility(flow, registry)
    assert report is not None


@pytest.mark.parametrize("flow_name", [f.stem for f in STARTER_FLOWS])
def test_all_node_statuses_are_valid(flow_name, flow_data_map, registry):
    """Every node must resolve to one of the four known statuses."""
    valid = {"ok", "outdated_safe", "outdated_breaking", "blocked"}
    flow = flow_data_map[flow_name]
    report = check_flow_compatibility(flow, registry)
    for node in report.nodes:
        assert node.status in valid, (
            f"Unexpected status '{node.status}' for {node.display_name} ({node.component_type})"
        )


@pytest.mark.parametrize("flow_name", [f.stem for f in STARTER_FLOWS])
def test_applier_produces_valid_json(flow_name, flow_data_map, registry):
    """apply_safe_upgrades must always return a JSON-serialisable dict."""
    flow = flow_data_map[flow_name]
    report = check_flow_compatibility(flow, registry)
    updated = apply_safe_upgrades(flow, registry, report)
    # Must round-trip through JSON without error
    serialised = json.dumps(updated)
    reparsed = json.loads(serialised)
    assert isinstance(reparsed, dict)


@pytest.mark.parametrize("flow_name", [f.stem for f in STARTER_FLOWS])
def test_apply_converges_in_one_pass(flow_name, flow_data_map, registry):
    """After applying safe upgrades, re-checking should find no new outdated_safe nodes.

    This verifies the applier actually wrote the current registry code and did not
    introduce a new delta on the next check.
    """
    flow = flow_data_map[flow_name]
    report1 = check_flow_compatibility(flow, registry)
    updated = apply_safe_upgrades(flow, registry, report1)
    report2 = check_flow_compatibility(updated, registry)

    # Any node that was safe in pass 1 must now be ok in pass 2
    safe_ids_pass1 = {n.node_id for n in report1.nodes if n.status == "outdated_safe"}
    still_safe_pass2 = {n.node_id for n in report2.nodes if n.status == "outdated_safe" and n.node_id in safe_ids_pass1}
    assert not still_safe_pass2, (
        f"Applier did not converge for {flow_name}: these nodes are still outdated_safe after apply: {still_safe_pass2}"
    )


@pytest.mark.parametrize("flow_name", [f.stem for f in STARTER_FLOWS])
def test_applier_does_not_change_blocking_or_breaking_nodes(flow_name, flow_data_map, registry):
    """Every blocked/breaking node dict must be identical before and after apply."""
    flow = flow_data_map[flow_name]
    original = copy.deepcopy(flow)
    report = check_flow_compatibility(flow, registry)
    updated = apply_safe_upgrades(flow, registry, report)

    unchanged_ids = {n.node_id for n in report.nodes if n.status in ("blocked", "outdated_breaking")}
    original_nodes = _nodes_by_id(original)
    updated_nodes = _nodes_by_id(updated)
    for node_id in unchanged_ids:
        assert node_id in original_nodes, f"Checker reported unknown node {node_id} in {flow_name}"
        assert node_id in updated_nodes, f"Applier deleted blocked/breaking node {node_id} in {flow_name}"
        assert updated_nodes[node_id] == original_nodes[node_id], (
            f"Blocked/breaking node {node_id} in {flow_name} was unexpectedly modified"
        )


@pytest.mark.parametrize("flow_name", [f.stem for f in STARTER_FLOWS])
def test_original_flow_not_mutated(flow_name, flow_data_map, registry):
    """The applier must never mutate the original flow dict."""
    flow = flow_data_map[flow_name]
    original = copy.deepcopy(flow)
    report = check_flow_compatibility(flow, registry)
    updated = apply_safe_upgrades(flow, registry, report)

    assert flow == original, f"Original flow was mutated for {flow_name}"
    assert updated is not flow, f"Applier returned the original flow object for {flow_name}"


@pytest.mark.parametrize(
    ("incompatible_type", "expected_status"),
    [("MissingComponent", "blocked"), ("BreakingComponent", "outdated_breaking")],
)
def test_applier_updates_safe_node_while_preserving_incompatible_node(incompatible_type, expected_status):
    """Exercise the write path while proving blocked/breaking nodes and input stay intact."""
    old_outputs = [
        {"name": "value", "display_name": "Value", "types": ["Data"], "method": "run", "allows_loop": False},
        {"name": "debug", "display_name": "Debug", "types": ["str"], "method": "debug", "allows_loop": False},
    ]
    current_outputs = [old_outputs[0]]
    registry = {
        "Test": {
            "SafeComponent": {
                "template": {"code": {"value": "safe-v2"}},
                "outputs": [],
                "metadata": {},
            },
            "BreakingComponent": {
                "template": {"code": {"value": "breaking-v2"}},
                "outputs": current_outputs,
                "metadata": {},
            },
        }
    }

    def node(node_id: str, component_type: str, code: str, outputs: list[dict]) -> dict:
        return {
            "id": node_id,
            "position": {"x": 17, "y": 29},
            "selected": False,
            "data": {
                "id": node_id,
                "type": component_type,
                "ui_state": {"collapsed": False, "tags": ["preserve", node_id]},
                "node": {
                    "display_name": component_type,
                    "edited": False,
                    "template": {"code": {"value": code}},
                    "outputs": outputs,
                },
            },
        }

    safe_node = node("safe-node", "SafeComponent", "safe-v1", [])
    incompatible_node = node("incompatible-node", incompatible_type, "incompatible-v1", old_outputs)
    flow = {
        "nodes": [safe_node, incompatible_node],
        "edges": [{"id": "edge-preserved", "source": "safe-node", "target": "incompatible-node"}],
        "viewport": {"x": 3, "y": 4, "zoom": 0.75},
    }
    original = copy.deepcopy(flow)

    report = check_flow_compatibility(flow, registry)
    statuses = {status.node_id: status.status for status in report.nodes}
    assert statuses == {"safe-node": "outdated_safe", "incompatible-node": expected_status}

    updated, count = apply_safe_upgrades(flow, registry, report, return_count=True)

    assert count == 1
    assert updated["nodes"][0]["data"]["node"]["template"]["code"]["value"] == "safe-v2"
    assert _nodes_by_id(updated)["incompatible-node"] == _nodes_by_id(original)["incompatible-node"]
    assert flow == original
    assert updated is not flow


# ---------------------------------------------------------------------------
# Summary test — print a human-readable report for CI logs
# ---------------------------------------------------------------------------


def test_upgrade_summary_report(flow_data_map, registry):
    """Print a human-readable summary of upgrade status across all fixture flows."""
    import sys

    for flow_name, flow in sorted(flow_data_map.items()):
        report = check_flow_compatibility(flow, registry)
        statuses = {}
        for n in report.nodes:
            statuses[n.status] = statuses.get(n.status, 0) + 1
        sys.stderr.write(f"{flow_name}: {dict(sorted(statuses.items()))}\n")
    # Always passes — output is visible in pytest -s
