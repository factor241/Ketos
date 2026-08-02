from __future__ import annotations

from typing import TYPE_CHECKING

from sqlmodel import func, select

from .model import CommandProposal

if TYPE_CHECKING:
    from uuid import UUID

    from sqlmodel.ext.asyncio.session import AsyncSession


async def get_command_proposal(session: AsyncSession, proposal_id: UUID) -> CommandProposal | None:
    return await session.get(CommandProposal, proposal_id)


async def get_command_proposal_by_idempotency(
    session: AsyncSession,
    *,
    chat_run_id: UUID,
    idempotency_key: str,
) -> CommandProposal | None:
    return (
        await session.exec(
            select(CommandProposal).where(
                CommandProposal.chat_run_id == chat_run_id,
                CommandProposal.idempotency_key == idempotency_key,
            )
        )
    ).one_or_none()


async def get_next_command_sequence(session: AsyncSession, chat_run_id: UUID) -> int:
    maximum = (
        await session.exec(select(func.max(CommandProposal.sequence)).where(CommandProposal.chat_run_id == chat_run_id))
    ).one()
    return (maximum or 0) + 1
