from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import TYPE_CHECKING

import pytest
from ag_ui.core import (
    ResumeEntry,
    RunAgentInput,
    RunErrorEvent,
    RunFinishedEvent,
    StateSnapshotEvent,
    ToolCallResultEvent,
)
from ag_ui_langgraph import LangGraphAgent
from fastapi import APIRouter, FastAPI, Request
from fastapi.testclient import TestClient
from ketos.agentic.services.ag_ui.auth import AG_UI_ACTOR_STATE_KEY, get_current_ag_ui_user
from kfx.mcp.flow_builder_tools import read_tools

from .ag_ui_contract_fixtures import decode_ag_ui_sse

if TYPE_CHECKING:
    from pathlib import Path


def test_stage01_registrar_is_default_off_and_idempotent(monkeypatch) -> None:
    from ketos.agentic.api.router import register_stage01_ag_ui, unregister_stage01_ag_ui

    app = FastAPI()
    runtime = SimpleNamespace(agent=object(), before_dispatch=object())

    monkeypatch.setattr("ketos.agentic.api.router.FEATURE_FLAGS.mvp_workspace", False)
    monkeypatch.setattr("ketos.agentic.api.router.FEATURE_FLAGS.mvp_chat", False)
    assert register_stage01_ag_ui(app, runtime) is False
    assert not any(route.path == "/api/v1/agentic/ag-ui" for route in app.routes)

    monkeypatch.setattr("ketos.agentic.api.router.FEATURE_FLAGS.mvp_workspace", True)
    monkeypatch.setattr("ketos.agentic.api.router.FEATURE_FLAGS.mvp_chat", True)
    fake_router = APIRouter()
    fake_router.add_api_route("/ag-ui", lambda: None, methods=["POST"])

    def create_router(*_args, **_kwargs):
        return fake_router

    monkeypatch.setattr("ketos.agentic.api.router.create_ag_ui_router", create_router)
    assert register_stage01_ag_ui(app, runtime) is True
    assert register_stage01_ag_ui(app, runtime) is False
    with TestClient(app) as client:
        assert client.post("/api/v1/agentic/ag-ui").status_code == 200
    unregister_stage01_ag_ui(app)
    with TestClient(app) as client:
        assert client.post("/api/v1/agentic/ag-ui").status_code == 404
    assert register_stage01_ag_ui(app, runtime) is True


@pytest.mark.asyncio
async def test_stage01_runtime_opens_one_checkpoint_and_builds_one_combined_agent(monkeypatch) -> None:
    from ketos.agentic.services.ag_ui.stage01_runtime import Stage01AgUiRuntime

    events: list[str] = []

    class FakeCheckpoint:
        class Saver:
            async def setup(self):
                events.append("setup")

        saver = Saver()

        async def open(self):
            events.append("open")
            return self.saver

        async def close(self):
            events.append("close")

    runtime = Stage01AgUiRuntime(checkpoint=FakeCheckpoint())  # type: ignore[arg-type]
    monkeypatch.setattr(runtime, "_build_agent", lambda _saver: events.append("build") or object())

    async with runtime:
        assert runtime.agent is not None
        assert events == ["open", "setup", "build"]

    assert events == ["open", "setup", "build", "close"]


@pytest.mark.asyncio
async def test_stage01_runtime_closes_checkpoint_when_agent_build_fails(monkeypatch) -> None:
    from ketos.agentic.services.ag_ui.stage01_runtime import Stage01AgUiRuntime

    events: list[str] = []

    class FakeCheckpoint:
        class Saver:
            async def setup(self):
                events.append("setup")

        async def open(self):
            events.append("open")
            return self.Saver()

        async def close(self):
            events.append("close")

    runtime = Stage01AgUiRuntime(checkpoint=FakeCheckpoint())  # type: ignore[arg-type]

    def fail_build(_saver):
        message = "build failed"
        raise RuntimeError(message)

    monkeypatch.setattr(runtime, "_build_agent", fail_build)
    with pytest.raises(RuntimeError, match="build failed"):
        await runtime.__aenter__()
    assert events == ["open", "setup", "close"]


def test_application_lifespan_registers_stage01_before_serving(monkeypatch) -> None:
    from ketos.agentic.services.ag_ui import stage01_runtime

    events: list[str] = []

    class FakeRuntime:
        agent = object()
        before_dispatch = object()

        async def __aenter__(self):
            events.append("open")
            return self

        async def __aexit__(self, *_exc_info):
            events.append("close")

    @asynccontextmanager
    async def wrapped_lifespan(_app):
        events.append("base-open")
        yield
        events.append("base-close")

    app = FastAPI(lifespan=stage01_runtime.compose_stage01_lifespan(wrapped_lifespan, lambda: FakeRuntime()))
    monkeypatch.setattr(stage01_runtime.FEATURE_FLAGS, "mvp_workspace", True)
    monkeypatch.setattr(stage01_runtime.FEATURE_FLAGS, "mvp_chat", True)

    def register(_app, _runtime):
        events.append("register")
        return True

    monkeypatch.setattr(stage01_runtime, "register_stage01_ag_ui", register)
    monkeypatch.setattr(stage01_runtime, "unregister_stage01_ag_ui", lambda _app: events.append("unregister"))

    with TestClient(app):
        assert events == ["base-open", "open", "register"]

    assert events == ["base-open", "open", "register", "unregister", "close", "base-close"]


def test_application_lifespan_does_not_touch_stage01_resources_when_flags_are_off(monkeypatch) -> None:
    from ketos.agentic.services.ag_ui import stage01_runtime

    events: list[str] = []

    @asynccontextmanager
    async def wrapped_lifespan(_app):
        events.append("base-open")
        yield
        events.append("base-close")

    def forbidden_factory():
        message = "default-off startup must not construct Stage 01 resources"
        raise AssertionError(message)

    monkeypatch.setattr(stage01_runtime.FEATURE_FLAGS, "mvp_workspace", False)
    monkeypatch.setattr(stage01_runtime.FEATURE_FLAGS, "mvp_chat", False)
    app = FastAPI(lifespan=stage01_runtime.compose_stage01_lifespan(wrapped_lifespan, forbidden_factory))

    with TestClient(app):
        assert events == ["base-open"]

    assert events == ["base-open", "base-close"]


@pytest.mark.asyncio
async def test_real_stage01_graph_runs_tool_then_resumes_both_interrupts_once(
    monkeypatch,
    tmp_path: Path,
) -> None:
    from ketos.agentic.services.ag_ui.checkpoint import AsyncSqliteCheckpoint
    from ketos.agentic.services.ag_ui.stage01_runtime import build_stage01_graph

    monkeypatch.setenv("LANGGRAPH_STRICT_MSGPACK", "true")
    monkeypatch.setattr(read_tools, "_load_registry_user_aware", dict)
    monkeypatch.setattr(
        read_tools,
        "search_registry",
        lambda *_args, **_kwargs: [{"type": "ChatInput"}, {"type": "ChatOutput"}],
    )
    checkpoint_path = tmp_path / "combined" / "stage01.sqlite3"
    thread_id = "stage01-combined-thread"

    def run_input(run_id: str, *, resume: list[ResumeEntry] | None = None) -> RunAgentInput:
        return RunAgentInput(
            thread_id=thread_id,
            run_id=run_id,
            state={},
            messages=[],
            tools=[],
            context=[],
            forwarded_props={},
            resume=resume,
        )

    async with AsyncSqliteCheckpoint(checkpoint_path) as checkpoint:
        await checkpoint.saver.setup()
        graph = await build_stage01_graph(checkpointer=checkpoint.saver)
        template = LangGraphAgent(name="ketos-mvp-probe", graph=graph)
        initial_events = [event async for event in template.clone().run(run_input("initial-run"))]
        finished = initial_events[-1]
        assert isinstance(finished, RunFinishedEvent)
        assert finished.outcome is not None
        assert finished.outcome.type == "interrupt"
        assert len(finished.outcome.interrupts) == 2
        assert len({interrupt.id for interrupt in finished.outcome.interrupts}) == 2
        assert any(isinstance(event, ToolCallResultEvent) for event in initial_events)
        snapshots = [event.snapshot for event in initial_events if isinstance(event, StateSnapshotEvent)]
        assert any(snapshot.get("tool_status") == "completed" for snapshot in snapshots)
        assert snapshots[-1]["effect_count"] == 0

        resume = [
            ResumeEntry(
                interrupt_id=interrupt.id,
                status="resolved",
                payload={"approved": index == 0},
            )
            for index, interrupt in enumerate(finished.outcome.interrupts)
        ]
        resumed_events = [event async for event in template.clone().run(run_input("resume-run", resume=resume))]
        durable_state = await graph.aget_state({"configurable": {"thread_id": thread_id}})

    assert isinstance(resumed_events[-1], RunFinishedEvent)
    assert resumed_events[-1].outcome is None
    assert durable_state.values["tool_result_count"] == 2
    assert durable_state.values["effect_count"] == 1
    assert durable_state.values["final_decision"] == "rejected"


def test_real_lifespan_endpoint_restarts_resumes_once_and_denies_replay(monkeypatch, tmp_path: Path) -> None:
    from ketos.agentic.services.ag_ui.stage01_runtime import Stage01AgUiRuntime, compose_stage01_lifespan

    monkeypatch.setenv("LANGGRAPH_STRICT_MSGPACK", "true")
    binding_root = tmp_path / "binding"
    checkpoint_root = tmp_path / "checkpoint"
    binding_root.mkdir(mode=0o700)
    checkpoint_root.mkdir(mode=0o700)
    binding_root.chmod(0o700)
    checkpoint_root.chmod(0o700)
    monkeypatch.setenv("KETOS_AG_UI_BINDING_DB", str(binding_root / "run-bindings.ledger"))
    monkeypatch.setenv("KETOS_AG_UI_CHECKPOINT_DB", str(checkpoint_root / "checkpoints.sqlite3"))
    monkeypatch.setattr("ketos.agentic.api.router.FEATURE_FLAGS.mvp_workspace", True)
    monkeypatch.setattr("ketos.agentic.api.router.FEATURE_FLAGS.mvp_chat", True)
    monkeypatch.setattr(read_tools, "_load_registry_user_aware", dict)
    monkeypatch.setattr(
        read_tools,
        "search_registry",
        lambda *_args, **_kwargs: [{"type": "ChatInput"}, {"type": "ChatOutput"}],
    )

    @asynccontextmanager
    async def base_lifespan(_app):
        yield

    async def authenticated_actor(request: Request):
        setattr(request.state, AG_UI_ACTOR_STATE_KEY, "actor-stage01-black-box")
        return object()

    def new_app() -> FastAPI:
        app = FastAPI(lifespan=compose_stage01_lifespan(base_lifespan, Stage01AgUiRuntime))
        app.dependency_overrides[get_current_ag_ui_user] = authenticated_actor
        return app

    def payload(run_id: str, *, resume: list[dict[str, object]] | None = None) -> dict[str, object]:
        return {
            "threadId": "thread-stage01-black-box",
            "runId": run_id,
            "state": {},
            "messages": [],
            "tools": [],
            "context": [],
            "forwardedProps": {},
            "resume": resume,
        }

    with TestClient(new_app()) as client:
        initial_response = client.post("/api/v1/agentic/ag-ui", json=payload("initial-run"))
        initial_events = decode_ag_ui_sse(initial_response.text)

    assert initial_response.status_code == 200
    assert any(isinstance(event, ToolCallResultEvent) for event in initial_events)
    initial_finish = initial_events[-1]
    assert isinstance(initial_finish, RunFinishedEvent)
    assert initial_finish.outcome is not None
    assert initial_finish.outcome.type == "interrupt"
    assert len(initial_finish.outcome.interrupts) == 2
    resume = [
        {
            "interruptId": interrupt.id,
            "status": "resolved",
            "payload": {"approved": index == 0},
        }
        for index, interrupt in enumerate(initial_finish.outcome.interrupts)
    ]

    with TestClient(new_app()) as client:
        resume_response = client.post("/api/v1/agentic/ag-ui", json=payload("resume-run", resume=resume))
        resume_events = decode_ag_ui_sse(resume_response.text)
        replay_response = client.post("/api/v1/agentic/ag-ui", json=payload("replay-run", resume=resume))
        replay_events = decode_ag_ui_sse(replay_response.text)

    assert resume_response.status_code == 200
    assert isinstance(resume_events[-1], RunFinishedEvent)
    resume_snapshots = [event.snapshot for event in resume_events if isinstance(event, StateSnapshotEvent)]
    assert resume_snapshots[-1]["effect_count"] == 1
    assert resume_snapshots[-1]["final_decision"] == "rejected"
    assert replay_response.status_code == 200
    assert len(replay_events) == 1
    assert isinstance(replay_events[0], RunErrorEvent)
