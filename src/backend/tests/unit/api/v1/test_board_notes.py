from uuid import uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from ketos.api.v1.board_notes import router as board_notes_router
from ketos.api.v1.boards import router as boards_router
from ketos.api.v1.placements import router as placements_router
from ketos.api.v1.projects import router as projects_router
from ketos.services.database.models.board_note.model import BoardNote
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.user.model import User
from ketos.services.deps import session_scope


@pytest.fixture
async def note_client(client: AsyncClient) -> AsyncClient:
    _ = client
    app = FastAPI()
    for router in (projects_router, boards_router, placements_router, board_notes_router):
        app.include_router(router, prefix="/api/v1")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver/") as local_client:
        yield local_client


async def _project_and_board(client: AsyncClient, headers: dict[str, str]) -> tuple[str, str]:
    project = await client.post(
        "/api/v1/projects/",
        json={"name": f"Note {uuid4()}", "description": "", "flows_list": [], "components_list": []},
        headers=headers,
    )
    assert project.status_code == 201
    project_id = project.json()["id"]
    board = await client.post(f"/api/v1/projects/{project_id}/boards", json={"title": "Note board"}, headers=headers)
    assert board.status_code == 201
    return project_id, board.json()["id"]


async def _create_note(client: AsyncClient, headers: dict[str, str], board_id: str) -> dict:
    response = await client.post(
        f"/api/v1/boards/{board_id}/board-notes",
        json={"content": "Safe **note**", "color": "#12aBcF", "placement": {"x": 0, "y": 0}},
        headers=headers,
    )
    assert response.status_code == 201
    return response.json()


async def test_board_note_create_list_patch_and_explicit_delete(
    note_client: AsyncClient, logged_in_headers: dict[str, str]
) -> None:
    project_id, board_id = await _project_and_board(note_client, logged_in_headers)
    created = await _create_note(note_client, logged_in_headers, board_id)
    note = created["note"]
    placement = created["placement"]
    assert note["project_id"] == project_id
    assert placement["board_id"] == board_id
    assert placement["target_id"] == note["id"]
    assert note["revision"] == placement["revision"] == 0

    listed = await note_client.get(f"/api/v1/projects/{project_id}/board-notes", headers=logged_in_headers)
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [note["id"]]
    fetched = await note_client.get(f"/api/v1/board-notes/{note['id']}", headers=logged_in_headers)
    assert fetched.status_code == 200
    assert fetched.json() == note

    updated = await note_client.patch(
        f"/api/v1/board-notes/{note['id']}",
        json={"content": "Updated [safe](https://example.test)", "color": "violet", "expected_revision": 0},
        headers=logged_in_headers,
    )
    assert updated.status_code == 200
    assert (updated.json()["content"], updated.json()["color"], updated.json()["revision"]) == (
        "Updated [safe](https://example.test)",
        "violet",
        1,
    )
    stale = await note_client.patch(
        f"/api/v1/board-notes/{note['id']}",
        json={"content": "Loser", "expected_revision": 0},
        headers=logged_in_headers,
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "stale_revision"

    for params in ({}, {"expected_revision": 1}, {"expected_revision": 1, "confirm_entity_delete": False}):
        rejected = await note_client.delete(
            f"/api/v1/board-notes/{note['id']}", params=params, headers=logged_in_headers
        )
        assert rejected.status_code == 422
    deleted = await note_client.delete(
        f"/api/v1/board-notes/{note['id']}",
        params={"expected_revision": 1, "confirm_entity_delete": True},
        headers=logged_in_headers,
    )
    assert deleted.status_code == 204
    remaining = await note_client.get(f"/api/v1/boards/{board_id}/placements", headers=logged_in_headers)
    assert remaining.status_code == 200
    assert remaining.json() == []


@pytest.mark.parametrize(
    "payload",
    [
        {"content": "<script>alert(1)</script>", "color": "neutral", "placement": {"x": 0, "y": 0}},
        {"content": "safe", "color": "red", "placement": {"x": 0, "y": 0}},
        {
            "content": "safe",
            "color": "neutral",
            "placement": {"x": 0, "y": 0},
            "created_by_id": str(uuid4()),
        },
    ],
)
async def test_board_note_create_rejects_unsafe_or_server_owned_fields(
    note_client: AsyncClient, logged_in_headers: dict[str, str], payload: dict
) -> None:
    _, board_id = await _project_and_board(note_client, logged_in_headers)
    response = await note_client.post(f"/api/v1/boards/{board_id}/board-notes", json=payload, headers=logged_in_headers)
    assert response.status_code == 422
    if "script" in payload["content"]:
        assert response.json()["detail"]["code"] == "unsafe_markdown"


async def test_board_note_foreign_null_and_missing_are_non_enumerating(
    note_client: AsyncClient, logged_in_headers: dict[str, str], active_user
) -> None:
    async with session_scope() as session:
        foreign_user = User(username=f"foreign-note-{uuid4()}", password="x", is_active=True)  # noqa: S106
        session.add(foreign_user)
        await session.flush()
        foreign_project = Folder(name="Foreign secret", user_id=foreign_user.id)
        null_project = Folder(name="Null secret", user_id=None)
        session.add(foreign_project)
        session.add(null_project)
        await session.flush()
        foreign_note = BoardNote(project_id=foreign_project.id, created_by_id=foreign_user.id, content="secret")
        null_note = BoardNote(project_id=null_project.id, created_by_id=active_user.id, content="secret")
        session.add(foreign_note)
        session.add(null_note)
        await session.commit()
        hidden_ids = (foreign_note.id, null_note.id, uuid4())
        hidden_projects = (foreign_project.id, null_project.id, uuid4())

    for note_id in hidden_ids:
        response = await note_client.get(f"/api/v1/board-notes/{note_id}", headers=logged_in_headers)
        assert response.status_code == 404
        assert "secret" not in response.text.lower()
    for project_id in hidden_projects:
        response = await note_client.get(f"/api/v1/projects/{project_id}/board-notes", headers=logged_in_headers)
        assert response.status_code == 404


async def test_board_note_patch_rejects_empty_and_unsafe_source(
    note_client: AsyncClient, logged_in_headers: dict[str, str]
) -> None:
    _, board_id = await _project_and_board(note_client, logged_in_headers)
    note_id = (await _create_note(note_client, logged_in_headers, board_id))["note"]["id"]
    empty = await note_client.patch(
        f"/api/v1/board-notes/{note_id}", json={"expected_revision": 0}, headers=logged_in_headers
    )
    unsafe = await note_client.patch(
        f"/api/v1/board-notes/{note_id}",
        json={"content": "[bad](javascript:alert(1))", "expected_revision": 0},
        headers=logged_in_headers,
    )
    assert empty.status_code == unsafe.status_code == 422
    assert unsafe.json()["detail"]["code"] == "unsafe_markdown"
