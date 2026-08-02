from types import SimpleNamespace
from uuid import uuid4

import pytest
from httpx import AsyncClient
from ketos.services.board.placement_service import create_placement
from ketos.services.board.service import create_board
from ketos.services.database.models.flow.model import Flow
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.placement.model import PlacementTargetKind
from ketos.services.deps import session_scope

pytestmark = pytest.mark.usefixtures("client")


async def _seed(owner_id):
    async with session_scope() as session:
        project = Folder(name=f"Editor context {uuid4()}", user_id=owner_id)
        session.add(project)
        await session.commit()
        await session.refresh(project)
        board = await create_board(
            session,
            project_id=project.id,
            actor_id=owner_id,
            title="Editor context",
        )
        flow = Flow(
            name=f"Editor flow {uuid4()}",
            user_id=owner_id,
            folder_id=project.id,
            is_component=False,
            data={"nodes": [], "edges": []},
        )
        session.add(flow)
        await session.commit()
        await session.refresh(flow)
        placement = await create_placement(
            session,
            board_id=board.id,
            actor_id=owner_id,
            target_kind=PlacementTargetKind.AUTOMATION,
            target_id=flow.id,
            geometry=SimpleNamespace(x=0, y=0, width=320, height=240, z_index=0),
        )
        return project, board, flow, placement


async def test_editor_context_requires_authentication(client: AsyncClient) -> None:
    response = await client.get(
        f"/api/v1/boards/{uuid4()}/placements/{uuid4()}/automation-editor-context",
        params={"flow_id": str(uuid4())},
    )
    assert response.status_code in {401, 403}


async def test_editor_context_returns_exact_four_ids(client: AsyncClient, active_user, logged_in_headers) -> None:
    project, board, flow, placement = await _seed(active_user.id)
    response = await client.get(
        f"/api/v1/boards/{board.id}/placements/{placement.id}/automation-editor-context",
        params={"flow_id": str(flow.id)},
        headers=logged_in_headers,
    )
    assert response.status_code == 200
    assert response.json() == {
        "project_id": str(project.id),
        "board_id": str(board.id),
        "placement_id": str(placement.id),
        "flow_id": str(flow.id),
    }


async def test_editor_context_rejects_malformed_and_uniformly_hides_mismatch(
    client: AsyncClient, active_user, logged_in_headers
) -> None:
    _, board, flow, placement = await _seed(active_user.id)
    malformed = await client.get(
        f"/api/v1/boards/{board.id}/placements/{placement.id}/automation-editor-context",
        params={"flow_id": "not-a-uuid"},
        headers=logged_in_headers,
    )
    assert malformed.status_code == 422
    for url, params in (
        (
            f"/api/v1/boards/{uuid4()}/placements/{placement.id}/automation-editor-context",
            {"flow_id": str(flow.id)},
        ),
        (
            f"/api/v1/boards/{board.id}/placements/{uuid4()}/automation-editor-context",
            {"flow_id": str(flow.id)},
        ),
        (
            f"/api/v1/boards/{board.id}/placements/{placement.id}/automation-editor-context",
            {"flow_id": str(uuid4()), "actor_id": str(active_user.id)},
        ),
    ):
        response = await client.get(url, params=params, headers=logged_in_headers)
        assert response.status_code == 404
        assert response.json() == {"detail": {"code": "board_resource_not_found"}}
