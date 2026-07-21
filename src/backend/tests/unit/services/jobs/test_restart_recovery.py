from __future__ import annotations

import json
from copy import deepcopy
from uuid import UUID, uuid4

import pytest
from ketos.services.database.models.jobs.model import Job, JobStatus, JobType
from ketos.services.jobs.board_claim import build_board_request_fingerprint
from ketos.services.jobs.board_results import board_execution_from_job
from ketos.services.jobs.recovery import reconcile_board_jobs_after_restart
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession

CURRENT_PID = 222
CURRENT_WORKER = UUID("22222222-2222-2222-2222-222222222222")
PRIOR_WORKER = UUID("11111111-1111-1111-1111-111111111111")


@pytest.fixture(name="job_session")
async def job_session_fixture():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(SQLModel.metadata.create_all)
    async with AsyncSession(engine, expire_on_commit=False) as session:
        yield session
    await engine.dispose()


def _metadata(
    job: Job,
    *,
    schema_version: int,
    origin_pid: int | None = 111,
    worker_id: UUID | None = PRIOR_WORKER,
) -> dict:
    board_id = uuid4()
    mvp = {
        "schema_version": schema_version,
        "kind": "board_automation_run",
        "board_id": str(board_id),
        "flow_id": str(job.flow_id),
        "flow_hash": "a" * 64,
        "request_fingerprint": build_board_request_fingerprint(
            actor_id=job.user_id,
            board_id=board_id,
            flow_id=job.flow_id,
            flow_hash="a" * 64,
            schema_version=schema_version if schema_version in (1, 2) else 2,
        ),
        "policy_version": 1,
        "reason": None,
        "detail": None,
        "result": None,
        "audit": {
            "request_id": str(job.job_id),
            "sequence": 1,
            "duration_ms": None,
            "outcome": "running" if job.status is JobStatus.IN_PROGRESS else "queued",
        },
    }
    if origin_pid is not None:
        mvp["origin_pid"] = origin_pid
    if worker_id is not None:
        mvp["worker_instance_id"] = str(worker_id)
    return {"mvp": mvp}


def _job(*, status: JobStatus = JobStatus.IN_PROGRESS, version: int = 1) -> Job:
    job = Job(
        job_id=uuid4(),
        flow_id=uuid4(),
        user_id=uuid4(),
        type=JobType.WORKFLOW,
        status=status,
    )
    job.job_metadata = _metadata(job, schema_version=version)
    return job


async def test_prior_worker_v1_terminalizes_once_and_projects_recoverable(job_session: AsyncSession) -> None:
    job = _job(version=1)
    job_session.add(job)
    await job_session.commit()

    first = await reconcile_board_jobs_after_restart(
        session=job_session,
        current_worker_instance_id=CURRENT_WORKER,
        current_pid=CURRENT_PID,
    )
    await job_session.refresh(job)
    first_finished = job.finished_timestamp
    first_bytes = json.dumps(job.job_metadata, sort_keys=True)
    second = await reconcile_board_jobs_after_restart(
        session=job_session,
        current_worker_instance_id=CURRENT_WORKER,
        current_pid=CURRENT_PID,
    )
    await job_session.refresh(job)

    assert first.recovered_ids == (job.job_id,)
    assert second.recovered_ids == ()
    assert job.status is JobStatus.FAILED
    assert job.job_metadata["mvp"]["schema_version"] == 2
    assert job.job_metadata["mvp"]["reason"] == "backend_restarted"
    assert job.finished_timestamp == first_finished
    assert json.dumps(job.job_metadata, sort_keys=True) == first_bytes
    dto = board_execution_from_job(job)
    assert (dto.status, dto.reason) == ("failed", "backend_restarted")


async def test_strict_workerless_legacy_v1_recovers_but_ambiguous_legacy_does_not(
    job_session: AsyncSession,
) -> None:
    legacy = _job(version=1)
    legacy.job_metadata = _metadata(legacy, schema_version=1, origin_pid=None, worker_id=None)
    ambiguous = _job(version=1)
    ambiguous.job_metadata = _metadata(ambiguous, schema_version=1, origin_pid=111, worker_id=None)
    ambiguous_before = deepcopy(ambiguous.job_metadata)
    job_session.add(legacy)
    job_session.add(ambiguous)
    await job_session.commit()

    summary = await reconcile_board_jobs_after_restart(
        session=job_session,
        current_worker_instance_id=CURRENT_WORKER,
        current_pid=CURRENT_PID,
    )
    await job_session.refresh(legacy)
    await job_session.refresh(ambiguous)

    assert summary.recovered_ids == (legacy.job_id,)
    assert legacy.status is JobStatus.FAILED
    assert legacy.job_metadata["mvp"]["schema_version"] == 2
    assert "origin_pid" not in legacy.job_metadata["mvp"]
    assert "worker_instance_id" not in legacy.job_metadata["mvp"]
    assert board_execution_from_job(legacy).reason == "backend_restarted"
    assert ambiguous.status is JobStatus.IN_PROGRESS
    assert ambiguous.job_metadata == ambiguous_before


async def test_current_worker_v2_and_terminal_v1_are_byte_immutable(job_session: AsyncSession) -> None:
    current = _job(version=2)
    current.job_metadata = _metadata(current, schema_version=2, origin_pid=CURRENT_PID, worker_id=CURRENT_WORKER)
    terminal = _job(status=JobStatus.COMPLETED, version=1)
    terminal.job_metadata["mvp"]["audit"]["outcome"] = "succeeded"
    before_current = json.dumps(current.job_metadata, sort_keys=True)
    before_terminal = json.dumps(terminal.job_metadata, sort_keys=True)
    job_session.add(current)
    job_session.add(terminal)
    await job_session.commit()

    summary = await reconcile_board_jobs_after_restart(
        session=job_session,
        current_worker_instance_id=CURRENT_WORKER,
        current_pid=CURRENT_PID,
    )

    assert summary.recovered_ids == ()
    assert json.dumps(current.job_metadata, sort_keys=True) == before_current
    assert json.dumps(terminal.job_metadata, sort_keys=True) == before_terminal
    assert terminal.status is JobStatus.COMPLETED


@pytest.mark.parametrize(
    ("origin_pid", "worker_id"),
    [
        (CURRENT_PID, PRIOR_WORKER),
        (111, CURRENT_WORKER),
    ],
)
async def test_current_worker_requires_both_pid_and_instance_identity(
    job_session: AsyncSession,
    origin_pid: int,
    worker_id: UUID,
) -> None:
    mixed = _job(version=2)
    mixed.job_metadata = _metadata(
        mixed,
        schema_version=2,
        origin_pid=origin_pid,
        worker_id=worker_id,
    )
    job_session.add(mixed)
    await job_session.commit()

    summary = await reconcile_board_jobs_after_restart(
        session=job_session,
        current_worker_instance_id=CURRENT_WORKER,
        current_pid=CURRENT_PID,
    )
    await job_session.refresh(mixed)

    assert summary.recovered_ids == (mixed.job_id,)
    assert mixed.status is JobStatus.FAILED
    assert mixed.job_metadata["mvp"]["reason"] == "backend_restarted"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("duration_ms", True),
        ("duration_ms", -1),
        ("sequence", True),
        ("outcome", "completed"),
    ],
)
async def test_ambiguous_workerless_legacy_is_untouched(
    job_session: AsyncSession,
    field: str,
    value: object,
) -> None:
    ambiguous = _job(version=1)
    ambiguous.job_metadata = _metadata(
        ambiguous,
        schema_version=1,
        origin_pid=None,
        worker_id=None,
    )
    ambiguous.job_metadata["mvp"]["audit"][field] = value
    before = deepcopy(ambiguous.job_metadata)
    job_session.add(ambiguous)
    await job_session.commit()

    summary = await reconcile_board_jobs_after_restart(
        session=job_session,
        current_worker_instance_id=CURRENT_WORKER,
        current_pid=CURRENT_PID,
    )
    await job_session.refresh(ambiguous)

    assert summary.recovered_ids == ()
    assert ambiguous.status is JobStatus.IN_PROGRESS
    assert ambiguous.job_metadata == before


async def test_prior_v2_recovers_while_unknown_and_unrelated_rows_are_untouched(
    job_session: AsyncSession,
) -> None:
    prior = _job(version=2)
    unknown = _job(version=3)
    unrelated = _job(version=2)
    unrelated.type = JobType.INGESTION
    unknown_before = deepcopy(unknown.job_metadata)
    unrelated_before = deepcopy(unrelated.job_metadata)
    job_session.add(prior)
    job_session.add(unknown)
    job_session.add(unrelated)
    await job_session.commit()

    summary = await reconcile_board_jobs_after_restart(
        session=job_session,
        current_worker_instance_id=CURRENT_WORKER,
        current_pid=CURRENT_PID,
    )
    await job_session.refresh(prior)

    assert summary.recovered_ids == (prior.job_id,)
    assert prior.status is JobStatus.FAILED
    assert unknown.job_metadata == unknown_before
    assert unrelated.job_metadata == unrelated_before
