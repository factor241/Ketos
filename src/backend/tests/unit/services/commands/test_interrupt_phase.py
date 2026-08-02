from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING

import pytest
from ketos.services.commands.exceptions import CommandProposalCorrelationError
from ketos.services.commands.proposal_service import bind_interrupt, ensure_proposal, fail_proposal
from ketos.services.database.models.command_proposal.model import CommandProposalStatus

from .test_proposal_service import _spec

if TYPE_CHECKING:
    from sqlmodel.ext.asyncio.session import AsyncSession

    from .conftest import CommandContext


async def test_interrupt_bind_is_idempotent_and_recomputes_phase_hash_once(
    command_session: AsyncSession, command_context: CommandContext
) -> None:
    proposal = await ensure_proposal(command_session, _spec(command_context))
    pre_hash = proposal.proposal_hash
    bound_at = datetime(2026, 7, 21, tzinfo=timezone.utc)

    bound = await bind_interrupt(
        command_session,
        proposal_id=proposal.id,
        chat_run_id=command_context.chat_run_id,
        thread_id=command_context.thread_id,
        interrupt_id="actual-interrupt",
        bound_at=bound_at,
    )
    replay = await bind_interrupt(
        command_session,
        proposal_id=proposal.id,
        chat_run_id=command_context.chat_run_id,
        thread_id=command_context.thread_id,
        interrupt_id="actual-interrupt",
        bound_at=datetime(2026, 7, 22, tzinfo=timezone.utc),
    )

    assert bound.status == CommandProposalStatus.AWAITING_CONFIRMATION
    assert bound.proposal_hash != pre_hash
    assert replay.proposal_hash == bound.proposal_hash
    assert replay.interrupt_bound_at == bound_at

    with pytest.raises(CommandProposalCorrelationError, match="interrupt_rebind"):
        await bind_interrupt(
            command_session,
            proposal_id=proposal.id,
            chat_run_id=command_context.chat_run_id,
            thread_id=command_context.thread_id,
            interrupt_id="forged-interrupt",
            bound_at=bound_at,
        )


async def test_pre_and_post_interrupt_failures_preserve_exact_phase(
    command_session: AsyncSession, command_context: CommandContext
) -> None:
    pre = await ensure_proposal(command_session, _spec(command_context, idempotency_key="pre"))
    pre_failed = await fail_proposal(command_session, pre.id, error_code="validation_failed")
    assert pre_failed.status == CommandProposalStatus.FAILED
    assert pre_failed.interrupt_id is None
    assert pre_failed.interrupt_bound_at is None
    assert pre_failed.resolved_at is not None

    post = await ensure_proposal(command_session, _spec(command_context, idempotency_key="post"))
    post = await bind_interrupt(
        command_session,
        proposal_id=post.id,
        chat_run_id=command_context.chat_run_id,
        thread_id=command_context.thread_id,
        interrupt_id="actual-post",
        bound_at=datetime(2026, 7, 21, tzinfo=timezone.utc),
    )
    frozen = (post.interrupt_id, post.interrupt_bound_at, post.proposal_hash)
    post_failed = await fail_proposal(command_session, post.id, error_code="serialize_failed")
    assert post_failed.status == CommandProposalStatus.FAILED
    assert (post_failed.interrupt_id, post_failed.interrupt_bound_at, post_failed.proposal_hash) == frozen
