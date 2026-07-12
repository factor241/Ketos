"""Unit tests for KetosClient.upsert_flow.

Uses respx to mock HTTP without a live server.
"""
# pragma: allowlist secret -- all credentials in this file are fake test data

from __future__ import annotations

from uuid import UUID

import httpx
import pytest
import respx
from ketos_sdk.client import KetosClient
from ketos_sdk.exceptions import KetosHTTPError, KetosNotFoundError

_BASE = "http://ketos.test"
_FLOW_ID = UUID("aaaaaaaa-0000-0000-0000-000000000001")

_FLOW_PAYLOAD = {
    "id": str(_FLOW_ID),
    "name": "Test Flow",
    "description": None,
    "data": {"nodes": [], "edges": []},
    "is_component": False,
    "updated_at": None,
    "endpoint_name": None,
    "tags": None,
    "folder_id": None,
    "user_id": None,
    "icon": None,
    "icon_bg_color": None,
    "locked": False,
    "mcp_enabled": False,
    "webhook": False,
    "access_type": "PRIVATE",
}


def _client() -> KetosClient:
    return KetosClient(base_url=_BASE, api_key="test-key")  # pragma: allowlist secret


# ---------------------------------------------------------------------------
# upsert_flow -- create path (201)
# ---------------------------------------------------------------------------


@respx.mock
def test_upsert_flow_create():
    respx.put(f"{_BASE}/api/v1/flows/{_FLOW_ID}").mock(return_value=httpx.Response(201, json=_FLOW_PAYLOAD))
    from ketos_sdk.models import FlowCreate

    client = _client()
    flow, created = client.upsert_flow(_FLOW_ID, FlowCreate(name="Test Flow"))
    assert created is True
    assert flow.id == _FLOW_ID
    assert flow.name == "Test Flow"


# ---------------------------------------------------------------------------
# upsert_flow -- update path (200)
# ---------------------------------------------------------------------------


@respx.mock
def test_upsert_flow_update():
    respx.put(f"{_BASE}/api/v1/flows/{_FLOW_ID}").mock(return_value=httpx.Response(200, json=_FLOW_PAYLOAD))
    from ketos_sdk.models import FlowCreate

    client = _client()
    flow, created = client.upsert_flow(_FLOW_ID, FlowCreate(name="Test Flow"))
    assert created is False
    assert flow.id == _FLOW_ID


# ---------------------------------------------------------------------------
# upsert_flow -- 404 raises KetosNotFoundError
# ---------------------------------------------------------------------------


@respx.mock
def test_upsert_flow_not_found_raises():
    respx.put(f"{_BASE}/api/v1/flows/{_FLOW_ID}").mock(
        return_value=httpx.Response(404, json={"detail": "Flow not found"})
    )
    from ketos_sdk.models import FlowCreate

    client = _client()
    with pytest.raises(KetosNotFoundError):
        client.upsert_flow(_FLOW_ID, FlowCreate(name="Test Flow"))


# ---------------------------------------------------------------------------
# upsert_flow -- 409 conflict raises KetosHTTPError
# ---------------------------------------------------------------------------


@respx.mock
def test_upsert_flow_conflict_raises():
    respx.put(f"{_BASE}/api/v1/flows/{_FLOW_ID}").mock(
        return_value=httpx.Response(409, json={"detail": "Name must be unique"})
    )
    from ketos_sdk.models import FlowCreate

    client = _client()
    with pytest.raises(KetosHTTPError) as exc_info:
        client.upsert_flow(_FLOW_ID, FlowCreate(name="Test Flow"))
    from http import HTTPStatus

    assert exc_info.value.status_code == HTTPStatus.CONFLICT
