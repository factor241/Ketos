from __future__ import annotations

from uuid import uuid4

from ketos.agentic.services.flow_proposal_adapter import propose_flow_changes
from ketos.services.commands.apply_service import resolve_proposal
from ketos.services.commands.canonical import flow_content_hash
from ketos.services.commands.proposal_service import bind_interrupt
from ketos.services.commands.restore_service import restore_flow_snapshot
from ketos.services.database.models.chat_thread.model import ChatRun, ChatThread
from ketos.services.database.models.command_proposal.model import CommandProposalStatus
from ketos.services.database.models.flow.model import Flow
from ketos.services.database.models.flow_version.model import FlowVersion
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.user.model import User
from sqlmodel import func, select, update


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


async def test_preview_confirm_stale_and_restore_are_server_owned(async_session) -> None:
    actor_id, project_id, chat_id, chat_run_id = (uuid4() for _ in range(4))
    thread_id = str(chat_id)
    async_session.add(User(id=actor_id, username=f"s08-{actor_id}", password="stage08-hash"))  # noqa: S106
    await async_session.flush()
    async_session.add(Folder(id=project_id, name="Stage 08", user_id=actor_id))
    await async_session.flush()
    async_session.add(
        ChatThread(
            id=chat_id,
            project_id=project_id,
            created_by_id=actor_id,
            title="Stage 08",
            provider="test",
            model_name="test",
            context_policy="chat_only",
        )
    )
    await async_session.flush()
    async_session.add(
        ChatRun(
            id=chat_run_id,
            chat_id=chat_id,
            ag_ui_run_id="run",
            langgraph_thread_id=thread_id,
            idempotency_key="run",
            request_fingerprint="d" * 64,
            run_sequence=1,
        )
    )
    await async_session.commit()

    rejected_create = await propose_flow_changes(
        async_session,
        actor_id=actor_id,
        project_id=project_id,
        chat_run_id=chat_run_id,
        thread_id=thread_id,
        target_flow_id=None,
        operations=[
            {
                "op": "create_flow",
                "name": "Rejected",
                "description": None,
                "nodes": [_node("Before")],
                "edges": [],
            }
        ],
        idempotency_key="create-reject",
        request_id="create-reject",
        component_registry=_registry(),
    )
    assert await async_session.get(Flow, rejected_create.flow_id) is None
    await bind_interrupt(
        async_session,
        proposal_id=rejected_create.id,
        chat_run_id=chat_run_id,
        thread_id=thread_id,
        interrupt_id="create-reject",
    )
    rejected_create = await resolve_proposal(
        async_session,
        proposal_id=rejected_create.id,
        actor_id=actor_id,
        chat_run_id=chat_run_id,
        thread_id=thread_id,
        interrupt_id="create-reject",
        approved=False,
        component_registry=_registry(),
    )
    assert rejected_create.status == CommandProposalStatus.REJECTED
    assert await async_session.get(Flow, rejected_create.flow_id) is None

    flow = Flow(
        id=uuid4(),
        user_id=actor_id,
        folder_id=project_id,
        name="Editable",
        data={"nodes": [_node("Before")], "edges": []},
        revision=3,
    )
    async_session.add(flow)
    await async_session.flush()
    before_hash = flow_content_hash(flow)
    edit = await propose_flow_changes(
        async_session,
        actor_id=actor_id,
        project_id=project_id,
        chat_run_id=chat_run_id,
        thread_id=thread_id,
        target_flow_id=flow.id,
        operations=[
            {"op": "set_parameter", "nodeId": "agent", "parameter": "system_prompt", "value": "After"}
        ],
        idempotency_key="edit-approve",
        request_id="edit-approve",
        component_registry=_registry(),
    )
    assert flow.revision == 3
    assert flow_content_hash(flow) == before_hash
    await bind_interrupt(
        async_session,
        proposal_id=edit.id,
        chat_run_id=chat_run_id,
        thread_id=thread_id,
        interrupt_id="edit-approve",
    )
    edit = await resolve_proposal(
        async_session,
        proposal_id=edit.id,
        actor_id=actor_id,
        chat_run_id=chat_run_id,
        thread_id=thread_id,
        interrupt_id="edit-approve",
        approved=True,
        component_registry=_registry(),
    )
    await async_session.refresh(flow)
    assert edit.status == CommandProposalStatus.APPLIED
    assert flow.revision == 4
    assert edit.pinned_flow_version_id is not None

    restored = await restore_flow_snapshot(
        async_session,
        source_proposal_id=edit.id,
        actor_id=actor_id,
        idempotency_key="restore",
        expected_flow_revision=4,
    )
    await async_session.refresh(flow)
    assert restored.status == CommandProposalStatus.APPLIED
    assert restored.source_proposal_id == edit.id
    assert restored.chat_run_id == chat_run_id
    assert restored.thread_id == thread_id
    assert flow.revision == 5
    assert flow.data["nodes"][0]["data"]["node"]["template"]["system_prompt"]["value"] == "Before"

    stale = await propose_flow_changes(
        async_session,
        actor_id=actor_id,
        project_id=project_id,
        chat_run_id=chat_run_id,
        thread_id=thread_id,
        target_flow_id=flow.id,
        operations=[
            {"op": "set_parameter", "nodeId": "agent", "parameter": "system_prompt", "value": "AI stale"}
        ],
        idempotency_key="edit-stale",
        request_id="edit-stale",
        component_registry=_registry(),
    )
    await bind_interrupt(
        async_session,
        proposal_id=stale.id,
        chat_run_id=chat_run_id,
        thread_id=thread_id,
        interrupt_id="edit-stale",
    )
    manual_data = {"nodes": [_node("Manual")], "edges": []}
    await async_session.exec(
        update(Flow).where(Flow.id == flow.id).values(data=manual_data, revision=Flow.revision + 1)
    )
    await async_session.flush()
    stale = await resolve_proposal(
        async_session,
        proposal_id=stale.id,
        actor_id=actor_id,
        chat_run_id=chat_run_id,
        thread_id=thread_id,
        interrupt_id="edit-stale",
        approved=True,
        component_registry=_registry(),
    )
    await async_session.refresh(flow)
    assert stale.status == CommandProposalStatus.STALE
    assert flow.revision == 6
    assert flow.data == manual_data
    assert (await async_session.exec(select(func.count(FlowVersion.id)))).one() == 2
