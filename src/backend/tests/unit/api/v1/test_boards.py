from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from ketos.api.v1.boards import router
from ketos.api.v1.projects import router as projects_router
from ketos.services.database.models.board.model import Board
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.user.model import User
from ketos.services.deps import session_scope


@pytest.fixture
async def board_client(client: AsyncClient) -> AsyncClient:
    # Keep the repository client fixture alive so its isolated database and
    # service lifecycle remain active, but mount the A03 router locally.  Live
    # application registration is owned by A10.
    app = FastAPI()
    app.include_router(projects_router, prefix="/api/v1")
    app.include_router(router, prefix="/api/v1")
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver/",
    ) as local_client:
        yield local_client


async def _create_project(client: AsyncClient, headers: dict[str, str], name: str = "Board Project") -> str:
    response = await client.post(
        "/api/v1/projects/",
        json={"name": name, "description": "", "flows_list": [], "components_list": []},
        headers=headers,
    )
    assert response.status_code == 201
    return response.json()["id"]


async def _create_board(client: AsyncClient, headers: dict[str, str], project_id: str, title: str = "Board") -> dict:
    response = await client.post(
        f"/api/v1/projects/{project_id}/boards", json={"title": title}, headers=headers
    )
    assert response.status_code == 201
    return response.json()


async def test_board_six_endpoint_contract(board_client: AsyncClient, logged_in_headers):
    project_id = await _create_project(board_client, logged_in_headers)
    created = await _create_board(board_client, logged_in_headers, project_id, "Sprint")
    assert created["project_id"] == project_id
    assert created["revision"] == 0
    assert (created["viewport_x"], created["viewport_y"], created["viewport_zoom"]) == (0, 0, 1)

    listed = await board_client.get(f"/api/v1/projects/{project_id}/boards", headers=logged_in_headers)
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [created["id"]]

    fetched = await board_client.get(f"/api/v1/boards/{created['id']}", headers=logged_in_headers)
    assert fetched.status_code == 200
    assert fetched.json() == created

    renamed = await board_client.patch(
        f"/api/v1/boards/{created['id']}",
        json={"title": "Renamed", "expected_revision": 0},
        headers=logged_in_headers,
    )
    assert renamed.status_code == 200
    assert renamed.json()["revision"] == 1

    viewport = await board_client.put(
        f"/api/v1/boards/{created['id']}/viewport",
        json={"x": 42.5, "y": -17.25, "zoom": 1.75, "expected_revision": 1},
        headers=logged_in_headers,
    )
    assert viewport.status_code == 200
    assert viewport.json()["revision"] == 2
    assert (viewport.json()["viewport_x"], viewport.json()["viewport_y"], viewport.json()["viewport_zoom"]) == (
        42.5, -17.25, 1.75
    )

    deleted = await board_client.delete(
        f"/api/v1/boards/{created['id']}", params={"expected_revision": 2}, headers=logged_in_headers
    )
    assert deleted.status_code == 204
    assert deleted.content == b""


async def test_board_get_patch_delete_deny_foreign_owner(
    board_client: AsyncClient, logged_in_headers, active_user
):
    async with session_scope() as session:
        foreign = User(username=f"foreign-{uuid4()}", password="x", is_active=True)
        session.add(foreign)
        await session.flush()
        foreign_folder = Folder(name="Foreign", user_id=foreign.id)
        null_folder = Folder(name="Null", user_id=None)
        session.add(foreign_folder)
        session.add(null_folder)
        await session.flush()
        foreign_board = Board(project_id=foreign_folder.id, created_by_id=foreign.id, title="Foreign secret")
        null_board = Board(project_id=null_folder.id, created_by_id=active_user.id, title="Null secret")
        session.add(foreign_board)
        session.add(null_board)
        await session.commit()
        ids = (foreign_board.id, null_board.id)

    for board_id in ids:
        get_response = await board_client.get(f"/api/v1/boards/{board_id}", headers=logged_in_headers)
        patch_response = await board_client.patch(
            f"/api/v1/boards/{board_id}",
            json={"title": "Stolen", "expected_revision": 0},
            headers=logged_in_headers,
        )
        delete_response = await board_client.delete(
            f"/api/v1/boards/{board_id}", params={"expected_revision": 0}, headers=logged_in_headers
        )
        assert {get_response.status_code, patch_response.status_code, delete_response.status_code} == {404}
        assert "secret" not in get_response.text.lower()


async def test_board_parent_child_id_mixup_fails_closed(board_client: AsyncClient, logged_in_headers):
    project_id = await _create_project(board_client, logged_in_headers)
    board = await _create_board(board_client, logged_in_headers, project_id)
    parent_as_child = await board_client.get(f"/api/v1/boards/{project_id}", headers=logged_in_headers)
    child_as_parent = await board_client.get(f"/api/v1/projects/{board['id']}/boards", headers=logged_in_headers)
    random_parent = await board_client.post(
        f"/api/v1/projects/{uuid4()}/boards", json={"title": "Hidden"}, headers=logged_in_headers
    )
    assert {parent_as_child.status_code, child_as_parent.status_code, random_parent.status_code} == {404}


def _assert_conflict(response) -> None:
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "board_revision_conflict"


async def test_stale_rename_and_viewport_write_zero_columns(board_client: AsyncClient, logged_in_headers):
    project_id = await _create_project(board_client, logged_in_headers)
    board = await _create_board(board_client, logged_in_headers, project_id, "Original")
    winner = await board_client.patch(
        f"/api/v1/boards/{board['id']}",
        json={"title": "Winner", "expected_revision": 0},
        headers=logged_in_headers,
    )
    assert winner.status_code == 200
    stale_rename = await board_client.patch(
        f"/api/v1/boards/{board['id']}",
        json={"title": "Loser", "expected_revision": 0},
        headers=logged_in_headers,
    )
    stale_viewport = await board_client.put(
        f"/api/v1/boards/{board['id']}/viewport",
        json={"x": 9, "y": 8, "zoom": 2, "expected_revision": 0},
        headers=logged_in_headers,
    )
    _assert_conflict(stale_rename)
    _assert_conflict(stale_viewport)
    persisted = await board_client.get(f"/api/v1/boards/{board['id']}", headers=logged_in_headers)
    assert persisted.json()["title"] == "Winner"
    assert (persisted.json()["viewport_x"], persisted.json()["viewport_y"], persisted.json()["viewport_zoom"]) == (0, 0, 1)
    assert persisted.json()["revision"] == 1


async def test_stale_delete_preserves_board(board_client: AsyncClient, logged_in_headers):
    project_id = await _create_project(board_client, logged_in_headers)
    board = await _create_board(board_client, logged_in_headers, project_id)
    winner = await board_client.patch(
        f"/api/v1/boards/{board['id']}",
        json={"title": "Still here", "expected_revision": 0},
        headers=logged_in_headers,
    )
    assert winner.status_code == 200
    stale = await board_client.delete(
        f"/api/v1/boards/{board['id']}", params={"expected_revision": 0}, headers=logged_in_headers
    )
    _assert_conflict(stale)
    persisted = await board_client.get(f"/api/v1/boards/{board['id']}", headers=logged_in_headers)
    assert persisted.status_code == 200
    assert persisted.json()["title"] == "Still here"


@pytest.mark.parametrize(
    ("method", "path_suffix", "body"),
    [
        ("post", "project", {"title": ""}),
        ("post", "project", {"title": "Valid", "created_by_id": str(uuid4())}),
        ("patch", "board", {"title": "  ", "expected_revision": 0}),
        ("patch", "board", {"title": "Valid", "expected_revision": -1}),
        ("put", "viewport", {"x": 0, "y": 0, "zoom": 2.1, "expected_revision": 0}),
    ],
)
async def test_board_invalid_payloads_return_422(
    board_client: AsyncClient, logged_in_headers, method: str, path_suffix: str, body: dict
):
    project_id = await _create_project(board_client, logged_in_headers)
    board = await _create_board(board_client, logged_in_headers, project_id)
    paths = {
        "project": f"/api/v1/projects/{project_id}/boards",
        "board": f"/api/v1/boards/{board['id']}",
        "viewport": f"/api/v1/boards/{board['id']}/viewport",
    }
    response = await board_client.request(method, paths[path_suffix], json=body, headers=logged_in_headers)
    assert response.status_code == 422


async def test_board_delete_requires_nonnegative_revision(board_client: AsyncClient, logged_in_headers):
    project_id = await _create_project(board_client, logged_in_headers)
    board = await _create_board(board_client, logged_in_headers, project_id)
    missing = await board_client.delete(f"/api/v1/boards/{board['id']}", headers=logged_in_headers)
    negative = await board_client.delete(
        f"/api/v1/boards/{board['id']}", params={"expected_revision": -1}, headers=logged_in_headers
    )
    assert missing.status_code == negative.status_code == 422
