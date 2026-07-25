from __future__ import annotations

from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from ketos.api.v1.chat_threads import router
from ketos.services.board.service import create_board
from ketos.services.chat_threads import service
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.user.model import User
from ketos.services.deps import session_scope


@pytest.fixture
async def chat_client(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> AsyncClient:
    _ = client
    monkeypatch.setattr(
        service,
        "get_provider_model_candidates",
        lambda provider, user_id: ["stage05-model"] if provider == "OpenAI" and user_id else [],
    )
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as local:
        yield local


async def _folder(user_id, name: str) -> Folder:
    async with session_scope() as session:
        folder = Folder(name=f"{name}-{uuid4()}", user_id=user_id)
        session.add(folder)
        await session.commit()
        await session.refresh(folder)
        return folder


def test_chat_thread_router_is_registered_once_in_v1_chain() -> None:
    from ketos.api.router import router_v1

    route_paths = [
        candidate.path
        for included_router in router_v1.routes
        for candidate in included_router.effective_route_contexts()
    ]
    assert route_paths.count("/v1/projects/{project_id}/chats") == 2
    assert route_paths.count("/v1/boards/{board_id}/chats") == 1
    assert route_paths.count("/v1/chats/{chat_id}") == 2


def _create_payload(title: str = "API chat") -> dict[str, str]:
    return {
        "title": title,
        "provider": "OpenAI",
        "model_name": "stage05-model",
        "context_policy": "chat_only",
    }


def _board_create_payload(title: str = "Board API chat") -> dict:
    return {
        "title": title,
        "provider": "OpenAI",
        "model_name": "stage05-model",
        "placement": {
            "x": 12,
            "y": 24,
            "width": 360,
            "height": 240,
            "z_index": 2,
        },
    }


async def test_board_chat_api_is_atomic_replayable_and_server_scoped(
    chat_client: AsyncClient,
    logged_in_headers,
    active_user,
) -> None:
    project = await _folder(active_user.id, "Board API")
    async with session_scope() as session:
        board = await create_board(
            session,
            project_id=project.id,
            actor_id=active_user.id,
            title="API Board",
        )
    key = str(uuid4())
    response = await chat_client.post(
        f"/api/v1/boards/{board.id}/chats",
        json=_board_create_payload(),
        headers={**logged_in_headers, "Idempotency-Key": key},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["chat"]["project_id"] == str(project.id)
    assert body["chat"]["created_by_id"] == str(active_user.id)
    assert body["chat"]["context_policy"] == "board"
    assert body["placement"]["board_id"] == str(board.id)
    assert body["placement"]["target_kind"] == "chat"
    assert body["placement"]["target_id"] == body["chat"]["id"]
    assert body["placement"]["x"] == 12
    assert body["idempotency_replayed"] is False

    replay = await chat_client.post(
        f"/api/v1/boards/{board.id}/chats",
        json=_board_create_payload(),
        headers={**logged_in_headers, "Idempotency-Key": key},
    )
    assert replay.status_code == 201
    assert replay.json()["idempotency_replayed"] is True
    assert (
        replay.json()["chat"]["id"],
        replay.json()["placement"]["id"],
    ) == (body["chat"]["id"], body["placement"]["id"])

    changed = _board_create_payload()
    changed["placement"]["x"] = 13
    conflict = await chat_client.post(
        f"/api/v1/boards/{board.id}/chats",
        json=changed,
        headers={**logged_in_headers, "Idempotency-Key": key},
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "idempotency_key_reused"


async def test_board_chat_api_rejects_missing_header_provider_and_forged_scope(
    chat_client: AsyncClient,
    logged_in_headers,
    active_user,
) -> None:
    project = await _folder(active_user.id, "Board validation")
    async with session_scope() as session:
        board = await create_board(
            session,
            project_id=project.id,
            actor_id=active_user.id,
            title="Validation Board",
        )
    url = f"/api/v1/boards/{board.id}/chats"

    missing_header = await chat_client.post(
        url,
        json=_board_create_payload(),
        headers=logged_in_headers,
    )
    assert missing_header.status_code == 422

    unavailable = _board_create_payload()
    unavailable["provider"] = "Unavailable"
    invalid_provider = await chat_client.post(
        url,
        json=unavailable,
        headers={**logged_in_headers, "Idempotency-Key": str(uuid4())},
    )
    assert invalid_provider.status_code == 422
    assert invalid_provider.json()["detail"]["code"] == "chat_validation_error"

    forged = _board_create_payload()
    forged.update(
        {
            "project_id": str(uuid4()),
            "actor_id": str(uuid4()),
            "context_policy": "chat_only",
            "target_id": str(uuid4()),
        }
    )
    forged_scope = await chat_client.post(
        url,
        json=forged,
        headers={**logged_in_headers, "Idempotency-Key": str(uuid4())},
    )
    assert forged_scope.status_code == 422


async def test_chat_api_owner_roundtrip_search_and_conflict(
    chat_client: AsyncClient, logged_in_headers, active_user
) -> None:
    project = await _folder(active_user.id, "API")
    created = await chat_client.post(
        f"/api/v1/projects/{project.id}/chats",
        json=_create_payload("Searchable title"),
        headers=logged_in_headers,
    )
    assert created.status_code == 201
    body = created.json()
    assert body["project_id"] == str(project.id)
    assert (body["provider"], body["model_name"], body["revision"]) == (
        "OpenAI",
        "stage05-model",
        0,
    )
    listed = await chat_client.get(
        f"/api/v1/projects/{project.id}/chats",
        params={"q": "SEARCHABLE"},
        headers=logged_in_headers,
    )
    assert [item["id"] for item in listed.json()] == [body["id"]]
    fetched = await chat_client.get(f"/api/v1/chats/{body['id']}", headers=logged_in_headers)
    assert fetched.json() == body
    winner = await chat_client.patch(
        f"/api/v1/chats/{body['id']}",
        json={"expected_revision": 0, "title": "Winner"},
        headers=logged_in_headers,
    )
    assert winner.status_code == 200
    assert (winner.json()["title"], winner.json()["revision"]) == ("Winner", 1)
    stale = await chat_client.patch(
        f"/api/v1/chats/{body['id']}",
        json={"expected_revision": 0, "title": "Stale"},
        headers=logged_in_headers,
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "chat_revision_conflict"


async def test_chat_api_denies_foreign_null_and_forged_overrides(
    chat_client: AsyncClient, logged_in_headers, active_user
) -> None:
    async with session_scope() as session:
        foreign = User(username=f"api-foreign-{uuid4()}", password="x", is_active=True)  # noqa: S106
        session.add(foreign)
        await session.commit()
        await session.refresh(foreign)
    foreign_project = await _folder(foreign.id, "Foreign")
    null_project = await _folder(None, "Null")
    for project in (foreign_project, null_project):
        response = await chat_client.get(f"/api/v1/projects/{project.id}/chats", headers=logged_in_headers)
        assert response.status_code == 404
        assert "foreign" not in response.text.lower()
    owned = await _folder(active_user.id, "Owned")
    forged = _create_payload()
    forged.update({"actor_id": str(uuid4()), "tool": "unsafe", "url": "https://invalid.test"})
    response = await chat_client.post(f"/api/v1/projects/{owned.id}/chats", json=forged, headers=logged_in_headers)
    assert response.status_code == 422


async def test_chat_messages_api_returns_owner_scoped_ag_ui_transcript(
    chat_client: AsyncClient,
    logged_in_headers,
    active_user,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project = await _folder(active_user.id, "Transcript")
    created = await chat_client.post(
        f"/api/v1/projects/{project.id}/chats",
        json=_create_payload("Durable transcript"),
        headers=logged_in_headers,
    )
    chat_id = created.json()["id"]
    captured: dict[str, object] = {}

    async def fake_load_committed_messages(_session, *, chat_id, actor_id):
        captured.update({"chat_id": chat_id, "actor_id": actor_id})
        return [
            SimpleNamespace(id=uuid4(), is_output=False, text="release prompt", chat_sequence=1),
            SimpleNamespace(id=uuid4(), is_output=True, text="release answer", chat_sequence=2),
        ]

    monkeypatch.setattr(
        "ketos.api.v1.chat_threads.load_committed_messages",
        fake_load_committed_messages,
        raising=False,
    )
    response = await chat_client.get(f"/api/v1/chats/{chat_id}/messages", headers=logged_in_headers)

    assert response.status_code == 200
    assert [(item["role"], item["content"], item["sequence"]) for item in response.json()] == [
        ("user", "release prompt", 1),
        ("assistant", "release answer", 2),
    ]
    assert captured == {"chat_id": UUID(chat_id), "actor_id": active_user.id}
