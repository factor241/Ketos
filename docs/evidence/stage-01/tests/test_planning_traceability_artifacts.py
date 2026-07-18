from __future__ import annotations

import json
from pathlib import Path

BUNDLE = Path(__file__).resolve().parents[1]


def test_stage02_plan_covers_all_w0_domains_without_implementing_them() -> None:
    plan = (BUNDLE / "planning/stage-02-w0-plan.md").read_text(encoding="utf-8")
    for domain in ("W0-A", "W0-B", "W0-C", "W0-D"):
        assert domain in plan
    for contract in ("Owner", "Dependencies", "Focused tests", "Rollback"):
        assert contract in plan
    assert "Stage 02 implementation status: NOT STARTED" in plan


def test_mcp_direct_name_fixture_spec_is_fail_closed() -> None:
    fixture = (BUNDLE / "planning/mcp-direct-name-fixture.md").read_text(encoding="utf-8")
    assert "direct-name" in fixture
    assert "mcp_enabled=true" in fixture
    assert "Flow EXECUTE" in fixture
    assert "unauthenticated" in fixture
    assert "wrong owner" in fixture
    assert "list/direct parity" in fixture


def test_traceability_has_exact_gc_and_requirement_denominators_without_false_pass() -> None:
    traceability = json.loads((BUNDLE / "requirements/traceability.json").read_text(encoding="utf-8"))
    gc_rows = traceability["guardrails"]
    requirement_rows = traceability["requirements"]
    assert len(gc_rows) == 18
    assert len(requirement_rows) == 40
    assert {row["id"] for row in gc_rows} == {f"GC-{index:02d}" for index in range(1, 19)}
    assert {row["id"] for row in requirement_rows} == {f"R-{index:02d}" for index in range(1, 41)}
    assert all(row["status"] != "FEATURE_PASS" for row in gc_rows + requirement_rows)
    assert all(row["evidence_or_disposition"] for row in gc_rows + requirement_rows)
