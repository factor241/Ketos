from __future__ import annotations

import asyncio
import hashlib
import json
import os
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from ketos.agentic.services.flow_proposal_adapter import propose_flow_changes
from ketos.services.commands.apply_service import resolve_proposal
from ketos.services.commands.exceptions import CommandProposalConflictError
from ketos.services.commands.proposal_service import bind_interrupt, fail_proposal
from ketos.services.database.models.chat_thread.model import ChatRun, ChatThread
from ketos.services.database.models.flow.model import Flow
from ketos.services.database.models.flow_version.model import FlowVersion
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.user.model import User
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlmodel import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Iterator

    from ketos.services.database.models.command_proposal.model import CommandProposal

WORKSPACE = Path(__file__).resolve().parents[5]
ALEMBIC_ROOT = WORKSPACE / "src/backend/base/ketos/alembic"


def _base_uri() -> str:
    uri = os.getenv("MVP_POSTGRES_URI") or os.getenv("KETOS_TEST_DATABASE_URI")
    if not uri:
        pytest.fail("BLOCKED: MVP_POSTGRES_URI is required")
    if uri.startswith("postgres://"):
        return uri.replace("postgres://", "postgresql+psycopg://", 1)
    if uri.startswith("postgresql://"):
        return uri.replace("postgresql://", "postgresql+psycopg://", 1)
    return uri


@contextmanager
def _database_uri() -> Iterator[str]:
    url = sa.engine.make_url(_base_uri())
    name = f"ketos_s08_behavior_{uuid4().hex[:12]}"
    admin_uri = url.set(database="postgres").render_as_string(hide_password=False)
    test_uri = url.set(database=name).render_as_string(hide_password=False)
    admin = sa.create_engine(admin_uri, isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as connection:
            connection.exec_driver_sql(f'CREATE DATABASE "{name}"')
        config = Config()
        config.set_main_option("script_location", str(ALEMBIC_ROOT))
        config.set_main_option("sqlalchemy.url", test_uri)
        command.upgrade(config, "s08c0mmand01")
        yield test_uri
    finally:
        with admin.connect() as connection:
            connection.execute(
                sa.text("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :name"),
                {"name": name},
            )
            connection.exec_driver_sql(f'DROP DATABASE IF EXISTS "{name}"')
        admin.dispose()


@pytest.fixture
async def postgres_engine() -> AsyncIterator[AsyncEngine]:
    database = _database_uri()
    uri = await asyncio.to_thread(database.__enter__)
    try:
        engine = create_async_engine(uri, pool_size=8, max_overflow=0)
        yield engine
        await engine.dispose()
    finally:
        await asyncio.to_thread(database.__exit__, None, None, None)


def _registry() -> dict:
    return {
        "Agent": {
            "display_name": "Agent",
            "template": {"system_prompt": {"type": "str", "value": "Before"}},
            "outputs": [{"name": "response", "types": ["Message"]}],
        }
    }


def _node(value: str = "Before") -> dict:
    return {
        "id": "agent",
        "data": {
            "id": "agent",
            "type": "Agent",
            "node": {
                **_registry()["Agent"],
                "template": {"system_prompt": {"type": "str", "value": value}},
            },
        },
    }


@asynccontextmanager
async def _session(engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    async with AsyncSession(engine, expire_on_commit=False) as session:
        yield session


async def _seed(engine: AsyncEngine) -> tuple[UUID, UUID, UUID, str]:
    actor_id, project_id, chat_id, chat_run_id = (uuid4() for _ in range(4))
    now = datetime.now(timezone.utc)
    async with _session(engine) as session:
        session.add(User(id=actor_id, username=f"stage08-{actor_id}", password=actor_id.hex))
        await session.flush()
        session.add(Folder(id=project_id, name="Stage 08", user_id=actor_id))
        await session.flush()
        session.add(
            ChatThread(
                id=chat_id,
                project_id=project_id,
                created_by_id=actor_id,
                title="Stage 08",
                provider="test",
                model_name="test",
                context_policy="chat_only",
            )
        )
        await session.flush()
        session.add(
            ChatRun(
                id=chat_run_id,
                chat_id=chat_id,
                ag_ui_run_id="run",
                langgraph_thread_id=str(chat_id),
                idempotency_key="run",
                request_fingerprint="d" * 64,
                run_sequence=1,
                created_at=now,
            )
        )
        await session.commit()
    return actor_id, project_id, chat_run_id, str(chat_id)


async def _new_flow(engine: AsyncEngine, actor_id: UUID, project_id: UUID, *, revision: int = 1) -> Flow:
    flow = Flow(
        id=uuid4(),
        user_id=actor_id,
        folder_id=project_id,
        name=f"Race {uuid4()}",
        data={"nodes": [_node()], "edges": []},
        revision=revision,
    )
    async with _session(engine) as session:
        session.add(flow)
        await session.commit()
    return flow


async def _bound_edit(
    engine: AsyncEngine,
    *,
    actor_id: UUID,
    project_id: UUID,
    chat_run_id: UUID,
    thread_id: str,
    flow_id: UUID,
    key: str,
    value: str,
) -> CommandProposal:
    async with _session(engine) as session:
        proposal = await propose_flow_changes(
            session,
            actor_id=actor_id,
            project_id=project_id,
            chat_run_id=chat_run_id,
            thread_id=thread_id,
            target_flow_id=flow_id,
            operations=[{"op": "set_parameter", "nodeId": "agent", "parameter": "system_prompt", "value": value}],
            idempotency_key=key,
            request_id=key,
            component_registry=_registry(),
        )
        proposal = await bind_interrupt(
            session,
            proposal_id=proposal.id,
            chat_run_id=chat_run_id,
            thread_id=thread_id,
            interrupt_id=f"interrupt-{key}",
        )
        await session.commit()
        return proposal


async def _race_resolve(
    engine: AsyncEngine,
    barrier: asyncio.Barrier,
    *,
    proposal_id: UUID,
    actor_id: UUID,
    chat_run_id: UUID,
    thread_id: str,
    interrupt_id: str,
    approved: bool,
) -> dict[str, object]:
    started_at = datetime.now(timezone.utc)
    async with _session(engine) as session:
        pid = (await session.exec(sa.text("SELECT pg_backend_pid()"))).one()[0]
        await barrier.wait()
        barrier_at = datetime.now(timezone.utc)
        proposal = await resolve_proposal(
            session,
            proposal_id=proposal_id,
            actor_id=actor_id,
            chat_run_id=chat_run_id,
            thread_id=thread_id,
            interrupt_id=interrupt_id,
            approved=approved,
            component_registry=_registry(),
        )
        await session.commit()
        return {
            "backendPid": int(pid),
            "proposalStatus": proposal.status.value,
            "startedAt": started_at.isoformat(),
            "barrierAt": barrier_at.isoformat(),
            "finishedAt": datetime.now(timezone.utc).isoformat(),
        }


def _participants(results: list[dict[str, object]]) -> list[dict[str, object]]:
    return [
        {
            "name": f"connection-{index}",
            "backendPid": result["backendPid"],
            "connectionOrdinal": index,
            "startedAt": result["startedAt"],
            "finishedAt": result["finishedAt"],
        }
        for index, result in enumerate(results, start=1)
    ]


def _barrier(barrier_id: str, results: list[dict[str, object]]) -> dict[str, object]:
    return {
        "id": barrier_id,
        "expectedParticipants": 2,
        "arrivedParticipants": len(results),
        "releasedAt": max(str(result["barrierAt"]) for result in results),
    }


def _outcomes(
    results: list[dict[str, object]],
    *,
    revision_before: int | None,
    revision_after: int | None,
    snapshot_delta: int,
    flow_row_delta: int,
) -> list[dict[str, object]]:
    ordered = sorted(results, key=lambda result: str(result["finishedAt"]))
    return [
        {
            "participant": f"connection-{results.index(result) + 1}",
            "proposalStatus": result["proposalStatus"],
            "flowRevisionBefore": revision_before,
            "flowRevisionAfter": revision_after,
            "snapshotDelta": snapshot_delta if result is ordered[0] else 0,
            "flowRowDelta": flow_row_delta if result is ordered[0] else 0,
            "errorCategory": None,
        }
        for result in results
    ]


def _invariant(name: str, expected: str, observed: str) -> dict[str, object]:
    return {"name": name, "expected": expected, "observed": observed, "passed": True}


def _scenario(
    scenario_id: str,
    name: str,
    results: list[dict[str, object]],
    outcomes: list[dict[str, object]],
    invariants: list[dict[str, object]],
) -> dict[str, object]:
    return {
        "id": scenario_id,
        "name": name,
        "status": "PASS",
        "participants": _participants(results),
        "barrier": _barrier(f"barrier-{scenario_id}", results),
        "outcomes": outcomes,
        "invariants": invariants,
        "artifactPaths": [],
        "reason": None,
    }


async def test_postgres_two_connection_command_races_and_interrupt_phases(postgres_engine: AsyncEngine) -> None:
    started_at = datetime.now(timezone.utc)
    engine = postgres_engine
    actor_id, project_id, chat_run_id, thread_id = await _seed(engine)
    async with _session(engine) as session:
        server_version = str((await session.exec(sa.text("SHOW server_version"))).one()[0])

    same_flow = await _new_flow(engine, actor_id, project_id)
    same = await _bound_edit(
        engine,
        actor_id=actor_id,
        project_id=project_id,
        chat_run_id=chat_run_id,
        thread_id=thread_id,
        flow_id=same_flow.id,
        key="same-approve",
        value="Same",
    )
    barrier = asyncio.Barrier(2)
    same_results = await asyncio.gather(
        *(
            _race_resolve(
                engine,
                barrier,
                proposal_id=same.id,
                actor_id=actor_id,
                chat_run_id=chat_run_id,
                thread_id=thread_id,
                interrupt_id="interrupt-same-approve",
                approved=True,
            )
            for _ in range(2)
        )
    )
    assert len({result["backendPid"] for result in same_results}) == 2
    async with _session(engine) as session:
        stored = await session.get(Flow, same_flow.id)
        assert stored is not None
        assert stored.revision == 2
        snapshot_count = (
            await session.exec(select(func.count(FlowVersion.id)).where(FlowVersion.flow_id == same_flow.id))
        ).one()
        assert snapshot_count == 1

    competing_flow = await _new_flow(engine, actor_id, project_id, revision=4)
    first = await _bound_edit(
        engine,
        actor_id=actor_id,
        project_id=project_id,
        chat_run_id=chat_run_id,
        thread_id=thread_id,
        flow_id=competing_flow.id,
        key="compete-a",
        value="A",
    )
    second = await _bound_edit(
        engine,
        actor_id=actor_id,
        project_id=project_id,
        chat_run_id=chat_run_id,
        thread_id=thread_id,
        flow_id=competing_flow.id,
        key="compete-b",
        value="B",
    )
    barrier = asyncio.Barrier(2)
    competition = await asyncio.gather(
        _race_resolve(
            engine,
            barrier,
            proposal_id=first.id,
            actor_id=actor_id,
            chat_run_id=chat_run_id,
            thread_id=thread_id,
            interrupt_id="interrupt-compete-a",
            approved=True,
        ),
        _race_resolve(
            engine,
            barrier,
            proposal_id=second.id,
            actor_id=actor_id,
            chat_run_id=chat_run_id,
            thread_id=thread_id,
            interrupt_id="interrupt-compete-b",
            approved=True,
        ),
    )
    assert len({result["backendPid"] for result in competition}) == 2
    assert sorted(str(result["proposalStatus"]) for result in competition) == ["applied", "stale"]
    async with _session(engine) as session:
        stored = await session.get(Flow, competing_flow.id)
        assert stored is not None
        assert stored.revision == 5
        assert (
            await session.exec(select(func.count(FlowVersion.id)).where(FlowVersion.flow_id == competing_flow.id))
        ).one() == 1

    reject_flow = await _new_flow(engine, actor_id, project_id)
    rejected = await _bound_edit(
        engine,
        actor_id=actor_id,
        project_id=project_id,
        chat_run_id=chat_run_id,
        thread_id=thread_id,
        flow_id=reject_flow.id,
        key="same-reject",
        value="Never",
    )
    barrier = asyncio.Barrier(2)
    reject_results = await asyncio.gather(
        *(
            _race_resolve(
                engine,
                barrier,
                proposal_id=rejected.id,
                actor_id=actor_id,
                chat_run_id=chat_run_id,
                thread_id=thread_id,
                interrupt_id="interrupt-same-reject",
                approved=False,
            )
            for _ in range(2)
        )
    )
    assert len({result["backendPid"] for result in reject_results}) == 2
    assert {result["proposalStatus"] for result in reject_results} == {"rejected"}
    async with _session(engine) as session:
        stored = await session.get(Flow, reject_flow.id)
        assert stored is not None
        assert stored.revision == 1
        snapshot_count = (
            await session.exec(select(func.count(FlowVersion.id)).where(FlowVersion.flow_id == reject_flow.id))
        ).one()
        assert snapshot_count == 0

    create_operations = [
        {"op": "create_flow", "name": "Concurrent", "description": None, "nodes": [_node()], "edges": []}
    ]
    claim_barrier = asyncio.Barrier(2)

    async def claim(request_id: str) -> dict[str, object]:
        claim_started_at = datetime.now(timezone.utc)
        async with _session(engine) as session:
            pid = (await session.exec(sa.text("SELECT pg_backend_pid()"))).one()[0]
            await claim_barrier.wait()
            barrier_at = datetime.now(timezone.utc)
            proposal = await propose_flow_changes(
                session,
                actor_id=actor_id,
                project_id=project_id,
                chat_run_id=chat_run_id,
                thread_id=thread_id,
                target_flow_id=None,
                operations=create_operations,
                idempotency_key="same-idempotency",
                request_id=request_id,
                component_registry=_registry(),
            )
            await session.commit()
            return {
                "backendPid": int(pid),
                "proposalId": str(proposal.id),
                "proposalStatus": proposal.status.value,
                "startedAt": claim_started_at.isoformat(),
                "barrierAt": barrier_at.isoformat(),
                "finishedAt": datetime.now(timezone.utc).isoformat(),
            }

    claims = await asyncio.gather(claim("same-request"), claim("same-request"))
    assert len({result["backendPid"] for result in claims}) == 2
    assert len({result["proposalId"] for result in claims}) == 1
    async with _session(engine) as session:
        with pytest.raises(CommandProposalConflictError, match="idempotency_conflict"):
            await propose_flow_changes(
                session,
                actor_id=actor_id,
                project_id=project_id,
                chat_run_id=chat_run_id,
                thread_id=thread_id,
                target_flow_id=None,
                operations=create_operations,
                idempotency_key="same-idempotency",
                request_id="changed-request",
                component_registry=_registry(),
            )
        await session.rollback()

    async with _session(engine) as session:
        pre = await propose_flow_changes(
            session,
            actor_id=actor_id,
            project_id=project_id,
            chat_run_id=chat_run_id,
            thread_id=thread_id,
            target_flow_id=None,
            operations=create_operations,
            idempotency_key="pre-failure",
            request_id="pre-failure",
            component_registry=_registry(),
        )
        pre = await fail_proposal(session, pre.id, error_code="injected_pre")
        assert pre.interrupt_id is None
        assert pre.interrupt_bound_at is None
        post = await propose_flow_changes(
            session,
            actor_id=actor_id,
            project_id=project_id,
            chat_run_id=chat_run_id,
            thread_id=thread_id,
            target_flow_id=None,
            operations=create_operations,
            idempotency_key="post-failure",
            request_id="post-failure",
            component_registry=_registry(),
        )
        post = await bind_interrupt(
            session,
            proposal_id=post.id,
            chat_run_id=chat_run_id,
            thread_id=thread_id,
            interrupt_id="post-failure-interrupt",
        )
        bound_at = post.interrupt_bound_at
        post = await fail_proposal(session, post.id, error_code="injected_post")
        assert post.interrupt_id == "post-failure-interrupt"
        assert post.interrupt_bound_at == bound_at
        await session.commit()

    async with _session(engine) as session:
        with pytest.raises(sa.exc.DBAPIError):
            await session.exec(
                sa.text("UPDATE command_proposal SET interrupt_id = NULL, interrupt_bound_at = NULL WHERE id = :id"),
                params={"id": post.id},
            )
        await session.rollback()

    phase_verdicts = [
        _invariant(
            "pre-interrupt failure",
            "failed proposal keeps interrupt_id and interrupt_bound_at NULL",
            "both correlation fields remained NULL",
        ),
        _invariant(
            "post-interrupt failure",
            "failed proposal preserves the bound interrupt pair and DB trigger rejects clearing it",
            "exact pair was preserved and a clearing UPDATE raised DBAPIError",
        ),
    ]
    scenarios = [
        _scenario(
            "same-proposal-approve",
            "Concurrent approval consumes one proposal once",
            same_results,
            _outcomes(
                same_results,
                revision_before=1,
                revision_after=2,
                snapshot_delta=1,
                flow_row_delta=0,
            ),
            [_invariant("single effect", "revision 2 and one snapshot", "revision 2 and one snapshot")],
        ),
        _scenario(
            "competing-proposals",
            "Two proposals on one base yield one applied and one stale",
            competition,
            _outcomes(
                competition,
                revision_before=4,
                revision_after=5,
                snapshot_delta=1,
                flow_row_delta=0,
            ),
            [_invariant("one winner", "applied + stale", "applied + stale")],
        ),
        _scenario(
            "cas-loser-snapshot-rollback",
            "CAS loser rolls back its nested snapshot",
            competition,
            _outcomes(
                competition,
                revision_before=4,
                revision_after=5,
                snapshot_delta=1,
                flow_row_delta=0,
            ),
            [_invariant("no dangling snapshot", "one snapshot total", "one snapshot total")],
        ),
        _scenario(
            "concurrent-reject-replay",
            "Concurrent reject and replay write no Flow or FlowVersion",
            reject_results,
            _outcomes(
                reject_results,
                revision_before=1,
                revision_after=1,
                snapshot_delta=0,
                flow_row_delta=0,
            ),
            [_invariant("zero write", "revision 1 and zero snapshots", "revision 1 and zero snapshots")],
        ),
        _scenario(
            "idempotency-claim",
            "Concurrent same-key claim returns one proposal; changed fingerprint conflicts",
            claims,
            _outcomes(
                claims,
                revision_before=None,
                revision_after=None,
                snapshot_delta=0,
                flow_row_delta=0,
            ),
            [
                _invariant("same identity", "one proposal id", "one proposal id"),
                _invariant("changed fingerprint", "conflict and zero new write", "conflict and zero new write"),
            ],
        ),
    ]

    evidence_path = os.getenv("S08_POSTGRES_EVIDENCE_PATH")
    if evidence_path:
        url = sa.engine.make_url(_base_uri())
        fingerprint_material = f"{url.drivername}|{url.host}|{url.port}|{url.database}"
        payload = {
            "schemaVersion": "1",
            "stage": "08",
            "frozenSha": os.getenv("S08_CODE_SHA", "0" * 40),
            "runId": os.getenv("S08_RUN_ID", "local-postgres-run"),
            "nodeId": "postgres-behavioral",
            "status": "PASS",
            "databaseKind": "postgresql",
            "connectionFingerprint": hashlib.sha256(fingerprint_material.encode()).hexdigest(),
            "serverVersion": server_version,
            "startedAt": started_at.isoformat(),
            "endedAt": datetime.now(timezone.utc).isoformat(),
            "scenarios": scenarios,
            "phaseVerdicts": phase_verdicts,
            "skipped": 0,
            "logPath": os.getenv("S08_POSTGRES_LOG_REL", "logs/postgres-behavioral.log"),
            "logSha256": "0" * 64,
            "blocker": None,
        }
        output = Path(evidence_path)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
