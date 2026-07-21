from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException

from ketos.api.utils import CurrentActiveUser, DbSession
from ketos.api.v1.schemas.command_proposals import CommandProposalRead, RestoreCommandProposalRequest
from ketos.services.commands.exceptions import (
    CommandProposalAuthorizationError,
    CommandProposalConflictError,
    CommandProposalNotFoundError,
)
from ketos.services.commands.service import load_authorized_proposal, restore_flow_snapshot

router = APIRouter(prefix="/command-proposals", tags=["Command proposals"])


@router.get("/{proposal_id}")
async def get_command_proposal(
    proposal_id: UUID,
    session: DbSession,
    current_user: CurrentActiveUser,
) -> CommandProposalRead:
    try:
        proposal = await load_authorized_proposal(session, proposal_id=proposal_id, actor_id=current_user.id)
    except (CommandProposalAuthorizationError, CommandProposalNotFoundError) as exc:
        raise HTTPException(status_code=404, detail={"code": exc.code}) from exc
    return CommandProposalRead.model_validate(proposal)


@router.post("/{proposal_id}/restore")
async def restore_command_proposal(
    proposal_id: UUID,
    payload: RestoreCommandProposalRequest,
    session: DbSession,
    current_user: CurrentActiveUser,
) -> CommandProposalRead:
    try:
        proposal = await restore_flow_snapshot(
            session,
            source_proposal_id=proposal_id,
            actor_id=current_user.id,
            idempotency_key=payload.idempotency_key,
            expected_flow_revision=payload.expected_flow_revision,
        )
        await session.commit()
    except (CommandProposalAuthorizationError, CommandProposalNotFoundError) as exc:
        await session.rollback()
        raise HTTPException(status_code=404, detail={"code": exc.code}) from exc
    except CommandProposalConflictError as exc:
        await session.rollback()
        raise HTTPException(status_code=409, detail={"code": exc.code}) from exc
    return CommandProposalRead.model_validate(proposal)
