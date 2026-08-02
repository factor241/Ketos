"""Atomic Stage 07 Board Job finalizer and state-machine tests."""

# ruff: noqa: INP001

from __future__ import annotations

import asyncio
import json
from copy import deepcopy
from typing import TYPE_CHECKING
from uuid import UUID

import pytest
from ketos.services.database.models.jobs.model import Job, JobStatus
from ketos.services.deps import session_scope
from ketos.services.jobs.board_claim import BoardJobConflict, claim_board_job
from ketos.services.jobs.board_contracts import BoardExecutionResult
from ketos.services.jobs.board_finalize import TerminalJobConflict, finalize_board_job

if TYPE_CHECKING:
    from httpx import AsyncClient

ACTOR_ID = UUID("10000000-0000-0000-0000-000000000001")
BOARD_ID = UUID("20000000-0000-0000-0000-000000000002")
FLOW_ID = UUID("30000000-0000-0000-0000-000000000003")


async def _claim(*, key: str) -> Job:
    return (
        await claim_board_job(
            actor_id=ACTOR_ID,
            board_id=BOARD_ID,
            flow_id=FLOW_ID,
            idempotency_key=key,
            flow_hash="a" * 64,
            policy_version=1,
        )
    ).job


async def _set_status(job_id: UUID, status: JobStatus) -> None:
    async with session_scope() as session:
        job = await session.get(Job, job_id)
        assert job is not None
        job.status = status
        session.add(job)


async def _read(job_id: UUID) -> Job:
    async with session_scope() as session:
        job = await session.get(Job, job_id)
        assert job is not None
        return job


def _terminal_args(status: JobStatus):
    if status is JobStatus.COMPLETED:
        return {
            "result": BoardExecutionResult(kind="json", value={"answer": 42}),
            "reason": None,
            "detail": None,
        }
    if status is JobStatus.FAILED:
        return {"result": None, "reason": "execution_failed", "detail": "raw traceback secret=bad"}
    if status is JobStatus.TIMED_OUT:
        return {"result": None, "reason": "timed_out", "detail": "raw timeout"}
    return {"result": None, "reason": "user_cancelled", "detail": "raw cancellation"}


@pytest.mark.parametrize(
    ("source", "target"),
    [
        (JobStatus.QUEUED, JobStatus.FAILED),
        (JobStatus.QUEUED, JobStatus.CANCELLED),
        (JobStatus.IN_PROGRESS, JobStatus.COMPLETED),
        (JobStatus.IN_PROGRESS, JobStatus.FAILED),
        (JobStatus.IN_PROGRESS, JobStatus.TIMED_OUT),
        (JobStatus.IN_PROGRESS, JobStatus.CANCELLED),
    ],
)
async def test_every_legal_transition_is_committed_atomically(
    client: AsyncClient,  # noqa: ARG001
    source: JobStatus,
    target: JobStatus,
) -> None:
    job = await _claim(key=f"legal-{source.value}-{target.value}")
    if source is JobStatus.IN_PROGRESS:
        await _set_status(job.job_id, source)

    finalized = await finalize_board_job(
        job_id=job.job_id,
        terminal_status=target,
        duration_ms=321,
        **_terminal_args(target),
    )

    assert finalized.status is target
    assert finalized.finished_timestamp is not None
    assert finalized.job_metadata is not None
    mvp = finalized.job_metadata["mvp"]
    assert mvp["flow_hash"] == "a" * 64
    assert mvp["audit"]["duration_ms"] == 321
    assert mvp["audit"]["sequence"] == 2
    assert len(json.dumps(finalized.job_metadata, ensure_ascii=False).encode("utf-8")) <= 32768
    assert "raw traceback" not in json.dumps(finalized.job_metadata)


@pytest.mark.parametrize(
    ("source", "target"),
    [
        (JobStatus.QUEUED, JobStatus.COMPLETED),
        (JobStatus.QUEUED, JobStatus.TIMED_OUT),
        (JobStatus.COMPLETED, JobStatus.FAILED),
        (JobStatus.FAILED, JobStatus.COMPLETED),
        (JobStatus.CANCELLED, JobStatus.COMPLETED),
        (JobStatus.TIMED_OUT, JobStatus.COMPLETED),
    ],
)
async def test_every_illegal_transition_conflicts_without_write(
    client: AsyncClient,  # noqa: ARG001
    source: JobStatus,
    target: JobStatus,
) -> None:
    job = await _claim(key=f"illegal-{source.value}-{target.value}")
    await _set_status(job.job_id, source)
    before = await _read(job.job_id)
    before_bytes = json.dumps(before.job_metadata, sort_keys=True)

    with pytest.raises(TerminalJobConflict):
        await finalize_board_job(
            job_id=job.job_id,
            terminal_status=target,
            duration_ms=1,
            **_terminal_args(target),
        )

    persisted = await _read(job.job_id)
    assert persisted.status is source
    assert persisted.finished_timestamp == before.finished_timestamp
    assert json.dumps(persisted.job_metadata, sort_keys=True) == before_bytes


async def test_exact_same_terminal_finalize_is_idempotent_and_timestamp_stable(client: AsyncClient) -> None:  # noqa: ARG001
    job = await _claim(key="same-finalize")
    await _set_status(job.job_id, JobStatus.IN_PROGRESS)
    kwargs = {
        "job_id": job.job_id,
        "terminal_status": JobStatus.COMPLETED,
        "result": BoardExecutionResult(kind="text", value="done"),
        "reason": None,
        "detail": None,
        "duration_ms": 12,
    }
    first = await finalize_board_job(**kwargs)
    before = deepcopy(first.job_metadata)
    first_finished = first.finished_timestamp

    second = await finalize_board_job(**kwargs)

    assert second.status is JobStatus.COMPLETED
    assert second.finished_timestamp == first_finished
    assert second.job_metadata == before


async def test_same_terminal_with_different_result_conflicts(client: AsyncClient) -> None:  # noqa: ARG001
    job = await _claim(key="different-finalize")
    await _set_status(job.job_id, JobStatus.IN_PROGRESS)
    await finalize_board_job(
        job_id=job.job_id,
        terminal_status=JobStatus.COMPLETED,
        result=BoardExecutionResult(kind="text", value="first"),
        reason=None,
        detail=None,
        duration_ms=1,
    )

    with pytest.raises(TerminalJobConflict):
        await finalize_board_job(
            job_id=job.job_id,
            terminal_status=JobStatus.COMPLETED,
            result=BoardExecutionResult(kind="text", value="second"),
            reason=None,
            detail=None,
            duration_ms=1,
        )


async def test_finalizer_rejects_reserved_backend_restarted_reason(client: AsyncClient) -> None:  # noqa: ARG001
    job = await _claim(key="reserved-reason")

    with pytest.raises(ValueError, match="reserved"):
        await finalize_board_job(
            job_id=job.job_id,
            terminal_status=JobStatus.FAILED,
            result=None,
            reason="backend_restarted",
            detail=None,
            duration_ms=1,
        )


async def test_concurrent_terminal_race_has_one_winner_and_no_rewrite(client: AsyncClient) -> None:  # noqa: ARG001
    job = await _claim(key="terminal-race")
    await _set_status(job.job_id, JobStatus.IN_PROGRESS)

    async def succeed():
        return await finalize_board_job(
            job_id=job.job_id,
            terminal_status=JobStatus.COMPLETED,
            result=BoardExecutionResult(kind="text", value="winner"),
            reason=None,
            detail=None,
            duration_ms=10,
        )

    async def cancel():
        return await finalize_board_job(
            job_id=job.job_id,
            terminal_status=JobStatus.CANCELLED,
            result=None,
            reason="user_cancelled",
            detail=None,
            duration_ms=10,
        )

    outcomes = await asyncio.gather(succeed(), cancel(), return_exceptions=True)
    assert sum(isinstance(value, Job) for value in outcomes) == 1
    assert sum(isinstance(value, TerminalJobConflict) for value in outcomes) == 1
    persisted = await _read(job.job_id)
    assert persisted.status in {JobStatus.COMPLETED, JobStatus.CANCELLED}


async def test_legacy_active_and_terminal_rows_are_never_upgraded_by_finalizer(client: AsyncClient) -> None:  # noqa: ARG001
    for status in (JobStatus.IN_PROGRESS, JobStatus.COMPLETED):
        job = await _claim(key=f"legacy-finalizer-{status.value}")
        await _set_status(job.job_id, status)
        async with session_scope() as session:
            persisted = await session.get(Job, job.job_id)
            assert persisted is not None
            assert persisted.job_metadata is not None
            legacy_metadata = deepcopy(persisted.job_metadata)
            del legacy_metadata["mvp"]["worker_instance_id"]
            persisted.job_metadata = legacy_metadata
            session.add(persisted)
        before = await _read(job.job_id)
        before_bytes = json.dumps(before.job_metadata, sort_keys=True)

        with pytest.raises((TerminalJobConflict, BoardJobConflict)):
            await finalize_board_job(
                job_id=job.job_id,
                terminal_status=JobStatus.FAILED,
                result=None,
                reason="execution_failed",
                detail=None,
                duration_ms=1,
            )

        after = await _read(job.job_id)
        assert after.status is status
        assert json.dumps(after.job_metadata, sort_keys=True) == before_bytes


async def test_unknown_oversized_mvp_field_is_rejected_without_mutation(client: AsyncClient) -> None:  # noqa: ARG001
    job = await _claim(key="unknown-oversized-field")
    async with session_scope() as session:
        persisted = await session.get(Job, job.job_id)
        assert persisted is not None
        assert persisted.job_metadata is not None
        invalid_metadata = deepcopy(persisted.job_metadata)
        invalid_metadata["mvp"]["unknown_blob"] = "x" * 100_000
        persisted.job_metadata = invalid_metadata
        session.add(persisted)
    before = await _read(job.job_id)
    before_bytes = json.dumps(before.job_metadata, sort_keys=True)

    with pytest.raises(TerminalJobConflict):
        await finalize_board_job(
            job_id=job.job_id,
            terminal_status=JobStatus.FAILED,
            result=None,
            reason="execution_failed",
            detail=None,
            duration_ms=1,
        )

    after = await _read(job.job_id)
    assert after.status is JobStatus.QUEUED
    assert json.dumps(after.job_metadata, sort_keys=True) == before_bytes
