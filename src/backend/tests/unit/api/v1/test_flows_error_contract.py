"""Stable, localizable error-envelope contracts for the v1 flows routes."""

from __future__ import annotations

import ast
from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import HTTPException
from langflow.api.v1.flows import _deny_to_flow_not_found, _flow_not_found_error, _handle_unique_constraint_error

if TYPE_CHECKING:
    from httpx import AsyncClient

FLOWS_SOURCE = Path(__file__).parents[4] / "base" / "langflow" / "api" / "v1" / "flows.py"


def test_flows_routes_do_not_construct_raw_http_exceptions_or_use_legacy_deny_adapter():
    tree = ast.parse(FLOWS_SOURCE.read_text(encoding="utf-8"), filename=str(FLOWS_SOURCE))

    raw_http_exception_lines = [
        node.lineno
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "HTTPException"
    ]
    legacy_deny_lines = [
        node.lineno
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "deny_to_404"
    ]

    assert raw_http_exception_lines == []
    assert legacy_deny_lines == []


def test_flows_coded_errors_never_publish_exception_text_as_compatibility_detail():
    tree = ast.parse(FLOWS_SOURCE.read_text(encoding="utf-8"), filename=str(FLOWS_SOURCE))
    violations: list[int] = []

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name) or node.func.id != "coded_http_error":
            continue
        detail = next((keyword.value for keyword in node.keywords if keyword.arg == "detail"), None)
        if detail is None:
            continue
        detail_names = {child.id for child in ast.walk(detail) if isinstance(child, ast.Name)}
        has_str_call = any(
            isinstance(child, ast.Call)
            and isinstance(child.func, ast.Name)
            and child.func.id == "str"
            for child in ast.walk(detail)
        )
        has_exception_message = any(
            isinstance(child, ast.Attribute) and child.attr == "message" for child in ast.walk(detail)
        )
        if detail_names & {"e", "exc", "error"} or has_str_call or has_exception_message:
            violations.append(node.lineno)

    assert violations == []


def test_unique_constraint_errors_have_stable_codes_and_private_diagnostics():
    conflict = _handle_unique_constraint_error(
        RuntimeError("UNIQUE constraint failed: flow.id, flow.endpoint_name: provider-secret"),
        status_code=409,
    )
    internal = _handle_unique_constraint_error(RuntimeError("database provider-secret"))

    assert conflict.status_code == 409
    assert conflict.payload.code == "flows.already_exists"
    assert conflict.detail == "A flow with this endpoint already exists."
    assert "provider-secret" not in str(conflict.payload.model_dump(mode="json"))
    assert "provider-secret" in conflict.technical_detail

    assert internal.status_code == 500
    assert internal.payload.code == "server.internal_error"
    assert internal.detail == "An internal error occurred while saving the flow."
    assert "provider-secret" not in str(internal.payload.model_dump(mode="json"))
    assert "provider-secret" in internal.technical_detail


def test_flow_not_found_adapters_keep_stable_id_params_and_non_denials_unchanged():
    from uuid import UUID

    flow_id = UUID("6ef6b919-7f7b-46df-b597-9e7958f83d4d")
    missing = _flow_not_found_error(flow_id)
    denied = _deny_to_flow_not_found(HTTPException(status_code=403, detail="provider policy"), flow_id)
    upstream = HTTPException(status_code=503, detail="authorization unavailable")

    assert missing.payload.code == "flows.not_found"
    assert missing.payload.params == {"flow_id": str(flow_id)}
    assert denied.status_code == 404
    assert denied.payload.code == "flows.not_found"
    assert denied.payload.params == {"flow_id": str(flow_id)}
    assert _deny_to_flow_not_found(upstream, flow_id) is upstream


async def test_upload_route_serves_stable_codes_without_publishing_parser_diagnostics(
    client: AsyncClient,
    logged_in_headers,
):
    missing = await client.post("api/v1/flows/upload/", headers=logged_in_headers)
    malformed = await client.post(
        "api/v1/flows/upload/",
        files={"file": ("bad.json", b"provider-secret is not JSON", "application/json")},
        headers=logged_in_headers,
    )

    assert missing.status_code == 400
    assert missing.json() == {
        "code": "request.bad_request",
        "detail": "No file provided",
        "message": "No file provided",
        "params": {},
    }
    assert malformed.status_code == 400
    assert malformed.json() == {
        "code": "flows.invalid",
        "detail": "Invalid JSON file.",
        "message": "Invalid JSON file.",
        "params": {},
    }
    assert "provider-secret" not in malformed.text
