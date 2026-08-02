from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from langchain_core.tools import StructuredTool
from langgraph._internal._constants import CONFIG_KEY_CHECKPOINT_NS
from langgraph.config import get_config
from langgraph.types import Interrupt, interrupt
from pydantic import BaseModel, ConfigDict, Field
from sqlmodel import select

from ketos.agentic.services.flow_proposal_adapter import propose_flow_changes
from ketos.services.commands.canonical import canonical_sha256
from ketos.services.commands.service import bind_interrupt, load_authorized_proposal, resolve_proposal
from ketos.services.database.models.command_proposal.model import CommandProposal
from ketos.services.deps import session_scope

FLOW_COMMAND_METADATA_TYPE = "ketos.flow-command-confirmation.v1"
FLOW_CONFIRMATION_RESPONSE_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {"approved": {"type": "boolean"}},
    "required": ["approved"],
    "additionalProperties": False,
}


class FlowProposalToolInput(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    target_flow_id: UUID | None = Field(default=None, alias="targetFlowId")
    operations: list[dict[str, Any]] = Field(min_length=1, max_length=128)


@dataclass(frozen=True)
class FlowBuilderToolContext:
    actor_id: UUID
    project_id: UUID
    chat_run_id: UUID
    thread_id: str
    component_registry: dict[str, dict[str, Any]]
    resume_interrupt_ids: frozenset[str] = frozenset()


def flatten_component_registry(all_types: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Flatten cached component categories without changing their registered names."""
    return {
        name: definition
        for components in all_types.values()
        if isinstance(components, dict)
        for name, definition in components.items()
        if isinstance(name, str) and isinstance(definition, dict)
    }


def _current_interrupt_id() -> str:
    namespace = get_config()["configurable"][CONFIG_KEY_CHECKPOINT_NS]
    return Interrupt.from_ns(value=None, ns=str(namespace)).id


def _validated_decision(value: Any) -> bool:
    if not isinstance(value, dict) or set(value) != {"approved"} or type(value["approved"]) is not bool:
        message = "confirmation response must contain only boolean approved"
        raise ValueError(message)
    return value["approved"]


async def _proposal_for_resume(context: FlowBuilderToolContext, interrupt_id: str) -> CommandProposal | None:
    if interrupt_id not in context.resume_interrupt_ids:
        return None
    async with session_scope() as session:
        proposal_id = (
            await session.exec(
                select(CommandProposal.id).where(
                    CommandProposal.actor_id == context.actor_id,
                    CommandProposal.thread_id == context.thread_id,
                    CommandProposal.interrupt_id == interrupt_id,
                )
            )
        ).one_or_none()
        if proposal_id is None:
            return None
        return await load_authorized_proposal(session, proposal_id=proposal_id, actor_id=context.actor_id)


def create_flow_proposal_tool(context: FlowBuilderToolContext) -> StructuredTool:
    """Create the sole mutating-capable agent tool; its first effect is only a proposal."""

    async def propose_flow_changes_tool(
        target_flow_id: UUID | None = None,
        operations: list[dict[str, Any]] | None = None,
    ) -> str:
        actual_operations = operations or []
        interrupt_id = _current_interrupt_id()
        resumed = await _proposal_for_resume(context, interrupt_id)
        source_chat_run_id = resumed.chat_run_id if resumed is not None else context.chat_run_id
        request_fingerprint = canonical_sha256(
            {
                "schemaVersion": 1,
                "threadId": context.thread_id,
                "targetFlowId": target_flow_id,
                "operations": actual_operations,
            }
        )
        idempotency_key = f"flow-command:{request_fingerprint}"
        async with session_scope() as session:
            proposal = await propose_flow_changes(
                session,
                actor_id=context.actor_id,
                project_id=context.project_id,
                chat_run_id=source_chat_run_id,
                thread_id=context.thread_id,
                target_flow_id=target_flow_id,
                operations=actual_operations,
                idempotency_key=idempotency_key,
                request_id=request_fingerprint,
                component_registry=context.component_registry,
            )
            proposal = await bind_interrupt(
                session,
                proposal_id=proposal.id,
                chat_run_id=source_chat_run_id,
                thread_id=context.thread_id,
                interrupt_id=interrupt_id,
            )
            await session.commit()

        decision = _validated_decision(
            interrupt(
                {
                    "reason": "confirmation",
                    "message": "Review the proposed flow changes before applying them.",
                    "responseSchema": FLOW_CONFIRMATION_RESPONSE_SCHEMA,
                    "metadata": {
                        "type": FLOW_COMMAND_METADATA_TYPE,
                        "proposalId": str(proposal.id),
                        "proposalHash": proposal.proposal_hash,
                        "preview": proposal.preview,
                    },
                }
            )
        )
        async with session_scope() as session:
            resolved = await resolve_proposal(
                session,
                proposal_id=proposal.id,
                actor_id=context.actor_id,
                chat_run_id=source_chat_run_id,
                thread_id=context.thread_id,
                interrupt_id=interrupt_id,
                approved=decision,
                component_registry=context.component_registry,
            )
            await session.commit()
        return json.dumps(
            {"proposalId": str(resolved.id), "status": resolved.status.value},
            separators=(",", ":"),
            sort_keys=True,
        )

    return StructuredTool.from_function(
        name="ProposeFlowChanges",
        description=(
            "Propose a validated create or edit of a Ketos flow. This never changes a flow until the user "
            "reviews the preview and explicitly approves the standard confirmation interrupt."
        ),
        coroutine=propose_flow_changes_tool,
        args_schema=FlowProposalToolInput,
    )


__all__ = [
    "FLOW_COMMAND_METADATA_TYPE",
    "FLOW_CONFIRMATION_RESPONSE_SCHEMA",
    "FlowBuilderToolContext",
    "create_flow_proposal_tool",
    "flatten_component_registry",
]
