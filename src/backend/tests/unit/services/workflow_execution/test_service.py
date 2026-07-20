"""Immutable shared workflow execution service characterization."""

# ruff: noqa: INP001, PT018

from __future__ import annotations

import json
from dataclasses import fields, replace
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from ketos.services.workflow_execution.service import (
    PreparedWorkflowExecution,
    WorkflowExecutionIntegrityError,
    WorkflowExecutionService,
)
from kfx.schema.schema import InputValueRequest


class FakeGraph:
    def __init__(self, payload, *, flow_id, user_id, flow_name, context):
        self.payload = payload
        self.flow_id = flow_id
        self.user_id = user_id
        self.flow_name = flow_name
        self.context = context
        self.run_id = None
        self.tracing_user_id = None

    def get_terminal_nodes(self):
        return list(self.payload["terminal_ids"])

    def set_run_id(self, run_id):
        self.run_id = str(run_id)


class FakeGraphFactory:
    def __init__(self):
        self.graphs: list[FakeGraph] = []

    def __call__(self, payload, **kwargs):
        graph = FakeGraph(payload, **kwargs)
        self.graphs.append(graph)
        return graph


def _flow():
    return SimpleNamespace(
        id=uuid4(),
        user_id=uuid4(),
        name="Frozen flow",
        data={"terminal_ids": ["output-b", "output-a"], "nested": {"value": 1}},
    )


async def test_prepare_contains_only_immutable_snapshots_and_normalizes_none_input() -> None:
    flow = _flow()
    factory = FakeGraphFactory()
    service = WorkflowExecutionService(graph_factory=factory)
    components = ["input-a"]
    inputs = [
        InputValueRequest(
            components=components,
            input_value=None,
            session="input-session",
            type="chat",
            client_request_time=123,
        )
    ]
    outputs = ["output-a"]
    request_variables = {"locale": "ru"}
    job_id = uuid4()

    prepared = await service.prepare(
        flow=flow,
        actor_id=flow.user_id,
        job_id=job_id,
        mode="v1_board",
        inputs=inputs,
        outputs=outputs,
        stream=False,
        session_id="caller-session-is-ignored",
        request_variables=request_variables,
    )
    before = prepared
    components.append("mutated")
    inputs[0].input_value = "mutated"
    outputs.append("mutated")
    request_variables["locale"] = "en"
    flow.data["nested"]["value"] = 999

    assert prepared == before
    assert prepared.inputs[0].components == ("input-a",)
    assert prepared.inputs[0].input_value == ""
    assert prepared.outputs == ("output-a",)
    assert prepared.terminal_node_ids == ("output-b", "output-a")
    assert prepared.session_id == str(job_id)
    assert json.loads(prepared.graph_payload_json)["nested"]["value"] == 1
    assert json.loads(prepared.graph_context_json)["request_variables"] == {"locale": "ru"}
    assert all(not isinstance(getattr(prepared, field.name), (dict, list, FakeGraph)) for field in fields(prepared))


async def test_materialize_returns_fresh_runtime_objects_and_rechecks_hash() -> None:
    flow = _flow()
    factory = FakeGraphFactory()
    service = WorkflowExecutionService(graph_factory=factory)
    prepared = await service.prepare(
        flow=flow,
        actor_id=flow.user_id,
        job_id=uuid4(),
        mode="v1_session",
        inputs=[InputValueRequest(components=["in"], input_value="hello", type="text")],
        outputs=["output-a"],
        stream=True,
        session_id=None,
        request_variables=None,
    )

    graph1, inputs1, outputs1 = service._materialize(prepared)
    graph1.payload["nested"]["value"] = 999
    inputs1[0].components.append("mutated")
    outputs1.append("mutated")
    graph2, inputs2, outputs2 = service._materialize(prepared)

    assert graph1 is not graph2
    assert inputs1 is not inputs2 and inputs1[0] is not inputs2[0]
    assert outputs1 is not outputs2
    assert graph2.payload["nested"]["value"] == 1
    assert inputs2[0].components == ["in"]
    assert outputs2 == ["output-a"]
    assert graph2.run_id == str(prepared.job_id)
    with pytest.raises(WorkflowExecutionIntegrityError):
        service._materialize(replace(prepared, graph_payload_json='{"tampered":true}'))


async def test_execute_forwards_exact_fields_once_and_preserves_snapshot_after_runtime_mutation() -> None:
    flow = _flow()
    factory = FakeGraphFactory()
    calls = []

    async def runner(**kwargs):
        calls.append(kwargs)
        kwargs["graph"].payload["nested"]["value"] = 7
        kwargs["inputs"][0].input_value = "runtime-mutated"
        kwargs["outputs"].append("runtime-mutated")
        return ["result"], "effective-session"

    service = WorkflowExecutionService(graph_factory=factory, runner=runner)
    prepared = await service.prepare(
        flow=flow,
        actor_id=flow.user_id,
        job_id=uuid4(),
        mode="v2_developer",
        inputs=[InputValueRequest(components=["in"], input_value="hello", type="chat")],
        outputs=["output-a"],
        stream=False,
        session_id="caller-session",
        request_variables={"key": "value"},
        tracing_user_id="external-trace-user",
    )
    snapshot = prepared
    event_manager = object()

    result = await service.execute_prepared(prepared, event_manager=event_manager)

    assert result == (["result"], "effective-session")
    assert len(calls) == 1
    assert calls[0]["flow_id"] == str(flow.id)
    assert calls[0]["stream"] is False
    assert calls[0]["session_id"] == "caller-session"
    assert calls[0]["event_manager"] is event_manager
    assert calls[0]["graph"].tracing_user_id == "external-trace-user"
    assert prepared == snapshot
    assert prepared.inputs[0].input_value == "hello"
    assert prepared.outputs == ("output-a",)


async def test_task_payload_round_trip_preserves_every_frozen_field() -> None:
    flow = _flow()
    service = WorkflowExecutionService(graph_factory=FakeGraphFactory())
    prepared = await service.prepare(
        flow=flow,
        actor_id=flow.user_id,
        job_id=uuid4(),
        mode="v1_board",
        inputs=[InputValueRequest(components=["in"], input_value="hello", type="chat")],
        outputs=["output-a"],
        stream=False,
        session_id=None,
        request_variables={"locale": "ru"},
        tracing_user_id="trace-user",
    )

    primitive = json.loads(json.dumps(prepared.to_task_payload()))

    assert PreparedWorkflowExecution.from_task_payload(primitive) == prepared


async def test_terminal_conflict_is_a_benign_lost_race_without_failed_refinalization(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from ketos.services.jobs import board_finalize, board_results
    from ketos.services.jobs.board_finalize import TerminalJobConflict
    from ketos.services.workflow_execution import service as service_module

    prepared = SimpleNamespace(mode="v1_board", job_id=uuid4(), terminal_node_ids=("out",))
    executor = SimpleNamespace(execute_prepared=AsyncMock(return_value=(["value"], "session")))
    finalize = AsyncMock(side_effect=TerminalJobConflict("cancel won"))
    monkeypatch.setattr(service_module, "_claim_execution_start", AsyncMock(return_value=True))
    monkeypatch.setattr(service_module, "WorkflowExecutionService", lambda: executor)
    monkeypatch.setattr(board_results, "sanitize_board_result", lambda *_args, **_kwargs: {"text": "value"})
    monkeypatch.setattr(board_finalize, "finalize_board_job", finalize)

    await service_module.execute_board_workflow_prepared(prepared)

    executor.execute_prepared.assert_awaited_once_with(prepared)
    finalize.assert_awaited_once()


@pytest.mark.parametrize("mode", ["v1_session", "v2_developer"])
async def test_non_board_modes_preserve_absent_caller_session(mode: str) -> None:
    flow = _flow()
    service = WorkflowExecutionService(graph_factory=FakeGraphFactory())

    prepared = await service.prepare(
        flow=flow,
        actor_id=flow.user_id,
        job_id=uuid4(),
        mode=mode,
        inputs=None,
        outputs=None,
        stream=False,
        session_id=None,
        request_variables=None,
    )

    assert isinstance(prepared, PreparedWorkflowExecution)
    assert prepared.session_id is None
