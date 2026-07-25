from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from sqlalchemy import func
from sqlmodel import select

from ketos.agentic.services.provider_service import get_provider_model_candidates
from ketos.services.chat_threads.repository import (
    ChatNotFoundError,
    compare_and_swap_chat,
    require_owned_chat,
)
from ketos.services.database.models.chat_thread.model import ChatContextPolicy, ChatThread
from ketos.services.database.models.folder.model import Folder

if TYPE_CHECKING:
    from uuid import UUID

    from sqlmodel.ext.asyncio.session import AsyncSession

_INVALID_VALUE_ERROR = "invalid chat field"
_PROVIDER_MODEL_ERROR = "provider/model is not available for this user"
_LIST_LIMIT_ERROR = "limit must be between 1 and 50"
_MAX_LIST_LIMIT = 50


@dataclass(frozen=True, slots=True)
class PreparedChatCreate:
    project_id: UUID
    actor_id: UUID
    title: str
    provider: str
    model_name: str
    context_policy: ChatContextPolicy


def _clean(value: str, *, label: str, limit: int) -> str:
    if not isinstance(value, str) or not (clean := value.strip()) or len(clean) > limit:
        raise ValueError(_INVALID_VALUE_ERROR, label)
    return clean


async def require_owned_project(session: AsyncSession, *, project_id: UUID, actor_id: UUID) -> Folder:
    project = (await session.exec(select(Folder).where(Folder.id == project_id, Folder.user_id == actor_id))).first()
    if project is None:
        raise ChatNotFoundError
    return project


def resolve_provider_model(*, provider: str, model_name: str, actor_id: UUID) -> tuple[str, str]:
    clean_provider = _clean(provider, label="provider", limit=128)
    clean_model = _clean(model_name, label="model_name", limit=256)
    if clean_model not in get_provider_model_candidates(clean_provider, actor_id):
        raise ValueError(_PROVIDER_MODEL_ERROR)
    return clean_provider, clean_model


async def create_chat(
    session: AsyncSession,
    *,
    project_id: UUID,
    actor_id: UUID,
    title: str,
    provider: str,
    model_name: str,
    context_policy: ChatContextPolicy,
) -> ChatThread:
    prepared = await prepare_chat_create(
        session,
        project_id=project_id,
        actor_id=actor_id,
        title=title,
        provider=provider,
        model_name=model_name,
        context_policy=context_policy,
    )
    chat = await create_chat_uncommitted(session, prepared=prepared)
    await session.commit()
    await session.refresh(chat)
    return chat


async def prepare_chat_create(
    session: AsyncSession,
    *,
    project_id: UUID,
    actor_id: UUID,
    title: str,
    provider: str,
    model_name: str,
    context_policy: ChatContextPolicy,
) -> PreparedChatCreate:
    await require_owned_project(session, project_id=project_id, actor_id=actor_id)
    clean_provider, clean_model = resolve_provider_model(provider=provider, model_name=model_name, actor_id=actor_id)
    return PreparedChatCreate(
        project_id=project_id,
        actor_id=actor_id,
        title=_clean(title, label="title", limit=120),
        provider=clean_provider,
        model_name=clean_model,
        context_policy=ChatContextPolicy(context_policy),
    )


async def create_chat_uncommitted(
    session: AsyncSession,
    *,
    prepared: PreparedChatCreate,
    chat_id: UUID | None = None,
) -> ChatThread:
    chat = ChatThread(
        project_id=prepared.project_id,
        created_by_id=prepared.actor_id,
        title=prepared.title,
        provider=prepared.provider,
        model_name=prepared.model_name,
        context_policy=prepared.context_policy,
    )
    if chat_id is not None:
        chat.id = chat_id
    session.add(chat)
    await session.flush()
    await session.refresh(chat)
    return chat


async def list_chats(
    session: AsyncSession,
    *,
    project_id: UUID,
    actor_id: UUID,
    query: str | None = None,
    limit: int = 50,
    include_archived: bool = False,
) -> list[ChatThread]:
    if not 1 <= limit <= _MAX_LIST_LIMIT:
        raise ValueError(_LIST_LIMIT_ERROR)
    await require_owned_project(session, project_id=project_id, actor_id=actor_id)
    statement = select(ChatThread).where(ChatThread.project_id == project_id)
    if not include_archived:
        statement = statement.where(ChatThread.archived.is_(False))
    if query is not None and (clean_query := query.strip()):
        statement = statement.where(func.lower(ChatThread.title).contains(clean_query.lower()))
    result = await session.exec(statement.order_by(ChatThread.updated_at.desc(), ChatThread.id).limit(limit))
    return list(result.all())


async def get_chat(session: AsyncSession, *, chat_id: UUID, actor_id: UUID) -> ChatThread:
    return await require_owned_chat(session, chat_id=chat_id, actor_id=actor_id)


async def patch_chat(
    session: AsyncSession,
    *,
    chat_id: UUID,
    actor_id: UUID,
    expected_revision: int,
    values: dict[str, object],
) -> ChatThread:
    chat = await require_owned_chat(session, chat_id=chat_id, actor_id=actor_id)
    mutable = dict(values)
    provider = mutable.get("provider", chat.provider)
    model_name = mutable.get("model_name", chat.model_name)
    if "provider" in mutable or "model_name" in mutable:
        clean_provider, clean_model = resolve_provider_model(
            provider=str(provider), model_name=str(model_name), actor_id=actor_id
        )
        mutable["provider"] = clean_provider
        mutable["model_name"] = clean_model
    return await compare_and_swap_chat(
        session,
        chat_id=chat_id,
        actor_id=actor_id,
        expected_revision=expected_revision,
        values=mutable,
    )
