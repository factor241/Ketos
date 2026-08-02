from __future__ import annotations

from typing import TYPE_CHECKING

from ketos.agentic.services.flow_proposal_adapter import propose_flow_changes
from ketos.agentic.tools.flow_proposal_tools import FLOW_PROPOSAL_TOOLKIT
from ketos.services.database.models.flow.model import Flow
from sqlmodel import select

from tests.unit.services.commands.conftest import (
    command_context as proposal_command_context,
)
from tests.unit.services.commands.conftest import (
    command_session as proposal_command_session,
)

if TYPE_CHECKING:
    from sqlmodel.ext.asyncio.session import AsyncSession

    from tests.unit.services.commands.conftest import CommandContext

__all__ = ["proposal_command_context", "proposal_command_session"]


def _registry() -> dict:
    return {
        "ChatInput": {
            "display_name": "Chat Input",
            "template": {"input_value": {"type": "str", "value": ""}},
            "outputs": [{"name": "message", "types": ["Message"]}],
        }
    }


def _node() -> dict:
    return {
        "id": "input",
        "data": {
            "id": "input",
            "type": "ChatInput",
            "node": _registry()["ChatInput"],
        },
    }


async def test_create_tool_persists_only_proposal_and_honors_explicit_project(
    command_session: AsyncSession,
    command_context: CommandContext,
) -> None:
    proposal = await propose_flow_changes(
        command_session,
        actor_id=command_context.actor_id,
        project_id=command_context.project_id,
        chat_run_id=command_context.chat_run_id,
        thread_id=command_context.thread_id,
        target_flow_id=None,
        operations=[
            {
                "op": "create_flow",
                "name": "Proposed only",
                "description": None,
                "nodes": [_node()],
                "edges": [],
            }
        ],
        idempotency_key="tool-create-1",
        request_id="request-create-1",
        component_registry=_registry(),
    )

    assert proposal.project_id == command_context.project_id
    assert proposal.status.value == "proposed"
    assert proposal.preview["after"]["revision"] == 1
    assert (await command_session.exec(select(Flow).where(Flow.id == proposal.flow_id))).one_or_none() is None


def test_toolkit_contains_only_read_and_proposal_surfaces() -> None:
    names = {tool.name for tool in FLOW_PROPOSAL_TOOLKIT}
    assert names == {"SearchComponentTypes", "DescribeComponentType", "ProposeFlowChanges"}
    assert names.isdisjoint(
        {
            "AddComponent",
            "RemoveComponent",
            "ConnectComponents",
            "ConfigureComponent",
            "RunFlow",
            "GenerateComponent",
            "BuildFlowFromSpec",
        }
    )
