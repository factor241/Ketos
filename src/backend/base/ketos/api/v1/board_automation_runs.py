"""Session-authenticated Stage 07 Board workflow execution facade."""

from __future__ import annotations

from contextlib import suppress
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import desc
from sqlmodel import select

from ketos.api.utils import CurrentActiveUser, DbSession
from ketos.services.board.exceptions import BoardResourceNotFoundError
from ketos.services.board.service import BoardNotFoundError, get_owned_board, validate_automation_target
from ketos.services.database.models.jobs.model import Job, JobStatus, JobType
from ketos.services.deps import get_settings_service, get_task_service
from ketos.services.jobs.board_claim import (
    BoardJobConflict,
    canonical_graph_payload,
    claim_board_job,
    derive_board_job_id,
)
from ketos.services.jobs.board_contracts import BoardAutomationRunRequest, BoardExecutionRead
from ketos.services.jobs.board_finalize import TerminalJobConflict, finalize_board_job
from ketos.services.jobs.board_results import BoardResultMetadataError, board_execution_from_job
from ketos.services.workflow_execution.policy import (
    BOARD_RUN_POLICY_VERSION,
    BoardRunPolicyViolation,
    validate_board_run_flow,
)
from ketos.services.workflow_execution.service import WorkflowExecutionService

router = APIRouter(
    prefix="/boards/{board_id}/automations/{flow_id}/runs",
    tags=["Board automation runs"],
)
_TERMINAL = frozenset({JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.TIMED_OUT, JobStatus.CANCELLED})


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "board_run_not_found"})


def _conflict() -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": "board_run_conflict"})


def _require_feature() -> None:
    if not get_settings_service().settings.agentic_experience:
        raise _not_found()


async def _require_scope(session: Any, *, board_id: UUID, flow_id: UUID, actor_id: UUID):
    _require_feature()
    try:
        board = await get_owned_board(session, board_id=board_id, actor_id=actor_id)
        flow = await validate_automation_target(
            session,
            board=board,
            flow_id=flow_id,
            actor_id=actor_id,
        )
    except (BoardNotFoundError, BoardResourceNotFoundError) as exc:
        raise _not_found() from exc
    return board, flow


def _metadata_board_predicate(board_id: UUID):
    metadata = Job.__table__.c.job_metadata
    return metadata["mvp"]["board_id"].as_string() == str(board_id)


async def _get_scoped_job(
    session: Any,
    *,
    job_id: UUID,
    board_id: UUID,
    flow_id: UUID,
    actor_id: UUID,
) -> Job:
    result = await session.exec(
        select(Job).where(
            Job.job_id == job_id,
            Job.user_id == actor_id,
            Job.flow_id == flow_id,
            Job.type == JobType.WORKFLOW,
            _metadata_board_predicate(board_id),
        )
    )
    job = result.first()
    if job is None:
        raise _not_found()
    try:
        dto = board_execution_from_job(job)
    except BoardResultMetadataError as exc:
        raise _not_found() from exc
    if dto.board_id != board_id:
        raise _not_found()
    return job


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def create_board_automation_run(
    board_id: UUID,
    flow_id: UUID,
    payload: BoardAutomationRunRequest,
    session: DbSession,
    current_user: CurrentActiveUser,
) -> BoardExecutionRead:
    _board, flow = await _require_scope(
        session,
        board_id=board_id,
        flow_id=flow_id,
        actor_id=current_user.id,
    )
    try:
        validate_board_run_flow(flow.data)
    except BoardRunPolicyViolation as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "board_run_policy_rejected"},
        ) from exc

    expected_job_id = derive_board_job_id(
        actor_id=current_user.id,
        board_id=board_id,
        flow_id=flow_id,
        idempotency_key=payload.idempotency_key,
    )
    _flow_json, flow_hash = canonical_graph_payload(flow.data)
    try:
        claim = await claim_board_job(
            actor_id=current_user.id,
            board_id=board_id,
            flow_id=flow_id,
            idempotency_key=payload.idempotency_key,
            flow_hash=flow_hash,
            policy_version=BOARD_RUN_POLICY_VERSION,
        )
    except BoardJobConflict as exc:
        raise _conflict() from exc
    if claim.job.job_id != expected_job_id:
        raise _conflict()
    if claim.claimed:
        service = WorkflowExecutionService()
        prepared = await service.prepare(
            flow=flow,
            actor_id=current_user.id,
            job_id=expected_job_id,
            mode="v1_board",
            inputs=None,
            outputs=None,
            stream=False,
            session_id=None,
            request_variables=None,
        )
        if prepared.flow_hash != flow_hash:
            raise _conflict()
        try:
            await service.enqueue_board_job(prepared)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={"code": "board_run_enqueue_failed"},
            ) from exc
    return board_execution_from_job(claim.job)


@router.get("")
async def list_board_automation_runs(
    board_id: UUID,
    flow_id: UUID,
    session: DbSession,
    current_user: CurrentActiveUser,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> list[BoardExecutionRead]:
    await _require_scope(session, board_id=board_id, flow_id=flow_id, actor_id=current_user.id)
    result = await session.exec(
        select(Job)
        .where(
            Job.user_id == current_user.id,
            Job.flow_id == flow_id,
            Job.type == JobType.WORKFLOW,
            _metadata_board_predicate(board_id),
        )
        .order_by(desc(Job.created_timestamp), desc(Job.job_id))
        .limit(limit)
    )
    jobs = list(result.all())
    try:
        return [board_execution_from_job(job) for job in jobs]
    except BoardResultMetadataError as exc:
        raise _not_found() from exc


@router.get("/{job_id}")
async def get_board_automation_run(
    board_id: UUID,
    flow_id: UUID,
    job_id: UUID,
    session: DbSession,
    current_user: CurrentActiveUser,
) -> BoardExecutionRead:
    await _require_scope(session, board_id=board_id, flow_id=flow_id, actor_id=current_user.id)
    job = await _get_scoped_job(
        session,
        job_id=job_id,
        board_id=board_id,
        flow_id=flow_id,
        actor_id=current_user.id,
    )
    return board_execution_from_job(job)


@router.post("/{job_id}/cancel")
async def cancel_board_automation_run(
    board_id: UUID,
    flow_id: UUID,
    job_id: UUID,
    session: DbSession,
    current_user: CurrentActiveUser,
) -> BoardExecutionRead:
    await _require_scope(session, board_id=board_id, flow_id=flow_id, actor_id=current_user.id)
    job = await _get_scoped_job(
        session,
        job_id=job_id,
        board_id=board_id,
        flow_id=flow_id,
        actor_id=current_user.id,
    )
    existing = board_execution_from_job(job)
    if job.status is JobStatus.CANCELLED and existing.reason == "user_cancelled":
        return existing
    if job.status in _TERMINAL:
        raise _conflict()
    try:
        cancelled = await finalize_board_job(
            job_id=job_id,
            terminal_status=JobStatus.CANCELLED,
            result=None,
            reason="user_cancelled",
            detail=None,
            duration_ms=0,
        )
    except TerminalJobConflict as exc:
        raise _conflict() from exc
    with suppress(Exception):  # persisted cancellation remains authoritative
        await get_task_service().revoke_task(job_id)
    return board_execution_from_job(cancelled)
