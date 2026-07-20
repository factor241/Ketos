"""Stage 07 Board allowlist and current-template policy tests."""

# ruff: noqa: EM101, INP001

from __future__ import annotations

import hashlib

import pytest
from ketos.services.workflow_execution import policy
from ketos.services.workflow_execution.policy import (
    BOARD_RUN_ALLOWED_COMPONENT_TYPES,
    BoardRunPolicyViolation,
    validate_board_run_flow,
)


def _hash(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()[:12]


def _node(component_type: str, code: str = "trusted-code", *, nested=None):
    node = {
        "id": f"{component_type}-1",
        "data": {
            "type": component_type,
            "node": {"template": {"code": {"value": code}}},
        },
    }
    if nested is not None:
        node["data"]["node"]["inline"] = {"nodes": nested}
    return node


@pytest.fixture(autouse=True)
def _registry(monkeypatch: pytest.MonkeyPatch):
    hashes = {
        component_type: frozenset({_hash("trusted-code")}) for component_type in BOARD_RUN_ALLOWED_COMPONENT_TYPES
    }
    monkeypatch.setattr(policy, "_load_registry_snapshot", lambda: policy._RegistrySnapshot(hashes))
    monkeypatch.setattr(
        policy, "get_trusted_code_for_validation", lambda code: code if code == "trusted-code" else None
    )


@pytest.mark.parametrize("component_type", sorted(BOARD_RUN_ALLOWED_COMPONENT_TYPES))
def test_every_exact_allowlisted_component_with_current_code_passes(component_type: str) -> None:
    validate_board_run_flow({"nodes": [_node(component_type)]})


@pytest.mark.parametrize("component_type", ["CustomComponent", "PythonCode", "MCP", "HTTP", "RunFlow"])
def test_unsafe_or_transitive_component_is_rejected(component_type: str) -> None:
    with pytest.raises(BoardRunPolicyViolation):
        validate_board_run_flow({"nodes": [_node(component_type)]})


def test_nested_violation_rejects_the_whole_flow() -> None:
    flow = {"nodes": [_node("Prompt", nested=[_node("MCP")])]}

    with pytest.raises(BoardRunPolicyViolation):
        validate_board_run_flow(flow)


def test_stale_or_collision_code_is_rejected() -> None:
    with pytest.raises(BoardRunPolicyViolation):
        validate_board_run_flow({"nodes": [_node("Prompt", "modified-code")]})


def test_registry_unavailable_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    def unavailable():
        raise BoardRunPolicyViolation("unavailable")

    monkeypatch.setattr(policy, "_load_registry_snapshot", unavailable)

    with pytest.raises(BoardRunPolicyViolation):
        validate_board_run_flow({"nodes": [_node("Prompt")]})
