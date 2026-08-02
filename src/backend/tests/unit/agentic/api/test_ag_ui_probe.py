from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import pytest
from ag_ui.core import (
    RunFinishedEvent,
    RunStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
)
from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from ketos.agentic.api import ag_ui_router
from ketos.agentic.api.ag_ui_router import create_ag_ui_router
from ketos.agentic.services.ag_ui import adapter, assembly
from ketos.services.auth.utils import get_current_active_user
from kfx.components.models_and_agents.agent import AgentComponent
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, MessagesState, StateGraph


def _run_input() -> dict[str, object]:
    return {
        "threadId": "thread-a02",
        "runId": "run-a02",
        "state": {},
        "messages": [
            {
                "id": "message-a02",
                "role": "user",
                "content": "hello",
            }
        ],
        "tools": [],
        "context": [],
        "forwardedProps": {},
    }


@dataclass
class _TrackingTemplateAgent:
    name: str = "ketos-mvp-probe"
    clone_calls: int = 0
    run_calls: int = 0

    def clone(self):
        self.clone_calls += 1
        return self


def _build_app(agent: object) -> FastAPI:
    app = FastAPI()
    v1_router = APIRouter(prefix="/api/v1")
    agentic_router = APIRouter(prefix="/agentic")
    agentic_router.include_router(create_ag_ui_router(agent))
    v1_router.include_router(agentic_router)
    app.include_router(v1_router)
    return app


def _standard_events(response_text: str) -> list[dict[str, object]]:
    return [json.loads(line.removeprefix("data: ")) for line in response_text.splitlines() if line.startswith("data: ")]


def _resolved_api_operations(app: FastAPI) -> Counter[tuple[str, str]]:
    """Inventory concrete operations through FastAPI's lazy included routers."""
    operations: Counter[tuple[str, str]] = Counter()
    for route in app.router.routes:
        if isinstance(route, APIRoute):
            resolved_routes = ((route.path, route.methods),)
        else:
            effective_route_contexts = getattr(route, "effective_route_contexts", None)
            if not callable(effective_route_contexts):
                continue
            resolved_routes = (
                (context.path, context.methods)
                for context in effective_route_contexts()
                if isinstance(context.original_route, APIRoute)
            )

        for path, methods in resolved_routes:
            for method in methods or ():
                operations[(method, path)] += 1
    return operations


def _assert_single_ag_ui_registration(app: FastAPI) -> None:
    operations = _resolved_api_operations(app)
    post_count = operations[("POST", "/api/v1/agentic/ag-ui")]
    health_count = operations[("GET", "/api/v1/agentic/ag-ui/health")]

    assert post_count == 1, f"duplicate AG-UI route or missing POST registration: count={post_count}"
    assert health_count == 1, f"duplicate AG-UI route or missing health registration: count={health_count}"


def _deterministic_graph():
    model = FakeListChatModel(responses=["probe-response"])

    async def call_model(state: MessagesState) -> dict[str, object]:
        return {"messages": [await model.ainvoke(state["messages"])]}

    builder = StateGraph(MessagesState)
    builder.add_node("model", call_model)
    builder.add_edge(START, "model")
    builder.add_edge("model", END)
    return builder.compile(checkpointer=InMemorySaver())


def test_auth_denial_happens_before_agent_clone_or_run() -> None:
    agent = _TrackingTemplateAgent()
    app = _build_app(agent)

    async def deny_request() -> None:
        raise HTTPException(status_code=403, detail="denied")

    app.dependency_overrides[get_current_active_user] = deny_request

    response = TestClient(app).post("/api/v1/agentic/ag-ui", json=_run_input())

    assert response.status_code == 403
    assert agent.clone_calls == 0
    assert agent.run_calls == 0


def test_assembly_hands_existing_agent_component_graph_to_upstream_agent(monkeypatch) -> None:
    graph = object()
    build_calls = 0

    class ComponentDouble:
        def create_agent_runnable(self):
            nonlocal build_calls
            build_calls += 1
            return graph

    captured: dict[str, object] = {}

    def build_agent(**kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(assembly, "LangGraphAgent", build_agent)

    assembled = assembly.assemble_langgraph_agent(ComponentDouble())

    assert assembled is not None
    assert build_calls == 1
    assert captured == {"name": "ketos-mvp-probe", "graph": graph}
    assert AgentComponent.__name__ == "AgentComponent"


def test_assembly_uses_injected_graph_builder_once_and_forwards_config(monkeypatch) -> None:
    graph = object()
    component = object()
    config = {"configurable": {"thread_id": "thread-a02"}}
    builder_calls: list[object] = []
    captured: dict[str, object] = {}

    def graph_builder(component_arg):
        builder_calls.append(component_arg)
        return graph

    def build_agent(**kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(assembly, "LangGraphAgent", build_agent)

    assembled = assembly.assemble_langgraph_agent(
        component,
        graph_builder=graph_builder,
        config=config,
    )

    assert assembled is not None
    assert builder_calls == [component]
    assert captured == {
        "name": "ketos-mvp-probe",
        "graph": graph,
        "config": config,
    }


def test_router_exposes_one_prefix_free_endpoint_without_redirect() -> None:
    agent = _TrackingTemplateAgent()
    app = _build_app(agent)
    app.dependency_overrides[get_current_active_user] = lambda: object()

    paths = app.openapi()["paths"]

    _assert_single_ag_ui_registration(app)
    assert "/api/v1/agentic/ag-ui" in paths
    assert list(paths["/api/v1/agentic/ag-ui"]) == ["post"]
    assert "/api/v1/agentic/ag-ui/health" in paths
    assert "/api/v1/agentic/agentic/ag-ui" not in paths
    assert TestClient(app).post("/api/v1/agentic/agentic/ag-ui", json=_run_input()).status_code == 404


def test_resolved_route_inventory_rejects_double_ag_ui_include() -> None:
    app = FastAPI()
    v1_router = APIRouter(prefix="/api/v1")
    agentic_router = APIRouter(prefix="/agentic")
    agentic_router.include_router(create_ag_ui_router(_TrackingTemplateAgent()))
    agentic_router.include_router(create_ag_ui_router(_TrackingTemplateAgent()))
    v1_router.include_router(agentic_router)
    app.include_router(v1_router)

    with pytest.raises(AssertionError, match="duplicate AG-UI route"):
        _assert_single_ag_ui_registration(app)


def test_router_forwards_a06_pre_dispatch_hook_to_upstream(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def capture_registration(*_args, **kwargs) -> None:
        captured.update(kwargs)

    async def before_dispatch(*_args) -> None:
        return None

    monkeypatch.setattr(adapter, "add_langgraph_fastapi_endpoint", capture_registration)

    create_ag_ui_router(_TrackingTemplateAgent(), before_dispatch=before_dispatch)

    assert captured["before_dispatch"] is before_dispatch


def test_injected_auth_denial_happens_before_agent_clone_or_run() -> None:
    agent = _TrackingTemplateAgent()

    async def deny_request() -> None:
        raise HTTPException(status_code=403, detail="injected deny")

    app = FastAPI()
    app.include_router(
        create_ag_ui_router(agent, auth_dependency=deny_request),
        prefix="/api/v1/agentic",
    )

    response = TestClient(app).post("/api/v1/agentic/ag-ui", json=_run_input())

    assert response.status_code == 403
    assert agent.clone_calls == 0
    assert agent.run_calls == 0


def test_real_endpoint_streams_standard_text_lifecycle() -> None:
    class ConfiguredComponentDouble:
        def create_agent_runnable(self):
            return _deterministic_graph()

    app = _build_app(assembly.assemble_langgraph_agent(ConfiguredComponentDouble()))
    app.dependency_overrides[get_current_active_user] = lambda: object()

    response = TestClient(app).post("/api/v1/agentic/ag-ui", json=_run_input())
    payloads = _standard_events(response.text)

    started = RunStartedEvent.model_validate(payloads[0])
    text_start = TextMessageStartEvent.model_validate(
        next(event for event in payloads if event["type"] == "TEXT_MESSAGE_START")
    )
    text_events = [
        TextMessageContentEvent.model_validate(event) for event in payloads if event["type"] == "TEXT_MESSAGE_CONTENT"
    ]
    text_end = TextMessageEndEvent.model_validate(
        next(event for event in payloads if event["type"] == "TEXT_MESSAGE_END")
    )
    finished = RunFinishedEvent.model_validate(payloads[-1])

    assert response.status_code == 200
    assert response.history == []
    assert response.headers["content-type"].startswith("text/event-stream")
    assert started.thread_id == finished.thread_id == "thread-a02"
    assert started.run_id == finished.run_id == "run-a02"
    assert text_start.message_id == text_end.message_id
    assert "".join(event.delta for event in text_events) == "probe-response"
    assert "CUSTOM" not in {str(event.get("type")) for event in payloads}
    serialized_events = json.dumps(payloads)
    assert all(token not in serialized_events for token in ("flow_update", "assistant_message", "on_interrupt"))


def test_production_sources_have_no_local_ag_ui_protocol() -> None:
    sources = "\n".join(
        Path(module.__file__).read_text(encoding="utf-8") for module in (ag_ui_router, adapter, assembly)
    )

    forbidden = (
        "EventEncoder",
        "BaseEvent",
        "Command(resume=",
        "forwardedProps.command.resume",
        "run_agent(",
        "assistant-panel",
        "use-assistant-chat",
        "text/event-stream",
    )
    assert all(token not in sources for token in forbidden)
