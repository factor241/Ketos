from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import uuid4

from ketos.agentic.services.flow_proposal_adapter import propose_flow_changes
from ketos.services.commands.apply_service import resolve_proposal
from ketos.services.commands.proposal_service import bind_interrupt
from ketos.services.database.models.command_proposal.model import CommandProposalStatus
from ketos.services.database.models.flow.model import Flow
from ketos.services.database.models.flow_version.model import FlowVersion
from sqlmodel import func, select

if TYPE_CHECKING:
    from sqlmodel.ext.asyncio.session import AsyncSession

    from .conftest import CommandContext


def _registry() -> dict:
    return {
        "Agent": {
            "display_name": "Agent",
            "template": {"system_prompt": {"type": "str", "value": "Before"}},
            "outputs": [{"name": "response", "types": ["Message"]}],
        }
    }


def _node(value: str = "Before") -> dict:
    return {
        "id": "agent",
        "data": {
            "id": "agent",
            "type": "Agent",
            "node": {
                **_registry()["Agent"],
                "template": {"system_prompt": {"type": "str", "value": value}},
            },
        },
    }


async def _bound_create(session: AsyncSession, context: CommandContext, key: str):
    proposal = await propose_flow_changes(
        session,
        actor_id=context.actor_id,
        project_id=context.project_id,
        chat_run_id=context.chat_run_id,
        thread_id=context.thread_id,
        target_flow_id=None,
        operations=[
            {
                "op": "create_flow",
                "name": f"Created {key}",
                "description": None,
                "nodes": [_node()],
                "edges": [],
            }
        ],
        idempotency_key=key,
        request_id=f"request-{key}",
        component_registry=_registry(),
    )
    return await bind_interrupt(
        session,
        proposal_id=proposal.id,
        chat_run_id=context.chat_run_id,
        thread_id=context.thread_id,
        interrupt_id=f"interrupt-{key}",
    )


async def test_create_approve_is_one_effect_and_replay_is_consumed(
    command_session: AsyncSession, command_context: CommandContext
) -> None:
    proposal = await _bound_create(command_session, command_context, "create")
    applied = await resolve_proposal(
        command_session,
        proposal_id=proposal.id,
        actor_id=command_context.actor_id,
        chat_run_id=command_context.chat_run_id,
        thread_id=command_context.thread_id,
        interrupt_id="interrupt-create",
        approved=True,
        component_registry=_registry(),
    )
    replay = await resolve_proposal(
        command_session,
        proposal_id=proposal.id,
        actor_id=command_context.actor_id,
        chat_run_id=command_context.chat_run_id,
        thread_id=command_context.thread_id,
        interrupt_id="interrupt-create",
        approved=True,
        component_registry=_registry(),
    )

    flow = await command_session.get(Flow, proposal.flow_id)
    assert applied.status == CommandProposalStatus.APPLIED
    assert replay.status == CommandProposalStatus.APPLIED
    assert flow is not None
    assert flow.revision == 1
    assert (await command_session.exec(select(func.count(Flow.id)).where(Flow.id == proposal.flow_id))).one() == 1


async def test_reject_has_zero_flow_and_snapshot_effect(
    command_session: AsyncSession, command_context: CommandContext
) -> None:
    proposal = await _bound_create(command_session, command_context, "reject")
    rejected = await resolve_proposal(
        command_session,
        proposal_id=proposal.id,
        actor_id=command_context.actor_id,
        chat_run_id=command_context.chat_run_id,
        thread_id=command_context.thread_id,
        interrupt_id="interrupt-reject",
        approved=False,
        component_registry={},
    )
    assert rejected.status == CommandProposalStatus.REJECTED
    assert await command_session.get(Flow, proposal.flow_id) is None
    assert (await command_session.exec(select(func.count(FlowVersion.id)))).one() == 0


async def test_edit_approve_bumps_once_and_pins_exact_pre_ai_snapshot(
    command_session: AsyncSession, command_context: CommandContext
) -> None:
    flow = Flow(
        id=uuid4(),
        user_id=command_context.actor_id,
        folder_id=command_context.project_id,
        name="Editable",
        data={"nodes": [_node()], "edges": []},
        revision=3,
    )
    command_session.add(flow)
    await command_session.flush()
    proposal = await propose_flow_changes(
        command_session,
        actor_id=command_context.actor_id,
        project_id=command_context.project_id,
        chat_run_id=command_context.chat_run_id,
        thread_id=command_context.thread_id,
        target_flow_id=flow.id,
        operations=[
            {
                "op": "set_parameter",
                "nodeId": "agent",
                "parameter": "system_prompt",
                "value": "After",
            }
        ],
        idempotency_key="edit",
        request_id="request-edit",
        component_registry=_registry(),
    )
    await bind_interrupt(
        command_session,
        proposal_id=proposal.id,
        chat_run_id=command_context.chat_run_id,
        thread_id=command_context.thread_id,
        interrupt_id="interrupt-edit",
    )
    applied = await resolve_proposal(
        command_session,
        proposal_id=proposal.id,
        actor_id=command_context.actor_id,
        chat_run_id=command_context.chat_run_id,
        thread_id=command_context.thread_id,
        interrupt_id="interrupt-edit",
        approved=True,
        component_registry=_registry(),
    )
    await command_session.refresh(flow)
    snapshot = await command_session.get(FlowVersion, applied.pinned_flow_version_id)

    assert applied.status == CommandProposalStatus.APPLIED
    assert flow.revision == 4
    assert flow.data["nodes"][0]["data"]["node"]["template"]["system_prompt"]["value"] == "After"
    assert snapshot is not None
    assert snapshot.source_flow_revision == 3
    assert snapshot.data["nodes"][0]["data"]["node"]["template"]["system_prompt"]["value"] == "Before"
