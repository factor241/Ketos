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

from .test_apply_service import _node, _registry


async def test_changed_base_fails_closed_without_snapshot(
    command_session: AsyncSession, command_context: CommandContext
) -> None:
    flow = Flow(
        id=uuid4(),
        user_id=command_context.actor_id,
        folder_id=command_context.project_id,
        name="Stale",
        data={"nodes": [_node()], "edges": []},
        revision=2,
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
            {"op": "set_parameter", "nodeId": "agent", "parameter": "system_prompt", "value": "AI"}
        ],
        idempotency_key="stale",
        request_id="request-stale",
        component_registry=_registry(),
    )
    await bind_interrupt(
        command_session,
        proposal_id=proposal.id,
        chat_run_id=command_context.chat_run_id,
        thread_id=command_context.thread_id,
        interrupt_id="interrupt-stale",
    )
    flow.data = {"nodes": [_node("Manual")], "edges": []}
    flow.revision = 3
    await command_session.flush()

    stale = await resolve_proposal(
        command_session,
        proposal_id=proposal.id,
        actor_id=command_context.actor_id,
        chat_run_id=command_context.chat_run_id,
        thread_id=command_context.thread_id,
        interrupt_id="interrupt-stale",
        approved=True,
        component_registry=_registry(),
    )
    await command_session.refresh(flow)
    assert stale.status == CommandProposalStatus.STALE
    assert flow.revision == 3
    assert flow.data["nodes"][0]["data"]["node"]["template"]["system_prompt"]["value"] == "Manual"
    assert (await command_session.exec(select(func.count(FlowVersion.id)))).one() == 0
