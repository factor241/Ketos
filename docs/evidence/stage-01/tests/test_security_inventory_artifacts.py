from __future__ import annotations

import json
from pathlib import Path


BUNDLE = Path(__file__).resolve().parents[1]
BASELINE_SHA = "80878261d07c21ad257de017d98069f211ada2c2"


def load_json(relative: str) -> dict:
    return json.loads((BUNDLE / relative).read_text(encoding="utf-8"))


def test_job_inventory_and_census_are_complete_and_balanced() -> None:
    inventory = load_json("backend/job-ownership.json")
    census = load_json("backend/job-null-census.json")

    assert inventory["source_baseline_sha"] == BASELINE_SHA
    assert inventory["nullable_owner_contract"] is True
    assert len(inventory["writers"]) == 9
    assert all(writer["owner_argument"] for writer in inventory["writers"])
    assert inventory["fail_open_or_unscoped_paths"]

    assert census["source_baseline_sha"] == BASELINE_SHA
    counts = census["counts"]
    assert counts["attributable"] + counts["ambiguous"] + counts["orphan"] == counts["all_null_owner"]
    assert counts["all_jobs"] == counts["owned"] + counts["all_null_owner"]
    assert census["snapshot"]["access_mode"] == "sqlite-mode-ro-query-only"
    assert census["production_representative"] is False


def test_route_matrix_covers_every_runtime_registration_with_required_fields() -> None:
    matrix = load_json("security/route-capability-matrix.json")
    routes = matrix["routes"]
    required = {
        "method",
        "path",
        "endpoint",
        "include_in_schema",
        "auth",
        "actor_source",
        "scope",
        "risk",
        "profile_gate",
        "review_status",
    }

    assert matrix["source_baseline_sha"] == BASELINE_SHA
    assert matrix["runtime"]["installed_plugin_entry_points"] == []
    assert matrix["runtime"]["route_method_registrations"] == len(routes)
    assert matrix["runtime"]["openapi_route_method_count"] == 137
    assert len(routes) == 263
    assert all(required <= route.keys() for route in routes)
    assert len({(route["path"], route["method"], route["endpoint"]) for route in routes}) == len(routes)
    assert any(route["path"].startswith("/api/mcp/") for route in routes)
    assert any(route["path"].startswith("/api/v1/mcp/") for route in routes)
    by_path_method = {(route["path"], route["method"]): route for route in routes}
    assert by_path_method[("/api/v1/responses", "POST")]["auth"] == "api-key"
    assert by_path_method[("/api/v1/agentic/assist", "POST")]["auth"] == "cookie-jwt-or-api-key"

    captured = json.loads((BUNDLE / "artifacts/runtime-route-inventory.stdout.log").read_text(encoding="utf-8"))
    assert captured == matrix


def test_security_profile_is_sanitized_and_blocks_unsafe_rollback() -> None:
    profile = load_json("security/profile-snapshot.json")
    serialized = json.dumps(profile, sort_keys=True).lower()

    assert profile["source_baseline_sha"] == BASELINE_SHA
    assert profile["secret_values_captured"] is False
    assert profile["settings"]["webhook_auth_enable"]["safe_required_value"] is True
    assert profile["settings"]["ssrf_protection_enabled"]["safe_required_value"] is True
    assert profile["settings"]["allow_public_custom_components"]["safe_required_value"] is False
    assert "api_key=" not in serialized
    assert "password=" not in serialized
    assert "token=" not in serialized

    safe_floor = (BUNDLE / "security/safe-rollback-floor.md").read_text(encoding="utf-8")
    emergency = (BUNDLE / "security/emergency-rollback.md").read_text(encoding="utf-8")
    assert "NOT_SAFE_AT_BASELINE_SHA" in safe_floor
    assert "AUTO_LOGIN=false" in emergency
    assert "WEBHOOK_AUTH_ENABLE=true" in emergency
    assert "ssrf_protection_enabled=true" in emergency
