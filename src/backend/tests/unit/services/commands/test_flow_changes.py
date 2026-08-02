from __future__ import annotations

import copy
import json
import math
from typing import Any
from uuid import UUID

import pytest
from ketos.services.commands.flow_changes import (
    MAX_OPERATIONS,
    MAX_PAYLOAD_BYTES,
    MAX_PREVIEW_BYTES,
    MAX_STRING_BYTES,
    FlowChangeError,
    apply_flow_changes,
    parse_flow_change_set,
)

PROJECT_ID = UUID("10000000-0000-0000-0000-000000000001")
FLOW_ID = UUID("20000000-0000-0000-0000-000000000002")


@pytest.fixture
def registry() -> dict[str, dict[str, Any]]:
    return {
        "ChatInput": {
            "display_name": "Chat Input",
            "template": {"input_value": {"type": "str", "value": ""}},
            "outputs": [{"name": "message", "types": ["Message"]}],
        },
        "Agent": {
            "display_name": "Agent",
            "template": {
                "input_value": {"type": "str", "input_types": ["Message"], "value": None},
                "system_prompt": {"type": "str", "value": "Be helpful"},
                "code": {"type": "code", "value": "trusted builtin"},
                "API_TOKEN": {"type": "str", "value": None},
            },
            "outputs": [{"name": "response", "types": ["Message"]}],
        },
        "ChatOutput": {
            "display_name": "Chat Output",
            "template": {"input_value": {"type": "str", "input_types": ["Message"], "value": None}},
            "outputs": [],
        },
    }


def _node(component_type: str, node_id: str, registry: dict[str, dict[str, Any]]) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "genericNode",
        "position": {"x": 0, "y": 0},
        "selected": False,
        "data": {
            "id": node_id,
            "type": component_type,
            "node": copy.deepcopy(registry[component_type]),
            "showNode": True,
        },
    }


def _edge(source: str, output: str, target: str, input_name: str) -> dict[str, Any]:
    return {
        "source": source,
        "target": target,
        "data": {
            "sourceHandle": {"name": output},
            "targetHandle": {"fieldName": input_name},
        },
    }


@pytest.fixture
def base_flow(registry: dict[str, dict[str, Any]]) -> dict[str, Any]:
    return {
        "name": "AI draft",
        "description": "Stage 08",
        "data": {
            "nodes": [
                _node("ChatInput", "input", registry),
                _node("Agent", "agent", registry),
                _node("ChatOutput", "output", registry),
            ],
            "edges": [
                _edge("input", "message", "agent", "input_value"),
                _edge("agent", "response", "output", "input_value"),
            ],
        },
    }


def _raw(*operations: dict[str, Any]) -> bytes:
    return json.dumps(
        {
            "schemaVersion": 1,
            "targetProjectId": str(PROJECT_ID),
            "targetFlowId": str(FLOW_ID),
            "operations": operations,
        },
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    ).encode()


def _apply(
    registry: dict[str, dict[str, Any]],
    target: dict[str, Any] | None,
    *operations: dict[str, Any],
    revision: int | None = 7,
):
    return apply_flow_changes(
        parse_flow_change_set(_raw(*operations)),
        target_flow=target,
        target_revision=revision,
        component_registry=registry,
    )


def test_wire_contract_enforces_exact_bounds_and_unknown_fields() -> None:
    accepted = parse_flow_change_set(_raw(*({"op": "remove_node", "nodeId": str(i)} for i in range(MAX_OPERATIONS))))
    assert len(accepted.operations) == MAX_OPERATIONS

    with pytest.raises(FlowChangeError, match="too_many_operations"):
        parse_flow_change_set(_raw(*({"op": "remove_node", "nodeId": str(i)} for i in range(MAX_OPERATIONS + 1))))
    with pytest.raises(FlowChangeError, match="payload_too_large"):
        parse_flow_change_set(_raw({"op": "remove_node", "nodeId": "x"}) + b" " * MAX_PAYLOAD_BYTES)
    with pytest.raises(FlowChangeError, match="string_too_long"):
        parse_flow_change_set(_raw({"op": "remove_node", "nodeId": "я" * ((MAX_STRING_BYTES // 2) + 1)}))
    with pytest.raises(FlowChangeError, match="unknown_operation_field"):
        parse_flow_change_set(_raw({"op": "remove_node", "nodeId": "x", "debug": True}))


@pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity"])
def test_wire_contract_rejects_non_finite_tokens(literal: str) -> None:
    raw = _raw({"op": "set_parameter", "nodeId": "agent", "parameter": "system_prompt", "value": 0})
    raw = raw.replace(b'"value":0', f'"value":{literal}'.encode())
    with pytest.raises(FlowChangeError, match="non_finite_number"):
        parse_flow_change_set(raw)


def test_create_flow_is_sole_operation_and_uses_server_owned_ids(registry: dict[str, dict[str, Any]]) -> None:
    node = _node("ChatInput", "input", registry)
    result = _apply(
        registry,
        None,
        {"op": "create_flow", "name": "Created", "description": None, "nodes": [node], "edges": []},
        revision=None,
    )

    assert result.project_id == PROJECT_ID
    assert result.flow_id == FLOW_ID
    assert result.flow["name"] == "Created"
    assert result.preview.before.revision is None
    assert result.preview.after.revision == 1
    assert result.ready is True
    assert result.command_type == "create_flow"

    with pytest.raises(FlowChangeError, match="create_flow_must_be_sole_operation"):
        parse_flow_change_set(
            _raw(
                {"op": "create_flow", "name": "x", "nodes": [], "edges": []},
                {"op": "remove_node", "nodeId": "x"},
            )
        )


def test_add_set_connect_disconnect_remove_are_transactional_and_deterministic(
    registry: dict[str, dict[str, Any]], base_flow: dict[str, Any]
) -> None:
    original = copy.deepcopy(base_flow)
    result = _apply(
        registry,
        base_flow,
        {"op": "add_node", "nodeId": "second", "componentType": "ChatOutput", "parameters": {}},
        {"op": "set_parameter", "nodeId": "agent", "parameter": "system_prompt", "value": "Concise"},
        {
            "op": "connect_nodes",
            "sourceNodeId": "input",
            "sourceOutput": "message",
            "targetNodeId": "second",
            "targetInput": "input_value",
        },
        {
            "op": "disconnect_nodes",
            "sourceNodeId": "agent",
            "sourceOutput": "response",
            "targetNodeId": "output",
            "targetInput": "input_value",
        },
        {"op": "remove_node", "nodeId": "output"},
    )

    assert base_flow == original
    assert result.command_type == "replace_flow"
    assert result.preview.after.revision == 8
    assert [item.index for item in result.preview.operation_summaries] == list(range(5))
    assert result.preview.after.hash == result.result_flow_hash
    assert len(json.dumps(result.preview.model_dump(mode="json"), ensure_ascii=False).encode()) <= MAX_PREVIEW_BYTES


def test_duplicate_connect_is_noop_and_does_not_advance_revision(
    registry: dict[str, dict[str, Any]], base_flow: dict[str, Any]
) -> None:
    result = _apply(
        registry,
        base_flow,
        {
            "op": "connect_nodes",
            "sourceNodeId": "input",
            "sourceOutput": "message",
            "targetNodeId": "agent",
            "targetInput": "input_value",
        },
    )
    assert result.noop is True
    assert result.ready is False
    assert result.preview.after.revision == 7


@pytest.mark.parametrize(
    "parameter",
    [
        "code",
        "python",
        "filesystem",
        "mcp",
        "provider",
        "model",
        "secret",
        "auth",
        "token",
        "password",
        "key",
        "credential",
        "API_TOKEN",
    ],
)
def test_set_parameter_forbidden_capabilities_fail_without_leaking_value(
    registry: dict[str, dict[str, Any]], base_flow: dict[str, Any], parameter: str
) -> None:
    with pytest.raises(FlowChangeError) as caught:
        _apply(
            registry,
            base_flow,
            {"op": "set_parameter", "nodeId": "agent", "parameter": parameter, "value": "SECRET-SENTINEL"},
        )
    assert caught.value.code == "forbidden_field"
    assert "SECRET-SENTINEL" not in str(caught.value)


@pytest.mark.parametrize("operation", ["set_parameter", "add_node", "create_flow", "replace_flow"])
def test_nested_forbidden_configuration_keys_fail_closed(
    registry: dict[str, dict[str, Any]], base_flow: dict[str, Any], operation: str
) -> None:
    registry["Agent"]["template"]["settings"] = {"type": "dict", "value": {}}
    nested = {"headers": [{"authorization": "SECRET-SENTINEL"}]}
    if operation == "set_parameter":
        payload = {"op": operation, "nodeId": "agent", "parameter": "settings", "value": nested}
    elif operation == "add_node":
        payload = {
            "op": operation,
            "nodeId": "second-agent",
            "componentType": "Agent",
            "parameters": {"settings": nested},
        }
    else:
        replacement = copy.deepcopy(base_flow)
        replacement["data"]["nodes"][1]["data"]["node"]["template"]["settings"] = {
            "type": "dict",
            "value": nested,
        }
        payload = {
            "op": operation,
            "name": replacement["name"],
            "description": replacement["description"],
            "nodes": replacement["data"]["nodes"],
            "edges": replacement["data"]["edges"],
        }

    with pytest.raises(FlowChangeError) as caught:
        _apply(
            registry,
            None if operation == "create_flow" else base_flow,
            payload,
            revision=None if operation == "create_flow" else 7,
        )
    assert caught.value.code == "forbidden_field"
    assert "SECRET-SENTINEL" not in str(caught.value)


def test_failure_rolls_back_all_prior_operations(
    registry: dict[str, dict[str, Any]], base_flow: dict[str, Any]
) -> None:
    original = copy.deepcopy(base_flow)
    with pytest.raises(FlowChangeError) as caught:
        _apply(
            registry,
            base_flow,
            {"op": "set_parameter", "nodeId": "agent", "parameter": "system_prompt", "value": "temporary"},
            {"op": "remove_node", "nodeId": "missing"},
        )
    assert caught.value.operation_index == 1
    assert base_flow == original


def test_disconnect_requires_exactly_one_structural_match(
    registry: dict[str, dict[str, Any]], base_flow: dict[str, Any]
) -> None:
    base_flow["data"]["edges"].append(copy.deepcopy(base_flow["data"]["edges"][0]))
    with pytest.raises(FlowChangeError, match="ambiguous_edge_match"):
        _apply(
            registry,
            base_flow,
            {
                "op": "disconnect_nodes",
                "sourceNodeId": "input",
                "sourceOutput": "message",
                "targetNodeId": "agent",
                "targetInput": "input_value",
            },
        )


@pytest.mark.parametrize(
    ("mutation", "code"),
    [
        (lambda flow: flow["data"]["nodes"].append(copy.deepcopy(flow["data"]["nodes"][0])), "duplicate_node_id"),
        (lambda flow: flow["data"]["nodes"][0]["data"].update(type="Unknown"), "unknown_component"),
        (lambda flow: flow["data"]["edges"][0].update(target="missing"), "dangling_edge"),
        (
            lambda flow: flow["data"]["nodes"][1]["data"]["node"]["template"]["code"].update(value="evil"),
            "forbidden_field",
        ),
    ],
)
def test_replace_flow_revalidates_every_nested_entity(
    registry: dict[str, dict[str, Any]],
    base_flow: dict[str, Any],
    mutation,
    code: str,
) -> None:
    replacement = copy.deepcopy(base_flow)
    mutation(replacement)
    with pytest.raises(FlowChangeError) as caught:
        _apply(
            registry,
            base_flow,
            {
                "op": "replace_flow",
                "name": replacement["name"],
                "description": replacement["description"],
                "nodes": replacement["data"]["nodes"],
                "edges": replacement["data"]["edges"],
            },
        )
    assert caught.value.code == code


def test_preview_never_contains_raw_parameter_or_html(
    registry: dict[str, dict[str, Any]], base_flow: dict[str, Any]
) -> None:
    value = '<script data-token="SUPER-SECRET">alert(1)</script>'
    result = _apply(
        registry,
        base_flow,
        {"op": "set_parameter", "nodeId": "agent", "parameter": "system_prompt", "value": value},
    )
    preview = result.preview.model_dump_json()
    assert result.flow["data"]["nodes"][1]["data"]["node"]["template"]["system_prompt"]["value"] == value
    assert "SUPER-SECRET" not in preview
    assert "<script" not in preview


def test_non_finite_target_is_rejected(registry: dict[str, dict[str, Any]], base_flow: dict[str, Any]) -> None:
    base_flow["data"]["nodes"][0]["position"]["x"] = math.nan
    with pytest.raises(FlowChangeError, match="non_finite_number"):
        _apply(registry, base_flow, {"op": "remove_node", "nodeId": "input"})
