from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient


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
