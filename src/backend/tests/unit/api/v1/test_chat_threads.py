from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from ketos.api.v1.chat_threads import router
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


def _create_payload(title: str = "API chat") -> dict[str, str]:
    return {
        "title": title,
        "provider": "OpenAI",
        "model_name": "stage05-model",
        "context_policy": "chat_only",
    }


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
