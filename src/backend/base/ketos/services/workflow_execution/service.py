"""Immutable preparation and one-call execution for workflow API adapters."""

# Compact integrity messages are observable Stage 07 diagnostics.
# ruff: noqa: BLE001, EM101, TRY003

from __future__ import annotations

import hashlib
import inspect
import json
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal
from uuid import UUID

from kfx.graph.graph.base import Graph
from kfx.schema.schema import InputValueRequest

from ketos.processing.process import run_graph_internal

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from kfx.events.event_manager import EventManager
    from kfx.graph.schema import RunOutputs
    from kfx.schema.schema import InputType

    from ketos.services.database.models.flow.model import FlowRead

ExecutionMode = Literal["v1_session", "v1_board", "v2_developer"]
_EXECUTION_MODES = frozenset({"v1_session", "v1_board", "v2_developer"})


class WorkflowExecutionIntegrityError(ValueError):
    """An immutable prepared snapshot is malformed or was modified."""


@dataclass(frozen=True, slots=True)
class InputValueSnapshot:
    components: tuple[str, ...]
    input_value: str
    session: str | None
    input_type: InputType | None
    client_request_time: int | None


@dataclass(frozen=True, slots=True)
class PreparedWorkflowExecution:
    job_id: UUID
    actor_id: UUID
    flow_id: UUID
    flow_name: str
    flow_hash: str
    graph_payload_json: str
    graph_context_json: str | None
    terminal_node_ids: tuple[str, ...]
    inputs: tuple[InputValueSnapshot, ...]
    outputs: tuple[str, ...]
    stream: bool
    mode: ExecutionMode
    session_id: str | None
    tracing_user_id: str | None = None

    def to_task_payload(self) -> dict[str, object]:
        """Return primitive JSON data accepted by the Celery serializer."""
        return {
            "job_id": str(self.job_id),
            "actor_id": str(self.actor_id),
            "flow_id": str(self.flow_id),
            "flow_name": self.flow_name,
            "flow_hash": self.flow_hash,
            "graph_payload_json": self.graph_payload_json,
            "graph_context_json": self.graph_context_json,
            "terminal_node_ids": list(self.terminal_node_ids),
            "inputs": [
                {
                    "components": list(item.components),
                    "input_value": item.input_value,
                    "session": item.session,
                    "input_type": item.input_type,
                    "client_request_time": item.client_request_time,
                }
                for item in self.inputs
            ],
            "outputs": list(self.outputs),
            "stream": self.stream,
            "mode": self.mode,
            "session_id": self.session_id,
            "tracing_user_id": self.tracing_user_id,
        }

    @classmethod
    def from_task_payload(cls, payload: dict[str, object]) -> PreparedWorkflowExecution:
        """Strictly reconstruct a prepared snapshot from primitive task data."""
        try:
            raw_inputs = payload["inputs"]
            raw_terminal_ids = payload["terminal_node_ids"]
            raw_outputs = payload["outputs"]
            if (
                not isinstance(raw_inputs, list)
                or not isinstance(raw_terminal_ids, list)
                or not isinstance(raw_outputs, list)
            ):
                raise TypeError
            inputs = tuple(
                InputValueSnapshot(
                    components=tuple(item["components"]),
                    input_value=item["input_value"],
                    session=item["session"],
                    input_type=item["input_type"],
                    client_request_time=item["client_request_time"],
                )
                for item in raw_inputs
                if isinstance(item, dict)
            )
            mode = payload["mode"]
            if mode not in _EXECUTION_MODES:
                raise TypeError
            prepared = cls(
                job_id=UUID(str(payload["job_id"])),
                actor_id=UUID(str(payload["actor_id"])),
                flow_id=UUID(str(payload["flow_id"])),
                flow_name=payload["flow_name"],
                flow_hash=payload["flow_hash"],
                graph_payload_json=payload["graph_payload_json"],
                graph_context_json=payload["graph_context_json"],
                terminal_node_ids=tuple(raw_terminal_ids),
                inputs=inputs,
                outputs=tuple(raw_outputs),
                stream=payload["stream"],
                mode=mode,
                session_id=payload["session_id"],
                tracing_user_id=payload.get("tracing_user_id"),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise WorkflowExecutionIntegrityError("invalid Board task payload") from exc
        if len(inputs) != len(raw_inputs):
            raise WorkflowExecutionIntegrityError("invalid Board task input snapshot")
        if not isinstance(prepared.flow_name, str) or not isinstance(prepared.flow_hash, str):
            raise WorkflowExecutionIntegrityError("invalid Board task string fields")
        if not isinstance(prepared.graph_payload_json, str) or (
            prepared.graph_context_json is not None and not isinstance(prepared.graph_context_json, str)
        ):
            raise WorkflowExecutionIntegrityError("invalid Board task JSON fields")
        if not all(isinstance(value, str) for value in (*prepared.terminal_node_ids, *prepared.outputs)):
            raise WorkflowExecutionIntegrityError("invalid Board task output fields")
        if (
            not isinstance(prepared.stream, bool)
            or (prepared.session_id is not None and not isinstance(prepared.session_id, str))
            or (prepared.tracing_user_id is not None and not isinstance(prepared.tracing_user_id, str))
        ):
            raise WorkflowExecutionIntegrityError("invalid Board task execution fields")
        return prepared


def _canonical_json(value: object) -> str:
    try:
        return json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise WorkflowExecutionIntegrityError("workflow snapshot must be canonical JSON") from exc


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class WorkflowExecutionService:
    """Create detached prepared DTOs and execute each through one runner call."""

    def __init__(
        self,
        *,
        graph_factory: Callable[..., Any] = Graph.from_payload,
        runner: Callable[..., Awaitable[tuple[list[RunOutputs], str]]] = run_graph_internal,
        board_dispatcher: Callable[[PreparedWorkflowExecution], object] | None = None,
    ) -> None:
        self._graph_factory = graph_factory
        self._runner = runner
        self._board_dispatcher = board_dispatcher

    async def prepare(
        self,
        *,
        flow: FlowRead,
        actor_id: UUID,
        job_id: UUID,
        mode: ExecutionMode,
        inputs: list[InputValueRequest] | None,
        outputs: list[str] | None,
        stream: bool,
        session_id: str | None,
        request_variables: dict[str, str] | None,
        tracing_user_id: str | None = None,
    ) -> PreparedWorkflowExecution:
        """Detach mutable request/Flow state into canonical strings and tuples."""
        if mode not in _EXECUTION_MODES:
            raise WorkflowExecutionIntegrityError("unsupported workflow execution mode")
        if not isinstance(flow.id, UUID) or not isinstance(actor_id, UUID) or not isinstance(job_id, UUID):
            raise WorkflowExecutionIntegrityError("workflow execution identities must be UUIDs")
        if not isinstance(flow.data, dict):
            raise WorkflowExecutionIntegrityError("flow data must be a JSON object")
        if not isinstance(flow.name, str):
            raise WorkflowExecutionIntegrityError("flow name must be a string")
        if request_variables is not None and not all(
            isinstance(key, str) and isinstance(value, str) for key, value in request_variables.items()
        ):
            raise WorkflowExecutionIntegrityError("request variables must contain string keys and values")

        graph_payload_json = _canonical_json(flow.data)
        detached_payload = json.loads(graph_payload_json)
        context = {"request_variables": dict(request_variables)} if request_variables else None
        graph_context_json = _canonical_json(context) if context is not None else None
        preview = self._new_graph(
            detached_payload,
            flow_id=flow.id,
            actor_id=actor_id,
            flow_name=flow.name,
            context=context,
        )
        terminal_node_ids = tuple(str(node_id) for node_id in preview.get_terminal_nodes())
        snapshots = tuple(self._snapshot_input(item) for item in inputs or [])
        selected_outputs = tuple(str(output) for output in outputs) if outputs is not None else terminal_node_ids
        effective_session_id = str(job_id) if mode == "v1_board" else session_id
        return PreparedWorkflowExecution(
            job_id=job_id,
            actor_id=actor_id,
            flow_id=flow.id,
            flow_name=flow.name,
            flow_hash=_sha256(graph_payload_json),
            graph_payload_json=graph_payload_json,
            graph_context_json=graph_context_json,
            terminal_node_ids=terminal_node_ids,
            inputs=snapshots,
            outputs=selected_outputs,
            stream=bool(stream),
            mode=mode,
            session_id=effective_session_id,
            tracing_user_id=tracing_user_id,
        )

    @staticmethod
    def _snapshot_input(value: InputValueRequest) -> InputValueSnapshot:
        if not isinstance(value, InputValueRequest):
            raise WorkflowExecutionIntegrityError("inputs must be InputValueRequest values")
        components = tuple(value.components or [])
        if not all(isinstance(component, str) for component in components):
            raise WorkflowExecutionIntegrityError("input components must be strings")
        if value.input_value is not None and not isinstance(value.input_value, str):
            raise WorkflowExecutionIntegrityError("input value must be a string or null")
        return InputValueSnapshot(
            components=components,
            input_value=value.input_value or "",
            session=value.session,
            input_type=value.type,
            client_request_time=value.client_request_time,
        )

    def _new_graph(
        self,
        payload: dict[str, Any],
        *,
        flow_id: UUID,
        actor_id: UUID,
        flow_name: str,
        context: dict[str, Any] | None,
    ) -> Any:
        return self._graph_factory(
            payload,
            flow_id=str(flow_id),
            user_id=str(actor_id),
            flow_name=flow_name,
            context=context,
        )

    def _materialize(self, prepared: PreparedWorkflowExecution) -> tuple[Any, list[InputValueRequest], list[str]]:
        """Build fresh mutable runtime objects after verifying the frozen snapshot."""
        if _sha256(prepared.graph_payload_json) != prepared.flow_hash:
            raise WorkflowExecutionIntegrityError("prepared graph payload hash mismatch")
        try:
            payload = json.loads(prepared.graph_payload_json)
            context = json.loads(prepared.graph_context_json) if prepared.graph_context_json is not None else None
        except (TypeError, json.JSONDecodeError) as exc:
            raise WorkflowExecutionIntegrityError("prepared execution contains invalid JSON") from exc
        if not isinstance(payload, dict) or (context is not None and not isinstance(context, dict)):
            raise WorkflowExecutionIntegrityError("prepared graph payload/context shape is invalid")
        if _canonical_json(payload) != prepared.graph_payload_json:
            raise WorkflowExecutionIntegrityError("prepared graph payload is not canonical")
        if context is not None and _canonical_json(context) != prepared.graph_context_json:
            raise WorkflowExecutionIntegrityError("prepared graph context is not canonical")

        graph = self._new_graph(
            payload,
            flow_id=prepared.flow_id,
            actor_id=prepared.actor_id,
            flow_name=prepared.flow_name,
            context=context,
        )
        if tuple(str(node_id) for node_id in graph.get_terminal_nodes()) != prepared.terminal_node_ids:
            raise WorkflowExecutionIntegrityError("prepared terminal node identity mismatch")
        graph.set_run_id(str(prepared.job_id))
        if prepared.tracing_user_id is not None:
            graph.tracing_user_id = prepared.tracing_user_id
        runtime_inputs = [
            InputValueRequest(
                components=list(snapshot.components),
                input_value=snapshot.input_value,
                session=snapshot.session,
                type=snapshot.input_type,
                client_request_time=snapshot.client_request_time,
            )
            for snapshot in prepared.inputs
        ]
        return graph, runtime_inputs, list(prepared.outputs)

    async def execute_prepared(
        self,
        prepared: PreparedWorkflowExecution,
        *,
        event_manager: EventManager | None = None,
    ) -> tuple[list[RunOutputs], str]:
        """Materialize once and invoke the authoritative runner exactly once."""
        graph, inputs, outputs = self._materialize(prepared)
        return await self._runner(
            graph=graph,
            flow_id=str(prepared.flow_id),
            stream=prepared.stream,
            session_id=prepared.session_id,
            inputs=inputs,
            outputs=outputs,
            event_manager=event_manager,
        )

    async def enqueue_board_job(self, prepared: PreparedWorkflowExecution) -> None:
        """Dispatch one Board snapshot; synchronous rejection is never swallowed."""
        if prepared.mode != "v1_board":
            raise WorkflowExecutionIntegrityError("only v1_board snapshots can be enqueued")
        try:
            if self._board_dispatcher is None:
                await dispatch_board_workflow(prepared)
            else:
                result = self._board_dispatcher(prepared)
                if inspect.isawaitable(result):
                    await result
        except Exception as exc:
            from ketos.services.database.models.jobs.model import JobStatus
            from ketos.services.jobs.board_finalize import finalize_board_job

            await finalize_board_job(
                job_id=prepared.job_id,
                terminal_status=JobStatus.FAILED,
                result=None,
                reason="enqueue_failed",
                detail=str(exc),
                duration_ms=0,
            )
            raise


async def _claim_execution_start(job_id: UUID) -> bool:
    from sqlalchemy import update

    from ketos.services.database.models.jobs.model import Job, JobStatus
    from ketos.services.deps import session_scope

    async with session_scope() as session:
        result = await session.exec(
            update(Job)
            .where(Job.job_id == job_id, Job.status == JobStatus.QUEUED)
            .values(status=JobStatus.IN_PROGRESS)
            .execution_options(synchronize_session=False)
        )
        return result.rowcount == 1


async def execute_board_workflow_prepared(prepared: PreparedWorkflowExecution) -> None:
    """Execute one claimed Board Job; duplicate delivery exits before side effects."""
    if prepared.mode != "v1_board":
        raise WorkflowExecutionIntegrityError("Board worker requires v1_board mode")
    if not await _claim_execution_start(prepared.job_id):
        return

    from ketos.services.database.models.jobs.model import JobStatus
    from ketos.services.jobs.board_finalize import TerminalJobConflict, finalize_board_job
    from ketos.services.jobs.board_results import sanitize_board_result

    started = time.monotonic()
    terminal_status: JobStatus
    result = None
    reason = None
    detail = None
    error: Exception | None = None
    try:
        outputs, _effective_session_id = await WorkflowExecutionService().execute_prepared(prepared)
        result = sanitize_board_result(outputs, terminal_node_ids=prepared.terminal_node_ids)
        terminal_status = JobStatus.COMPLETED
    except TimeoutError as exc:
        terminal_status = JobStatus.TIMED_OUT
        reason = "timed_out"
        detail = str(exc)
        error = exc
    except Exception as exc:
        terminal_status = JobStatus.FAILED
        reason = "execution_failed"
        detail = str(exc)
        error = exc
    try:
        await finalize_board_job(
            job_id=prepared.job_id,
            terminal_status=terminal_status,
            result=result,
            reason=reason,
            detail=detail,
            duration_ms=max(0, int((time.monotonic() - started) * 1000)),
        )
    except TerminalJobConflict:
        return
    if error is not None:
        raise error


async def execute_board_workflow_payload(payload: dict[str, object]) -> None:
    """Celery-compatible async adapter accepting only primitive data."""
    await execute_board_workflow_prepared(PreparedWorkflowExecution.from_task_payload(payload))


async def dispatch_board_workflow(prepared: PreparedWorkflowExecution) -> None:
    """Dispatch with deterministic task identity on local and Celery backends."""
    from ketos.services.deps import get_task_service

    task_service = get_task_service()
    if task_service.use_celery:
        from ketos.worker import execute_board_workflow_task

        await task_service.fire_and_forget_task(
            execute_board_workflow_task,
            prepared.to_task_payload(),
            task_id=prepared.job_id,
        )
    else:
        await task_service.fire_and_forget_task(
            execute_board_workflow_prepared,
            prepared,
            task_id=prepared.job_id,
        )
