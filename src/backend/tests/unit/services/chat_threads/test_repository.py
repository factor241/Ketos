from __future__ import annotations

import asyncio
import hashlib
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

import pytest
from ketos.services.chat_threads.repository import (
    ChatIdempotencyConflictError,
    ChatNotFoundError,
    ChatRevisionConflictError,
    claim_chat_run,
    compare_and_swap_chat,
    require_owned_chat,
)
from ketos.services.database.models.chat_thread.model import ChatRun, ChatThread
from ketos.services.database.models.folder.model import Folder
from ketos.services.deps import session_scope
from sqlmodel import select

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from ketos.services.database.models.user.model import User

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("client")]


def _fingerprint(label: str) -> str:
    return hashlib.sha256(label.encode()).hexdigest()


async def _create_chat(*, created_by_id: UUID, folder_user_id: UUID | None) -> UUID:
    async with session_scope() as session:
        folder = Folder(id=uuid4(), name=f"repository-test-{uuid4()}", user_id=folder_user_id)
        session.add(folder)
        await session.commit()
        chat = ChatThread(
            project_id=folder.id,
            created_by_id=created_by_id,
            title="Original title",
            provider="openai",
            model_name="stage05-model",
            context_policy="chat_only",
        )
        session.add(chat)
        await session.commit()
        await session.refresh(chat)
        return chat.id


async def _load_chat(chat_id: UUID) -> ChatThread:
    async with session_scope() as session:
        chat = (await session.exec(select(ChatThread).where(ChatThread.id == chat_id))).one()
        session.expunge(chat)
        return chat


async def _load_runs(chat_id: UUID) -> list[ChatRun]:
    async with session_scope() as session:
        result = await session.exec(select(ChatRun).where(ChatRun.chat_id == chat_id).order_by(ChatRun.run_sequence))
        runs = list(result.all())
        for run in runs:
            session.expunge(run)
        return runs


def _actor_id(active_user: User) -> UUID:
    return UUID(str(active_user.id))


async def test_require_owned_chat_uses_project_owner_exclusively(active_user: User) -> None:
    actor_id = _actor_id(active_user)
    owned_id = await _create_chat(created_by_id=actor_id, folder_user_id=actor_id)
    ownerless_id = await _create_chat(created_by_id=actor_id, folder_user_id=None)
    async with session_scope() as session:
        assert (await require_owned_chat(session, chat_id=owned_id, actor_id=actor_id)).id == owned_id
    async with session_scope() as session:
        with pytest.raises(ChatNotFoundError) as foreign:
            await require_owned_chat(session, chat_id=owned_id, actor_id=uuid4())
    async with session_scope() as session:
        with pytest.raises(ChatNotFoundError) as ownerless:
            await require_owned_chat(session, chat_id=ownerless_id, actor_id=actor_id)
    assert foreign.value.args == ownerless.value.args


async def test_compare_and_swap_has_one_winner(active_user: User) -> None:
    actor_id = _actor_id(active_user)
    chat_id = await _create_chat(created_by_id=actor_id, folder_user_id=actor_id)
    async with session_scope() as session:
        winner = await compare_and_swap_chat(
            session,
            chat_id=chat_id,
            actor_id=actor_id,
            expected_revision=0,
            values={"title": "Winning title"},
        )
    assert (winner.title, winner.revision) == ("Winning title", 1)
    async with session_scope() as session:
        with pytest.raises(ChatRevisionConflictError) as stale:
            await compare_and_swap_chat(
                session,
                chat_id=chat_id,
                actor_id=actor_id,
                expected_revision=0,
                values={"title": "Stale overwrite"},
            )
    assert stale.value.code == "chat_revision_conflict"
    persisted = await _load_chat(chat_id)
    assert (persisted.title, persisted.revision) == ("Winning title", 1)


async def test_claim_chat_run_same_idempotency_replays_existing_sequence(active_user: User) -> None:
    actor_id = _actor_id(active_user)
    chat_id = await _create_chat(created_by_id=actor_id, folder_user_id=actor_id)
    async with session_scope() as session:
        initial = await claim_chat_run(
            session,
            chat_id=chat_id,
            actor_id=actor_id,
            ag_ui_run_id=f"ag-{uuid4()}",
            idempotency_key="claim-once",
            request_fingerprint=_fingerprint("same"),
        )
    async with session_scope() as session:
        replay = await claim_chat_run(
            session,
            chat_id=chat_id,
            actor_id=actor_id,
            ag_ui_run_id=f"ag-retry-{uuid4()}",
            idempotency_key="claim-once",
            request_fingerprint=_fingerprint("same"),
        )
    assert not initial.replayed
    assert replay.replayed
    assert initial.run.id == replay.run.id
    assert initial.run.run_sequence == replay.run.run_sequence == 1
    assert initial.run.langgraph_thread_id == str(chat_id)
    assert len(await _load_runs(chat_id)) == 1


async def test_fingerprint_conflict_inserts_nothing(active_user: User) -> None:
    actor_id = _actor_id(active_user)
    chat_id = await _create_chat(created_by_id=actor_id, folder_user_id=actor_id)
    async with session_scope() as session:
        initial = await claim_chat_run(
            session,
            chat_id=chat_id,
            actor_id=actor_id,
            ag_ui_run_id=f"ag-{uuid4()}",
            idempotency_key="same-key",
            request_fingerprint=_fingerprint("a"),
        )
    async with session_scope() as session:
        with pytest.raises(ChatIdempotencyConflictError) as conflict:
            await claim_chat_run(
                session,
                chat_id=chat_id,
                actor_id=actor_id,
                ag_ui_run_id=f"ag-{uuid4()}",
                idempotency_key="same-key",
                request_fingerprint=_fingerprint("b"),
            )
    assert conflict.value.code == "chat_idempotency_conflict"
    runs = await _load_runs(chat_id)
    assert len(runs) == 1
    assert runs[0].id == initial.run.id


async def test_distinct_keys_allocate_monotonic_sequences(active_user: User) -> None:
    actor_id = _actor_id(active_user)
    chat_id = await _create_chat(created_by_id=actor_id, folder_user_id=actor_id)
    claims = []
    for index in (1, 2):
        async with session_scope() as session:
            claims.append(
                await claim_chat_run(
                    session,
                    chat_id=chat_id,
                    actor_id=actor_id,
                    ag_ui_run_id=f"ag-{uuid4()}",
                    idempotency_key=f"key-{index}",
                    request_fingerprint=_fingerprint(str(index)),
                )
            )
    assert [claim.run.run_sequence for claim in claims] == [1, 2]
    assert len({run.id for run in await _load_runs(chat_id)}) == 2


def _concurrent_claimers(
    *, chat_id: UUID, actor_id: UUID, keys: tuple[str, str], fingerprints: tuple[str, str]
) -> tuple[Callable[[], Awaitable[object]], Callable[[], Awaitable[object]]]:
    ready = asyncio.Event()
    arrived = 0

    async def claim(index: int):
        nonlocal arrived
        async with session_scope() as session:
            arrived += 1
            if arrived == 2:
                ready.set()
            await ready.wait()
            return await claim_chat_run(
                session,
                chat_id=chat_id,
                actor_id=actor_id,
                ag_ui_run_id=f"ag-{uuid4()}",
                idempotency_key=keys[index],
                request_fingerprint=fingerprints[index],
            )

    return lambda: claim(0), lambda: claim(1)


async def test_claim_chat_run_two_writers_allocate_distinct_run_sequences(active_user: User) -> None:
    actor_id = _actor_id(active_user)
    chat_id = await _create_chat(created_by_id=actor_id, folder_user_id=actor_id)
    first, second = _concurrent_claimers(
        chat_id=chat_id,
        actor_id=actor_id,
        keys=("concurrent-a", "concurrent-b"),
        fingerprints=(_fingerprint("a"), _fingerprint("b")),
    )
    claims = await asyncio.gather(first(), second())
    assert {claim.run.run_sequence for claim in claims} == {1, 2}
    assert all(not claim.replayed for claim in claims)


async def test_two_writers_coalesce_same_key(active_user: User) -> None:
    actor_id = _actor_id(active_user)
    chat_id = await _create_chat(created_by_id=actor_id, folder_user_id=actor_id)
    fingerprint = _fingerprint("shared")
    first, second = _concurrent_claimers(
        chat_id=chat_id,
        actor_id=actor_id,
        keys=("concurrent-same", "concurrent-same"),
        fingerprints=(fingerprint, fingerprint),
    )
    claims = await asyncio.gather(first(), second())
    assert claims[0].run.id == claims[1].run.id
    assert sorted(claim.replayed for claim in claims) == [False, True]
    assert len(await _load_runs(chat_id)) == 1


@pytest.mark.parametrize("max_attempts", [0, 6])
async def test_claim_rejects_attempts_outside_bounds(active_user: User, max_attempts: int) -> None:
    actor_id = _actor_id(active_user)
    chat_id = await _create_chat(created_by_id=actor_id, folder_user_id=actor_id)
    async with session_scope() as session:
        with pytest.raises(ValueError, match="max_attempts"):
            await claim_chat_run(
                session,
                chat_id=chat_id,
                actor_id=actor_id,
                ag_ui_run_id=f"ag-{uuid4()}",
                idempotency_key="invalid",
                request_fingerprint=_fingerprint("invalid"),
                max_attempts=max_attempts,
            )
    assert await _load_runs(chat_id) == []


async def test_foreign_actor_fails_before_insert(active_user: User) -> None:
    owner_id = _actor_id(active_user)
    chat_id = await _create_chat(created_by_id=owner_id, folder_user_id=owner_id)
    async with session_scope() as session:
        with pytest.raises(ChatNotFoundError):
            await claim_chat_run(
                session,
                chat_id=chat_id,
                actor_id=uuid4(),
                ag_ui_run_id=f"ag-{uuid4()}",
                idempotency_key="foreign",
                request_fingerprint=_fingerprint("foreign"),
            )
    assert await _load_runs(chat_id) == []


async def test_chat_run_sequence_not_published_without_committed_insert(active_user: User) -> None:
    actor_id = _actor_id(active_user)
    chat_id = await _create_chat(created_by_id=actor_id, folder_user_id=actor_id)
    injected_failure = "injected pre-flush failure"

    async def fail_before_flush(_run: ChatRun) -> None:
        raise RuntimeError(injected_failure)

    async with session_scope() as session:
        with pytest.raises(RuntimeError, match=injected_failure):
            await claim_chat_run(
                session,
                chat_id=chat_id,
                actor_id=actor_id,
                ag_ui_run_id=f"ag-{uuid4()}",
                idempotency_key="failed-before-flush",
                request_fingerprint=_fingerprint("failure"),
                before_flush=fail_before_flush,
            )
    assert await _load_runs(chat_id) == []

    async with session_scope() as session:
        successful = await claim_chat_run(
            session,
            chat_id=chat_id,
            actor_id=actor_id,
            ag_ui_run_id=f"ag-{uuid4()}",
            idempotency_key="successful-after-failure",
            request_fingerprint=_fingerprint("success"),
        )
    assert successful.run.run_sequence == 1
    assert len(await _load_runs(chat_id)) == 1


@pytest.mark.parametrize(
    ("ag_ui_run_id", "idempotency_key"),
    [("a" * 257, "valid-key"), ("valid-run-id", "k" * 513)],
)
async def test_claim_rejects_identifiers_over_storage_bounds(
    active_user: User, ag_ui_run_id: str, idempotency_key: str
) -> None:
    actor_id = _actor_id(active_user)
    chat_id = await _create_chat(created_by_id=actor_id, folder_user_id=actor_id)
    async with session_scope() as session:
        with pytest.raises(ValueError, match="must not exceed"):
            await claim_chat_run(
                session,
                chat_id=chat_id,
                actor_id=actor_id,
                ag_ui_run_id=ag_ui_run_id,
                idempotency_key=idempotency_key,
                request_fingerprint=_fingerprint("bounded"),
            )
    assert await _load_runs(chat_id) == []
