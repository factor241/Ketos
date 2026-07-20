"""Characterize the v1 session adapter around the common Stage 07 executor."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from ketos.api.v1 import endpoints
from ketos.api.v1.schemas import SimplifiedAPIRequest
from ketos.services.database.models.flow.model import Flow


@pytest.mark.parametrize("stream", [False, True])
async def test_v1_forwards_session_selected_output_stream_and_trace_identity(
    monkeypatch: pytest.MonkeyPatch,
    stream,
) -> None:
    actor = SimpleNamespace(id=uuid4())
    flow = Flow(
        id=uuid4(),
        name="compatibility flow",
        user_id=actor.id,
        data={"nodes": [], "edges": []},
    )
    request = SimplifiedAPIRequest(
        input_value="hello",
        input_type="text",
        output_type="any",
        output_component="selected-output",
        session_id="caller-session",
        user_id="trace-user",
    )
    preview = SimpleNamespace(vertices=[], tracing_user_id=None)
    prepared = object()
    service = SimpleNamespace(prepare=AsyncMock(return_value=prepared))

    async def execute_prepared(*_args, **_kwargs):
        return [], "effective-session"

    service.execute_prepared = execute_prepared
    job_service = SimpleNamespace(
        create_job=AsyncMock(),
        execute_with_status=AsyncMock(return_value=([], "effective-session")),
    )
    task_service = SimpleNamespace(fire_and_forget_task=AsyncMock())
    monkeypatch.setattr(endpoints, "process_tweaks", lambda data, _tweaks, **_kwargs: data)
    monkeypatch.setattr(endpoints.Graph, "from_payload", lambda *_args, **_kwargs: preview)
    monkeypatch.setattr(endpoints, "get_job_service", lambda: job_service)
    monkeypatch.setattr(endpoints, "get_task_service", lambda: task_service)
    monkeypatch.setattr(endpoints, "get_memory_base_service", lambda: SimpleNamespace(on_flow_output=object()))

    def service_factory(*, runner):
        assert runner is endpoints.run_graph_internal
        return service

    monkeypatch.setattr(endpoints, "WorkflowExecutionService", service_factory)

    response = await endpoints.simple_run_flow(flow, request, stream=stream, api_key_user=actor)

    assert response.session_id == "effective-session"
    kwargs = service.prepare.await_args.kwargs
    assert kwargs["session_id"] == "caller-session"
    assert kwargs["stream"] is stream
    assert kwargs["outputs"] == ["selected-output"]
    assert kwargs["inputs"][0].input_value == "hello"
    assert kwargs["inputs"][0].type == "text"
    assert kwargs["tracing_user_id"] == "trace-user"
    assert preview.tracing_user_id == "trace-user"
    job_service.execute_with_status.assert_awaited_once()
