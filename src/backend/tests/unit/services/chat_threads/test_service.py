from __future__ import annotations

from uuid import uuid4

import pytest
from ketos.services.chat_threads import service
from ketos.services.chat_threads.repository import ChatNotFoundError, ChatRevisionConflictError
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.user.model import User
from ketos.services.deps import session_scope

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("client")]


async def _folder(user_id, name: str) -> Folder:
    async with session_scope() as session:
        folder = Folder(name=f"{name}-{uuid4()}", user_id=user_id)
        session.add(folder)
        await session.commit()
        await session.refresh(folder)
        return folder


async def _foreign_user() -> User:
    async with session_scope() as session:
        user = User(username=f"chat-foreign-{uuid4()}", password="x", is_active=True)  # noqa: S106
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user


@pytest.fixture(autouse=True)
def configured_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        service,
        "get_provider_model_candidates",
        lambda provider, user_id: ["stage05-model"] if provider == "OpenAI" and user_id else [],
    )


async def test_owner_roundtrip_search_and_cas(active_user) -> None:
    project = await _folder(active_user.id, "Owned")
    async with session_scope() as session:
        first = await service.create_chat(
            session,
            project_id=project.id,
            actor_id=active_user.id,
            title="  Alpha plan  ",
            provider="OpenAI",
            model_name="stage05-model",
            context_policy="chat_only",
        )
    assert first.title == "Alpha plan"
    assert (first.provider, first.model_name, first.context_policy.value) == (
        "OpenAI",
        "stage05-model",
        "chat_only",
    )
    async with session_scope() as session:
        await service.create_chat(
            session,
            project_id=project.id,
            actor_id=active_user.id,
            title="Beta",
            provider="OpenAI",
            model_name="stage05-model",
            context_policy="board",
        )
    async with session_scope() as session:
        found = await service.list_chats(session, project_id=project.id, actor_id=active_user.id, query="ALPHA")
    assert [item.id for item in found] == [first.id]
    async with session_scope() as session:
        updated = await service.patch_chat(
            session,
            chat_id=first.id,
            actor_id=active_user.id,
            expected_revision=0,
            values={"title": "Renamed", "context_policy": "board"},
        )
    assert (updated.title, updated.revision, updated.context_policy.value) == ("Renamed", 1, "board")
    async with session_scope() as session:
        with pytest.raises(ChatRevisionConflictError):
            await service.patch_chat(
                session,
                chat_id=first.id,
                actor_id=active_user.id,
                expected_revision=0,
                values={"title": "Stale"},
            )


async def test_foreign_and_null_projects_fail_closed(active_user) -> None:
    foreign = await _foreign_user()
    foreign_project = await _folder(foreign.id, "Foreign")
    null_project = await _folder(None, "Null")
    for project_id in (foreign_project.id, null_project.id, uuid4()):
        async with session_scope() as session:
            with pytest.raises(ChatNotFoundError):
                await service.list_chats(session, project_id=project_id, actor_id=active_user.id)
        async with session_scope() as session:
            with pytest.raises(ChatNotFoundError):
                await service.create_chat(
                    session,
                    project_id=project_id,
                    actor_id=active_user.id,
                    title="Forbidden",
                    provider="OpenAI",
                    model_name="stage05-model",
                    context_policy="chat_only",
                )


async def test_provider_model_is_resolved_server_side(active_user) -> None:
    project = await _folder(active_user.id, "Provider")
    async with session_scope() as session:
        with pytest.raises(ValueError, match="not available"):
            await service.create_chat(
                session,
                project_id=project.id,
                actor_id=active_user.id,
                title="Invalid",
                provider="OpenAI",
                model_name="client-forged-model",
                context_policy="chat_only",
            )
