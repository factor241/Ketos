from __future__ import annotations

from contextlib import asynccontextmanager
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from ag_ui.core import RunAgentInput
from ag_ui.core.events import (
    MessagesSnapshotEvent,
    RunFinishedEvent,
    RunStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
)
from fastapi import HTTPException
from ketos.agentic.services.ag_ui import durable_chat
from ketos.agentic.services.ag_ui.auth import AG_UI_ACTOR_STATE_KEY
from ketos.agentic.services.ag_ui.durable_chat import (
    _flow_builder_component,
    _server_component,
    canonical_run_request,
    create_durable_chat_before_dispatch,
    derive_idempotency_key,
    request_fingerprint,
    validate_client_authority,
)
from ketos.services.chat_threads.repository import ChatIdempotencyConflictError
from ketos.services.database.models.chat_thread.model import ChatRunStatus
from starlette.requests import Request

ACTOR_ID = UUID("20000000-0000-0000-0000-000000000001")
CHAT_ID = UUID("10000000-0000-0000-0000-000000000001")
RUN_ROW_ID = UUID("30000000-0000-0000-0000-000000000001")


@pytest.mark.asyncio
async def test_s05_server_component_exposes_only_read_only_current_date_kfx_tool() -> None:
    component = await _server_component(
        actor_id=ACTOR_ID,
        provider="OpenAI",
        model_name="gpt-4o-mini",
    )

    assert [tool.name for tool in component.tools] == ["get_current_date"]
    assert component.add_current_date_tool is False
    assert component.add_calculator_tool is False


@pytest.mark.asyncio
async def test_s08_flow_builder_disables_retry_middleware_that_would_swallow_interrupts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    component = SimpleNamespace(
        tools=[],
        handle_parsing_errors=True,
        system_prompt="",
    )

    async def server_component(**_kwargs):
        return component

    async def all_types(_settings):
        return {"inputs": {"TextInput": {"template": {}}}}

    monkeypatch.setattr(durable_chat, "_server_component", server_component)
    monkeypatch.setattr(durable_chat, "get_and_cache_all_types_dict", all_types)

    actual = await _flow_builder_component(
        actor_id=ACTOR_ID,
        provider="OpenAI",
        model_name="gpt-4o-mini",
        project_id=UUID(int=9),
        chat_run_id=RUN_ROW_ID,
        thread_id=str(CHAT_ID),
        resume_interrupt_ids=frozenset(),
    )

    assert actual is component
    assert component.handle_parsing_errors is False
    assert [tool.name for tool in component.tools] == ["ProposeFlowChanges"]


def _input(
    *,
    run_id: str = "run-1",
    state: dict[str, object] | None = None,
    forwarded_props: dict[str, object] | None = None,
    resume: list[dict[str, object]] | None = None,
) -> RunAgentInput:
    return RunAgentInput(
        threadId="10000000-0000-0000-0000-000000000001",
        runId=run_id,
        state={} if state is None else state,
        messages=[{"id": "user-1", "role": "user", "content": "hello"}],
        tools=[],
        context=[],
        forwardedProps={} if forwarded_props is None else forwarded_props,
        resume=resume,
    )


def test_s05_normal_run_identity_and_fingerprint_are_canonical() -> None:
    first = _input(state={"boardId": "board-1", "projectId": "project-1", "ignored": 1})
    second = _input(state={"ignored": 2, "projectId": "project-1", "boardId": "board-1"})

    assert derive_idempotency_key(first) == "run:run-1"
    assert canonical_run_request(first) == canonical_run_request(second)
    assert request_fingerprint(first) == request_fingerprint(second)


def test_s05_resume_identity_ignores_new_run_id_but_canonicalizes_every_response() -> None:
    resume = [
        {"interruptId": "interrupt-a", "status": "resolved", "payload": {"approved": True}},
        {"interruptId": "interrupt-b", "status": "resolved", "payload": {"value": "ok"}},
    ]
    first = _input(run_id="resume-run-a", resume=deepcopy(resume))
    second = _input(run_id="resume-run-b", resume=deepcopy(resume))

    assert derive_idempotency_key(first) == derive_idempotency_key(second)
    assert derive_idempotency_key(first).startswith("resume:")
    assert request_fingerprint(first) == request_fingerprint(second)

    changed = deepcopy(resume)
    changed[1]["payload"] = {"value": "different"}
    assert derive_idempotency_key(_input(run_id="resume-run-c", resume=changed)) != derive_idempotency_key(first)


@pytest.mark.parametrize(
    ("state", "forwarded_props"),
    [
        ({"model": "browser-model"}, {}),
        ({"nested": {"tool": "browser-tool"}}, {}),
        ({}, {"mcpUrl": "https://attacker.invalid"}),
        ({}, {"actor": "forged"}),
        ({}, {"base_url": "https://attacker.invalid"}),
    ],
)
def test_s05_client_authority_overrides_fail_closed(
    state: dict[str, object], forwarded_props: dict[str, object]
) -> None:
    with pytest.raises(HTTPException) as exc_info:
        validate_client_authority(_input(state=state, forwarded_props=forwarded_props))

    assert exc_info.value.status_code == 403


def test_s08_standard_state_messages_do_not_trip_authority_guard() -> None:
    resume = [{"interruptId": "interrupt-a", "status": "resolved", "payload": {"approved": True}}]
    standard_state = {
        "messages": [
            {
                "id": "assistant-1",
                "type": "ai",
                "role": "assistant",
                "response_metadata": {
                    "finish_reason": "tool_calls",
                    "model_name": "gpt-4o-mini",
                    "model_provider": "openai",
                },
                "tool_calls": [],
            }
        ]
    }

    validate_client_authority(_input(state=standard_state))
    validate_client_authority(_input(state=standard_state, resume=resume))

    with pytest.raises(HTTPException) as exc_info:
        validate_client_authority(
            _input(
                state={**standard_state, "override": {"model": "browser-model"}},
                resume=resume,
            )
        )
    assert exc_info.value.status_code == 403


def _request() -> Request:
    request = Request({"type": "http", "method": "POST", "path": "/ag-ui", "headers": []})
    setattr(request.state, AG_UI_ACTOR_STATE_KEY, str(ACTOR_ID))
    return request


class _Agent:
    def __init__(self, events: list[object], *, disconnect: bool = False) -> None:
        self.events = events
        self.disconnect = disconnect
        self.invocations = 0
        self.graph = SimpleNamespace(checkpointer="durable-checkpointer")
        self.name = "template"
        self.config: dict[str, object] = {}

    async def run(self, _input_data: RunAgentInput):
        self.invocations += 1
        for event in self.events:
            yield event
        if self.disconnect:
            message = "disconnected"
            raise ConnectionError(message)


async def _configure_hook(
    monkeypatch: pytest.MonkeyPatch,
    *,
    replayed: bool = False,
    disconnect: bool = False,
) -> tuple[_Agent, AsyncMock, list[tuple[ChatRunStatus, str | None]]]:
    @asynccontextmanager
    async def fake_session_scope():
        yield object()

    chat = SimpleNamespace(id=CHAT_ID, project_id=UUID(int=9), provider="OpenAI", model_name="gpt-4o")
    run = SimpleNamespace(id=RUN_ROW_ID, run_sequence=1, outcome="success")
    monkeypatch.setattr(durable_chat, "session_scope", fake_session_scope)
    monkeypatch.setattr(durable_chat, "require_owned_chat", AsyncMock(return_value=chat))
    monkeypatch.setattr(
        durable_chat,
        "claim_chat_run",
        AsyncMock(return_value=SimpleNamespace(run=run, replayed=replayed)),
    )
    monkeypatch.setattr(
        durable_chat,
        "load_committed_messages",
        AsyncMock(return_value=[SimpleNamespace(id=UUID(int=7), text="committed", is_output=False)]),
    )
    monkeypatch.setattr(durable_chat, "append_user_message", AsyncMock())
    committed = AsyncMock()
    monkeypatch.setattr(durable_chat, "commit_assistant_message", committed)
    states: list[tuple[ChatRunStatus, str | None]] = []

    async def set_state(_run_id, state, *, outcome=None, duration_ms=None):  # noqa: ARG001
        states.append((state, outcome))

    monkeypatch.setattr(durable_chat, "_set_run_state", set_state)
    configured: list[tuple[UUID, str, str]] = []

    class _Component:
        def create_agent_runnable(self):
            return SimpleNamespace(name="owned-kfx-graph", checkpointer=None)

    async def component(*, actor_id, provider, model_name):
        configured.append((actor_id, provider, model_name))
        return _Component()

    monkeypatch.setattr(durable_chat, "_server_component", component)
    events: list[object] = [
        RunStartedEvent(threadId=str(CHAT_ID), runId="run-1"),
        TextMessageStartEvent(messageId="assistant-1", role="assistant"),
        TextMessageContentEvent(messageId="assistant-1", delta="answer"),
    ]
    if not disconnect:
        events.extend(
            [
                TextMessageEndEvent(messageId="assistant-1"),
                RunFinishedEvent(threadId=str(CHAT_ID), runId="run-1"),
            ]
        )
    agent = _Agent(events, disconnect=disconnect)
    await create_durable_chat_before_dispatch()(_input(), _request(), agent)  # type: ignore[arg-type]
    if replayed:
        assert configured == []
        assert agent.graph.checkpointer == "durable-checkpointer"
    else:
        assert configured == [(ACTOR_ID, "OpenAI", "gpt-4o")]
        assert agent.graph.name == "owned-kfx-graph"
        assert agent.graph.checkpointer == "durable-checkpointer"
    return agent, committed, states


@pytest.mark.asyncio
async def test_s05_owned_run_emits_snapshot_before_delta_and_commits_terminal_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    agent, committed, states = await _configure_hook(monkeypatch)

    events = [event async for event in agent.run(_input())]

    assert agent.invocations == 1
    assert isinstance(events[0], RunStartedEvent)
    assert isinstance(events[1], MessagesSnapshotEvent)
    assert isinstance(events[2], TextMessageStartEvent)
    assert events[1].messages[0].content == "committed"
    committed.assert_awaited_once()
    assert committed.await_args.kwargs["text"] == "answer"
    assert states[0][0] == ChatRunStatus.RUNNING
    assert states[-1] == (ChatRunStatus.SUCCEEDED, "success")


@pytest.mark.asyncio
async def test_s05_idempotent_replay_emits_standard_events_without_graph_invocation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    agent, committed, _states = await _configure_hook(monkeypatch, replayed=True)

    events = [event async for event in agent.run(_input())]

    assert agent.invocations == 0
    assert [type(event) for event in events] == [RunStartedEvent, MessagesSnapshotEvent, RunFinishedEvent]
    assert events[-1].result == {"replayed": True, "runSequence": 1}
    committed.assert_not_awaited()


@pytest.mark.asyncio
async def test_s05_disconnect_never_commits_partial_assistant_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    agent, committed, states = await _configure_hook(monkeypatch, disconnect=True)

    with pytest.raises(ConnectionError, match="disconnected"):
        _ = [event async for event in agent.run(_input())]

    committed.assert_not_awaited()
    assert states[-1] == (ChatRunStatus.FAILED_RECOVERABLE, "stream_disconnected")


@pytest.mark.asyncio
async def test_s05_changed_fingerprint_maps_to_http_409(monkeypatch: pytest.MonkeyPatch) -> None:
    @asynccontextmanager
    async def fake_session_scope():
        yield object()

    monkeypatch.setattr(durable_chat, "session_scope", fake_session_scope)
    monkeypatch.setattr(
        durable_chat,
        "require_owned_chat",
        AsyncMock(return_value=SimpleNamespace(project_id=UUID(int=9))),
    )
    monkeypatch.setattr(
        durable_chat,
        "claim_chat_run",
        AsyncMock(side_effect=ChatIdempotencyConflictError(CHAT_ID)),
    )

    with pytest.raises(HTTPException) as exc_info:
        await create_durable_chat_before_dispatch()(_input(), _request(), _Agent([]))  # type: ignore[arg-type]

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "chat_idempotency_conflict"
