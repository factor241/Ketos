from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import uuid4

import pytest
from ketos.services.commands.exceptions import CommandProposalAuthorizationError
from ketos.services.commands.proposal_service import ensure_proposal, load_authorized_proposal

from .test_proposal_service import _spec

if TYPE_CHECKING:
    from sqlmodel.ext.asyncio.session import AsyncSession

    from .conftest import CommandContext


async def test_recovery_requires_exact_proposal_run_thread_folder_owner_chain(
    command_session: AsyncSession, command_context: CommandContext
) -> None:
    proposal = await ensure_proposal(command_session, _spec(command_context))
    await command_session.commit()

    recovered = await load_authorized_proposal(
        command_session,
        proposal_id=proposal.id,
        actor_id=command_context.actor_id,
    )
    assert recovered.id == proposal.id

    with pytest.raises(CommandProposalAuthorizationError, match="recovery_scope_denied"):
        await load_authorized_proposal(command_session, proposal_id=proposal.id, actor_id=uuid4())


async def test_forged_persisted_thread_or_project_fails_closed(
    command_session: AsyncSession, command_context: CommandContext
) -> None:
    proposal = await ensure_proposal(command_session, _spec(command_context))
    await command_session.commit()

    proposal.thread_id = str(uuid4())
    await command_session.commit()
    with pytest.raises(CommandProposalAuthorizationError, match="recovery_scope_denied"):
        await load_authorized_proposal(
            command_session,
            proposal_id=proposal.id,
            actor_id=command_context.actor_id,
        )

    proposal.thread_id = command_context.thread_id
    proposal.project_id = uuid4()
    await command_session.commit()
    with pytest.raises(CommandProposalAuthorizationError, match="recovery_scope_denied"):
        await load_authorized_proposal(
            command_session,
            proposal_id=proposal.id,
            actor_id=command_context.actor_id,
        )
