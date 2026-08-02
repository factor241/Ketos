from __future__ import annotations

import copy
from datetime import datetime, timezone
from time import monotonic
from typing import TYPE_CHECKING

from sqlalchemy.exc import IntegrityError
from sqlmodel import select, update

from ketos.services.commands.canonical import canonical_json_bytes, flow_content_hash, proposal_hash
from ketos.services.commands.exceptions import CommandProposalCorrelationError
from ketos.services.commands.flow_changes import apply_flow_changes, parse_flow_change_set
from ketos.services.commands.proposal_service import _material_from_row, load_authorized_proposal
from ketos.services.database.models.command_proposal.model import (
    CommandProposal,
    CommandProposalCommandType,
    CommandProposalStatus,
)
from ketos.services.database.models.flow.model import Flow
from ketos.services.database.models.flow_version.crud import create_pinned_flow_version_entry

if TYPE_CHECKING:
    from uuid import UUID

    from sqlmodel.ext.asyncio.session import AsyncSession

_ERR_HASH = "proposal_hash_mismatch"
_ERR_CONFIRMATION_SCOPE = "confirmation_scope_mismatch"


class _StaleFlowError(RuntimeError):
    pass


async def _claim_resolution(
    session: AsyncSession,
    proposal: CommandProposal,
    *,
    actor_id: UUID,
    chat_run_id: UUID,
    interrupt_id: str,
    approved: bool,
    resolved_at: datetime,
) -> bool:
    terminal = CommandProposalStatus.APPLIED if approved else CommandProposalStatus.REJECTED
    result = await session.exec(
        update(CommandProposal)
        .where(
            CommandProposal.id == proposal.id,
            CommandProposal.actor_id == actor_id,
            CommandProposal.chat_run_id == chat_run_id,
            CommandProposal.thread_id == proposal.thread_id,
            CommandProposal.interrupt_id == interrupt_id,
            CommandProposal.status == CommandProposalStatus.AWAITING_CONFIRMATION,
            CommandProposal.resolved_at.is_(None),
        )
        .values(status=terminal, resolved_at=resolved_at)
    )
    await session.refresh(proposal)
    return result.rowcount == 1  # type: ignore[union-attr]


async def resolve_proposal(
    session: AsyncSession,
    *,
    proposal_id: UUID,
    actor_id: UUID,
    chat_run_id: UUID,
    thread_id: str,
    interrupt_id: str,
    approved: bool,
    component_registry: dict,
) -> CommandProposal:
    """Consume one confirmation and atomically create/edit or reject its Flow."""
    started = monotonic()
    proposal = await load_authorized_proposal(session, proposal_id=proposal_id, actor_id=actor_id)
    if (
        proposal.chat_run_id != chat_run_id
        or proposal.thread_id != thread_id
        or proposal.interrupt_id != interrupt_id
    ):
        raise CommandProposalCorrelationError(_ERR_CONFIRMATION_SCOPE)
    if proposal.status != CommandProposalStatus.AWAITING_CONFIRMATION:
        return proposal
    if proposal_hash(_material_from_row(proposal)) != proposal.proposal_hash:
        raise CommandProposalCorrelationError(_ERR_HASH)
    resolved_at = datetime.now(timezone.utc)
    if not approved:
        if not await _claim_resolution(
            session,
            proposal,
            actor_id=actor_id,
            chat_run_id=chat_run_id,
            interrupt_id=interrupt_id,
            approved=False,
            resolved_at=resolved_at,
        ):
            return proposal
        proposal.outcome = {"code": "rejected", "effect": "none"}
        proposal.duration_ms = max(0, int((monotonic() - started) * 1000))
        await session.flush()
        return proposal

    change_set = parse_flow_change_set(canonical_json_bytes(proposal.canonical_payload))
    current_flow: Flow | None = None
    target: dict | None = None
    target_revision: int | None = None
    if proposal.command_type != CommandProposalCommandType.CREATE_FLOW:
        current_flow = (
            await session.exec(
                select(Flow).where(
                    Flow.id == proposal.flow_id,
                    Flow.user_id == actor_id,
                    Flow.folder_id == proposal.project_id,
                    Flow.fs_path.is_(None),
                )
            )
        ).one_or_none()
        if current_flow is not None:
            target = {
                "name": current_flow.name,
                "description": current_flow.description,
                "data": current_flow.data,
            }
            target_revision = current_flow.revision

    simulated = apply_flow_changes(
        change_set,
        target_flow=target,
        target_revision=target_revision,
        component_registry=component_registry,
    )
    if not await _claim_resolution(
        session,
        proposal,
        actor_id=actor_id,
        chat_run_id=chat_run_id,
        interrupt_id=interrupt_id,
        approved=True,
        resolved_at=resolved_at,
    ):
        return proposal

    if simulated.result_flow_hash != proposal.result_flow_hash:
        proposal.status = CommandProposalStatus.STALE
        proposal.outcome = {"code": "result_hash_mismatch", "effect": "none"}
        await session.flush()
        return proposal

    if proposal.command_type == CommandProposalCommandType.CREATE_FLOW:
        try:
            async with session.begin_nested():
                session.add(
                    Flow(
                        id=proposal.flow_id,
                        user_id=actor_id,
                        folder_id=proposal.project_id,
                        fs_path=None,
                        name=simulated.flow["name"],
                        description=simulated.flow["description"],
                        data=simulated.flow["data"],
                        revision=1,
                        updated_at=resolved_at,
                    )
                )
                await session.flush()
        except IntegrityError:
            proposal.status = CommandProposalStatus.STALE
            proposal.outcome = {"code": "create_conflict", "effect": "none"}
        else:
            proposal.outcome = {
                "code": "applied",
                "beforeRevision": None,
                "afterRevision": 1,
                "beforeHash": None,
                "afterHash": simulated.result_flow_hash,
            }
    elif (
        current_flow is None
        or current_flow.revision != proposal.base_flow_revision
        or flow_content_hash(current_flow) != proposal.base_flow_hash
    ):
        proposal.status = CommandProposalStatus.STALE
        proposal.outcome = {"code": "stale_base", "effect": "none"}
    else:
        snapshot = None
        try:
            async with session.begin_nested():
                snapshot = await create_pinned_flow_version_entry(
                    session,
                    flow_id=current_flow.id,
                    user_id=actor_id,
                    data=copy.deepcopy(current_flow.data),
                    source_flow_revision=current_flow.revision,
                    source_flow_hash=proposal.base_flow_hash,
                    description=f"Pre-AI snapshot for command {proposal.id}",
                )
                result = await session.exec(
                    update(Flow)
                    .where(
                        Flow.id == current_flow.id,
                        Flow.user_id == actor_id,
                        Flow.folder_id == proposal.project_id,
                        Flow.revision == proposal.base_flow_revision,
                    )
                    .values(
                        name=simulated.flow["name"],
                        description=simulated.flow["description"],
                        data=simulated.flow["data"],
                        revision=Flow.revision + 1,
                        updated_at=resolved_at,
                    )
                )
                if result.rowcount != 1:  # type: ignore[union-attr]
                    raise _StaleFlowError
        except (_StaleFlowError, IntegrityError):
            proposal.status = CommandProposalStatus.STALE
            proposal.outcome = {"code": "stale_cas", "effect": "none"}
        else:
            proposal.pinned_flow_version_id = snapshot.id
            proposal.outcome = {
                "code": "applied",
                "beforeRevision": proposal.base_flow_revision,
                "afterRevision": proposal.base_flow_revision + 1,
                "beforeHash": proposal.base_flow_hash,
                "afterHash": simulated.result_flow_hash,
            }

    proposal.duration_ms = max(0, int((monotonic() - started) * 1000))
    await session.flush()
    await session.refresh(proposal)
    return proposal
