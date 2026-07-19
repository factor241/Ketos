from __future__ import annotations

import asyncio
import inspect
import json
from pathlib import Path
from typing import get_args

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
from ketos.agentic.services.ag_ui import probe_state, probe_tools
from ketos.services.auth.utils import get_current_active_user
from kfx.mcp.flow_builder_tools import read_tools
from kfx.mcp.flow_builder_tools.read_tools import SearchComponentTypes
from kfx.schema import Data
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode
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
    from ketos.agentic.services.user_components_context import current_user_id

    monkeypatch.setattr(read_tools, "_load_registry_user_aware", lambda: {current_user_id(): {}})
    monkeypatch.setattr(
        read_tools,
        "search_registry",
        lambda registry, **_kwargs: [{"type": next(iter(registry))}],
    )
    alice_tool = (await probe_tools.build_probe_tools(ketos_actor_id="alice"))[0]
    bob_tool = (await probe_tools.build_probe_tools(ketos_actor_id="bob"))[0]

    alice_result, bob_result = await asyncio.gather(
        alice_tool.ainvoke({"query": "component"}),
        bob_tool.ainvoke({"query": "component"}),
    )

    assert _result_data(alice_result)["results"] == [{"type": "alice"}]
    assert _result_data(bob_result)["results"] == [{"type": "bob"}]
    assert current_user_id() is None


@pytest.mark.asyncio
async def test_sequential_actor_a_then_b_on_same_event_loop_does_not_leak(monkeypatch) -> None:
    from ketos.agentic.services.user_components_context import current_user_id

    monkeypatch.setattr(read_tools, "_load_registry_user_aware", lambda: {current_user_id(): {}})
    monkeypatch.setattr(
        read_tools,
        "search_registry",
        lambda registry, **_kwargs: [{"type": next(iter(registry))}],
    )
    actor_a_tool = (await probe_tools.build_probe_tools(ketos_actor_id="actor-a"))[0]
    actor_b_tool = (await probe_tools.build_probe_tools(ketos_actor_id="actor-b"))[0]

    actor_a_result = await actor_a_tool.ainvoke({"query": "component"})
    actor_b_result = await actor_b_tool.ainvoke({"query": "component"})

    assert _result_data(actor_a_result)["results"] == [{"type": "actor-a"}]
    assert _result_data(actor_b_result)["results"] == [{"type": "actor-b"}]
    assert current_user_id() is None


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
async def test_official_stream_has_standard_tool_lifecycle_and_bounded_state(monkeypatch) -> None:
    monkeypatch.setattr(read_tools, "_load_registry_user_aware", dict)
    monkeypatch.setattr(
        read_tools,
        "search_registry",
        lambda *_args, **_kwargs: [{"type": "ChatInput"}, {"type": "ChatOutput"}],
    )
    tool = (await probe_tools.build_probe_tools(ketos_actor_id="actor-a07"))[0]

    async def request_tool(_state: probe_state.ProbeGraphState) -> dict[str, object]:
        return {
            "messages": [
                AIMessage(
                    content="",
                    tool_calls=[{"name": tool.name, "args": {"query": "chat"}, "id": "call-a07"}],
                )
            ],
            **probe_state.running_probe_state(),
        }

    async def finish_probe(_state: probe_state.ProbeGraphState) -> dict[str, object]:
        return {
            "messages": [AIMessage(content="probe complete")],
            **probe_state.completed_probe_state(result_count=2),
        }

    builder = StateGraph(
        probe_state.ProbeGraphState,
        output_schema=probe_state.ProbeSharedState,
    )
    builder.add_node("request_tool", request_tool)
    builder.add_node("tools", ToolNode([tool]))
    builder.add_node("finish_probe", finish_probe)
    builder.add_edge(START, "request_tool")
    builder.add_edge("request_tool", "tools")
    builder.add_edge("tools", "finish_probe")
    builder.add_edge("finish_probe", END)

    response = TestClient(
        _build_app(LangGraphAgent(name="ketos-mvp-probe", graph=builder.compile(checkpointer=InMemorySaver())))
    ).post(
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
    assert start.tool_call_name == tool.name
    assert len(result.content.encode()) <= probe_tools.MAX_RESULT_BYTES

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
    )
    assert all(token not in sources for token in forbidden)
    assert "SearchComponentTypes" in inspect.getsource(probe_tools)
    assert set(get_args(probe_state.ToolStatus)) == {"idle", "running", "completed", "error"}
