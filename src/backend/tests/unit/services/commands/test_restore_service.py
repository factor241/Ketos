from __future__ import annotations

from types import SimpleNamespace
from typing import TYPE_CHECKING
from uuid import uuid4

import pytest
from ketos.agentic.services.flow_proposal_adapter import propose_flow_changes
from ketos.services.commands.apply_service import resolve_proposal
from ketos.services.commands.exceptions import CommandProposalAuthorizationError, CommandProposalConflictError
from ketos.services.commands.proposal_service import bind_interrupt
from ketos.services.commands.restore_service import restore_flow_snapshot
from ketos.services.database.models.command_proposal.model import CommandProposal, CommandProposalStatus
from ketos.services.database.models.flow.model import Flow
from ketos.services.database.models.flow_version.crud import create_flow_version_entry, delete_flow_version_entry
from ketos.services.database.models.flow_version.exceptions import FlowVersionDeployedError
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


def _node(value: str) -> dict:
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


async def _applied_edit(session: AsyncSession, context: CommandContext):
    flow = Flow(
        id=uuid4(),
        user_id=context.actor_id,
        folder_id=context.project_id,
        name="Restorable",
        data={"nodes": [_node("Before")], "edges": []},
        revision=5,
    )
    session.add(flow)
    await session.flush()
    proposal = await propose_flow_changes(
        session,
        actor_id=context.actor_id,
        project_id=context.project_id,
        chat_run_id=context.chat_run_id,
        thread_id=context.thread_id,
        target_flow_id=flow.id,
        operations=[
            {"op": "set_parameter", "nodeId": "agent", "parameter": "system_prompt", "value": "After"}
        ],
        idempotency_key="source-edit",
        request_id="source-edit",
        component_registry=_registry(),
    )
    await bind_interrupt(
        session,
        proposal_id=proposal.id,
        chat_run_id=context.chat_run_id,
        thread_id=context.thread_id,
        interrupt_id="source-interrupt",
    )
    applied = await resolve_proposal(
        session,
        proposal_id=proposal.id,
        actor_id=context.actor_id,
        chat_run_id=context.chat_run_id,
        thread_id=context.thread_id,
        interrupt_id="source-interrupt",
        approved=True,
        component_registry=_registry(),
    )
    return flow, applied


async def test_restore_is_one_cas_effect_with_server_lineage_and_replay(
    command_session: AsyncSession, command_context: CommandContext
) -> None:
    flow, source = await _applied_edit(command_session, command_context)
    restored = await restore_flow_snapshot(
        command_session,
        source_proposal_id=source.id,
        actor_id=command_context.actor_id,
        idempotency_key="restore-once",
        expected_flow_revision=6,
    )
    replay = await restore_flow_snapshot(
        command_session,
        source_proposal_id=source.id,
        actor_id=command_context.actor_id,
        idempotency_key="restore-once",
        expected_flow_revision=6,
    )
    await command_session.refresh(flow)

    assert restored.id == replay.id
    assert restored.status == CommandProposalStatus.APPLIED
    assert restored.source_kind == "server_restore"
    assert restored.source_proposal_id == source.id
    assert restored.chat_run_id == source.chat_run_id
    assert restored.thread_id == source.thread_id
    assert restored.interrupt_id is None
    assert flow.revision == 7
    assert flow.data["nodes"][0]["data"]["node"]["template"]["system_prompt"]["value"] == "Before"
    assert (await command_session.exec(select(func.count(FlowVersion.id)))).one() == 2
    assert (await command_session.exec(select(func.count(CommandProposal.id)))).one() == 2


async def test_stale_restore_has_zero_flow_or_snapshot_effect(
    command_session: AsyncSession, command_context: CommandContext
) -> None:
    flow, source = await _applied_edit(command_session, command_context)
    stale = await restore_flow_snapshot(
        command_session,
        source_proposal_id=source.id,
        actor_id=command_context.actor_id,
        idempotency_key="restore-stale",
        expected_flow_revision=99,
    )
    await command_session.refresh(flow)

    assert stale.status == CommandProposalStatus.STALE
    assert flow.revision == 6
    assert flow.data["nodes"][0]["data"]["node"]["template"]["system_prompt"]["value"] == "After"
    assert (await command_session.exec(select(func.count(FlowVersion.id)))).one() == 1


async def test_restore_denies_foreign_actor_and_changed_idempotency_fingerprint(
    command_session: AsyncSession, command_context: CommandContext
) -> None:
    _flow, source = await _applied_edit(command_session, command_context)
    with pytest.raises(CommandProposalAuthorizationError):
        await restore_flow_snapshot(
            command_session,
            source_proposal_id=source.id,
            actor_id=uuid4(),
            idempotency_key="foreign",
            expected_flow_revision=6,
        )
    await restore_flow_snapshot(
        command_session,
        source_proposal_id=source.id,
        actor_id=command_context.actor_id,
        idempotency_key="collision",
        expected_flow_revision=6,
    )
    with pytest.raises(CommandProposalConflictError):
        await restore_flow_snapshot(
            command_session,
            source_proposal_id=source.id,
            actor_id=command_context.actor_id,
            idempotency_key="collision",
            expected_flow_revision=7,
        )


async def test_pre_ai_pin_survives_pruning_and_explicit_delete(
    command_session: AsyncSession, command_context: CommandContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    flow, source = await _applied_edit(command_session, command_context)
    pin_id = source.pinned_flow_version_id
    assert pin_id is not None
    monkeypatch.setattr(
        "ketos.services.database.models.flow_version.crud.get_settings_service",
        lambda: SimpleNamespace(settings=SimpleNamespace(max_flow_version_entries_per_flow=1)),
    )

    for index in range(3):
        await create_flow_version_entry(
            command_session,
            flow_id=flow.id,
            user_id=command_context.actor_id,
            data={"nodes": [_node(f"Manual {index}")], "edges": []},
            description=f"Manual {index}",
        )
    await command_session.flush()

    assert await command_session.get(FlowVersion, pin_id) is not None
    with pytest.raises(FlowVersionDeployedError, match="pinned by a command proposal"):
        await delete_flow_version_entry(command_session, pin_id, command_context.actor_id)
    assert await command_session.get(FlowVersion, pin_id) is not None
