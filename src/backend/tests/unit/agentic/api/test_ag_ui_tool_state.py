from __future__ import annotations

import asyncio
import inspect
import json
from pathlib import Path
from typing import Literal, get_args

import pytest
from ag_ui.core import (
    RunFinishedEvent,
    StateSnapshotEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallResultEvent,
    ToolCallStartEvent,
)
from ag_ui_langgraph import LangGraphAgent
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient
from ketos.agentic.api.ag_ui_router import create_ag_ui_router
from ketos.agentic.services import user_components_overlay
from ketos.agentic.services.ag_ui import probe_state, probe_tools
from ketos.agentic.services.user_components_context import (
    current_user_id,
    reset_current_user_id,
    set_current_user_id,
)
from ketos.services.auth.utils import get_current_active_user
from kfx.components.models_and_agents.agent import AgentComponent
from kfx.mcp.flow_builder_tools import read_tools
from kfx.mcp.flow_builder_tools.read_tools import SearchComponentTypes
from kfx.mcp.tool_cache import cached_tool_call, reset_tool_cache
from kfx.schema import Data
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import ValidationError

from .ag_ui_contract_fixtures import decode_ag_ui_sse


def _run_input() -> dict[str, object]:
    return {
        "threadId": "thread-a07",
        "runId": "run-a07",
        "state": probe_state.initial_probe_state(),
        "messages": [{"id": "message-a07", "role": "user", "content": "find chat components"}],
        "tools": [],
        "context": [],
        "forwardedProps": {},
    }


def _build_app(agent: LangGraphAgent) -> FastAPI:
    app = FastAPI()
    v1_router = APIRouter(prefix="/api/v1")
    agentic_router = APIRouter(prefix="/agentic")
    agentic_router.include_router(create_ag_ui_router(agent))
    v1_router.include_router(agentic_router)
    app.include_router(v1_router)
    app.dependency_overrides[get_current_active_user] = lambda: object()
    return app


def _result_data(result: object) -> dict[str, object]:
    assert isinstance(result, Data)
    assert isinstance(result.data, dict)
    return result.data


@pytest.mark.asyncio
async def test_binding_exposes_exactly_one_real_read_only_kfx_tool() -> None:
    tools = await probe_tools.build_probe_tools(ketos_actor_id="actor-a07")

    assert len(tools) == 1
    assert tools[0].name == "search_components"
    assert set(tools[0].args_schema.model_fields) == {"query"}
    assert SearchComponentTypes.name == "SearchComponentTypes"
    assert probe_tools.APPROVED_COMPONENT is SearchComponentTypes


@pytest.mark.asyncio
@pytest.mark.parametrize("query", ["", "   ", "x" * 65])
async def test_query_bounds_reject_empty_or_oversized_input_before_registry(monkeypatch, query: str) -> None:
    def forbidden_registry_read():
        message = "registry must not be read for a rejected query"
        raise AssertionError(message)

    monkeypatch.setattr(read_tools, "_load_registry_user_aware", forbidden_registry_read)
    tool = (await probe_tools.build_probe_tools(ketos_actor_id="actor-a07"))[0]

    with pytest.raises(ValueError, match="query"):
        await tool.ainvoke({"query": query})


@pytest.mark.asyncio
async def test_malformed_query_cannot_reach_registry(monkeypatch) -> None:
    def forbidden_registry_read():
        message = "registry must not be read for malformed input"
        raise AssertionError(message)

    monkeypatch.setattr(read_tools, "_load_registry_user_aware", forbidden_registry_read)
    tool = (await probe_tools.build_probe_tools(ketos_actor_id="actor-a07"))[0]

    with pytest.raises((TypeError, ValidationError), match=r"query|string"):
        await tool.ainvoke({"query": {"flow": {"nodes": ["x" * 10_000]}}})


@pytest.mark.asyncio
async def test_tool_result_count_and_serialized_payload_are_bounded(monkeypatch) -> None:
    monkeypatch.setattr(read_tools, "_load_registry_user_aware", dict)
    monkeypatch.setattr(
        read_tools,
        "search_registry",
        lambda *_args, **_kwargs: [
            {"type": f"Component{index}", "description": "z" * 2000, "api_key": "forbidden"} for index in range(50)
        ],
    )
    tool = (await probe_tools.build_probe_tools(ketos_actor_id="actor-a07"))[0]

    result = _result_data(await tool.ainvoke({"query": "component"}))

    assert result["count"] <= probe_tools.MAX_RESULTS
    assert len(result["results"]) == result["count"]
    assert len(json.dumps(result, ensure_ascii=False).encode()) <= probe_tools.MAX_RESULT_BYTES
    assert result["truncated"] is True
    assert "api_key" not in json.dumps(result)


@pytest.mark.asyncio
async def test_actor_context_and_request_cache_are_isolated_concurrently(monkeypatch) -> None:
    def admission_fixed_registry():
        assert current_user_id() is None
        return {"OfficialComponent": {}}

    monkeypatch.setattr(read_tools, "_load_registry_user_aware", admission_fixed_registry)
    alice_tool = (await probe_tools.build_probe_tools(ketos_actor_id="alice"))[0]
    bob_tool = (await probe_tools.build_probe_tools(ketos_actor_id="bob"))[0]

    async def invoke_as(actor_id: str, tool):
        set_current_user_id(actor_id)
        result = await tool.ainvoke({"query": "official"})
        assert current_user_id() == actor_id
        return result

    try:
        alice_result, bob_result = await asyncio.gather(
            invoke_as("alice", alice_tool),
            invoke_as("bob", bob_tool),
        )
    finally:
        reset_current_user_id()

    assert _result_data(alice_result)["results"][0]["type"] == "OfficialComponent"
    assert _result_data(bob_result)["results"][0]["type"] == "OfficialComponent"
    assert current_user_id() is None


@pytest.mark.asyncio
async def test_sequential_actor_a_then_b_on_same_event_loop_does_not_leak(monkeypatch) -> None:
    def admission_fixed_registry():
        assert current_user_id() is None
        return {"OfficialComponent": {}}

    monkeypatch.setattr(read_tools, "_load_registry_user_aware", admission_fixed_registry)
    actor_a_tool = (await probe_tools.build_probe_tools(ketos_actor_id="actor-a"))[0]
    actor_b_tool = (await probe_tools.build_probe_tools(ketos_actor_id="actor-b"))[0]

    try:
        set_current_user_id("actor-a")
        actor_a_result = await actor_a_tool.ainvoke({"query": "official"})
        assert current_user_id() == "actor-a"

        set_current_user_id("actor-b")
        actor_b_result = await actor_b_tool.ainvoke({"query": "official"})
        assert current_user_id() == "actor-b"
    finally:
        reset_current_user_id()

    assert _result_data(actor_a_result)["results"][0]["type"] == "OfficialComponent"
    assert _result_data(actor_b_result)["results"][0]["type"] == "OfficialComponent"
    assert current_user_id() is None


@pytest.mark.asyncio
async def test_probe_restores_callers_existing_request_cache(monkeypatch) -> None:
    monkeypatch.setattr(read_tools, "_load_registry_user_aware", lambda: {"OfficialComponent": {}})
    tool = (await probe_tools.build_probe_tools(ketos_actor_id="actor-a"))[0]
    replacement_calls = 0

    def replacement_value() -> str:
        nonlocal replacement_calls
        replacement_calls += 1
        return "replacement"

    reset_tool_cache()
    try:
        assert cached_tool_call("caller", {"key": "stable"}, lambda: "preserved") == "preserved"
        await tool.ainvoke({"query": "official"})
        assert cached_tool_call("caller", {"key": "stable"}, replacement_value) == "preserved"
    finally:
        reset_tool_cache()

    assert replacement_calls == 0


@pytest.mark.asyncio
async def test_actor_with_planted_custom_component_never_reaches_overlay_code_loader(
    monkeypatch,
    tmp_path: Path,
) -> None:
    custom_code_loads = 0

    (tmp_path / "PlantedComponent.py").write_text("raise RuntimeError('must never execute')\n")
    monkeypatch.setattr(
        user_components_overlay,
        "load_local_registry",
        lambda: {"CustomComponent": {}, "OfficialComponent": {}},
    )
    monkeypatch.setattr(
        user_components_overlay,
        "get_user_components_dir",
        lambda **_kwargs: tmp_path,
    )

    def forbidden_overlay_entry(*_args, **_kwargs):
        nonlocal custom_code_loads
        custom_code_loads += 1
        message = "persisted custom component Python must not be loaded or executed"
        raise AssertionError(message)

    monkeypatch.setattr(user_components_overlay, "_build_overlay_entry", forbidden_overlay_entry)
    tool = (await probe_tools.build_probe_tools(ketos_actor_id="actor-with-custom-component"))[0]

    try:
        set_current_user_id("actor-with-custom-component")
        result = await tool.ainvoke({"query": "official"})
        assert current_user_id() == "actor-with-custom-component"
    finally:
        reset_current_user_id()

    assert custom_code_loads == 0
    assert _result_data(result)["results"][0]["type"] == "OfficialComponent"


def test_shared_state_is_strict_and_bounded() -> None:
    assert probe_state.initial_probe_state() == {
        "stage": "stage-01",
        "tool_status": "idle",
        "tool_result_count": 0,
        "confirmation_status": "not_requested",
    }
    assert set(probe_state.ProbeSharedState.model_fields) == {
        "stage",
        "tool_status",
        "tool_result_count",
        "confirmation_status",
    }
    with pytest.raises(ValidationError):
        probe_state.validate_probe_state({**probe_state.initial_probe_state(), "flow": {"nodes": []}})
    with pytest.raises(ValidationError):
        probe_state.validate_probe_state(
            {**probe_state.initial_probe_state(), "tool_result_count": probe_tools.MAX_RESULTS + 1}
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("registry_results", "expected_count", "expected_truncated"),
    [
        ([], 0, False),
        ([{"type": "ChatInput"}, {"type": "ChatOutput"}], 2, False),
        ([{"type": f"Component{index}"} for index in range(20)], probe_tools.MAX_RESULTS, True),
    ],
)
async def test_official_stream_has_standard_tool_lifecycle_and_truthful_bounded_state(
    monkeypatch,
    registry_results: list[dict[str, str]],
    expected_count: int,
    expected_truncated: Literal[False, True],
) -> None:
    monkeypatch.setattr(read_tools, "_load_registry_user_aware", dict)
    monkeypatch.setattr(
        read_tools,
        "search_registry",
        lambda *_args, **_kwargs: registry_results,
    )
    graph_builder = await probe_state.prepare_probe_graph_builder(
        ketos_actor_id="actor-a07",
        checkpointer=InMemorySaver(),
    )
    assert not inspect.iscoroutinefunction(graph_builder)
    component = AgentComponent()
    graph = graph_builder(component)

    response = TestClient(_build_app(LangGraphAgent(name="ketos-mvp-probe", graph=graph))).post(
        "/api/v1/agentic/ag-ui",
        json=_run_input(),
    )
    events = decode_ag_ui_sse(response.text)
    event_types = [type(event) for event in events]

    assert response.status_code == 200
    lifecycle = (
        ToolCallStartEvent,
        ToolCallArgsEvent,
        ToolCallEndEvent,
        ToolCallResultEvent,
    )
    lifecycle_indexes = [event_types.index(event_type) for event_type in lifecycle]
    assert lifecycle_indexes == sorted(lifecycle_indexes)
    start = next(event for event in events if isinstance(event, ToolCallStartEvent))
    args = next(event for event in events if isinstance(event, ToolCallArgsEvent))
    result = next(event for event in events if isinstance(event, ToolCallResultEvent))
    end = next(event for event in events if isinstance(event, ToolCallEndEvent))
    assert start.tool_call_id == args.tool_call_id == result.tool_call_id == end.tool_call_id == "call-a07"
    assert start.tool_call_name == "search_components"
    assert len(result.content.encode()) <= probe_tools.MAX_RESULT_BYTES
    assert AgentComponent.name == "Agent"
    result_payload = json.loads(result.content)
    assert result_payload["count"] == expected_count
    assert len(result_payload["results"]) == expected_count
    assert result_payload["truncated"] is expected_truncated

    snapshots = [event for event in events if isinstance(event, StateSnapshotEvent)]
    assert snapshots
    assert event_types.index(StateSnapshotEvent) < event_types.index(RunFinishedEvent)
    for snapshot in snapshots:
        protocol_owned = {"messages", "tools"}
        shared_fields = set(probe_state.ProbeSharedState.model_fields)
        assert set(snapshot.snapshot) <= shared_fields | protocol_owned
        probe_state.validate_probe_state({key: snapshot.snapshot[key] for key in shared_fields})
        serialized = json.dumps(snapshot.snapshot)
        assert all(token not in serialized for token in ("flow", "nodes", "api_key", "cookie", "secret"))
    completed = [snapshot.snapshot for snapshot in snapshots if snapshot.snapshot["tool_status"] == "completed"]
    assert completed[-1]["tool_result_count"] == result_payload["count"] == expected_count


@pytest.mark.asyncio
async def test_malformed_tool_result_fails_closed_in_shared_state(monkeypatch) -> None:
    monkeypatch.setattr(read_tools, "_load_registry_user_aware", dict)
    monkeypatch.setattr(read_tools, "search_registry", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(
        probe_tools,
        "_bounded_result",
        lambda _result: Data(
            data={
                "results": [],
                "count": probe_tools.MAX_RESULTS + 1,
                "truncated": False,
            }
        ),
    )
    graph_builder = await probe_state.prepare_probe_graph_builder(
        ketos_actor_id="actor-a07",
        checkpointer=InMemorySaver(),
    )
    graph = graph_builder(AgentComponent())

    response = TestClient(_build_app(LangGraphAgent(name="ketos-mvp-probe", graph=graph))).post(
        "/api/v1/agentic/ag-ui",
        json=_run_input(),
    )
    events = decode_ag_ui_sse(response.text)
    snapshots = [event.snapshot for event in events if isinstance(event, StateSnapshotEvent)]

    assert response.status_code == 200
    assert snapshots[-1]["tool_status"] == "error"
    assert snapshots[-1]["tool_result_count"] == 0


def test_production_sources_have_no_custom_protocol_or_forbidden_tool_imports() -> None:
    sources = "\n".join(Path(module.__file__).read_text(encoding="utf-8") for module in (probe_tools, probe_state))
    forbidden = (
        "mutate_tools",
        "run_tools",
        "filesystem",
        "mcp.server",
        "mcp.client",
        "CustomEvent",
        "flow_update",
        "Command(resume",
        "forwardedProps",
        "EventEncoder",
        "text/event-stream",
        "ChatModel",
        "create_agent_runnable",
        "httpx",
        "requests.",
        "aiohttp",
    )
    assert all(token not in sources for token in forbidden)
    assert "SearchComponentTypes" in inspect.getsource(probe_tools)
    assert set(get_args(probe_state.ToolStatus)) == {"idle", "running", "completed", "error"}
