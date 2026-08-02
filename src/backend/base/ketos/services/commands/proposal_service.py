from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy.exc import IntegrityError
from sqlmodel import select, update

from ketos.services.commands.canonical import ProposalHashMaterial, proposal_hash
from ketos.services.commands.exceptions import (
    CommandProposalAuthorizationError,
    CommandProposalConflictError,
    CommandProposalCorrelationError,
    CommandProposalNotFoundError,
)
from ketos.services.database.models.chat_thread.model import ChatRun, ChatThread
from ketos.services.database.models.command_proposal.crud import (
    get_command_proposal,
    get_command_proposal_by_idempotency,
    get_next_command_sequence,
)
from ketos.services.database.models.command_proposal.model import (
    CommandProposal,
    CommandProposalCommandType,
    CommandProposalSourceKind,
    CommandProposalStatus,
)
from ketos.services.database.models.flow.model import Flow
from ketos.services.database.models.folder.model import Folder

if TYPE_CHECKING:
    from uuid import UUID

    from sqlmodel.ext.asyncio.session import AsyncSession

    from ketos.services.commands.contracts import CommandProposalSpec

_MAX_SEQUENCE_RETRIES = 3
_ERR_IDEMPOTENCY_CONFLICT = "idempotency_conflict"
_ERR_SEQUENCE_CONFLICT = "sequence_conflict"
_ERR_PROPOSAL_NOT_FOUND = "proposal_not_found"
_ERR_INTERRUPT_SCOPE = "interrupt_scope_mismatch"
_ERR_INTERRUPT_REBIND = "interrupt_rebind"
_ERR_INTERRUPT_PHASE = "interrupt_phase_mismatch"
_ERR_RECOVERY_SCOPE = "recovery_scope_denied"


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _normalize_proposal_times(proposal: CommandProposal) -> CommandProposal:
    """Keep the service contract timezone-aware across SQLite and PostgreSQL."""
    proposal.created_at = _as_utc(proposal.created_at)  # type: ignore[assignment]
    proposal.interrupt_bound_at = _as_utc(proposal.interrupt_bound_at)
    proposal.resolved_at = _as_utc(proposal.resolved_at)
    return proposal


def _material_from_spec(spec: CommandProposalSpec, sequence: int) -> ProposalHashMaterial:
    return ProposalHashMaterial(
        source_kind=spec.source_kind.value,
        chat_run_id=spec.chat_run_id,
        thread_id=spec.thread_id,
        interrupt_id=None,
        interrupt_bound=False,
        source_proposal_id=spec.source_proposal_id,
        sequence=sequence,
        actor_id=spec.actor_id,
        project_id=spec.project_id,
        flow_id=spec.flow_id,
        command_type=spec.command_type.value,
        canonical_payload=spec.canonical_payload,
        base_flow_revision=spec.base_flow_revision,
        base_flow_hash=spec.base_flow_hash,
        result_flow_hash=spec.result_flow_hash,
        redacted_preview_summary=spec.preview,
    )


def _material_from_row(
    proposal: CommandProposal,
    *,
    interrupt_id: str | None = None,
    interrupt_bound: bool | None = None,
) -> ProposalHashMaterial:
    actual_interrupt_id = proposal.interrupt_id if interrupt_id is None else interrupt_id
    actual_bound = proposal.interrupt_bound_at is not None if interrupt_bound is None else interrupt_bound
    return ProposalHashMaterial(
        source_kind=proposal.source_kind.value,
        chat_run_id=proposal.chat_run_id,
        thread_id=proposal.thread_id,
        interrupt_id=actual_interrupt_id,
        interrupt_bound=actual_bound,
        source_proposal_id=proposal.source_proposal_id,
        sequence=proposal.sequence,
        actor_id=proposal.actor_id,
        project_id=proposal.project_id,
        flow_id=proposal.flow_id,
        command_type=proposal.command_type.value,
        canonical_payload=proposal.canonical_payload,
        base_flow_revision=proposal.base_flow_revision,
        base_flow_hash=proposal.base_flow_hash,
        result_flow_hash=proposal.result_flow_hash,
        redacted_preview_summary=proposal.preview,
    )


def _same_request(existing: CommandProposal, spec: CommandProposalSpec) -> bool:
    return existing.request_fingerprint == spec.request_fingerprint


async def ensure_proposal(session: AsyncSession, spec: CommandProposalSpec) -> CommandProposal:
    # Serialize sequence allocation on the durable parent row. PostgreSQL holds
    # this lock until the caller's transaction commits; SQLite keeps the DB
    # unique constraints as the fallback arbiter.
    await session.exec(select(ChatRun.id).where(ChatRun.id == spec.chat_run_id).with_for_update())
    existing = await get_command_proposal_by_idempotency(
        session,
        chat_run_id=spec.chat_run_id,
        idempotency_key=spec.idempotency_key,
    )
    if existing is not None:
        if _same_request(existing, spec):
            return _normalize_proposal_times(existing)
        raise CommandProposalConflictError(_ERR_IDEMPOTENCY_CONFLICT)

    for _attempt in range(_MAX_SEQUENCE_RETRIES):
        sequence = await get_next_command_sequence(session, spec.chat_run_id)
        material = _material_from_spec(spec, sequence)
        proposal = CommandProposal(
            actor_id=spec.actor_id,
            project_id=spec.project_id,
            source_kind=spec.source_kind,
            chat_run_id=spec.chat_run_id,
            thread_id=spec.thread_id,
            source_proposal_id=spec.source_proposal_id,
            flow_id=spec.flow_id,
            command_type=spec.command_type,
            canonical_payload=spec.canonical_payload,
            preview=spec.preview,
            proposal_hash=proposal_hash(material),
            base_flow_revision=spec.base_flow_revision,
            base_flow_hash=spec.base_flow_hash,
            result_flow_hash=spec.result_flow_hash,
            idempotency_key=spec.idempotency_key,
            request_fingerprint=spec.request_fingerprint,
            request_id=spec.request_id,
            sequence=sequence,
            redacted_audit=spec.redacted_audit,
        )
        try:
            async with session.begin_nested():
                session.add(proposal)
                await session.flush()
        except IntegrityError:
            existing = await get_command_proposal_by_idempotency(
                session,
                chat_run_id=spec.chat_run_id,
                idempotency_key=spec.idempotency_key,
            )
            if existing is None:
                continue
            if _same_request(existing, spec):
                return _normalize_proposal_times(existing)
            raise CommandProposalConflictError(_ERR_IDEMPOTENCY_CONFLICT) from None
        else:
            await session.refresh(proposal)
            return _normalize_proposal_times(proposal)
    raise CommandProposalConflictError(_ERR_SEQUENCE_CONFLICT)


async def bind_interrupt(
    session: AsyncSession,
    *,
    proposal_id: UUID,
    chat_run_id: UUID,
    thread_id: str,
    interrupt_id: str,
    bound_at: datetime | None = None,
) -> CommandProposal:
    proposal = await get_command_proposal(session, proposal_id)
    if proposal is None:
        raise CommandProposalNotFoundError(_ERR_PROPOSAL_NOT_FOUND)
    if (
        proposal.source_kind != CommandProposalSourceKind.AI_RUN
        or proposal.chat_run_id != chat_run_id
        or proposal.thread_id != thread_id
    ):
        raise CommandProposalCorrelationError(_ERR_INTERRUPT_SCOPE)
    if proposal.interrupt_id is not None:
        if proposal.interrupt_id == interrupt_id:
            return _normalize_proposal_times(proposal)
        raise CommandProposalCorrelationError(_ERR_INTERRUPT_REBIND)
    if proposal.status != CommandProposalStatus.PROPOSED:
        raise CommandProposalCorrelationError(_ERR_INTERRUPT_PHASE)

    frozen_hash = proposal_hash(_material_from_row(proposal, interrupt_id=interrupt_id, interrupt_bound=True))
    actual_bound_at = bound_at or datetime.now(timezone.utc)
    result = await session.exec(
        update(CommandProposal)
        .where(
            CommandProposal.id == proposal_id,
            CommandProposal.chat_run_id == chat_run_id,
            CommandProposal.thread_id == thread_id,
            CommandProposal.status == CommandProposalStatus.PROPOSED,
            CommandProposal.interrupt_id.is_(None),
            CommandProposal.interrupt_bound_at.is_(None),
        )
        .values(
            status=CommandProposalStatus.AWAITING_CONFIRMATION,
            interrupt_id=interrupt_id,
            interrupt_bound_at=actual_bound_at,
            proposal_hash=frozen_hash,
        )
    )
    if result.rowcount != 1:  # type: ignore[union-attr]
        await session.refresh(proposal)
        if proposal.interrupt_id == interrupt_id:
            return _normalize_proposal_times(proposal)
        raise CommandProposalCorrelationError(_ERR_INTERRUPT_REBIND)
    await session.refresh(proposal)
    return _normalize_proposal_times(proposal)


async def fail_proposal(
    session: AsyncSession,
    proposal_id: UUID,
    *,
    error_code: str,
) -> CommandProposal:
    proposal = await get_command_proposal(session, proposal_id)
    if proposal is None:
        raise CommandProposalNotFoundError(_ERR_PROPOSAL_NOT_FOUND)
    result = await session.exec(
        update(CommandProposal)
        .where(
            CommandProposal.id == proposal_id,
            CommandProposal.status.in_((CommandProposalStatus.PROPOSED, CommandProposalStatus.AWAITING_CONFIRMATION)),
            CommandProposal.resolved_at.is_(None),
        )
        .values(
            status=CommandProposalStatus.FAILED,
            resolved_at=datetime.now(timezone.utc),
            outcome={"code": error_code},
        )
    )
    await session.refresh(proposal)
    if result.rowcount != 1 and proposal.status not in {  # type: ignore[union-attr]
        CommandProposalStatus.APPLIED,
        CommandProposalStatus.REJECTED,
        CommandProposalStatus.STALE,
        CommandProposalStatus.FAILED,
    }:
        raise CommandProposalCorrelationError(_ERR_INTERRUPT_PHASE)
    return _normalize_proposal_times(proposal)


async def load_authorized_proposal(
    session: AsyncSession,
    *,
    proposal_id: UUID,
    actor_id: UUID,
) -> CommandProposal:
    row = (
        await session.exec(
            select(CommandProposal, ChatRun, ChatThread, Folder)
            .join(ChatRun, ChatRun.id == CommandProposal.chat_run_id)
            .join(ChatThread, ChatThread.id == ChatRun.chat_id)
            .join(Folder, Folder.id == ChatThread.project_id)
            .where(CommandProposal.id == proposal_id)
        )
    ).one_or_none()
    if row is None:
        raise CommandProposalAuthorizationError(_ERR_RECOVERY_SCOPE)
    proposal, chat_run, chat_thread, folder = row
    if (
        folder.user_id is None
        or folder.user_id != actor_id
        or proposal.actor_id != actor_id
        or proposal.project_id != folder.id
        or proposal.thread_id != str(chat_thread.id)
        or chat_run.langgraph_thread_id != str(chat_thread.id)
    ):
        raise CommandProposalAuthorizationError(_ERR_RECOVERY_SCOPE)
    if proposal.command_type != CommandProposalCommandType.CREATE_FLOW:
        flow = (
            await session.exec(
                select(Flow).where(
                    Flow.id == proposal.flow_id,
                    Flow.user_id == actor_id,
                    Flow.folder_id == proposal.project_id,
                )
            )
        ).one_or_none()
        if flow is None or flow.fs_path is not None:
            raise CommandProposalAuthorizationError(_ERR_RECOVERY_SCOPE)
    return _normalize_proposal_times(proposal)
