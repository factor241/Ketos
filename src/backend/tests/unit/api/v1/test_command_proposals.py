from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from ketos.api.v1 import command_proposals
from ketos.api.v1.command_proposals import get_command_proposal, restore_command_proposal
from ketos.api.v1.schemas.command_proposals import RestoreCommandProposalRequest
from ketos.services.commands.exceptions import CommandProposalConflictError
from pydantic import ValidationError


def test_restore_request_rejects_every_server_owned_override() -> None:
    with pytest.raises(ValidationError):
        RestoreCommandProposalRequest.model_validate(
            {
                "idempotency_key": "restore",
                "expected_flow_revision": 2,
                "actor_id": str(uuid4()),
                "flow_id": str(uuid4()),
                "source_kind": "server_restore",
                "status": "applied",
            }
        )


async def test_restore_route_uses_current_user_and_returns_camel_case(monkeypatch: pytest.MonkeyPatch) -> None:
    actor_id, proposal_id, source_id, flow_id, pin_id = (uuid4() for _ in range(5))
    result = SimpleNamespace(
        id=proposal_id,
        source_kind="server_restore",
        source_proposal_id=source_id,
        flow_id=flow_id,
        status="applied",
        pinned_flow_version_id=pin_id,
        outcome={"code": "applied"},
    )
    restore = AsyncMock(return_value=result)
    monkeypatch.setattr(command_proposals, "restore_flow_snapshot", restore)
    session = SimpleNamespace(commit=AsyncMock(), rollback=AsyncMock())

    response = await restore_command_proposal(
        source_id,
        RestoreCommandProposalRequest(idempotency_key="restore-key", expected_flow_revision=8),
        session,
        SimpleNamespace(id=actor_id),
    )

    restore.assert_awaited_once_with(
        session,
        source_proposal_id=source_id,
        actor_id=actor_id,
        idempotency_key="restore-key",
        expected_flow_revision=8,
    )
    assert response.model_dump(by_alias=True)["sourceKind"] == "server_restore"
    assert response.model_dump(by_alias=True)["sourceProposalId"] == source_id
    session.commit.assert_awaited_once()


async def test_restore_route_maps_domain_conflict_to_409(monkeypatch: pytest.MonkeyPatch) -> None:
    restore = AsyncMock(side_effect=CommandProposalConflictError("restore_revision_conflict"))
    monkeypatch.setattr(command_proposals, "restore_flow_snapshot", restore)
    session = SimpleNamespace(commit=AsyncMock(), rollback=AsyncMock())

    with pytest.raises(HTTPException) as exc_info:
        await restore_command_proposal(
            uuid4(),
            RestoreCommandProposalRequest(idempotency_key="restore-key", expected_flow_revision=2),
            session,
            SimpleNamespace(id=uuid4()),
        )
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == {"code": "restore_revision_conflict"}
    session.rollback.assert_awaited_once()


async def test_read_route_reauthorizes_current_user(monkeypatch: pytest.MonkeyPatch) -> None:
    actor_id, proposal_id, flow_id = (uuid4() for _ in range(3))
    result = SimpleNamespace(
        id=proposal_id,
        source_kind="ai_run",
        source_proposal_id=None,
        flow_id=flow_id,
        status="applied",
        pinned_flow_version_id=None,
        outcome={"code": "applied", "afterRevision": 1},
    )
    load = AsyncMock(return_value=result)
    monkeypatch.setattr(command_proposals, "load_authorized_proposal", load)
    session = SimpleNamespace()

    response = await get_command_proposal(proposal_id, session, SimpleNamespace(id=actor_id))

    load.assert_awaited_once_with(session, proposal_id=proposal_id, actor_id=actor_id)
    assert response.id == proposal_id
    assert response.model_dump(by_alias=True)["outcome"]["afterRevision"] == 1


def test_restore_router_is_registered_once() -> None:
    from ketos.api.router import router_v1

    paths = [
        route.path
        for included in router_v1.routes
        for route in included.effective_route_contexts()
    ]
    assert paths.count("/v1/command-proposals/{proposal_id}/restore") == 1
    assert paths.count("/v1/command-proposals/{proposal_id}") == 1
