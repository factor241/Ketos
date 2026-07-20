"""Regression coverage for the Stage 01 fail-closed Job ownership floor."""

from __future__ import annotations

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from httpx import AsyncClient
from ketos.services.database.models.jobs import crud as job_crud
from ketos.services.database.models.jobs.model import Job, JobStatus, JobType
from ketos.services.jobs.service import JobService
from kfx.services.deps import session_scope


@asynccontextmanager
async def _session_scope(session):
    yield session


def _capture_session(*jobs: Job):
    result = MagicMock()
    result.all.return_value = jobs
    result.first.return_value = jobs[0] if jobs else None
    session = MagicMock()
    session.exec = AsyncMock(return_value=result)
    session.add = MagicMock()
    session.flush = AsyncMock()
    return session


def _statement(session) -> str:
    return str(session.exec.await_args.args[0])


def _where_clause(session) -> str:
    return _statement(session).partition("WHERE")[2]


@pytest.mark.asyncio
async def test_list_jobs_limits_user_authorized_results_to_exact_owner_and_canonical_timestamp(monkeypatch):
    """A user-scoped list neither includes legacy NULL rows nor uses created_at."""
    owner_id, flow_id = uuid4(), uuid4()
    owner_job = Job(job_id=uuid4(), flow_id=flow_id, user_id=owner_id)
    session = _capture_session(owner_job)
    monkeypatch.setattr("ketos.services.jobs.service.session_scope", lambda: _session_scope(session))

    jobs = await JobService().get_jobs_by_flow_id(flow_id, user_id=owner_id)

    assert jobs == [owner_job]
    where_clause = _where_clause(session)
    assert "job.user_id IS NULL" not in where_clause
    assert "job.user_id =" in where_clause
    assert "ORDER BY job.created_timestamp DESC" in _statement(session)


@pytest.mark.asyncio
async def test_get_job_limits_user_authorized_result_to_exact_owner(monkeypatch):
    """A user-scoped get must not match a legacy NULL-owned row."""
    owner_id, flow_id, job_id = uuid4(), uuid4(), uuid4()
    owner_job = Job(job_id=job_id, flow_id=flow_id, user_id=owner_id)
    session = _capture_session(owner_job)
    monkeypatch.setattr("ketos.services.jobs.service.session_scope", lambda: _session_scope(session))

    job = await JobService().get_job_by_job_id(job_id, user_id=owner_id)

    assert job is owner_job
    statement = _where_clause(session)
    assert "job.user_id IS NULL" not in statement
    assert "job.user_id =" in statement


@pytest.mark.asyncio
async def test_get_job_without_user_context_remains_a_distinct_internal_path(monkeypatch):
    """System callers can inspect a job without pretending to be a user."""
    flow_id, job_id = uuid4(), uuid4()
    system_job = Job(job_id=job_id, flow_id=flow_id, user_id=None)
    session = _capture_session(system_job)
    monkeypatch.setattr("ketos.services.jobs.service.session_scope", lambda: _session_scope(session))

    job = await JobService().get_job_by_job_id_internal(job_id)

    assert job is system_job
    assert "job.user_id" not in _where_clause(session)


@pytest.mark.asyncio
async def test_protected_get_cannot_be_called_without_owner_context():
    """Forgetting owner context must fail before any persistence access."""
    with pytest.raises(TypeError, match="user_id"):
        await JobService().get_job_by_job_id(uuid4())  # type: ignore[call-arg]


@pytest.mark.asyncio
async def test_protected_cancel_cannot_be_called_without_owner_context():
    """The protected cancellation API has no unscoped default branch."""
    with pytest.raises(TypeError, match="user_id"):
        await JobService().cancel_in_flight_jobs_by_asset(  # type: ignore[call-arg]
            uuid4(),
            "knowledge_base",
        )


def test_job_crud_exposes_distinct_owned_and_internal_lookup_helpers():
    """Persistence helpers make authorization context explicit at the call site."""
    assert callable(getattr(job_crud, "get_owned_job_by_job_id", None))
    assert callable(getattr(job_crud, "get_job_by_job_id_internal", None))


@pytest.mark.asyncio
async def test_job_crud_list_requires_exact_owner_and_canonical_timestamp():
    """The persistence-level protected list is exact-owner and canonically ordered."""
    owner_id, flow_id = uuid4(), uuid4()
    owner_job = Job(job_id=uuid4(), flow_id=flow_id, user_id=owner_id)
    session = _capture_session(owner_job)

    jobs = await job_crud.get_jobs_by_flow_id(session, flow_id, owner_id)

    assert jobs == [owner_job]
    where_clause = _where_clause(session)
    assert "job.user_id IS NULL" not in where_clause
    assert "job.user_id =" in where_clause
    assert "ORDER BY job.created_timestamp DESC" in _statement(session)


@pytest.mark.asyncio
async def test_job_crud_owned_lookup_requires_exact_owner():
    """The persistence-level protected lookup cannot match a NULL owner."""
    owner_id, flow_id, job_id = uuid4(), uuid4(), uuid4()
    owner_job = Job(job_id=job_id, flow_id=flow_id, user_id=owner_id)
    session = _capture_session(owner_job)

    job = await job_crud.get_owned_job_by_job_id(session, job_id, owner_id)

    assert job is owner_job
    where_clause = _where_clause(session)
    assert "job.user_id IS NULL" not in where_clause
    assert "job.user_id =" in where_clause


@pytest.mark.asyncio
async def test_get_owned_job_uses_the_exact_owner_query(monkeypatch):
    """The named protected lookup cannot adopt a legacy NULL-owned row."""
    owner_id, flow_id, job_id = uuid4(), uuid4(), uuid4()
    owner_job = Job(job_id=job_id, flow_id=flow_id, user_id=owner_id)
    session = _capture_session(owner_job)
    monkeypatch.setattr("ketos.services.jobs.service.session_scope", lambda: _session_scope(session))

    job = await JobService().get_owned_job(job_id, user_id=owner_id)

    assert job is owner_job
    where_clause = _where_clause(session)
    assert "job.user_id IS NULL" not in where_clause
    assert "job.user_id =" in where_clause


@pytest.mark.asyncio
@pytest.mark.parametrize("job_owner", [pytest.param(None, id="null-owner"), pytest.param(uuid4(), id="foreign-owner")])
async def test_validate_ownership_rejects_null_and_foreign_owner(job_owner, monkeypatch):
    """Protected mutation preflight is fail-closed for NULL and foreign rows."""
    actor_id, job_id = uuid4(), uuid4()
    service = JobService()
    monkeypatch.setattr(service, "get_owned_job", AsyncMock(return_value=None))

    with pytest.raises(ValueError, match="not found"):
        await service._validate_ownership(job_id, actor_id)


@pytest.mark.asyncio
async def test_validate_ownership_allows_exact_owner(monkeypatch):
    """The exact owner remains authorized for protected job operations."""
    actor_id, job_id, flow_id = uuid4(), uuid4(), uuid4()
    job = Job(job_id=job_id, flow_id=flow_id, user_id=actor_id)
    service = JobService()
    monkeypatch.setattr(service, "get_owned_job", AsyncMock(return_value=job))

    assert await service._validate_ownership(job_id, actor_id) is job


@pytest.mark.asyncio
async def test_cancel_in_flight_jobs_limits_user_authorized_cancellation_to_exact_owner(monkeypatch):
    """An asset cancellation with user context cannot mutate NULL-owned rows."""
    owner_id, asset_id, flow_id = uuid4(), uuid4(), uuid4()
    owner_job = Job(
        job_id=uuid4(),
        flow_id=flow_id,
        asset_id=asset_id,
        asset_type="knowledge_base",
        user_id=owner_id,
        status=JobStatus.QUEUED,
        type=JobType.INGESTION,
    )
    session = _capture_session(owner_job)
    monkeypatch.setattr("ketos.services.jobs.service.session_scope", lambda: _session_scope(session))

    cancelled = await JobService().cancel_in_flight_jobs_by_asset(asset_id, "knowledge_base", user_id=owner_id)

    assert cancelled == [owner_job.job_id]
    statement = _where_clause(session)
    assert "job.user_id IS NULL" not in statement
    assert "job.user_id =" in statement


@pytest.mark.asyncio
async def test_cancel_in_flight_jobs_mutates_only_exact_owner_for_shared_asset(client: AsyncClient):  # noqa: ARG001
    """A user cancellation leaves foreign and NULL-owned rows untouched in storage."""
    owner_id, foreign_id, asset_id = uuid4(), uuid4(), uuid4()
    owner_job = Job(
        job_id=uuid4(),
        flow_id=uuid4(),
        asset_id=asset_id,
        asset_type="knowledge_base",
        user_id=owner_id,
        status=JobStatus.QUEUED,
        type=JobType.INGESTION,
    )
    foreign_job = Job(
        job_id=uuid4(),
        flow_id=uuid4(),
        asset_id=asset_id,
        asset_type="knowledge_base",
        user_id=foreign_id,
        status=JobStatus.IN_PROGRESS,
        type=JobType.INGESTION,
    )
    null_owner_job = Job(
        job_id=uuid4(),
        flow_id=uuid4(),
        asset_id=asset_id,
        asset_type="knowledge_base",
        user_id=None,
        status=JobStatus.QUEUED,
        type=JobType.INGESTION,
    )
    job_ids = [owner_job.job_id, foreign_job.job_id, null_owner_job.job_id]

    async with session_scope() as session:
        session.add_all([owner_job, foreign_job, null_owner_job])
        await session.flush()

    try:
        cancelled = await JobService().cancel_in_flight_jobs_by_asset(asset_id, "knowledge_base", user_id=owner_id)

        assert cancelled == [owner_job.job_id]
        async with session_scope() as session:
            persisted_owner = await session.get(Job, owner_job.job_id)
            persisted_foreign = await session.get(Job, foreign_job.job_id)
            persisted_null_owner = await session.get(Job, null_owner_job.job_id)

            assert persisted_owner is not None
            assert persisted_owner.status == JobStatus.CANCELLED
            assert persisted_foreign is not None
            assert persisted_foreign.status == JobStatus.IN_PROGRESS
            assert persisted_null_owner is not None
            assert persisted_null_owner.status == JobStatus.QUEUED
    finally:
        async with session_scope() as session:
            for job_id in job_ids:
                job = await session.get(Job, job_id)
                if job:
                    await session.delete(job)
