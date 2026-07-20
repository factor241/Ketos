"""Focused contract tests for the unregistered Stage 07 Board run router."""

# ruff: noqa: EM101, TRY003

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from ketos.api.v1 import board_automation_runs as routes
from ketos.services.board.service import BoardNotFoundError
from ketos.services.database.models.jobs.model import JobStatus
from ketos.services.jobs.board_claim import BoardJobClaim, canonical_graph_payload, derive_board_job_id
from ketos.services.jobs.board_contracts import BoardAutomationRunRequest


def _user():
    return SimpleNamespace(id=uuid4())


def _flow():
    return SimpleNamespace(id=uuid4(), name="Board flow", data={"nodes": [], "edges": []})


async def test_scope_hides_missing_and_foreign_board_with_same_404(monkeypatch: pytest.MonkeyPatch) -> None:
    async def missing(*_args, **_kwargs):
        raise BoardNotFoundError

    monkeypatch.setattr(routes, "_require_feature", lambda: None)
    monkeypatch.setattr(routes, "get_owned_board", missing)

    with pytest.raises(HTTPException) as exc_info:
        await routes._require_scope(object(), board_id=uuid4(), flow_id=uuid4(), actor_id=uuid4())

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == {"code": "board_run_not_found"}


async def test_same_key_replay_returns_job_without_materialization_or_enqueue(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = _user()
    flow = _flow()
    board_id = uuid4()
    payload = BoardAutomationRunRequest(idempotency_key=str(uuid4()))
    job_id = derive_board_job_id(
        actor_id=user.id,
        board_id=board_id,
        flow_id=flow.id,
        idempotency_key=payload.idempotency_key,
    )
    job = SimpleNamespace(job_id=job_id)
    monkeypatch.setattr(routes, "_require_scope", AsyncMock(return_value=(object(), flow)))
    monkeypatch.setattr(routes, "validate_board_run_flow", lambda _data: None)
    monkeypatch.setattr(routes, "claim_board_job", AsyncMock(return_value=BoardJobClaim(job=job, claimed=False)))
    monkeypatch.setattr(routes, "board_execution_from_job", lambda value: value)

    class MustNotMaterialize:
        def __init__(self):
            pytest.fail("replay must not construct the execution service")

    monkeypatch.setattr(routes, "WorkflowExecutionService", MustNotMaterialize)

    result = await routes.create_board_automation_run(board_id, flow.id, payload, object(), user)

    assert result is job


async def test_new_claim_prepares_once_and_enqueues_once(monkeypatch: pytest.MonkeyPatch) -> None:
    user = _user()
    flow = _flow()
    board_id = uuid4()
    payload = BoardAutomationRunRequest(idempotency_key=str(uuid4()))
    job_id = derive_board_job_id(
        actor_id=user.id,
        board_id=board_id,
        flow_id=flow.id,
        idempotency_key=payload.idempotency_key,
    )
    _payload_json, flow_hash = canonical_graph_payload(flow.data)
    job = SimpleNamespace(job_id=job_id)
    prepared = SimpleNamespace(job_id=job_id, flow_hash=flow_hash)
    service = SimpleNamespace(prepare=AsyncMock(return_value=prepared), enqueue_board_job=AsyncMock())
    monkeypatch.setattr(routes, "_require_scope", AsyncMock(return_value=(object(), flow)))
    monkeypatch.setattr(routes, "validate_board_run_flow", lambda _data: None)
    monkeypatch.setattr(routes, "claim_board_job", AsyncMock(return_value=BoardJobClaim(job=job, claimed=True)))
    monkeypatch.setattr(routes, "WorkflowExecutionService", lambda: service)
    monkeypatch.setattr(routes, "board_execution_from_job", lambda value: value)

    result = await routes.create_board_automation_run(board_id, flow.id, payload, object(), user)

    assert result is job
    service.prepare.assert_awaited_once()
    service.enqueue_board_job.assert_awaited_once_with(prepared)


async def test_cancel_persists_before_best_effort_revoke(monkeypatch: pytest.MonkeyPatch) -> None:
    user = _user()
    flow_id = uuid4()
    board_id = uuid4()
    job_id = uuid4()
    job = SimpleNamespace(status=JobStatus.IN_PROGRESS)
    cancelled = SimpleNamespace(status=JobStatus.CANCELLED)
    order: list[str] = []

    async def finalize(**_kwargs):
        order.append("finalize")
        return cancelled

    async def revoke(_job_id):
        order.append("revoke")
        raise RuntimeError("backend unavailable")

    monkeypatch.setattr(routes, "_require_scope", AsyncMock())
    monkeypatch.setattr(routes, "_get_scoped_job", AsyncMock(return_value=job))
    monkeypatch.setattr(routes, "finalize_board_job", finalize)
    monkeypatch.setattr(routes, "get_task_service", lambda: SimpleNamespace(revoke_task=revoke))
    monkeypatch.setattr(
        routes,
        "board_execution_from_job",
        lambda value: SimpleNamespace(reason=None) if value is job else "cancelled-dto",
    )

    result = await routes.cancel_board_automation_run(board_id, flow_id, job_id, object(), user)

    assert result == "cancelled-dto"
    assert order == ["finalize", "revoke"]


async def test_list_statement_contains_all_owner_scope_predicates(monkeypatch: pytest.MonkeyPatch) -> None:
    user = _user()
    captured = SimpleNamespace(statement=None)

    class EmptyResult:
        def all(self):
            return []

    class Session:
        async def exec(self, statement):
            captured.statement = statement
            return EmptyResult()

    monkeypatch.setattr(routes, "_require_scope", AsyncMock())

    result = await routes.list_board_automation_runs(uuid4(), uuid4(), Session(), user)
    sql = str(captured.statement)

    assert result == []
    assert "job.user_id" in sql
    assert "job.flow_id" in sql
    assert "job.type" in sql
    assert "job.job_metadata" in sql
