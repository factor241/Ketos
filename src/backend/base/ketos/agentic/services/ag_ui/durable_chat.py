"""Owner-scoped durable Chat binding for the official AG-UI adapter."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any
from uuid import UUID

from ag_ui.core.events import (
    MessagesSnapshotEvent,
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
)
from ag_ui.core.types import AssistantMessage, RunAgentInput, UserMessage
from fastapi import HTTPException, Request, status
from kfx.components.helpers import CurrentDateComponent
from kfx.components.models_and_agents.agent import AgentComponent
from kfx.interface.components import get_and_cache_all_types_dict
from sqlalchemy import update

from ketos.agentic.flows.flow_builder_hitl import (
    FlowBuilderToolContext,
    create_flow_proposal_tool,
    flatten_component_registry,
)
from ketos.agentic.services.ag_ui.auth import AG_UI_ACTOR_STATE_KEY
from ketos.services.chat_threads.message_adapter import (
    append_user_message,
    commit_assistant_message,
    load_committed_messages,
)
from ketos.services.chat_threads.repository import (
    ChatIdempotencyConflictError,
    ChatNotFoundError,
    claim_chat_run,
    require_owned_chat,
)
from ketos.services.database.models.chat_thread.model import ChatRun, ChatRunStatus
from ketos.services.deps import get_settings_service, session_scope

if TYPE_CHECKING:
    from ag_ui_langgraph import LangGraphAgent

_ALLOWED_STATE_KEYS = frozenset({"projectId", "boardId"})
_MISSING_CHECKPOINTER_MESSAGE = "Stage-05 durable Chat requires the admitted LangGraph checkpointer"
_FORBIDDEN_AUTHORITY_KEYS = frozenset(
    {
        "actor",
        "actorid",
        "actor_id",
        "apikey",
        "api_key",
        "baseurl",
        "base_url",
        "endpoint",
        "model",
        "modelname",
        "model_name",
        "mcp",
        "mcpurl",
        "mcp_url",
        "provider",
        "role",
        "tool",
        "tools",
        "url",
        "userid",
        "user_id",
    }
)


def _json_value(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(by_alias=True, exclude_none=False)
    if isinstance(value, Mapping):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [_json_value(item) for item in value]
    return value


def _canonical_json(value: Any) -> str:
    return json.dumps(_json_value(value), ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _contains_forbidden_authority(value: Any) -> bool:
    if isinstance(value, Mapping):
        for key, item in value.items():
            normalized = str(key).replace("-", "_").lower()
            compact = normalized.replace("_", "")
            if normalized in _FORBIDDEN_AUTHORITY_KEYS or compact in _FORBIDDEN_AUTHORITY_KEYS:
                return True
            if _contains_forbidden_authority(item):
                return True
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return any(_contains_forbidden_authority(item) for item in value)
    return False


def validate_client_authority(input_data: RunAgentInput) -> None:
    """Reject any browser-supplied identity, runtime, model or endpoint authority."""
    if input_data.tools or input_data.context:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="AG-UI client runtime overrides are not permitted",
        )
    state = input_data.state
    if isinstance(state, Mapping):
        # CopilotKit's standard run request mirrors protocol messages under
        # state.messages, including inert provider/model response metadata on
        # resumes and subsequent turns.
        # The server never reads that mirror as authority; the owned Chat row
        # selects provider/model and the checkpoint owns execution state.
        state = {key: value for key, value in state.items() if key != "messages"}
    if _contains_forbidden_authority(state) or _contains_forbidden_authority(input_data.forwarded_props):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="AG-UI client authority overrides are not permitted",
        )


def canonical_run_request(input_data: RunAgentInput) -> dict[str, Any]:
    """Return the frozen trusted subset used by Stage-05 idempotency."""
    state = input_data.state if isinstance(input_data.state, Mapping) else {}
    trusted_state = {key: _json_value(state[key]) for key in sorted(_ALLOWED_STATE_KEYS) if key in state}
    result: dict[str, Any] = {
        "threadId": input_data.thread_id,
        "messages": _json_value(input_data.messages),
        "state": trusted_state,
        "resume": _json_value(input_data.resume or []),
    }
    if not input_data.resume:
        result["runId"] = input_data.run_id
    return result


def request_fingerprint(input_data: RunAgentInput) -> str:
    return hashlib.sha256(_canonical_json(canonical_run_request(input_data)).encode()).hexdigest()


def derive_idempotency_key(input_data: RunAgentInput) -> str:
    if not input_data.resume:
        return f"run:{input_data.run_id}"
    payload = {"threadId": input_data.thread_id, "resume": _json_value(input_data.resume)}
    return "resume:" + hashlib.sha256(_canonical_json(payload).encode()).hexdigest()


def _standard_messages(rows: Sequence[Any]) -> list[UserMessage | AssistantMessage]:
    return [
        AssistantMessage(id=str(row.id), content=row.text)
        if row.is_output
        else UserMessage(id=str(row.id), content=row.text)
        for row in rows
    ]


def _latest_user_text(input_data: RunAgentInput) -> str | None:
    for message in reversed(input_data.messages):
        if getattr(message, "role", None) == "user":
            content = getattr(message, "content", None)
            if isinstance(content, str) and content.strip():
                return content
    return None


async def _server_component(
    *,
    actor_id: UUID,
    provider: str,
    model_name: str,
) -> AgentComponent:
    component = AgentComponent(_user_id=actor_id)
    component.model = [{"provider": provider, "name": model_name, "metadata": {}}]
    component.agent_llm = provider
    component.model_name = model_name
    current_date = CurrentDateComponent(_user_id=actor_id)
    current_date.timezone = "UTC"
    component.tools = await current_date.to_toolkit()
    component.add_current_date_tool = False
    component.add_calculator_tool = False
    return component


async def _flow_builder_component(
    *,
    actor_id: UUID,
    provider: str,
    model_name: str,
    project_id: UUID,
    chat_run_id: UUID,
    thread_id: str,
    resume_interrupt_ids: frozenset[str],
) -> AgentComponent:
    component = await _server_component(actor_id=actor_id, provider=provider, model_name=model_name)
    # Test doubles and compatibility callers that supply a graph-only component
    # retain the Stage-05 behavior. Production AgentComponent always owns tools.
    if not hasattr(component, "tools"):
        return component
    all_types = await get_and_cache_all_types_dict(get_settings_service())
    component.tools = [
        create_flow_proposal_tool(
            FlowBuilderToolContext(
                actor_id=actor_id,
                project_id=project_id,
                chat_run_id=chat_run_id,
                thread_id=thread_id,
                component_registry=flatten_component_registry(all_types),
                resume_interrupt_ids=resume_interrupt_ids,
            )
        )
    ]
    # LangGraph interrupts are control-flow exceptions. AgentComponent's optional
    # ToolRetryMiddleware retries every Exception and would otherwise turn a
    # confirmation interrupt into an ordinary tool error/result, allowing the
    # model to continue while the durable proposal remains unresolved.
    component.handle_parsing_errors = False
    component.system_prompt = (
        "You are the Ketos Flow Builder. Clarify ambiguous requests. For concrete flow creation or editing, "
        "use only ProposeFlowChanges. Never claim that a flow changed before the tool reports applied."
    )
    return component


async def _set_run_state(
    run_id: UUID,
    status_value: ChatRunStatus,
    *,
    outcome: str | None = None,
    duration_ms: int | None = None,
) -> None:
    now = datetime.now(timezone.utc)
    values: dict[str, object] = {"status": status_value}
    if status_value == ChatRunStatus.RUNNING:
        values["started_at"] = now
    if status_value in {
        ChatRunStatus.SUCCEEDED,
        ChatRunStatus.FAILED,
        ChatRunStatus.FAILED_RECOVERABLE,
        ChatRunStatus.CANCELLED,
    }:
        values.update({"finished_at": now, "duration_ms": duration_ms, "outcome": outcome})
    async with session_scope() as session:
        await session.exec(update(ChatRun).where(ChatRun.id == run_id).values(**values))
        await session.commit()


async def _snapshot(chat_id: UUID, actor_id: UUID) -> MessagesSnapshotEvent:
    async with session_scope() as session:
        rows = await load_committed_messages(session, chat_id=chat_id, actor_id=actor_id)
    return MessagesSnapshotEvent(messages=_standard_messages(rows))


def _outcome_label(event: RunFinishedEvent) -> str:
    outcome = event.outcome
    if outcome is None:
        return "success"
    value = getattr(outcome, "type", None)
    return str(getattr(value, "value", value) or "success")[:128]


def create_durable_chat_before_dispatch():
    """Bind one owned durable Chat to one request-local official AG-UI agent."""

    async def before_dispatch(
        input_data: RunAgentInput,
        request: Request,
        request_agent: LangGraphAgent,
    ) -> None:
        validate_client_authority(input_data)
        actor_value = getattr(request.state, AG_UI_ACTOR_STATE_KEY, None)
        try:
            actor_id = UUID(str(actor_value))
            chat_id = UUID(input_data.thread_id)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid AG-UI owner binding") from exc

        try:
            async with session_scope() as session:
                chat = await require_owned_chat(session, chat_id=chat_id, actor_id=actor_id)
                state = input_data.state if isinstance(input_data.state, Mapping) else {}
                project_id = state.get("projectId")
                if project_id is not None and str(project_id) != str(chat.project_id):
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="AG-UI project binding denied")
                claim = await claim_chat_run(
                    session,
                    chat_id=chat_id,
                    actor_id=actor_id,
                    ag_ui_run_id=input_data.run_id,
                    idempotency_key=derive_idempotency_key(input_data),
                    request_fingerprint=request_fingerprint(input_data),
                )
        except ChatNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found") from exc
        except ChatIdempotencyConflictError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc.code) from exc

        if claim.replayed:

            async def replay(_input: RunAgentInput):
                yield RunStartedEvent(threadId=str(chat_id), runId=input_data.run_id)
                yield await _snapshot(chat_id, actor_id)
                yield RunFinishedEvent(
                    threadId=str(chat_id),
                    runId=input_data.run_id,
                    result={"replayed": True, "runSequence": claim.run.run_sequence},
                )

            request_agent.run = replay  # type: ignore[method-assign]
            return

        original_run = request_agent.run
        durable_checkpointer = getattr(request_agent.graph, "checkpointer", None)
        if durable_checkpointer is None:
            raise RuntimeError(_MISSING_CHECKPOINTER_MESSAGE)
        resume_interrupt_ids = frozenset(entry.interrupt_id for entry in (input_data.resume or []))
        component = await _flow_builder_component(
            actor_id=actor_id,
            provider=chat.provider,
            model_name=chat.model_name,
            project_id=chat.project_id,
            chat_run_id=claim.run.id,
            thread_id=str(chat_id),
            resume_interrupt_ids=resume_interrupt_ids,
        )
        owned_graph = component.create_agent_runnable()
        owned_graph.checkpointer = durable_checkpointer
        request_agent.graph = owned_graph
        request_agent.name = "ketos-chat"
        config = dict(request_agent.config or {})
        configurable = dict(config.get("configurable") or {})
        metadata = dict(config.get("metadata") or {})
        configurable.update({"thread_id": str(chat_id), "ketos_actor_id": str(actor_id)})
        metadata.update(
            {
                "chat_id": str(chat_id),
                "chat_run_id": str(claim.run.id),
                "project_id": str(chat.project_id),
                "run_id": input_data.run_id,
                "actor_id": str(actor_id),
            }
        )
        config.update({"configurable": configurable, "metadata": metadata})
        request_agent.config = config

        await _set_run_state(claim.run.id, ChatRunStatus.RUNNING)
        user_text = None if input_data.resume else _latest_user_text(input_data)
        if user_text is not None:
            async with session_scope() as session:
                await append_user_message(
                    session,
                    chat_id=chat_id,
                    chat_run_id=claim.run.id,
                    actor_id=actor_id,
                    text=user_text,
                )

        async def durable_run(run_input: RunAgentInput):
            started_at = datetime.now(timezone.utc)
            snapshot_sent = False
            assistant_ids: set[str] = set()
            completed_ids: set[str] = set()
            deltas: dict[str, list[str]] = {}
            try:
                async for event in original_run(run_input):
                    if isinstance(event, RunStartedEvent):
                        yield event
                        if not snapshot_sent:
                            yield await _snapshot(chat_id, actor_id)
                            snapshot_sent = True
                        continue
                    if not snapshot_sent:
                        yield await _snapshot(chat_id, actor_id)
                        snapshot_sent = True
                    if isinstance(event, TextMessageStartEvent) and event.role == "assistant":
                        assistant_ids.add(event.message_id)
                        deltas.setdefault(event.message_id, [])
                    elif isinstance(event, TextMessageContentEvent) and event.message_id in assistant_ids:
                        deltas[event.message_id].append(event.delta)
                    elif isinstance(event, TextMessageEndEvent) and event.message_id in assistant_ids:
                        completed_ids.add(event.message_id)
                    elif isinstance(event, RunErrorEvent):
                        elapsed = max(0, int((datetime.now(timezone.utc) - started_at).total_seconds() * 1000))
                        await _set_run_state(
                            claim.run.id,
                            ChatRunStatus.FAILED,
                            outcome=(event.code or "run_error")[:128],
                            duration_ms=elapsed,
                        )
                    elif isinstance(event, RunFinishedEvent):
                        for message_id in completed_ids:
                            text = "".join(deltas.get(message_id, []))
                            if text.strip():
                                async with session_scope() as session:
                                    await commit_assistant_message(
                                        session,
                                        chat_id=chat_id,
                                        chat_run_id=claim.run.id,
                                        actor_id=actor_id,
                                        text=text,
                                    )
                        elapsed = max(0, int((datetime.now(timezone.utc) - started_at).total_seconds() * 1000))
                        await _set_run_state(
                            claim.run.id,
                            ChatRunStatus.SUCCEEDED,
                            outcome=_outcome_label(event),
                            duration_ms=elapsed,
                        )
                    yield event
            except BaseException:
                elapsed = max(0, int((datetime.now(timezone.utc) - started_at).total_seconds() * 1000))
                await _set_run_state(
                    claim.run.id,
                    ChatRunStatus.FAILED_RECOVERABLE,
                    outcome="stream_disconnected",
                    duration_ms=elapsed,
                )
                raise

        request_agent.run = durable_run  # type: ignore[method-assign]

    return before_dispatch


__all__ = [
    "canonical_run_request",
    "create_durable_chat_before_dispatch",
    "derive_idempotency_key",
    "request_fingerprint",
    "validate_client_authority",
]
