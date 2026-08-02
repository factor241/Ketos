from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel import SQLModel, func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from ketos.services.chat_threads.recovery import (
    ChatRunRecoveryConflictError,
    ChatRunRecoveryNotFoundError,
    classify_nonterminal_runs,
    reconcile_nonterminal_chat_runs,
    reconcile_owned_run,
)
from ketos.services.database.models.chat_thread.model import ChatRun, ChatRunStatus, ChatThread
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.message.model import MessageTable
from ketos.services.database.models.user.model import User


class FakeCheckpointProbe:
    def __init__(self, resumable_thread_ids: set[str] | None = None) -> None:
        self.resumable_thread_ids = resumable_thread_ids or set()
        self.calls: list[str] = []

    async def has_resumable_checkpoint(self, thread_id: str) -> bool:
        self.calls.append(thread_id)
        return thread_id in self.resumable_thread_ids


class FakeSaver:
    def __init__(self, resumable_thread_ids: set[str]) -> None:
        self.resumable_thread_ids = resumable_thread_ids

    async def aget_tuple(self, config):
        thread_id = config["configurable"]["thread_id"]
        return object() if thread_id in self.resumable_thread_ids else None


@pytest.fixture(name="recovery_session")
async def recovery_session_fixture():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(SQLModel.metadata.create_all)
    async with AsyncSession(engine, expire_on_commit=False) as session:
        yield session
    await engine.dispose()


async def _seed_run(
    session: AsyncSession,
    *,
    status: ChatRunStatus = ChatRunStatus.CLAIMED,
    fingerprint: str = "a" * 64,
) -> tuple[UUID, ChatRun]:
    actor_id = uuid4()
    folder = Folder(id=uuid4(), name=f"stage09-{uuid4()}", user_id=actor_id)
    chat = ChatThread(
        id=uuid4(),
        project_id=folder.id,
        created_by_id=actor_id,
        title="Stage 09",
        provider="test",
        model_name="test",
        context_policy="chat_only",
    )
    run = ChatRun(
        id=uuid4(),
        chat_id=chat.id,
        ag_ui_run_id=f"ag-{uuid4()}",
        langgraph_thread_id=str(chat.id),
        idempotency_key=f"key-{uuid4()}",
        request_fingerprint=fingerprint,
        status=status,
        run_sequence=1,
    )
    session.add(User(id=actor_id, username=f"stage09-{actor_id}", password="stage09-hash"))
    session.add(folder)
    session.add(chat)
    session.add(run)
    await session.commit()
    return actor_id, run


async def test_startup_classifies_resumable_and_missing_without_running_graph(
    recovery_session: AsyncSession,
) -> None:
    _actor_a, resumable = await _seed_run(recovery_session)
    _actor_b, missing = await _seed_run(recovery_session, status=ChatRunStatus.RUNNING)
    _actor_c, terminal = await _seed_run(recovery_session, status=ChatRunStatus.SUCCEEDED)
    probe = FakeCheckpointProbe({resumable.langgraph_thread_id})

    results = await classify_nonterminal_runs(recovery_session, probe=probe)
    await recovery_session.refresh(resumable)
    await recovery_session.refresh(missing)
    await recovery_session.refresh(terminal)

    assert {item.run_id for item in results} == {resumable.id, missing.id}
    assert resumable.status == ChatRunStatus.CLAIMED
    assert missing.status == ChatRunStatus.FAILED_RECOVERABLE
    assert missing.outcome == "backend_restarted"
    assert missing.finished_at is not None
    assert terminal.status == ChatRunStatus.SUCCEEDED
    assert probe.calls == [resumable.langgraph_thread_id, missing.langgraph_thread_id]


async def test_request_reconcile_missing_checkpoint_transitions_once(
    recovery_session: AsyncSession,
) -> None:
    actor_id, run = await _seed_run(recovery_session, status=ChatRunStatus.RUNNING)
    probe = FakeCheckpointProbe()

    first = await reconcile_owned_run(
        recovery_session,
        run_id=run.id,
        actor_id=actor_id,
        request_fingerprint=run.request_fingerprint,
        probe=probe,
    )
    await recovery_session.refresh(run)
    first_finished_at = run.finished_at
    first_audit = dict(run.redacted_audit)
    second = await reconcile_owned_run(
        recovery_session,
        run_id=run.id,
        actor_id=actor_id,
        request_fingerprint=run.request_fingerprint,
        probe=probe,
    )
    await recovery_session.refresh(run)

    assert first.status == second.status == ChatRunStatus.FAILED_RECOVERABLE
    assert first.changed is True
    assert second.changed is False
    assert probe.calls == [run.langgraph_thread_id]
    assert run.finished_at == first_finished_at
    assert run.redacted_audit == first_audit
    assert run.redacted_audit == {
        "checkpoint": "missing_or_unsupported",
        "reason": "backend_restarted",
    }


async def test_changed_fingerprint_conflicts_before_checkpoint_lookup(
    recovery_session: AsyncSession,
) -> None:
    actor_id, run = await _seed_run(recovery_session)
    probe = FakeCheckpointProbe({run.langgraph_thread_id})

    with pytest.raises(ChatRunRecoveryConflictError):
        await reconcile_owned_run(
            recovery_session,
            run_id=run.id,
            actor_id=actor_id,
            request_fingerprint="b" * 64,
            probe=probe,
        )

    assert probe.calls == []


async def test_terminal_run_is_untouched_without_checkpoint_lookup(
    recovery_session: AsyncSession,
) -> None:
    actor_id, run = await _seed_run(recovery_session, status=ChatRunStatus.SUCCEEDED)
    run.outcome = "completed"
    run.redacted_audit = {"terminal": "preserved"}
    await recovery_session.commit()
    probe = FakeCheckpointProbe({run.langgraph_thread_id})

    result = await reconcile_owned_run(
        recovery_session,
        run_id=run.id,
        actor_id=actor_id,
        request_fingerprint=run.request_fingerprint,
        probe=probe,
    )

    assert result.status == ChatRunStatus.SUCCEEDED
    assert result.changed is False
    assert probe.calls == []
    assert run.outcome == "completed"
    assert run.redacted_audit == {"terminal": "preserved"}


async def test_startup_limit_is_bounded_and_validated(
    recovery_session: AsyncSession,
) -> None:
    _actor_a, first = await _seed_run(recovery_session)
    _actor_b, _second = await _seed_run(recovery_session)
    probe = FakeCheckpointProbe({first.langgraph_thread_id})

    results = await classify_nonterminal_runs(recovery_session, probe=probe, limit=1)

    assert len(results) == 1
    assert len(probe.calls) == 1
    with pytest.raises(ValueError, match="between 1 and 1000"):
        await classify_nonterminal_runs(recovery_session, probe=probe, limit=0)


async def test_frozen_reconcile_interface_returns_bounded_summary(
    recovery_session: AsyncSession,
) -> None:
    actor_id, resumable = await _seed_run(recovery_session)
    _foreign_actor, _foreign = await _seed_run(recovery_session)

    summary = await reconcile_nonterminal_chat_runs(
        session=recovery_session,
        checkpointer=FakeSaver({resumable.langgraph_thread_id}),
        owner_id=actor_id,
    )

    assert summary.scanned == 1
    assert summary.resumable == 1
    assert summary.failed_recoverable == 0
    assert summary.run_ids == (resumable.id,)


async def test_foreign_owner_gets_no_checkpoint_state(
    recovery_session: AsyncSession,
) -> None:
    _actor_id, run = await _seed_run(recovery_session)
    probe = FakeCheckpointProbe({run.langgraph_thread_id})

    with pytest.raises(ChatRunRecoveryNotFoundError):
        await reconcile_owned_run(
            recovery_session,
            run_id=run.id,
            actor_id=uuid4(),
            request_fingerprint=run.request_fingerprint,
            probe=probe,
        )

    assert probe.calls == []


async def test_resumable_reconcile_keeps_same_row_and_message_counts(
    recovery_session: AsyncSession,
) -> None:
    actor_id, run = await _seed_run(recovery_session)
    probe = FakeCheckpointProbe({run.langgraph_thread_id})
    before_runs = (await recovery_session.exec(select(func.count(ChatRun.id)))).one()
    before_messages = (await recovery_session.exec(select(func.count(MessageTable.id)))).one()

    result = await reconcile_owned_run(
        recovery_session,
        run_id=run.id,
        actor_id=actor_id,
        request_fingerprint=run.request_fingerprint,
        probe=probe,
    )

    assert result.run_id == run.id
    assert result.checkpoint_resumable is True
    assert result.changed is False
    assert (await recovery_session.exec(select(func.count(ChatRun.id)))).one() == before_runs == 1
    assert (await recovery_session.exec(select(func.count(MessageTable.id)))).one() == before_messages == 0
