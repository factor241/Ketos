"""Regression coverage for the Stage 01 fail-closed Job ownership floor."""

from __future__ import annotations

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from ketos.services.database.models.jobs.model import Job, JobStatus, JobType
from ketos.services.jobs.service import JobService


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
    monkeypatch.setattr(
        "ketos.services.jobs.service.session_scope", lambda: _session_scope(session)
    )

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
    monkeypatch.setattr(
        "ketos.services.jobs.service.session_scope", lambda: _session_scope(session)
    )

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
    monkeypatch.setattr(
        "ketos.services.jobs.service.session_scope", lambda: _session_scope(session)
    )

    job = await JobService().get_job_by_job_id(job_id)

    assert job is system_job
    assert "job.user_id" not in _where_clause(session)


@pytest.mark.asyncio
@pytest.mark.parametrize("job_owner", [pytest.param(None, id="null-owner"), pytest.param(uuid4(), id="foreign-owner")])
async def test_validate_ownership_rejects_null_and_foreign_owner(job_owner, monkeypatch):
    """Protected mutation preflight is fail-closed for NULL and foreign rows."""
    actor_id, job_id, flow_id = uuid4(), uuid4(), uuid4()
    job = Job(job_id=job_id, flow_id=flow_id, user_id=job_owner)
    service = JobService()
    monkeypatch.setattr(service, "get_job_by_job_id", AsyncMock(return_value=job))

    with pytest.raises(ValueError, match="Access denied"):
        await service._validate_ownership(job_id, actor_id)


@pytest.mark.asyncio
async def test_validate_ownership_allows_exact_owner(monkeypatch):
    """The exact owner remains authorized for protected job operations."""
    actor_id, job_id, flow_id = uuid4(), uuid4(), uuid4()
    job = Job(job_id=job_id, flow_id=flow_id, user_id=actor_id)
    service = JobService()
    monkeypatch.setattr(service, "get_job_by_job_id", AsyncMock(return_value=job))

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
    monkeypatch.setattr(
        "ketos.services.jobs.service.session_scope", lambda: _session_scope(session)
    )

    cancelled = await JobService().cancel_in_flight_jobs_by_asset(
        asset_id, "knowledge_base", user_id=owner_id
    )

    assert cancelled == [owner_job.job_id]
    statement = _where_clause(session)
    assert "job.user_id IS NULL" not in statement
    assert "job.user_id =" in statement
