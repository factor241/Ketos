from __future__ import annotations

import asyncio
import os
import stat
from dataclasses import dataclass, field
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from uuid import UUID

import pytest
from ag_ui.core import RunAgentInput
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from ketos.agentic.services.ag_ui import auth, run_binding
from ketos.agentic.services.ag_ui.adapter import register_langgraph_endpoint
from ketos.services.auth.exceptions import (
    InactiveUserError,
    InvalidCredentialsError,
    InvalidTokenError,
    TokenExpiredError,
)
from kfx.services.deps import injectable_session_scope

ACTOR_A = UUID("10000000-0000-0000-0000-000000000001")
ACTOR_B = UUID("20000000-0000-0000-0000-000000000002")


@dataclass
class _AuthServiceStub:
    users_by_token: dict[str, Any] = field(default_factory=dict)
    error: Exception | None = None
    calls: list[tuple[str, object]] = field(default_factory=list)

    async def get_current_user_from_access_token(self, token: str, db: object) -> Any:
        self.calls.append((token, db))
        if self.error is not None:
            raise self.error
        return self.users_by_token[token]


@dataclass
class _TemplateAgent:
    name: str = "ketos-mvp-probe"
    config: dict[str, Any] = field(
        default_factory=lambda: {
            "recursion_limit": 17,
            "callbacks": [object()],
            "configurable": {"server_setting": "preserved"},
            "metadata": {"model": "server-model", "role": "server-role"},
        }
    )
    run_inputs: list[RunAgentInput] = field(default_factory=list)
    clones: list[_RequestAgent] = field(default_factory=list)
    _thread_lock_registry: object = field(default_factory=object)
    _resume_claim_registry: object = field(default_factory=object)

    def clone(self) -> _RequestAgent:
        clone = _RequestAgent(
            template=self,
            config={key: value.copy() if isinstance(value, dict) else value for key, value in self.config.items()},
        )
        self.clones.append(clone)
        return clone


@dataclass
class _RequestAgent:
    template: _TemplateAgent
    config: dict[str, Any]
    _thread_lock_registry: object = field(default_factory=object)
    _resume_claim_registry: object = field(default_factory=object)

    async def run(self, input_data: RunAgentInput):
        self.template.run_inputs.append(input_data)
        if False:  # pragma: no cover - makes this an async generator without custom events
            yield None


def _run_input(
    *,
    thread_id: str = "thread-a06",
    run_id: str = "run-a06",
    resume: list[dict[str, object]] | None = None,
    forged: bool = False,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "threadId": thread_id,
        "runId": run_id,
        "state": {},
        "messages": [],
        "tools": [],
        "context": [],
        "forwardedProps": {},
    }
    if resume is not None:
        payload["resume"] = resume
    if forged:
        payload.update(
            {
                "actor": str(ACTOR_B),
                "actor_id": str(ACTOR_B),
                "user_id": str(ACTOR_B),
                "role": "admin",
                "model": "browser-model",
            }
        )
        payload["state"] = {
            "actor_id": str(ACTOR_B),
            "user_id": str(ACTOR_B),
            "role": "admin",
            "model": "browser-model",
        }
        payload["forwardedProps"] = {
            "actorId": str(ACTOR_B),
            "userId": str(ACTOR_B),
            "role": "admin",
            "model": "browser-model",
        }
    return payload


def _auth_app(monkeypatch: pytest.MonkeyPatch, service: _AuthServiceStub) -> tuple[FastAPI, object]:
    app = FastAPI()
    db = object()
    monkeypatch.setattr(auth, "get_auth_service", lambda: service)
    app.dependency_overrides[injectable_session_scope] = lambda: db

    @app.get("/actor")
    async def actor_endpoint(request: Request, _user: auth.CurrentAgUiUser) -> dict[str, str]:
        return {"actor_id": getattr(request.state, auth.AG_UI_ACTOR_STATE_KEY)}

    return app, db


@pytest.mark.parametrize(
    ("headers", "params", "cookies"),
    [
        ({}, {}, {}),
        ({}, {}, {"refresh_token_lf": "refresh-only"}),
        ({"x-api-key": "direct-key"}, {}, {}),
        ({}, {"api_key": "direct-key"}, {}),
        ({}, {"x-api-key": "direct-key"}, {}),
        ({}, {}, {"apikey_tkn_lflw": "direct-key"}),
        ({"Authorization": "Bearer valid", "x-api-key": "direct-key"}, {}, {}),
        ({"Authorization": "Bearer valid"}, {"api_key": "direct-key"}, {}),
        ({"Authorization": "Bearer valid"}, {}, {"apikey_tkn_lflw": "direct-key"}),
    ],
)
def test_ag_ui_auth_denies_missing_or_any_api_key_before_auth_service(
    monkeypatch: pytest.MonkeyPatch,
    headers: dict[str, str],
    params: dict[str, str],
    cookies: dict[str, str],
) -> None:
    service = _AuthServiceStub(users_by_token={"valid": SimpleNamespace(id=ACTOR_A, is_active=True)})
    app, _db = _auth_app(monkeypatch, service)

    response = TestClient(app).get("/actor", headers=headers, params=params, cookies=cookies)

    assert response.status_code == 403
    assert service.calls == []


@pytest.mark.parametrize(
    ("headers", "cookies", "expected_token"),
    [
        ({"Authorization": "Bearer bearer-token"}, {}, "bearer-token"),
        ({}, {"access_token_lf": "cookie-token"}, "cookie-token"),
    ],
)
def test_ag_ui_auth_accepts_only_access_token_and_sets_server_actor(
    monkeypatch: pytest.MonkeyPatch,
    headers: dict[str, str],
    cookies: dict[str, str],
    expected_token: str,
) -> None:
    user = SimpleNamespace(id=ACTOR_A, is_active=True)
    service = _AuthServiceStub(users_by_token={expected_token: user})
    app, db = _auth_app(monkeypatch, service)

    response = TestClient(app).get("/actor", headers=headers, cookies=cookies)

    assert response.status_code == 200
    assert response.json() == {"actor_id": str(ACTOR_A)}
    assert service.calls == [(expected_token, db)]


@pytest.mark.parametrize(
    ("error", "expected_status"),
    [
        (TokenExpiredError(), 401),
        (InvalidTokenError(), 401),
        (InactiveUserError(), 401),
        (InvalidCredentialsError(), 403),
    ],
)
def test_ag_ui_auth_maps_existing_authentication_errors(
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
    expected_status: int,
) -> None:
    service = _AuthServiceStub(error=error)
    app, _db = _auth_app(monkeypatch, service)

    response = TestClient(app).get("/actor", headers={"Authorization": "Bearer rejected-token"})

    assert response.status_code == expected_status
    assert len(service.calls) == 1


def _registered_app(
    monkeypatch: pytest.MonkeyPatch,
    *,
    service: _AuthServiceStub,
    store: run_binding.RunBindingStore,
) -> tuple[FastAPI, _TemplateAgent]:
    app = FastAPI()
    db = object()
    agent = _TemplateAgent()
    monkeypatch.setattr(auth, "get_auth_service", lambda: service)
    app.dependency_overrides[injectable_session_scope] = lambda: db
    register_langgraph_endpoint(
        app,
        agent,  # type: ignore[arg-type]
        path="/ag-ui",
        dependencies=(Depends(auth.get_current_ag_ui_user),),
        before_dispatch=run_binding.create_ag_ui_before_dispatch(store),
    )
    return app, agent


def test_each_run_and_resume_reauthenticates_before_dispatch(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    service = _AuthServiceStub(users_by_token={"token-a": SimpleNamespace(id=ACTOR_A, is_active=True)})
    store = run_binding.RunBindingStore(tmp_path / "bindings" / "run-bindings.sqlite3")
    app, agent = _registered_app(monkeypatch, service=service, store=store)
    client = TestClient(app)

    first = client.post("/ag-ui", headers={"Authorization": "Bearer token-a"}, json=_run_input())
    resumed = client.post(
        "/ag-ui",
        headers={"Authorization": "Bearer token-a"},
        json=_run_input(
            run_id="run-a06-resume",
            resume=[{"interruptId": "interrupt-a06", "status": "resolved", "payload": {"approved": True}}],
        ),
    )

    assert first.status_code == resumed.status_code == 200
    assert [call[0] for call in service.calls] == ["token-a", "token-a"]
    assert [item.run_id for item in agent.run_inputs] == ["run-a06", "run-a06-resume"]


def test_binding_path_uses_injectable_local_env_or_configured_data_dir(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    configured_data_dir = tmp_path / "configured-data"
    monkeypatch.setattr(
        run_binding,
        "get_settings_service",
        lambda: SimpleNamespace(settings=SimpleNamespace(data_dir=str(configured_data_dir))),
    )
    monkeypatch.delenv("KETOS_AG_UI_BINDING_DB", raising=False)

    assert run_binding.resolve_run_binding_path() == (
        configured_data_dir / "agentic" / "ag_ui" / "run-bindings.sqlite3"
    )

    injected = tmp_path / "harness" / "bindings.sqlite3"
    monkeypatch.setenv("KETOS_AG_UI_BINDING_DB", str(injected))
    assert run_binding.resolve_run_binding_path() == injected


@pytest.mark.parametrize("unsafe_path", [":memory:", "sqlite:///tmp/bindings.sqlite3", "relative.sqlite3"])
def test_binding_path_rejects_non_local_or_relative_env(
    monkeypatch: pytest.MonkeyPatch,
    unsafe_path: str,
) -> None:
    monkeypatch.setenv("KETOS_AG_UI_BINDING_DB", unsafe_path)

    with pytest.raises(ValueError, match="absolute local filesystem path"):
        run_binding.resolve_run_binding_path()


def test_actor_swap_on_existing_thread_is_denied_before_second_graph_dispatch(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    service = _AuthServiceStub(
        users_by_token={
            "token-a": SimpleNamespace(id=ACTOR_A, is_active=True),
            "token-b": SimpleNamespace(id=ACTOR_B, is_active=True),
        }
    )
    store = run_binding.RunBindingStore(tmp_path / "bindings" / "run-bindings.sqlite3")
    app, agent = _registered_app(monkeypatch, service=service, store=store)
    client = TestClient(app)

    first = client.post("/ag-ui", headers={"Authorization": "Bearer token-a"}, json=_run_input())
    foreign = client.post(
        "/ag-ui",
        headers={"Authorization": "Bearer token-b"},
        json=_run_input(run_id="run-foreign"),
    )

    assert first.status_code == 200
    assert foreign.status_code == 403
    assert len(service.calls) == 2
    assert len(agent.run_inputs) == 1


@pytest.mark.parametrize("container_name", ["state", "forwardedProps"])
@pytest.mark.parametrize("reserved_key", ["actor_id", "user_id", "role", "model"])
def test_reserved_authority_or_model_input_is_denied_before_claim_and_graph_dispatch(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
    container_name: str,
    reserved_key: str,
) -> None:
    service = _AuthServiceStub(users_by_token={"token-a": SimpleNamespace(id=ACTOR_A, is_active=True)})
    path = tmp_path / "bindings" / "run-bindings.sqlite3"
    app, agent = _registered_app(monkeypatch, service=service, store=run_binding.RunBindingStore(path))
    payload = _run_input()
    payload[container_name] = {reserved_key: "forged-browser-value"}

    response = TestClient(app).post(
        "/ag-ui",
        headers={"Authorization": "Bearer token-a"},
        json=payload,
    )

    assert response.status_code == 403
    assert agent.run_inputs == []
    assert not path.exists()


def test_non_authority_state_and_forwarded_props_reach_request_agent_run(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    service = _AuthServiceStub(users_by_token={"token-a": SimpleNamespace(id=ACTOR_A, is_active=True)})
    path = tmp_path / "bindings" / "run-bindings.sqlite3"
    app, agent = _registered_app(monkeypatch, service=service, store=run_binding.RunBindingStore(path))
    payload = _run_input()
    payload["state"] = {"stage_marker": "stage-01", "tool_result_count": 1}
    payload["forwardedProps"] = {"streamSubgraphs": True}

    response = TestClient(app).post(
        "/ag-ui",
        headers={"Authorization": "Bearer token-a"},
        json=payload,
    )

    assert response.status_code == 200
    assert len(agent.run_inputs) == 1
    assert agent.run_inputs[0].state == {"stage_marker": "stage-01", "tool_result_count": 1}
    assert agent.run_inputs[0].forwarded_props == {"streamSubgraphs": True}


@pytest.mark.asyncio
async def test_competing_first_requests_dispatch_at_most_one_graph_run(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    service = _AuthServiceStub(
        users_by_token={
            "token-a": SimpleNamespace(id=ACTOR_A, is_active=True),
            "token-b": SimpleNamespace(id=ACTOR_B, is_active=True),
        }
    )
    store = run_binding.RunBindingStore(tmp_path / "bindings" / "run-bindings.sqlite3")
    app, agent = _registered_app(monkeypatch, service=service, store=store)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        responses = await asyncio.gather(
            client.post(
                "/ag-ui",
                headers={"Authorization": "Bearer token-a"},
                json=_run_input(thread_id="thread-race", run_id="run-race-a"),
            ),
            client.post(
                "/ag-ui",
                headers={"Authorization": "Bearer token-b"},
                json=_run_input(thread_id="thread-race", run_id="run-race-b"),
            ),
        )

    assert sorted(response.status_code for response in responses) == [200, 403]
    assert len(agent.run_inputs) == 1


def test_before_dispatch_binds_only_server_actor_and_preserves_template_config(tmp_path) -> None:
    store = run_binding.RunBindingStore(tmp_path / "bindings" / "run-bindings.sqlite3")
    hook = run_binding.create_ag_ui_before_dispatch(store)
    request = Request(
        {
            "type": "http",
            "headers": [
                (b"actor", str(ACTOR_B).encode()),
                (b"actor-id", str(ACTOR_B).encode()),
                (b"role", b"admin"),
                (b"model", b"browser-model"),
            ],
        }
    )
    setattr(request.state, auth.AG_UI_ACTOR_STATE_KEY, str(ACTOR_A))
    agent = _TemplateAgent().clone()
    callbacks = agent.config["callbacks"]
    input_data = RunAgentInput.model_validate(_run_input())

    asyncio.run(hook(input_data, request, agent))

    assert agent.config["recursion_limit"] == 17
    assert agent.config["callbacks"] is callbacks
    assert agent.config["configurable"] == {
        "server_setting": "preserved",
        "ketos_actor_id": str(ACTOR_A),
        "thread_id": "thread-a06",
    }
    assert agent.config["metadata"] == {
        "model": "server-model",
        "role": "server-role",
        "actor_id": str(ACTOR_A),
        "thread_id": "thread-a06",
        "run_id": "run-a06",
    }
    assert str(ACTOR_B) not in repr(agent.config)


@pytest.mark.asyncio
async def test_hook_denies_missing_server_authenticated_actor_before_claim(tmp_path) -> None:
    path = tmp_path / "bindings" / "run-bindings.sqlite3"
    request = Request({"type": "http", "headers": []})

    with pytest.raises(HTTPException) as error:
        await run_binding.create_ag_ui_before_dispatch(run_binding.RunBindingStore(path))(
            RunAgentInput.model_validate(_run_input()),
            request,
            _TemplateAgent().clone(),  # type: ignore[arg-type]
        )

    assert error.value.status_code == 403
    assert not path.exists()


@pytest.mark.asyncio
async def test_binding_allows_same_actor_new_run_and_denies_every_reused_or_foreign_binding(tmp_path) -> None:
    store = run_binding.RunBindingStore(tmp_path / "bindings" / "run-bindings.sqlite3")

    await store.claim(thread_id="thread-a", run_id="run-a", actor_id=str(ACTOR_A))
    await store.claim(thread_id="thread-a", run_id="run-b", actor_id=str(ACTOR_A))

    with pytest.raises(run_binding.RunBindingDeniedError):
        await store.claim(thread_id="thread-a", run_id="run-c", actor_id=str(ACTOR_B))
    with pytest.raises(run_binding.RunBindingDeniedError):
        await store.claim(thread_id="thread-a", run_id="run-a", actor_id=str(ACTOR_A))
    with pytest.raises(run_binding.RunBindingDeniedError):
        await store.claim(thread_id="thread-b", run_id="run-b", actor_id=str(ACTOR_A))


@pytest.mark.asyncio
async def test_first_thread_claim_is_atomic_across_competing_store_objects(tmp_path) -> None:
    path = tmp_path / "bindings" / "run-bindings.sqlite3"
    first_store = run_binding.RunBindingStore(path)
    second_store = run_binding.RunBindingStore(path)

    results = await asyncio.gather(
        first_store.claim(thread_id="thread-race", run_id="run-a", actor_id=str(ACTOR_A)),
        second_store.claim(thread_id="thread-race", run_id="run-b", actor_id=str(ACTOR_B)),
        return_exceptions=True,
    )

    assert sum(result is None for result in results) == 1
    assert sum(isinstance(result, run_binding.RunBindingDeniedError) for result in results) == 1


@pytest.mark.asyncio
async def test_bindings_survive_new_store_object_and_use_private_file_permissions(tmp_path) -> None:
    path = tmp_path / "bindings" / "run-bindings.sqlite3"
    first_store = run_binding.RunBindingStore(path)
    await first_store.claim(thread_id="thread-restart", run_id="run-before", actor_id=str(ACTOR_A))

    restarted_store = run_binding.RunBindingStore(path)
    with pytest.raises(run_binding.RunBindingDeniedError):
        await restarted_store.claim(thread_id="thread-restart", run_id="run-after", actor_id=str(ACTOR_B))
    with pytest.raises(run_binding.RunBindingDeniedError):
        await restarted_store.claim(thread_id="other-thread", run_id="run-before", actor_id=str(ACTOR_A))

    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert stat.S_IMODE(path.parent.stat().st_mode) == 0o700


@pytest.mark.asyncio
async def test_binding_store_rejects_permissive_preexisting_controlled_parent(tmp_path) -> None:
    parent = tmp_path / "bindings"
    parent.mkdir(mode=0o700)
    parent.chmod(0o777)
    path = parent / "run-bindings.sqlite3"

    with pytest.raises(ValueError, match="private mode 0700"):
        await run_binding.RunBindingStore(path).claim(
            thread_id="thread-parent-mode",
            run_id="run-parent-mode",
            actor_id=str(ACTOR_A),
        )

    assert not path.exists()


@pytest.mark.asyncio
async def test_binding_store_rejects_controlled_parent_owner_mismatch(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    parent = tmp_path / "bindings"
    parent.mkdir(mode=0o700)
    parent.chmod(0o700)
    path = parent / "run-bindings.sqlite3"
    monkeypatch.setattr(run_binding.os, "geteuid", lambda: os.getuid() + 1)

    with pytest.raises(ValueError, match="effective user"):
        await run_binding.RunBindingStore(path).claim(
            thread_id="thread-owner",
            run_id="run-owner",
            actor_id=str(ACTOR_A),
        )

    assert not path.exists()


@pytest.mark.asyncio
async def test_binding_store_rejects_symlink_in_ancestor_chain(tmp_path) -> None:
    real_root = tmp_path / "real-root"
    real_root.mkdir(mode=0o700)
    real_root.chmod(0o700)
    linked_root = tmp_path / "linked-root"
    linked_root.symlink_to(real_root, target_is_directory=True)
    path = linked_root / "bindings" / "run-bindings.sqlite3"

    with pytest.raises(ValueError, match="symlink"):
        await run_binding.RunBindingStore(path).claim(
            thread_id="thread-symlink",
            run_id="run-symlink",
            actor_id=str(ACTOR_A),
        )

    assert not path.exists()


@pytest.mark.asyncio
async def test_binding_store_rejects_hardlinked_database(tmp_path) -> None:
    parent = tmp_path / "bindings"
    parent.mkdir(mode=0o700)
    parent.chmod(0o700)
    source = parent / "source.sqlite3"
    source.write_bytes(b"")
    source.chmod(0o600)
    path = parent / "run-bindings.sqlite3"
    os.link(source, path)

    with pytest.raises(ValueError, match="exactly one hard link"):
        await run_binding.RunBindingStore(path).claim(
            thread_id="thread-hardlink",
            run_id="run-hardlink",
            actor_id=str(ACTOR_A),
        )


@pytest.mark.asyncio
async def test_binding_store_rejects_permissive_preexisting_database(tmp_path) -> None:
    parent = tmp_path / "bindings"
    parent.mkdir(mode=0o700)
    parent.chmod(0o700)
    path = parent / "run-bindings.sqlite3"
    path.write_bytes(b"")
    path.chmod(0o666)

    with pytest.raises(ValueError, match="private mode 0600"):
        await run_binding.RunBindingStore(path).claim(
            thread_id="thread-database-mode",
            run_id="run-database-mode",
            actor_id=str(ACTOR_A),
        )


@pytest.mark.asyncio
async def test_binding_store_creates_every_controlled_directory_private(tmp_path) -> None:
    secure_root = tmp_path / "agentic"
    parent = secure_root / "ag_ui"
    path = parent / "run-bindings.sqlite3"

    await run_binding.RunBindingStore(path, secure_root=secure_root).claim(
        thread_id="thread-private-tree",
        run_id="run-private-tree",
        actor_id=str(ACTOR_A),
    )

    assert stat.S_IMODE(secure_root.stat().st_mode) == 0o700
    assert stat.S_IMODE(parent.stat().st_mode) == 0o700
    assert stat.S_IMODE(path.stat().st_mode) == 0o600


@pytest.mark.asyncio
async def test_binding_store_creates_database_private_before_sqlite_open(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    path = tmp_path / "bindings" / "run-bindings.sqlite3"
    real_connect = run_binding.sqlite3.connect
    observed_modes: list[int] = []

    def inspecting_connect(*args, **kwargs):
        observed_modes.append(stat.S_IMODE(path.stat().st_mode))
        return real_connect(*args, **kwargs)

    monkeypatch.setattr(run_binding.sqlite3, "connect", inspecting_connect)

    await run_binding.RunBindingStore(path).claim(
        thread_id="thread-preopen-mode",
        run_id="run-preopen-mode",
        actor_id=str(ACTOR_A),
    )

    assert observed_modes == [0o600]


@pytest.mark.asyncio
async def test_binding_store_rejects_database_inode_substitution_during_sqlite_open(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    parent = tmp_path / "bindings"
    parent.mkdir(mode=0o700)
    parent.chmod(0o700)
    path = parent / "run-bindings.sqlite3"
    real_connect = run_binding.sqlite3.connect
    with real_connect(path) as connection:
        connection.execute("CREATE TABLE seed (value TEXT NOT NULL)")
    path.chmod(0o600)
    swapped = False

    def substituting_connect(*args, **kwargs):
        nonlocal swapped
        if not swapped:
            swapped = True
            path.unlink()
            descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600)
            os.close(descriptor)
        return real_connect(*args, **kwargs)

    monkeypatch.setattr(run_binding.sqlite3, "connect", substituting_connect)

    with pytest.raises(ValueError, match="inode changed"):
        await run_binding.RunBindingStore(path).claim(
            thread_id="thread-substitution",
            run_id="run-substitution",
            actor_id=str(ACTOR_A),
        )


@pytest.mark.parametrize(("thread_id", "run_id"), [("", "run"), ("thread", ""), ("t" * 257, "run")])
@pytest.mark.asyncio
async def test_hook_fails_closed_on_invalid_resource_identifiers(tmp_path, thread_id: str, run_id: str) -> None:
    store = run_binding.RunBindingStore(tmp_path / "bindings" / "run-bindings.sqlite3")
    request = Request({"type": "http", "headers": []})
    setattr(request.state, auth.AG_UI_ACTOR_STATE_KEY, str(ACTOR_A))
    input_data = SimpleNamespace(thread_id=thread_id, run_id=run_id)

    with pytest.raises(HTTPException) as error:
        await run_binding.create_ag_ui_before_dispatch(store)(input_data, request, _TemplateAgent().clone())  # type: ignore[arg-type]

    assert error.value.status_code == 400


def test_production_sources_do_not_implement_an_ag_ui_protocol() -> None:
    sources = "\n".join(
        Path(path).read_text(encoding="utf-8")
        for path in (
            auth.__file__,
            run_binding.__file__,
        )
    )
    forbidden = (
        "EventEncoder",
        "BaseEvent",
        "RunAgentInput.model_validate",
        "model_validate_json",
        "text/event-stream",
        "Command(resume=",
        "forwarded_props.command.resume",
        "jwt.decode",
    )
    assert all(token not in sources for token in forbidden)
