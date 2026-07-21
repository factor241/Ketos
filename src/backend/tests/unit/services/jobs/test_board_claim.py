"""Stage 07 deterministic and atomic Board Job claim contract."""

# ruff: noqa: INP001

from __future__ import annotations

import asyncio
import hashlib
import json
import os
from contextlib import asynccontextmanager
from copy import deepcopy
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest
from ketos.services.database.models.jobs.model import Job, JobStatus, JobType
from ketos.services.deps import session_scope
from ketos.services.jobs import board_claim as board_claim_module
from ketos.services.jobs.board_claim import (
    BOARD_JOB_NAMESPACE,
    BoardJobConflict,
    BoardJobResourceNotFoundError,
    build_board_request_fingerprint,
    canonical_graph_payload,
    claim_board_job,
    derive_board_job_id,
)
from ketos.services.jobs.board_contracts import BoardAutomationRunRequest
from ketos.services.jobs.worker_identity import ProcessWorkerIdentity
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

pytestmark = pytest.mark.usefixtures("client")


ACTOR_ID = UUID("10000000-0000-0000-0000-000000000001")
BOARD_ID = UUID("20000000-0000-0000-0000-000000000002")
FLOW_ID = UUID("30000000-0000-0000-0000-000000000003")
FLOW_HASH = "a" * 64


def _claim_kwargs(*, key: str = "intent-1", flow_hash: str = FLOW_HASH, actor_id: UUID = ACTOR_ID):
    return {
        "actor_id": actor_id,
        "board_id": BOARD_ID,
        "flow_id": FLOW_ID,
        "idempotency_key": key,
        "flow_hash": flow_hash,
        "policy_version": 1,
    }


def _identity_kwargs(*, key: str = "intent-1", actor_id: UUID = ACTOR_ID):
    return {
        "actor_id": actor_id,
        "board_id": BOARD_ID,
        "flow_id": FLOW_ID,
        "idempotency_key": key,
    }


def _mvp(job: Job) -> dict:
    assert job.job_metadata is not None
    value = job.job_metadata.get("mvp")
    assert isinstance(value, dict)
    return value


async def _persisted_job(job_id: UUID) -> Job | None:
    async with session_scope() as session:
        return await session.get(Job, job_id)


def test_uuid5_identity_matches_the_frozen_formula() -> None:
    canonical = f"ketos.board-job.v1:{ACTOR_ID}:{BOARD_ID}:{FLOW_ID}:intent-1"
    expected = UUID("9e381109-89ee-57c2-93e9-56313f4a0b57")

    assert UUID("7a2d1c1e-7f9b-5bd6-9fd9-4f80243c3c55") == BOARD_JOB_NAMESPACE
    assert derive_board_job_id(**_identity_kwargs()) == expected
    assert derive_board_job_id(**_identity_kwargs()) == derive_board_job_id(**_identity_kwargs())
    assert canonical.endswith(":intent-1")


def test_canonical_graph_payload_and_fingerprint_are_order_independent() -> None:
    first_json, first_hash = canonical_graph_payload({"b": [2, 1], "a": {"z": "✓", "x": 1}})
    second_json, second_hash = canonical_graph_payload({"a": {"x": 1, "z": "✓"}, "b": [2, 1]})

    assert first_json == second_json == '{"a":{"x":1,"z":"✓"},"b":[2,1]}'
    assert first_hash == second_hash
    assert len(first_hash) == 64
    assert build_board_request_fingerprint(
        actor_id=ACTOR_ID,
        board_id=BOARD_ID,
        flow_id=FLOW_ID,
        flow_hash=first_hash,
    ) == build_board_request_fingerprint(
        actor_id=ACTOR_ID,
        board_id=BOARD_ID,
        flow_id=FLOW_ID,
        flow_hash=second_hash,
    )


def test_request_contract_forbids_extra_fields_and_invalid_key() -> None:
    assert BoardAutomationRunRequest(idempotency_key="safe.Key:1-2_3").idempotency_key == "safe.Key:1-2_3"
    with pytest.raises(ValidationError):
        BoardAutomationRunRequest(idempotency_key="contains space")
    with pytest.raises(ValidationError):
        BoardAutomationRunRequest(idempotency_key="x", actor_id=str(ACTOR_ID))


def test_process_worker_identity_is_stable_per_pid_and_rotates_for_new_process() -> None:
    current_pid = 101
    generated = iter(
        [
            UUID("40000000-0000-0000-0000-000000000004"),
            UUID("50000000-0000-0000-0000-000000000005"),
        ]
    )
    identity = ProcessWorkerIdentity(pid_provider=lambda: current_pid, uuid_provider=lambda: next(generated))

    first = identity.get()
    assert identity.get() == first
    current_pid = 202
    second = identity.get()

    assert first != second
    assert identity.get() == second


def test_process_worker_identity_resets_in_a_forked_child_even_with_same_pid_fixture() -> None:
    generated = iter(
        [
            UUID("40000000-0000-0000-0000-000000000004"),
            UUID("50000000-0000-0000-0000-000000000005"),
        ]
    )
    identity = ProcessWorkerIdentity(pid_provider=lambda: 101, uuid_provider=lambda: next(generated))

    first = identity.get()
    identity._reset_after_fork()  # exercise the registered child hook

    assert identity.get() != first


async def test_new_claim_writes_exact_domain_marker_without_raw_key() -> None:
    worker_id = UUID("40000000-0000-0000-0000-000000000004")
    raw_key = "Never-Persist-Me"

    claim = await claim_board_job(
        **_claim_kwargs(key=raw_key),
        worker_instance_id_provider=lambda: worker_id,
    )

    assert claim.claimed is True
    assert claim.job.job_id == derive_board_job_id(**_identity_kwargs(key=raw_key))
    assert claim.job.user_id == ACTOR_ID
    assert claim.job.flow_id == FLOW_ID
    assert claim.job.type is JobType.WORKFLOW
    assert claim.job.status is JobStatus.QUEUED
    mvp = _mvp(claim.job)
    assert mvp == {
        "schema_version": 2,
        "kind": "board_automation_run",
        "board_id": str(BOARD_ID),
        "flow_id": str(FLOW_ID),
        "flow_hash": FLOW_HASH,
        "request_fingerprint": build_board_request_fingerprint(
            actor_id=ACTOR_ID,
            board_id=BOARD_ID,
            flow_id=FLOW_ID,
            flow_hash=FLOW_HASH,
        ),
        "policy_version": 1,
        "origin_pid": os.getpid(),
        "worker_instance_id": str(worker_id),
        "reason": None,
        "detail": None,
        "result": None,
        "audit": {
            "request_id": str(claim.job.job_id),
            "sequence": 1,
            "duration_ms": None,
            "outcome": "queued",
        },
    }
    persisted_bytes = json.dumps(claim.job.job_metadata, sort_keys=True)
    assert raw_key not in persisted_bytes
    assert claim.job.dedupe_key is not None
    assert raw_key not in claim.job.dedupe_key


async def test_same_fingerprint_replays_same_job_without_mutation() -> None:
    worker_id = uuid4()
    first = await claim_board_job(**_claim_kwargs(), worker_instance_id_provider=lambda: worker_id)
    before = deepcopy(first.job.job_metadata)
    second = await claim_board_job(**_claim_kwargs(), worker_instance_id_provider=uuid4)

    assert first.claimed is True
    assert second.claimed is False
    assert second.job.job_id == first.job.job_id
    assert second.job.job_metadata == before
    assert _mvp(second.job)["worker_instance_id"] == str(worker_id)


async def test_replay_after_process_change_preserves_original_worker_evidence(monkeypatch) -> None:
    first_worker = UUID("40000000-0000-0000-0000-000000000004")
    second_worker = UUID("50000000-0000-0000-0000-000000000005")
    first = await claim_board_job(
        **_claim_kwargs(key="restart-replay"),
        worker_instance_id_provider=lambda: first_worker,
    )
    before = json.dumps(first.job.job_metadata, sort_keys=True, separators=(",", ":"))
    first_origin_pid = _mvp(first.job)["origin_pid"]
    monkeypatch.setattr(board_claim_module.os, "getpid", lambda: first_origin_pid + 1)

    replay = await claim_board_job(
        **_claim_kwargs(key="restart-replay"),
        worker_instance_id_provider=lambda: second_worker,
    )

    assert replay.claimed is False
    assert _mvp(replay.job)["origin_pid"] == first_origin_pid
    assert _mvp(replay.job)["worker_instance_id"] == str(first_worker)
    assert json.dumps(replay.job.job_metadata, sort_keys=True, separators=(",", ":")) == before


async def test_two_new_claims_share_the_process_stable_worker_identity() -> None:
    first = await claim_board_job(**_claim_kwargs(key="process-job-1"))
    second = await claim_board_job(**_claim_kwargs(key="process-job-2"))

    assert first.claimed is second.claimed is True
    assert _mvp(first.job)["worker_instance_id"] == _mvp(second.job)["worker_instance_id"]


async def test_integrity_conflict_rolls_back_then_reads_in_fresh_session(monkeypatch) -> None:
    job_id = derive_board_job_id(**_identity_kwargs(key="fresh-session"))
    fingerprint = build_board_request_fingerprint(
        actor_id=ACTOR_ID,
        board_id=BOARD_ID,
        flow_id=FLOW_ID,
        flow_hash=FLOW_HASH,
    )
    existing = Job(
        job_id=job_id,
        flow_id=FLOW_ID,
        user_id=ACTOR_ID,
        type=JobType.WORKFLOW,
        dedupe_key=hashlib.sha256(b"ketos.board-job-key.v1:fresh-session").hexdigest(),
        job_metadata={
            "mvp": {
                "schema_version": 2,
                "kind": "board_automation_run",
                "board_id": str(BOARD_ID),
                "flow_id": str(FLOW_ID),
                "flow_hash": FLOW_HASH,
                "request_fingerprint": fingerprint,
                "policy_version": 1,
                "origin_pid": 123,
                "worker_instance_id": str(uuid4()),
            }
        },
    )
    insert_session = MagicMock()
    insert_session.add = MagicMock()
    insert_session.commit = AsyncMock(
        side_effect=IntegrityError("INSERT job", {}, Exception("UNIQUE constraint failed: job.job_id"))
    )
    insert_session.rollback = AsyncMock()
    insert_session.exec = AsyncMock()
    result = MagicMock()
    result.first.return_value = existing
    replay_session = MagicMock()
    replay_session.exec = AsyncMock(return_value=result)
    sessions = iter([insert_session, replay_session])

    @asynccontextmanager
    async def fake_session_scope():
        yield next(sessions)

    monkeypatch.setattr(board_claim_module, "session_scope", fake_session_scope)

    claim = await claim_board_job(**_claim_kwargs(key="fresh-session"))

    assert claim == board_claim_module.BoardJobClaim(job=existing, claimed=False)
    insert_session.add.assert_called_once()
    insert_session.exec.assert_not_awaited()
    insert_session.rollback.assert_awaited_once()
    replay_session.exec.assert_awaited_once()


async def test_changed_flow_hash_conflicts_without_mutation() -> None:
    first = await claim_board_job(**_claim_kwargs(flow_hash="a" * 64))
    before = deepcopy(first.job.job_metadata)

    with pytest.raises(BoardJobConflict):
        await claim_board_job(**_claim_kwargs(flow_hash="b" * 64))

    persisted = await _persisted_job(first.job.job_id)
    assert persisted is not None
    assert persisted.job_metadata == before


async def test_forced_uuid_collision_with_different_key_hash_conflicts(monkeypatch) -> None:
    first = await claim_board_job(**_claim_kwargs(key="collision-key-a"))
    before = deepcopy(first.job.job_metadata)
    monkeypatch.setattr(board_claim_module, "derive_board_job_id", lambda **_kwargs: first.job.job_id)

    with pytest.raises(BoardJobConflict):
        await claim_board_job(**_claim_kwargs(key="collision-key-b"))

    persisted = await _persisted_job(first.job.job_id)
    assert persisted is not None
    assert persisted.job_metadata == before
    assert persisted.dedupe_key == first.job.dedupe_key


async def test_non_pk_integrity_error_is_re_raised_when_no_conflicting_row(monkeypatch) -> None:
    integrity_error = IntegrityError("INSERT job", {}, Exception("CHECK constraint failed: policy"))
    insert_session = MagicMock()
    insert_session.add = MagicMock()
    insert_session.commit = AsyncMock(side_effect=integrity_error)
    insert_session.rollback = AsyncMock()
    empty_result = MagicMock()
    empty_result.first.return_value = None
    replay_session = MagicMock()
    replay_session.exec = AsyncMock(return_value=empty_result)
    sessions = iter([insert_session, replay_session])

    @asynccontextmanager
    async def fake_session_scope():
        yield next(sessions)

    monkeypatch.setattr(board_claim_module, "session_scope", fake_session_scope)

    with pytest.raises(IntegrityError) as raised:
        await claim_board_job(**_claim_kwargs(key="unrelated-integrity-error"))

    assert raised.value is integrity_error
    insert_session.rollback.assert_awaited_once()
    assert replay_session.exec.await_count == 2


@pytest.mark.parametrize("existing_owner", [None, uuid4()])
async def test_foreign_or_null_collision_is_resource_not_found(existing_owner: UUID | None) -> None:
    job_id = derive_board_job_id(**_identity_kwargs())
    async with session_scope() as session:
        session.add(
            Job(
                job_id=job_id,
                flow_id=FLOW_ID,
                user_id=existing_owner,
                type=JobType.WORKFLOW,
                job_metadata={"mvp": {"request_fingerprint": "x" * 64}},
            )
        )
        await session.commit()

    with pytest.raises(BoardJobResourceNotFoundError):
        await claim_board_job(**_claim_kwargs())


async def test_parallel_two_writer_claim_has_one_winner_and_one_row() -> None:
    started = asyncio.Event()

    async def writer():
        await started.wait()
        return await claim_board_job(**_claim_kwargs(key="parallel"))

    tasks = [asyncio.create_task(writer()), asyncio.create_task(writer())]
    started.set()
    claims = await asyncio.gather(*tasks)
    job_id = derive_board_job_id(**_identity_kwargs(key="parallel"))

    assert sorted(claim.claimed for claim in claims) == [False, True]
    assert {claim.job.job_id for claim in claims} == {job_id}
    async with session_scope() as session:
        rows = (await session.exec(select(Job).where(Job.job_id == job_id))).all()
    assert len(rows) == 1


async def test_only_claim_winner_invokes_enqueue_spy() -> None:
    enqueue_spy = AsyncMock()

    async def claim_then_enqueue():
        claim = await claim_board_job(**_claim_kwargs(key="enqueue-once"))
        if claim.claimed:
            await enqueue_spy(claim.job)
        return claim

    claims = await asyncio.gather(claim_then_enqueue(), claim_then_enqueue())

    assert sorted(claim.claimed for claim in claims) == [False, True]
    enqueue_spy.assert_awaited_once()
    assert enqueue_spy.await_args.args[0].job_id == derive_board_job_id(**_identity_kwargs(key="enqueue-once"))


@pytest.mark.parametrize(
    ("status", "metadata"),
    [
        (
            JobStatus.COMPLETED,
            {
                "mvp": {
                    "schema_version": 1,
                    "board_id": str(BOARD_ID),
                    "flow_id": str(FLOW_ID),
                    "request_fingerprint": build_board_request_fingerprint(
                        actor_id=ACTOR_ID,
                        board_id=BOARD_ID,
                        flow_id=FLOW_ID,
                        flow_hash=FLOW_HASH,
                    ),
                    "policy_version": 1,
                    "audit": {"sequence": 1, "outcome": "succeeded"},
                }
            },
        ),
        (
            JobStatus.IN_PROGRESS,
            {
                "mvp": {
                    "schema_version": 1,
                    "kind": "board_automation_run",
                    "board_id": str(BOARD_ID),
                    "flow_id": str(FLOW_ID),
                    "request_fingerprint": build_board_request_fingerprint(
                        actor_id=ACTOR_ID,
                        board_id=BOARD_ID,
                        flow_id=FLOW_ID,
                        flow_hash=FLOW_HASH,
                    ),
                    "policy_version": 1,
                    "audit": {"sequence": 1, "outcome": "running"},
                }
            },
        ),
    ],
)
async def test_terminal_and_legacy_active_v1_collision_remain_byte_identical(
    status: JobStatus,
    metadata: dict,
) -> None:
    job_id = derive_board_job_id(**_identity_kwargs(key=f"legacy-{status.value}"))
    finished = datetime(2026, 1, 1, tzinfo=timezone.utc) if status is JobStatus.COMPLETED else None
    async with session_scope() as session:
        session.add(
            Job(
                job_id=job_id,
                flow_id=FLOW_ID,
                user_id=ACTOR_ID,
                type=JobType.WORKFLOW,
                status=status,
                finished_timestamp=finished,
                job_metadata=deepcopy(metadata),
            )
        )
        await session.commit()

    baseline = await _persisted_job(job_id)
    assert baseline is not None
    before = json.dumps(baseline.job_metadata, sort_keys=True, separators=(",", ":"))
    before_finished = baseline.finished_timestamp
    with pytest.raises(BoardJobConflict):
        await claim_board_job(**_claim_kwargs(key=f"legacy-{status.value}"))

    persisted = await _persisted_job(job_id)
    assert persisted is not None
    assert persisted.status is status
    assert persisted.finished_timestamp == before_finished
    assert json.dumps(persisted.job_metadata, sort_keys=True, separators=(",", ":")) == before
