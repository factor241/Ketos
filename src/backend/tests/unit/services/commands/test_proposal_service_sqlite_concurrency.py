from __future__ import annotations

import asyncio
from uuid import uuid4

from ketos.services.commands.proposal_service import ensure_proposal
from ketos.services.database.models.chat_thread.model import ChatRun, ChatThread
from ketos.services.database.models.command_proposal.model import CommandProposal
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.user.model import User
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel import SQLModel, func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from .conftest import CommandContext
from .test_proposal_service import _spec

_TEST_PASSWORD = "stage08-hash"  # noqa: S105  # pragma: allowlist secret


async def _sqlite_context(engine) -> CommandContext:
    actor_id = uuid4()
    project_id = uuid4()
    chat_id = uuid4()
    chat_run_id = uuid4()
    thread_id = str(chat_id)
    async with AsyncSession(engine, expire_on_commit=False) as session:
        session.add(User(id=actor_id, username=f"stage08-{actor_id}", password=_TEST_PASSWORD))
        session.add(Folder(id=project_id, name="Stage 08 concurrency", user_id=actor_id))
        session.add(
            ChatThread(
                id=chat_id,
                project_id=project_id,
                created_by_id=actor_id,
                title="Stage 08 concurrency",
                provider="test",
                model_name="test",
                context_policy="chat_only",
            )
        )
        session.add(
            ChatRun(
                id=chat_run_id,
                chat_id=chat_id,
                ag_ui_run_id="sqlite-concurrency",
                langgraph_thread_id=thread_id,
                idempotency_key="sqlite-chat-run",
                request_fingerprint="d" * 64,
                run_sequence=1,
            )
        )
        await session.commit()
    return CommandContext(actor_id, project_id, chat_id, chat_run_id, thread_id)


async def test_sqlite_concurrent_idempotency_and_sequence_claims(tmp_path) -> None:
    database = tmp_path / "stage08-command-concurrency.sqlite"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database}", connect_args={"timeout": 15})
    async with engine.begin() as connection:
        await connection.run_sync(SQLModel.metadata.create_all)
    context = await _sqlite_context(engine)

    async def claim(key: str, fingerprint: str):
        async with AsyncSession(engine, expire_on_commit=False) as session:
            proposal = await ensure_proposal(
                session,
                _spec(
                    context,
                    idempotency_key=key,
                    request_fingerprint=fingerprint,
                    request_id=f"request-{key}",
                ),
            )
            await session.commit()
            return proposal.id, proposal.sequence

    same = await asyncio.gather(
        claim("same-key", "1" * 64),
        claim("same-key", "1" * 64),
    )
    assert same[0] == same[1]

    different = await asyncio.gather(
        *(claim(f"key-{index}", f"{index + 2:x}" * 64) for index in range(5))
    )
    assert sorted(sequence for _, sequence in different) == [2, 3, 4, 5, 6]
    async with AsyncSession(engine) as session:
        count = (
            await session.exec(
                select(func.count()).select_from(CommandProposal).where(
                    CommandProposal.chat_run_id == context.chat_run_id
                )
            )
        ).one()
    assert count == 6
    await engine.dispose()
