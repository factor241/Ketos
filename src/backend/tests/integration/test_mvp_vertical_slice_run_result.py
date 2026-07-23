from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import func
from sqlmodel import select

from ketos.services.board.exceptions import PlacementAlreadyExistsError
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


@pytest.mark.asyncio
@pytest.mark.usefixtures("client")
async def test_run_result_persists_terminal_truth_and_result_placement() -> None:
    actor_id = uuid4()

    async with session_scope() as session:
        user = User(
            id=actor_id,
            username=f"result-{uuid4()}",
            password="x",
            is_active=True,
        )
        session.add(user)
        await session.flush()

        project = Folder(name=f"result-project-{uuid4()}", user_id=actor_id)
        session.add(project)
        await session.flush()

        board = await create_board(
            session,
            project_id=project.id,
            actor_id=actor_id,
            title="Stage 10 run result",
        )

        flow = Flow(
            name=f"result-flow-{uuid4()}",
            user_id=actor_id,
            folder_id=project.id,
            data={"nodes": [], "edges": []},
        )
        session.add(flow)
        await session.commit()

        board_id = board.id
        flow_id = flow.id

    successful_claim = await claim_board_job(
        actor_id=actor_id,
        board_id=board_id,
        flow_id=flow_id,
        idempotency_key="stage10-run-result-success",
        flow_hash="a" * 64,
        policy_version=1,
    )
    assert successful_claim.claimed is True

    successful_replay = await claim_board_job(
        actor_id=actor_id,
        board_id=board_id,
        flow_id=flow_id,
        idempotency_key="stage10-run-result-success",
        flow_hash="a" * 64,
        policy_version=1,
    )
    assert successful_replay.claimed is False
    assert successful_replay.job.job_id == successful_claim.job.job_id

    successful_job_id = successful_claim.job.job_id

    async with session_scope() as session:
        persisted = await session.get(Job, successful_job_id)
        assert persisted is not None
        persisted.status = JobStatus.IN_PROGRESS
        await session.commit()

    completed = await finalize_board_job(
        job_id=successful_job_id,
        terminal_status=JobStatus.COMPLETED,
        result=BoardExecutionResult(kind="text", value="stage10-result"),
        reason=None,
        detail=None,
        duration_ms=17,
    )
    completed_read = board_execution_from_job(completed)

    assert completed_read.status == "succeeded"
    assert completed_read.result is not None
    assert completed_read.result.kind == "text"
    assert completed_read.result.value == "stage10-result"

    geometry = SimpleNamespace(
        x=120.0,
        y=160.0,
        width=320.0,
        height=200.0,
        z_index=1,
    )

    async with session_scope() as session:
        placement = await create_placement(
            session,
            board_id=board_id,
            actor_id=actor_id,
            target_kind=PlacementTargetKind.JOB_RESULT,
            target_id=successful_job_id,
            geometry=geometry,
        )
        placement_id = placement.id
        placement_revision = placement.revision

    async with session_scope() as session:
        with pytest.raises(PlacementAlreadyExistsError):
            await create_placement(
                session,
                board_id=board_id,
                actor_id=actor_id,
                target_kind=PlacementTargetKind.JOB_RESULT,
                target_id=successful_job_id,
                geometry=geometry,
            )

    async with session_scope() as session:
        placement_count = await session.scalar(
            select(func.count())
            .select_from(Placement)
            .where(
                Placement.board_id == board_id,
                Placement.target_kind == PlacementTargetKind.JOB_RESULT,
                Placement.target_id == successful_job_id,
            )
        )
        assert placement_count == 1

        reloaded_success = await session.get(Job, successful_job_id)
        assert reloaded_success is not None
        assert reloaded_success.status == JobStatus.COMPLETED
        reloaded_read = board_execution_from_job(reloaded_success)
        assert reloaded_read.status == "succeeded"
        assert reloaded_read.result is not None
        assert reloaded_read.result.value == "stage10-result"

    async with session_scope() as session:
        await delete_placement_cas(
            session,
            placement_id=placement_id,
            actor_id=actor_id,
            expected_revision=placement_revision,
        )

    async with session_scope() as session:
        assert await session.get(Placement, placement_id) is None
        preserved_job = await session.get(Job, successful_job_id)
        assert preserved_job is not None
        assert preserved_job.status == JobStatus.COMPLETED
        preserved_read = board_execution_from_job(preserved_job)
        assert preserved_read.result is not None
        assert preserved_read.result.value == "stage10-result"

    failed_claim = await claim_board_job(
        actor_id=actor_id,
        board_id=board_id,
        flow_id=flow_id,
        idempotency_key="stage10-run-result-failed",
        flow_hash="a" * 64,
        policy_version=1,
    )
    assert failed_claim.claimed is True

    failed = await finalize_board_job(
        job_id=failed_claim.job.job_id,
        terminal_status=JobStatus.FAILED,
        result=None,
        reason="execution_failed",
        detail="stage10 expected failure",
        duration_ms=9,
    )
    failed_read = board_execution_from_job(failed)

    assert failed_read.status == "failed"
    assert failed_read.reason == "execution_failed"
    assert failed_read.result is None

    async with session_scope() as session:
        reloaded_failed = await session.get(Job, failed_claim.job.job_id)
        assert reloaded_failed is not None
        assert reloaded_failed.status == JobStatus.FAILED

        reloaded_failed_read = board_execution_from_job(reloaded_failed)
        assert reloaded_failed_read.status == "failed"
        assert reloaded_failed_read.reason == "execution_failed"
        assert reloaded_failed_read.result is None

        remaining_result_placements = await session.scalar(
            select(func.count())
            .select_from(Placement)
            .where(
                Placement.target_kind == PlacementTargetKind.JOB_RESULT,
                Placement.target_id.in_(
                    [successful_job_id, failed_claim.job.job_id],
                ),
            )
        )
        assert remaining_result_placements == 0
