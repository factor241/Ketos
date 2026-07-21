from __future__ import annotations

import copy
from datetime import datetime, timezone
from time import monotonic
from typing import TYPE_CHECKING

from sqlalchemy.exc import IntegrityError
from sqlmodel import select, update

from ketos.services.commands.canonical import canonical_sha256, flow_content_hash, proposal_hash
from ketos.services.commands.contracts import CommandProposalSpec
from ketos.services.commands.exceptions import (
    CommandProposalAuthorizationError,
    CommandProposalConflictError,
)
from ketos.services.commands.proposal_service import _material_from_row, ensure_proposal, load_authorized_proposal
from ketos.services.database.models.command_proposal.crud import get_command_proposal_by_idempotency
from ketos.services.database.models.command_proposal.model import (
    CommandProposal,
    CommandProposalCommandType,
    CommandProposalSourceKind,
    CommandProposalStatus,
)
from ketos.services.database.models.flow.model import Flow
from ketos.services.database.models.flow_version.crud import create_pinned_flow_version_entry
from ketos.services.database.models.flow_version.model import FlowVersion

if TYPE_CHECKING:
    from uuid import UUID

    from sqlmodel.ext.asyncio.session import AsyncSession

_ERR_RESTORE_SOURCE = "restore_source_not_applicable"
_ERR_RESTORE_CONFLICT = "restore_revision_conflict"
_ERR_RESTORE_IDEMPOTENCY = "idempotency_conflict"
_ERR_PROPOSAL_HASH = "proposal_hash_mismatch"


class _RestoreStaleError(RuntimeError):
    pass


def _restore_fingerprint(*, source_proposal_id: UUID, expected_flow_revision: int) -> str:
    return canonical_sha256(
        {
            "schemaVersion": 1,
            "sourceProposalId": source_proposal_id,
            "expectedFlowRevision": expected_flow_revision,
        }
    )


async def _latest_applicable_source(
    session: AsyncSession,
    *,
    source: CommandProposal,
) -> bool:
    candidates = (
        await session.exec(
            select(CommandProposal)
            .where(
                CommandProposal.actor_id == source.actor_id,
                CommandProposal.project_id == source.project_id,
                CommandProposal.flow_id == source.flow_id,
                CommandProposal.source_kind == CommandProposalSourceKind.AI_RUN,
                CommandProposal.status == CommandProposalStatus.APPLIED,
                CommandProposal.pinned_flow_version_id.is_not(None),
            )
        )
    ).all()

    def lineage_key(candidate: CommandProposal) -> tuple[int, str, str]:
        outcome = candidate.outcome or {}
        revision = outcome.get("afterRevision")
        return (
            revision if isinstance(revision, int) and not isinstance(revision, bool) else -1,
            candidate.resolved_at.isoformat() if candidate.resolved_at is not None else "",
            str(candidate.id),
        )

    return bool(candidates) and max(candidates, key=lineage_key).id == source.id


async def restore_flow_snapshot(
    session: AsyncSession,
    *,
    source_proposal_id: UUID,
    actor_id: UUID,
    idempotency_key: str,
    expected_flow_revision: int,
) -> CommandProposal:
    """Restore the latest applicable pre-AI snapshot with one audited CAS."""
    started = monotonic()
    source = await load_authorized_proposal(session, proposal_id=source_proposal_id, actor_id=actor_id)
    if (
        source.source_kind != CommandProposalSourceKind.AI_RUN
        or source.status != CommandProposalStatus.APPLIED
        or source.pinned_flow_version_id is None
        or not await _latest_applicable_source(session, source=source)
    ):
        raise CommandProposalConflictError(_ERR_RESTORE_SOURCE)

    fingerprint = _restore_fingerprint(
        source_proposal_id=source_proposal_id,
        expected_flow_revision=expected_flow_revision,
    )
    replay = await get_command_proposal_by_idempotency(
        session,
        chat_run_id=source.chat_run_id,
        idempotency_key=idempotency_key,
    )
    if replay is not None:
        if replay.request_fingerprint != fingerprint or replay.source_proposal_id != source.id:
            raise CommandProposalConflictError(_ERR_RESTORE_IDEMPOTENCY)
        return replay

    flow = (
        await session.exec(
            select(Flow).where(
                Flow.id == source.flow_id,
                Flow.user_id == actor_id,
                Flow.folder_id == source.project_id,
                Flow.fs_path.is_(None),
            )
        )
    ).one_or_none()
    snapshot = (
        await session.exec(
            select(FlowVersion).where(
                FlowVersion.id == source.pinned_flow_version_id,
                FlowVersion.flow_id == source.flow_id,
                FlowVersion.user_id == actor_id,
            )
        )
    ).one_or_none()
    if flow is None or snapshot is None or snapshot.data is None:
        raise CommandProposalAuthorizationError(_ERR_RESTORE_SOURCE)

    before_hash = flow_content_hash(flow)
    source_outcome = source.outcome or {}
    source_after_revision = source_outcome.get("afterRevision")
    source_after_hash = source_outcome.get("afterHash")
    source_snapshot_hash = flow_content_hash(
        {"name": flow.name, "description": flow.description, "data": snapshot.data}
    )
    lineage_matches = (
        isinstance(source_after_revision, int)
        and not isinstance(source_after_revision, bool)
        and source_after_revision == expected_flow_revision
        and source_after_revision == flow.revision
        and isinstance(source_after_hash, str)
        and source_after_hash == before_hash
        and snapshot.source_flow_hash == source_snapshot_hash
    )
    restored = {
        "name": flow.name,
        "description": flow.description,
        "data": copy.deepcopy(snapshot.data),
    }
    result_hash = flow_content_hash(restored)
    payload = {
        "schemaVersion": 1,
        "source": "pre_ai_snapshot",
        "sourceFlowVersionId": str(snapshot.id),
        "targetProjectId": str(source.project_id),
        "targetFlowId": str(source.flow_id),
        "operations": [
            {
                "op": "replace_flow",
                "name": flow.name,
                "description": flow.description,
                "nodes": copy.deepcopy(snapshot.data.get("nodes", [])),
                "edges": copy.deepcopy(snapshot.data.get("edges", [])),
            }
        ],
    }
    spec = CommandProposalSpec(
        actor_id=actor_id,
        project_id=source.project_id,
        source_kind=CommandProposalSourceKind.SERVER_RESTORE,
        chat_run_id=source.chat_run_id,
        thread_id=source.thread_id,
        source_proposal_id=source.id,
        flow_id=source.flow_id,
        command_type=CommandProposalCommandType.REPLACE_FLOW,
        canonical_payload=payload,
        preview={
            "before": {"revision": flow.revision, "hash": before_hash},
            "after": {"revision": flow.revision + 1, "hash": result_hash},
            "source": "pre_ai_snapshot",
            "canRestore": True,
        },
        base_flow_revision=flow.revision,
        base_flow_hash=before_hash,
        result_flow_hash=result_hash,
        idempotency_key=idempotency_key,
        request_fingerprint=fingerprint,
        request_id=f"restore:{source.id}",
        redacted_audit={"sourceProposalId": str(source.id), "sourceFlowVersionId": str(snapshot.id)},
    )
    proposal = await ensure_proposal(session, spec)
    if proposal.status != CommandProposalStatus.PROPOSED:
        return proposal

    resolved_at = datetime.now(timezone.utc)
    if not lineage_matches:
        proposal.status = CommandProposalStatus.STALE
        proposal.resolved_at = resolved_at
        proposal.outcome = {"code": _ERR_RESTORE_CONFLICT, "effect": "none"}
        await session.flush()
        return proposal

    try:
        async with session.begin_nested():
            current_snapshot = await create_pinned_flow_version_entry(
                session,
                flow_id=flow.id,
                user_id=actor_id,
                data=copy.deepcopy(flow.data),
                source_flow_revision=flow.revision,
                source_flow_hash=before_hash,
                description=f"Pre-restore snapshot for command {proposal.id}",
            )
            result = await session.exec(
                update(Flow)
                .where(
                    Flow.id == flow.id,
                    Flow.user_id == actor_id,
                    Flow.folder_id == source.project_id,
                    Flow.revision == expected_flow_revision,
                )
                .values(data=copy.deepcopy(snapshot.data), revision=Flow.revision + 1, updated_at=resolved_at)
            )
            if result.rowcount != 1:  # type: ignore[union-attr]
                raise _RestoreStaleError
            claimed = await session.exec(
                update(CommandProposal)
                .where(
                    CommandProposal.id == proposal.id,
                    CommandProposal.status == CommandProposalStatus.PROPOSED,
                    CommandProposal.resolved_at.is_(None),
                )
                .values(
                    status=CommandProposalStatus.APPLIED,
                    resolved_at=resolved_at,
                    pinned_flow_version_id=current_snapshot.id,
                    outcome={
                        "code": "applied",
                        "beforeRevision": expected_flow_revision,
                        "afterRevision": expected_flow_revision + 1,
                        "beforeHash": before_hash,
                        "afterHash": result_hash,
                        "sourceProposalId": str(source.id),
                    },
                    duration_ms=max(0, int((monotonic() - started) * 1000)),
                )
            )
            if claimed.rowcount != 1:  # type: ignore[union-attr]
                raise _RestoreStaleError
    except (_RestoreStaleError, IntegrityError):
        await session.refresh(proposal)
        if proposal.status == CommandProposalStatus.PROPOSED:
            stale = await session.exec(
                update(CommandProposal)
                .where(
                    CommandProposal.id == proposal.id,
                    CommandProposal.status == CommandProposalStatus.PROPOSED,
                    CommandProposal.resolved_at.is_(None),
                )
                .values(
                    status=CommandProposalStatus.STALE,
                    resolved_at=resolved_at,
                    outcome={"code": "stale_cas", "effect": "none"},
                )
            )
            if stale.rowcount == 1:  # type: ignore[union-attr]
                await session.flush()
            await session.refresh(proposal)
    await session.refresh(proposal)
    if proposal_hash(_material_from_row(proposal)) != proposal.proposal_hash:
        raise CommandProposalConflictError(_ERR_PROPOSAL_HASH)
    return proposal
