from __future__ import annotations

import json
from uuid import uuid4

from ketos.agentic.services.flow_proposal_adapter import propose_flow_changes
from ketos.services.commands.apply_service import resolve_proposal
from ketos.services.commands.canonical import flow_content_hash
from ketos.services.commands.flow_changes import MAX_OPERATIONS, MAX_PREVIEW_BYTES
from ketos.services.commands.proposal_service import bind_interrupt
from ketos.services.commands.restore_service import restore_flow_snapshot
from ketos.services.database.models.chat_thread.model import ChatRun, ChatThread
from ketos.services.database.models.command_proposal.model import (
    CommandProposal,
    CommandProposalStatus,
)
from ketos.services.database.models.flow.model import Flow
from ketos.services.database.models.flow_version.model import FlowVersion
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.user.model import User
from sqlmodel import func, select, update

_AI_PREVIEW_KEYS = {
    "before",
    "after",
    "operationSummaries",
    "warnings",
    "risk",
    "canRestore",
}


def _assert_bounded_ai_preview(proposal: CommandProposal) -> None:
    assert set(proposal.preview) == _AI_PREVIEW_KEYS
    assert len(proposal.preview["operationSummaries"]) <= MAX_OPERATIONS
    serialized = json.dumps(
        proposal.preview,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    assert len(serialized) <= MAX_PREVIEW_BYTES


def _assert_redacted_audit(proposal: CommandProposal) -> None:
    assert proposal.redacted_audit
    serialized = json.dumps(
        proposal.redacted_audit,
        sort_keys=True,
        separators=(",", ":"),
    ).casefold()
    for forbidden in (
        "api_key",
        "authorization",
        "credential",
        "openai_api_key",
        "secret",
        "token",
    ):
        assert forbidden not in serialized


async def _flow_version_count(async_session, flow_id) -> int:
    return (
        await async_session.exec(
            select(func.count(FlowVersion.id)).where(FlowVersion.flow_id == flow_id)
        )
    ).one()


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
    _assert_bounded_ai_preview(rejected_create)
    _assert_redacted_audit(rejected_create)
    assert rejected_create.base_flow_revision is None
    assert rejected_create.base_flow_hash is None
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
    assert rejected_create.outcome == {"code": "rejected", "effect": "none"}
    assert rejected_create.resolved_at is not None
    assert await async_session.get(Flow, rejected_create.flow_id) is None
    rejected_replay = await resolve_proposal(
        async_session,
        proposal_id=rejected_create.id,
        actor_id=actor_id,
        chat_run_id=chat_run_id,
        thread_id=thread_id,
        interrupt_id="create-reject",
        approved=False,
        component_registry=_registry(),
    )
    assert rejected_replay.id == rejected_create.id
    assert rejected_replay.outcome == {"code": "rejected", "effect": "none"}
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
    _assert_bounded_ai_preview(edit)
    _assert_redacted_audit(edit)
    assert edit.base_flow_revision == 3
    assert edit.base_flow_hash == before_hash
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
    after_hash = flow_content_hash(flow)
    assert edit.status == CommandProposalStatus.APPLIED
    assert flow.revision == 4
    assert edit.pinned_flow_version_id is not None
    assert edit.outcome == {
        "code": "applied",
        "beforeRevision": 3,
        "afterRevision": 4,
        "beforeHash": before_hash,
        "afterHash": after_hash,
    }
    assert edit.resolved_at is not None
    versions_after_edit = await _flow_version_count(async_session, flow.id)
    approved_replay = await resolve_proposal(
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
    assert approved_replay.id == edit.id
    assert approved_replay.outcome == edit.outcome
    assert flow.revision == 4
    assert flow_content_hash(flow) == after_hash
    assert await _flow_version_count(async_session, flow.id) == versions_after_edit

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
    restored_hash = flow_content_hash(flow)
    assert restored.outcome == {
        "code": "applied",
        "beforeRevision": 4,
        "afterRevision": 5,
        "beforeHash": after_hash,
        "afterHash": restored_hash,
        "sourceProposalId": str(edit.id),
    }
    assert set(restored.preview) == {"before", "after", "source", "canRestore"}
    _assert_redacted_audit(restored)
    versions_after_restore = await _flow_version_count(async_session, flow.id)
    restored_replay = await restore_flow_snapshot(
        async_session,
        source_proposal_id=edit.id,
        actor_id=actor_id,
        idempotency_key="restore",
        expected_flow_revision=4,
    )
    await async_session.refresh(flow)
    assert restored_replay.id == restored.id
    assert restored_replay.outcome == restored.outcome
    assert flow.revision == 5
    assert flow_content_hash(flow) == restored_hash
    assert await _flow_version_count(async_session, flow.id) == versions_after_restore

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
    _assert_bounded_ai_preview(stale)
    _assert_redacted_audit(stale)
    assert stale.base_flow_revision == 5
    assert stale.base_flow_hash == restored_hash
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
    assert stale.outcome == {"code": "stale_base", "effect": "none"}
    assert flow.revision == 6
    assert flow.data == manual_data
    manual_hash = flow_content_hash(flow)
    assert (await async_session.exec(select(func.count(FlowVersion.id)))).one() == 2

    versions_before_stale_restore = await _flow_version_count(async_session, flow.id)
    stale_restore = await restore_flow_snapshot(
        async_session,
        source_proposal_id=edit.id,
        actor_id=actor_id,
        idempotency_key="restore-stale",
        expected_flow_revision=99,
    )
    await async_session.refresh(flow)
    assert stale_restore.status == CommandProposalStatus.STALE
    assert stale_restore.outcome == {
        "code": "restore_revision_conflict",
        "effect": "none",
    }
    assert stale_restore.base_flow_revision == 6
    assert set(stale_restore.preview) == {"before", "after", "source", "canRestore"}
    _assert_redacted_audit(stale_restore)
    assert flow.revision == 6
    assert flow_content_hash(flow) == manual_hash
    assert await _flow_version_count(async_session, flow.id) == versions_before_stale_restore

    stale_restore_replay = await restore_flow_snapshot(
        async_session,
        source_proposal_id=edit.id,
        actor_id=actor_id,
        idempotency_key="restore-stale",
        expected_flow_revision=99,
    )
    await async_session.refresh(flow)
    assert stale_restore_replay.id == stale_restore.id
    assert stale_restore_replay.outcome == stale_restore.outcome
    assert flow.revision == 6
    assert flow_content_hash(flow) == manual_hash
    assert await _flow_version_count(async_session, flow.id) == versions_before_stale_restore
