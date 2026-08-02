from uuid import uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from ketos.api.v1.board_notes import router as board_notes_router
from ketos.api.v1.boards import router as boards_router
from ketos.api.v1.placements import router as placements_router
from ketos.api.v1.projects import router as projects_router


@pytest.fixture
async def placement_client(client: AsyncClient) -> AsyncClient:
    _ = client
    app = FastAPI()
    for router in (projects_router, boards_router, placements_router, board_notes_router):
        app.include_router(router, prefix="/api/v1")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver/") as local_client:
        yield local_client


async def _create_project_board_note(client: AsyncClient, headers: dict[str, str]) -> tuple[str, dict, dict]:
    project_response = await client.post(
        "/api/v1/projects/",
        json={"name": f"Placement {uuid4()}", "description": "", "flows_list": [], "components_list": []},
        headers=headers,
    )
    assert project_response.status_code == 201
    project_id = project_response.json()["id"]
    board_response = await client.post(
        f"/api/v1/projects/{project_id}/boards", json={"title": "Placement board"}, headers=headers
    )
    assert board_response.status_code == 201
    board = board_response.json()
    note_response = await client.post(
        f"/api/v1/boards/{board['id']}/board-notes",
        json={
            "content": "Placement note",
            "color": "yellow",
            "placement": {"x": 10, "y": 20, "width": 320, "height": 240, "z_index": 0},
        },
        headers=headers,
    )
    assert note_response.status_code == 201
    return project_id, board, note_response.json()


async def test_placement_lifecycle_keeps_entity_separate(
    placement_client: AsyncClient, logged_in_headers: dict[str, str]
) -> None:
    _, board, created = await _create_project_board_note(placement_client, logged_in_headers)
    note = created["note"]
    placement = created["placement"]
    assert "content" not in placement
    assert not {"x", "y", "width", "height", "display_state"} & note.keys()

    listed = await placement_client.get(f"/api/v1/boards/{board['id']}/placements", headers=logged_in_headers)
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [placement["id"]]

    moved = await placement_client.patch(
        f"/api/v1/placements/{placement['id']}",
        json={"x": 99, "display_state": "collapsed", "expected_revision": placement["revision"]},
        headers=logged_in_headers,
    )
    assert moved.status_code == 200
    assert (moved.json()["x"], moved.json()["display_state"], moved.json()["revision"]) == (99, "collapsed", 1)

    stale = await placement_client.patch(
        f"/api/v1/placements/{placement['id']}",
        json={"y": 777, "expected_revision": 0},
        headers=logged_in_headers,
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "stale_revision"

    closed = await placement_client.delete(
        f"/api/v1/placements/{placement['id']}",
        params={"expected_revision": 1},
        headers=logged_in_headers,
    )
    assert closed.status_code == 204
    assert (
        await placement_client.get(f"/api/v1/board-notes/{note['id']}", headers=logged_in_headers)
    ).status_code == 200

    replaced = await placement_client.post(
        f"/api/v1/boards/{board['id']}/placements",
        json={
            "target_kind": "note",
            "target_id": note["id"],
            "x": 50,
            "y": 60,
            "width": 320,
            "height": 240,
            "z_index": 2,
        },
        headers=logged_in_headers,
    )
    assert replaced.status_code == 201
    assert replaced.json()["id"] != placement["id"]
    assert replaced.json()["target_id"] == note["id"]
    duplicate = await placement_client.post(
        f"/api/v1/boards/{board['id']}/placements",
        json={"target_kind": "note", "target_id": note["id"], "x": 0, "y": 0},
        headers=logged_in_headers,
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"]["code"] == "placement_already_exists"


@pytest.mark.parametrize(
    ("payload", "expected_status"),
    [
        ({"target_kind": "chat", "target_id": str(uuid4()), "x": 0, "y": 0}, 404),
        ({"target_kind": "note", "target_id": str(uuid4()), "x": "Infinity", "y": 0}, 422),
        (
            {"target_kind": "note", "target_id": str(uuid4()), "x": 0, "y": 0, "actor_id": str(uuid4())},
            422,
        ),
    ],
)
async def test_placement_invalid_or_missing_targets_are_rejected(
    placement_client: AsyncClient,
    logged_in_headers: dict[str, str],
    payload: dict,
    expected_status: int,
) -> None:
    _, board, _ = await _create_project_board_note(placement_client, logged_in_headers)
    response = await placement_client.post(
        f"/api/v1/boards/{board['id']}/placements", json=payload, headers=logged_in_headers
    )
    assert response.status_code == expected_status


async def test_placement_routes_require_authentication(placement_client: AsyncClient) -> None:
    response = await placement_client.get(f"/api/v1/boards/{uuid4()}/placements")
    assert response.status_code in {401, 403}
