"""Stage 07 Result Placement validation matrix."""

# ruff: noqa: S106

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from ketos.services.board.exceptions import (
    BoardResourceNotFoundError,
    PlacementAlreadyExistsError,
    TargetKindNotAvailableError,
    TargetProjectMismatchError,
)
from ketos.services.board.placement_service import create_placement, delete_placement_cas
from ketos.services.board.service import create_board
from ketos.services.database.models.flow.model import Flow
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.jobs.model import Job, JobStatus
from ketos.services.database.models.placement.model import Placement, PlacementTargetKind
from ketos.services.database.models.user.model import User
from ketos.services.deps import session_scope
from ketos.services.jobs.board_claim import claim_board_job
from ketos.services.jobs.board_contracts import BoardExecutionResult
from ketos.services.jobs.board_finalize import finalize_board_job
from ketos.services.jobs.board_results import board_execution_from_job

pytestmark = pytest.mark.usefixtures("client")


def _geometry() -> SimpleNamespace:
    return SimpleNamespace(x=10.0, y=20.0, width=360.0, height=240.0, z_index=1)


async def _project(user_id, name: str) -> Folder:
    async with session_scope() as session:
        value = Folder(name=f"{name}-{uuid4()}", user_id=user_id)
        session.add(value)
        await session.commit()
        await session.refresh(value)
        return value


async def _board(project_id, actor_id):
    async with session_scope() as session:
        return await create_board(session, project_id=project_id, actor_id=actor_id, title="Results")


async def _flow(project_id, actor_id) -> Flow:
    async with session_scope() as session:
        value = Flow(
            name=f"Result flow {uuid4()}",
            user_id=actor_id,
            folder_id=project_id,
            data={"nodes": [], "edges": []},
        )
        session.add(value)
        await session.commit()
        await session.refresh(value)
        return value


async def _user() -> User:
    async with session_scope() as session:
        value = User(username=f"result-{uuid4()}", password="x", is_active=True)
        session.add(value)
        await session.commit()
        await session.refresh(value)
        return value


async def _job(*, actor_id, board_id, flow_id, status: JobStatus = JobStatus.QUEUED) -> Job:
    claim = await claim_board_job(
        actor_id=actor_id,
        board_id=board_id,
        flow_id=flow_id,
        idempotency_key=str(uuid4()),
        flow_hash="a" * 64,
        policy_version=1,
    )
    if status is JobStatus.QUEUED:
        return claim.job
    async with session_scope() as session:
        persisted = await session.get(Job, claim.job.job_id)
        persisted.status = JobStatus.IN_PROGRESS
        await session.commit()
    reason = {
        JobStatus.COMPLETED: None,
        JobStatus.FAILED: "execution_failed",
        JobStatus.TIMED_OUT: "timed_out",
        JobStatus.CANCELLED: "user_cancelled",
    }[status]
    return await finalize_board_job(
        job_id=claim.job.job_id,
        terminal_status=status,
        result=BoardExecutionResult(kind="text", value="safe result") if status is JobStatus.COMPLETED else None,
        reason=reason,
        detail="raw secret must not survive",
        duration_ms=7,
    )


async def _place(*, board_id, actor_id, job_id) -> Placement:
    async with session_scope() as session:
        return await create_placement(
            session,
            board_id=board_id,
            actor_id=actor_id,
            target_kind=PlacementTargetKind.JOB_RESULT,
            target_id=job_id,
            geometry=_geometry(),
        )


@pytest.mark.parametrize(
    "terminal_status",
    [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.TIMED_OUT, JobStatus.CANCELLED],
)
async def test_every_authoritative_terminal_job_can_be_placed(active_user, terminal_status: JobStatus) -> None:
    project = await _project(active_user.id, "terminal")
    board = await _board(project.id, active_user.id)
    flow = await _flow(project.id, active_user.id)
    job = await _job(actor_id=active_user.id, board_id=board.id, flow_id=flow.id, status=terminal_status)

    placement = await _place(board_id=board.id, actor_id=active_user.id, job_id=job.job_id)
    dto = board_execution_from_job(job)

    assert placement.target_kind is PlacementTargetKind.JOB_RESULT
    assert placement.target_id == job.job_id
    assert dto.status in {"succeeded", "failed", "cancelled"}
    assert "raw secret" not in (dto.reason or "")


@pytest.mark.parametrize("active_status", [JobStatus.QUEUED, JobStatus.IN_PROGRESS])
async def test_active_job_cannot_be_placed(active_user, active_status: JobStatus) -> None:
    project = await _project(active_user.id, "active")
    board = await _board(project.id, active_user.id)
    flow = await _flow(project.id, active_user.id)
    job = await _job(actor_id=active_user.id, board_id=board.id, flow_id=flow.id)
    if active_status is JobStatus.IN_PROGRESS:
        async with session_scope() as session:
            persisted = await session.get(Job, job.job_id)
            persisted.status = JobStatus.IN_PROGRESS
            await session.commit()

    with pytest.raises(TargetKindNotAvailableError):
        await _place(board_id=board.id, actor_id=active_user.id, job_id=job.job_id)


async def test_foreign_and_null_owner_jobs_are_hidden(active_user) -> None:
    foreign = await _user()
    project = await _project(active_user.id, "owner")
    board = await _board(project.id, active_user.id)
    flow = await _flow(project.id, active_user.id)
    foreign_job = await _job(actor_id=foreign.id, board_id=board.id, flow_id=flow.id, status=JobStatus.FAILED)
    null_job = await _job(actor_id=active_user.id, board_id=board.id, flow_id=flow.id, status=JobStatus.FAILED)
    async with session_scope() as session:
        persisted = await session.get(Job, null_job.job_id)
        persisted.user_id = None
        await session.commit()

    for job_id in (foreign_job.job_id, null_job.job_id, uuid4()):
        with pytest.raises(BoardResourceNotFoundError):
            await _place(board_id=board.id, actor_id=active_user.id, job_id=job_id)


async def test_wrong_board_and_wrong_project_are_rejected(active_user) -> None:
    project = await _project(active_user.id, "board")
    other_project = await _project(active_user.id, "other")
    board = await _board(project.id, active_user.id)
    other_board = await _board(project.id, active_user.id)
    same_project_flow = await _flow(project.id, active_user.id)
    other_project_flow = await _flow(other_project.id, active_user.id)
    wrong_board_job = await _job(
        actor_id=active_user.id,
        board_id=other_board.id,
        flow_id=same_project_flow.id,
        status=JobStatus.FAILED,
    )
    wrong_project_job = await _job(
        actor_id=active_user.id,
        board_id=board.id,
        flow_id=other_project_flow.id,
        status=JobStatus.FAILED,
    )

    for job_id in (wrong_board_job.job_id, wrong_project_job.job_id):
        with pytest.raises(TargetProjectMismatchError):
            await _place(board_id=board.id, actor_id=active_user.id, job_id=job_id)


async def test_malformed_or_wrong_flow_metadata_is_hidden(active_user) -> None:
    project = await _project(active_user.id, "metadata")
    board = await _board(project.id, active_user.id)
    flow = await _flow(project.id, active_user.id)
    job = await _job(actor_id=active_user.id, board_id=board.id, flow_id=flow.id, status=JobStatus.FAILED)
    async with session_scope() as session:
        persisted = await session.get(Job, job.job_id)
        persisted.job_metadata = {"mvp": {"flow_id": str(uuid4())}}
        await session.commit()

    with pytest.raises(BoardResourceNotFoundError):
        await _place(board_id=board.id, actor_id=active_user.id, job_id=job.job_id)


async def test_unique_result_target_and_close_preserve_job(active_user) -> None:
    project = await _project(active_user.id, "unique")
    board = await _board(project.id, active_user.id)
    flow = await _flow(project.id, active_user.id)
    job = await _job(actor_id=active_user.id, board_id=board.id, flow_id=flow.id, status=JobStatus.COMPLETED)
    placement = await _place(board_id=board.id, actor_id=active_user.id, job_id=job.job_id)

    with pytest.raises(PlacementAlreadyExistsError):
        await _place(board_id=board.id, actor_id=active_user.id, job_id=job.job_id)
    async with session_scope() as session:
        await delete_placement_cas(
            session,
            placement_id=placement.id,
            actor_id=active_user.id,
            expected_revision=placement.revision,
        )
    async with session_scope() as session:
        assert await session.get(Placement, placement.id) is None
        assert await session.get(Job, job.job_id) is not None
