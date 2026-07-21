"""Fail-closed recovery of one standard LangGraph command interrupt."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Mapping, Protocol
from uuid import UUID

from langgraph.types import Interrupt

from ketos.services.database.models.command_proposal.model import CommandProposalStatus

if TYPE_CHECKING:
    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
    from sqlmodel.ext.asyncio.session import AsyncSession

_HASH = re.compile(r"[0-9a-f]{64}\Z")
_METADATA_TYPE = "ketos.flow-command-confirmation.v1"
_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {"approved": {"type": "boolean"}},
    "required": ["approved"],
    "additionalProperties": False,
}


class CommandRecoveryProofError(ValueError):
    """Persisted state cannot prove the requested command recovery."""


@dataclass(frozen=True, slots=True)
class OpenCommandInterrupt:
    proposal_id: UUID
    proposal_hash: str
    interrupt_id: str
    thread_id: str


@dataclass(frozen=True, slots=True)
class PendingCommandRecovery:
    proposal_id: UUID
    chat_run_id: UUID
    thread_id: str
    interrupt_id: str
    proposal_hash: str


class CommandService(Protocol):
    async def load_authorized_proposal(
        self, session: AsyncSession, *, proposal_id: UUID, actor_id: UUID
    ) -> Any: ...

    async def resolve_proposal(self, session: AsyncSession, **kwargs: Any) -> Any: ...


def _descriptor(interrupt: object, *, thread_id: str) -> OpenCommandInterrupt | None:
    if not isinstance(interrupt, Interrupt) or not isinstance(interrupt.id, str) or not interrupt.id:
        return None
    value = interrupt.value
    if not isinstance(value, Mapping) or set(value) != {"reason", "message", "responseSchema", "metadata"}:
        return None
    if value.get("reason") != "confirmation" or value.get("responseSchema") != _RESPONSE_SCHEMA:
        return None
    metadata = value.get("metadata")
    if not isinstance(metadata, Mapping) or set(metadata) != {"type", "proposalId", "proposalHash", "preview"}:
        return None
    if metadata.get("type") != _METADATA_TYPE or not isinstance(metadata.get("preview"), Mapping):
        return None
    proposal_hash = metadata.get("proposalHash")
    if not isinstance(proposal_hash, str) or _HASH.fullmatch(proposal_hash) is None:
        return None
    try:
        proposal_id = UUID(str(metadata.get("proposalId")))
    except (TypeError, ValueError):
        return None
    return OpenCommandInterrupt(proposal_id, proposal_hash, interrupt.id, thread_id)


class CommandCheckpointInspector:
    """Read standard open interrupts through the public saver API only."""

    async def open_interrupts(
        self, checkpointer: AsyncSqliteSaver, thread_id: str
    ) -> tuple[OpenCommandInterrupt, ...]:
        checkpoint_tuple = await checkpointer.aget_tuple({"configurable": {"thread_id": thread_id}})
        if checkpoint_tuple is None:
            return ()
        config = getattr(checkpoint_tuple, "config", None)
        configurable = config.get("configurable") if isinstance(config, Mapping) else None
        if not isinstance(configurable, Mapping) or configurable.get("thread_id") != thread_id:
            raise CommandRecoveryProofError("checkpoint belongs to another thread")
        checkpoint = getattr(checkpoint_tuple, "checkpoint", None)
        if not isinstance(checkpoint, Mapping) or not isinstance(checkpoint.get("channel_values"), Mapping):
            raise CommandRecoveryProofError("checkpoint payload is invalid")
        pending_writes = getattr(checkpoint_tuple, "pending_writes", None)
        if not isinstance(pending_writes, (list, tuple)):
            raise CommandRecoveryProofError("checkpoint pending writes are invalid")
        matches: list[OpenCommandInterrupt] = []
        for write in pending_writes:
            if not isinstance(write, (list, tuple)) or len(write) != 3 or write[1] != "__interrupt__":
                continue
            values = write[2]
            if not isinstance(values, (list, tuple)):
                continue
            for value in values:
                descriptor = _descriptor(value, thread_id=thread_id)
                if descriptor is not None:
                    matches.append(descriptor)
        return tuple(matches)

    async def require_exact(
        self, checkpointer: AsyncSqliteSaver, *, thread_id: str, proposal: Any
    ) -> OpenCommandInterrupt:
        interrupts = await self.open_interrupts(checkpointer, thread_id)
        if len(interrupts) != 1:
            raise CommandRecoveryProofError("expected exactly one open command interrupt")
        proof = interrupts[0]
        if (
            proof.proposal_id != proposal.id
            or proof.proposal_hash != proposal.proposal_hash
            or proof.interrupt_id != proposal.interrupt_id
            or proof.thread_id != proposal.thread_id
        ):
            raise CommandRecoveryProofError("proposal and checkpoint do not match")
        return proof


async def recover_pending_command(
    *,
    session: AsyncSession,
    checkpointer: AsyncSqliteSaver,
    checkpoint_inspector: CommandCheckpointInspector,
    command_service: CommandService,
    actor_id: UUID,
    chat_run_id: UUID,
    proposal_id: UUID,
) -> PendingCommandRecovery:
    """Prove one authorized pending proposal without mutating checkpoint or Flow."""
    proposal = await command_service.load_authorized_proposal(
        session, proposal_id=proposal_id, actor_id=actor_id
    )
    status_value = getattr(proposal.status, "value", proposal.status)
    if (
        proposal.id != proposal_id
        or proposal.actor_id != actor_id
        or proposal.chat_run_id != chat_run_id
        or status_value != CommandProposalStatus.AWAITING_CONFIRMATION.value
        or not isinstance(proposal.thread_id, str)
        or not isinstance(proposal.interrupt_id, str)
        or proposal.interrupt_bound_at is None
        or not isinstance(proposal.proposal_hash, str)
    ):
        raise CommandRecoveryProofError("proposal is not an exact pending command")
    proof = await checkpoint_inspector.require_exact(
        checkpointer, thread_id=proposal.thread_id, proposal=proposal
    )
    return PendingCommandRecovery(
        proposal_id=proposal.id,
        chat_run_id=proposal.chat_run_id,
        thread_id=proposal.thread_id,
        interrupt_id=proof.interrupt_id,
        proposal_hash=proposal.proposal_hash,
    )


async def resolve_recovered_command(
    *,
    session: AsyncSession,
    checkpointer: AsyncSqliteSaver,
    checkpoint_inspector: CommandCheckpointInspector,
    command_service: CommandService,
    actor_id: UUID,
    chat_run_id: UUID,
    proposal_id: UUID,
    approved: bool,
    component_registry: dict[str, dict[str, Any]],
) -> Any:
    """Delegate one proven decision to the existing public CAS facade."""
    pending = await recover_pending_command(
        session=session,
        checkpointer=checkpointer,
        checkpoint_inspector=checkpoint_inspector,
        command_service=command_service,
        actor_id=actor_id,
        chat_run_id=chat_run_id,
        proposal_id=proposal_id,
    )
    return await command_service.resolve_proposal(
        session,
        proposal_id=pending.proposal_id,
        actor_id=actor_id,
        chat_run_id=pending.chat_run_id,
        thread_id=pending.thread_id,
        interrupt_id=pending.interrupt_id,
        approved=approved,
        component_registry=component_registry,
    )


__all__ = [
    "CommandCheckpointInspector",
    "CommandRecoveryProofError",
    "OpenCommandInterrupt",
    "PendingCommandRecovery",
    "recover_pending_command",
    "resolve_recovered_command",
]
