from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Sequence
    from datetime import datetime
    from uuid import UUID

    from sqlmodel.ext.asyncio.session import AsyncSession

from sqlalchemy import update
from sqlmodel import col, select

from ketos.services.database.models.jobs.model import Job, JobStatus


async def get_jobs_by_flow_id(
    db: AsyncSession,
    flow_id: UUID,
    user_id: UUID,
    page: int = 1,
    size: int = 10,
) -> list[Job]:
    """Get exact-owner jobs by flow ID with pagination.

    Args:
        db: Async database session
        flow_id: The flow ID to filter jobs by
        user_id: Authenticated owner ID
        page: Page number (1-indexed)
        size: Number of jobs per page

    Returns:
        Exact-owner Job objects for the specified flow
    """
    statement = (
        select(Job)
        .where(Job.flow_id == flow_id, Job.user_id == user_id)
        .order_by(col(Job.created_timestamp).desc())
        .offset((page - 1) * size)
        .limit(size)
    )

    result = await db.exec(statement)
    return list(result.all())


async def get_job_by_job_id(db: AsyncSession, job_id: UUID, user_id: UUID) -> Job | None:
    """Get an exact-owner job by its UUID.

    Args:
        db: Async database session
        job_id: The job ID to fetch
        user_id: Authenticated owner ID.

    Returns:
        Job object or None if not found (or not accessible by the given user)
    """
    return await get_owned_job_by_job_id(db, job_id, user_id)


async def get_owned_job_by_job_id(db: AsyncSession, job_id: UUID, user_id: UUID) -> Job | None:
    """Get one exact-owner job for a protected caller.

    Args:
        db: Active database session.
        job_id: Job identifier to fetch.
        user_id: Authenticated owner identifier.

    Returns:
        The exact-owner Job, or None when it is missing or inaccessible.
    """
    statement = select(Job).where(Job.job_id == job_id, Job.user_id == user_id)
    result = await db.exec(statement)
    return result.first()


async def get_job_by_job_id_internal(db: AsyncSession, job_id: UUID) -> Job | None:
    """Get one job without an ownership filter for trusted internal workflows.

    Args:
        db: Active database session.
        job_id: Job identifier to fetch.

    Returns:
        The matching Job, or None when it does not exist.
    """
    statement = select(Job).where(Job.job_id == job_id)
    result = await db.exec(statement)
    return result.first()


async def update_job_status(
    db: AsyncSession,
    job_id: UUID,
    status: JobStatus,
    *,
    finished_timestamp: datetime | None = None,
) -> Job | None:
    """Update the status of a job.

    Args:
        db: Async database session
        job_id: The job ID to update
        status: The new status value
        finished_timestamp: Optional timestamp to set atomically with the status

    Returns:
        Updated Job object or None if not found
    """
    values = {"status": status}
    if finished_timestamp is not None:
        values["finished_timestamp"] = finished_timestamp

    result = await db.exec(
        update(Job).where(Job.job_id == job_id).values(**values).execution_options(synchronize_session=False)
    )
    if result.rowcount == 0:
        return None
    return await get_job_by_job_id_internal(db, job_id)


async def get_latest_jobs_by_asset_ids(db: AsyncSession, asset_ids: Sequence[UUID]) -> dict[UUID, Job]:
    """Get the latest job for each asset ID in a single query.

    Args:
        db: Async database session
        asset_ids: List of asset IDs to fetch jobs for

    Returns:
        Dictionary mapping asset_id to the latest Job object
    """
    if not asset_ids:
        return {}

    # Query all jobs for the given asset IDs, ordered by created_timestamp descending
    statement = select(Job).where(col(Job.asset_id).in_(asset_ids)).order_by(col(Job.created_timestamp).desc())

    result = await db.exec(statement)
    all_jobs = result.all()

    # Build a dictionary with the latest job per asset_id
    latest_jobs: dict[UUID, Job] = {}
    for job in all_jobs:
        if job.asset_id and job.asset_id not in latest_jobs:
            latest_jobs[job.asset_id] = job

    return latest_jobs
