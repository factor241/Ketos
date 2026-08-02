from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import uuid4

import pytest
from ketos.services.commands.contracts import CommandProposalSpec
from ketos.services.commands.exceptions import CommandProposalConflictError
from ketos.services.commands.proposal_service import ensure_proposal
from ketos.services.database.models.command_proposal.model import CommandProposal
from sqlmodel import func, select

if TYPE_CHECKING:
    from sqlmodel.ext.asyncio.session import AsyncSession

    from .conftest import CommandContext


def _spec(context: CommandContext, **updates) -> CommandProposalSpec:
    values = {
        "actor_id": context.actor_id,
        "project_id": context.project_id,
        "source_kind": "ai_run",
        "chat_run_id": context.chat_run_id,
        "thread_id": context.thread_id,
        "source_proposal_id": None,
        "flow_id": uuid4(),
        "command_type": "create_flow",
        "canonical_payload": {
            "schemaVersion": 1,
            "targetProjectId": str(context.project_id),
            "operations": [{"op": "create_flow"}],
        },
        "preview": {"risk": "low", "summary": "Create flow"},
        "base_flow_revision": None,
        "base_flow_hash": None,
        "result_flow_hash": "b" * 64,
        "idempotency_key": "proposal-key",
        "request_fingerprint": "c" * 64,
        "request_id": "request-1",
        "redacted_audit": {"source": "agent"},
    }
    values.update(updates)
    return CommandProposalSpec.model_validate(values)


async def test_same_idempotency_and_fingerprint_returns_one_durable_proposal(
    command_session: AsyncSession, command_context: CommandContext
) -> None:
    spec = _spec(command_context)
    first = await ensure_proposal(command_session, spec)
    await command_session.commit()
    second = await ensure_proposal(command_session, spec)

    count = (
        await command_session.exec(
            select(func.count()).select_from(CommandProposal).where(CommandProposal.chat_run_id == spec.chat_run_id)
        )
    ).one()
    assert first.id == second.id
    assert first.sequence == second.sequence == 1
    assert first.proposal_hash == second.proposal_hash
    assert count == 1


async def test_changed_fingerprint_for_same_key_is_conflict_without_new_row(
    command_session: AsyncSession, command_context: CommandContext
) -> None:
    first = await ensure_proposal(command_session, _spec(command_context))
    await command_session.commit()

    with pytest.raises(CommandProposalConflictError, match="idempotency_conflict"):
        await ensure_proposal(command_session, _spec(command_context, request_fingerprint="e" * 64))

    rows = (await command_session.exec(select(CommandProposal))).all()
    assert [row.id for row in rows] == [first.id]


async def test_different_keys_claim_monotonic_per_run_sequences(
    command_session: AsyncSession, command_context: CommandContext
) -> None:
    first = await ensure_proposal(command_session, _spec(command_context, idempotency_key="one"))
    await command_session.commit()
    second = await ensure_proposal(command_session, _spec(command_context, idempotency_key="two"))

    assert (first.sequence, second.sequence) == (1, 2)
