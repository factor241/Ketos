from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid5

from sqlmodel import select

from ketos.agentic.services.flow_command_policy import reject_flow_command_bypass
from ketos.services.commands.canonical import canonical_sha256
from ketos.services.commands.contracts import CommandProposalSpec
from ketos.services.commands.exceptions import CommandProposalAuthorizationError, CommandProposalConflictError
from ketos.services.commands.service import apply_flow_changes, ensure_proposal, parse_flow_change_set
from ketos.services.database.models.chat_thread.model import ChatRun, ChatThread
from ketos.services.database.models.flow.model import Flow
from ketos.services.database.models.folder.model import Folder

if TYPE_CHECKING:
    from sqlmodel.ext.asyncio.session import AsyncSession

_ERR_PROPOSAL_SCOPE = "proposal_scope_denied"
_ERR_UNSUPPORTED_STORAGE = "unsupported_storage_mode"
_ERR_NO_CHANGES = "no_changes"


async def _authorize_source(
    session: AsyncSession,
    *,
    actor_id: UUID,
    project_id: UUID,
    chat_run_id: UUID,
    thread_id: str,
) -> None:
    row = (
        await session.exec(
            select(ChatRun, ChatThread, Folder)
            .join(ChatThread, ChatThread.id == ChatRun.chat_id)
            .join(Folder, Folder.id == ChatThread.project_id)
            .where(ChatRun.id == chat_run_id)
        )
    ).one_or_none()
    if row is None:
        raise CommandProposalAuthorizationError(_ERR_PROPOSAL_SCOPE)
    run, thread, project = row
    if (
        project.user_id != actor_id
        or project.id != project_id
        or thread.project_id != project_id
        or str(thread.id) != thread_id
        or run.langgraph_thread_id != thread_id
    ):
        raise CommandProposalAuthorizationError(_ERR_PROPOSAL_SCOPE)


async def propose_flow_changes(
    session: AsyncSession,
    *,
    actor_id: UUID,
    project_id: UUID,
    chat_run_id: UUID,
    thread_id: str,
    target_flow_id: UUID | None,
    operations: list[dict[str, Any]],
    idempotency_key: str,
    request_id: str,
    component_registry: dict[str, dict[str, Any]],
):
    """Validate on a copy and persist one proposal without mutating a Flow."""
    reject_flow_command_bypass(operations)
    await _authorize_source(
        session,
        actor_id=actor_id,
        project_id=project_id,
        chat_run_id=chat_run_id,
        thread_id=thread_id,
    )
    # A create proposal must reserve the same server-owned Flow ID when the
    # same durable request is replayed or races on another DB connection.
    flow_id = target_flow_id or uuid5(chat_run_id, f"ketos-flow-command:{idempotency_key}")
    target_flow: dict[str, Any] | None = None
    target_revision: int | None = None
    if target_flow_id is not None:
        flow = (
            await session.exec(
                select(Flow).where(
                    Flow.id == target_flow_id,
                    Flow.user_id == actor_id,
                    Flow.folder_id == project_id,
                )
            )
        ).one_or_none()
        if flow is None:
            raise CommandProposalAuthorizationError(_ERR_PROPOSAL_SCOPE)
        if flow.fs_path is not None:
            raise CommandProposalConflictError(_ERR_UNSUPPORTED_STORAGE)
        target_flow = {"name": flow.name, "description": flow.description, "data": flow.data}
        target_revision = flow.revision

    wire = {
        "schemaVersion": 1,
        "targetProjectId": str(project_id),
        "targetFlowId": str(flow_id),
        "operations": operations,
    }
    from ketos.services.commands.canonical import canonical_json_bytes

    change_set = parse_flow_change_set(canonical_json_bytes(wire))
    result = apply_flow_changes(
        change_set,
        target_flow=target_flow,
        target_revision=target_revision,
        component_registry=component_registry,
    )
    if not result.ready:
        raise CommandProposalConflictError(_ERR_NO_CHANGES)
    canonical_payload = change_set.model_dump(mode="json", by_alias=True)
    preview = result.preview.model_dump(mode="json", by_alias=True)
    request_fingerprint = canonical_sha256(
        {
            "schemaVersion": 1,
            "chatRunId": chat_run_id,
            "threadId": thread_id,
            "requestId": request_id,
            "payload": canonical_payload,
        }
    )
    spec = CommandProposalSpec(
        actor_id=actor_id,
        project_id=project_id,
        source_kind="ai_run",
        chat_run_id=chat_run_id,
        thread_id=thread_id,
        source_proposal_id=None,
        flow_id=flow_id,
        command_type=result.command_type,
        canonical_payload=canonical_payload,
        preview=preview,
        base_flow_revision=target_revision,
        base_flow_hash=None if target_flow is None else result.preview.before.hash,
        result_flow_hash=result.result_flow_hash,
        idempotency_key=idempotency_key,
        request_fingerprint=request_fingerprint,
        request_id=request_id,
        redacted_audit={"operationCount": len(operations), "risk": result.preview.risk},
    )
    return await ensure_proposal(session, spec)
