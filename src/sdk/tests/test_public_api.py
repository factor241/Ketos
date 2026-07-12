"""Ketos-only public API contract."""

from __future__ import annotations

import pathlib

import httpx
import ketos_sdk
import pytest
from ketos_sdk import AsyncKetosClient, KetosClient
from ketos_sdk._http import _build_headers
from ketos_sdk._version import __version__


@pytest.mark.unit
def test_public_clients_use_only_canonical_names() -> None:
    assert ketos_sdk.KetosClient is KetosClient
    assert ketos_sdk.AsyncKetosClient is AsyncKetosClient
    for legacy_name in ("Client", "AsyncClient"):
        assert not hasattr(ketos_sdk, legacy_name)


@pytest.mark.unit
def test_client_instantiation_uses_canonical_name() -> None:
    client = KetosClient("http://localhost:7860")
    try:
        assert isinstance(client, KetosClient)
    finally:
        client.close()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_async_client_instantiation_uses_canonical_name() -> None:
    client = AsyncKetosClient("http://localhost:7860")
    try:
        assert isinstance(client, AsyncKetosClient)
    finally:
        await client.aclose()


@pytest.mark.unit
def test_default_headers_include_explicit_sdk_user_agent() -> None:
    headers = _build_headers(None)
    assert headers["User-Agent"] == f"ketos-sdk/{__version__}"


@pytest.mark.unit
def test_injected_httpx_client_receives_sdk_headers() -> None:
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, json=[]))
    with httpx.Client(transport=transport) as http_client:
        KetosClient("https://ketos.test", httpx_client=http_client)
        assert http_client.headers["User-Agent"] == f"ketos-sdk/{__version__}"
        assert http_client.headers["Content-Type"] == "application/json"


@pytest.mark.unit
def test_old_namespace_is_absent_from_source_tree() -> None:
    old_namespace = "lang" + "flow_sdk"
    source_root = pathlib.Path(ketos_sdk.__file__).parents[1]
    assert not (source_root / old_namespace).exists()
