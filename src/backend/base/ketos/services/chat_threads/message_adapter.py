"""Durable committed-message access for chat threads."""

from __future__ import annotations

import asyncio
import inspect
from typing import TYPE_CHECKING

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlmodel import select

from ketos.services.chat_threads.repository import require_owned_chat
from ketos.services.database.models.chat_thread.model import ChatRun, ChatThread
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.message.model import MessageTable

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable, Sequence
    from uuid import UUID

    from sqlmodel.ext.asyncio.session import AsyncSession

_MAX_MESSAGE_LENGTH = 100_000
_DEFAULT_MAX_ATTEMPTS = 5
_MAX_LOAD_LIMIT = 200
_AFTER_SEQUENCE_ERROR = "after_sequence must be non-negative"
_LIMIT_ERROR = "limit must be between 1 and 200"
_ATTEMPTS_ERROR = "max_attempts must be between 1 and 5"
_RUN_OWNERSHIP_ERROR = "chat run does not belong to chat"
_BLANK_TEXT_ERROR = "text must not be blank"
_TEXT_LENGTH_ERROR = "text must not exceed 100000 characters"


class ChatMessageAllocationError(RuntimeError):
    """Raised when a committed-message sequence cannot be allocated."""


async def load_committed_messages(
    session: AsyncSession,
    *,
    chat_id: UUID,
    actor_id: UUID,
    after_sequence: int = 0,
    limit: int = 200,
) -> list[MessageTable]:
    """Load durable committed messages visible to the chat owner."""
    if after_sequence < 0:
        raise ValueError(_AFTER_SEQUENCE_ERROR)
    if not 1 <= limit <= _MAX_LOAD_LIMIT:
        raise ValueError(_LIMIT_ERROR)

    statement = (
        select(MessageTable)
        .join(ChatThread, MessageTable.chat_id == ChatThread.id)
        .join(Folder, ChatThread.project_id == Folder.id)
        .where(
            MessageTable.chat_id == chat_id,
            MessageTable.chat_run_id.is_not(None),
            MessageTable.chat_sequence.is_not(None),
            MessageTable.chat_sequence > 0,
            MessageTable.chat_sequence > after_sequence,
            Folder.user_id == actor_id,
        )
        .order_by(MessageTable.chat_sequence.asc())
        .limit(limit)
    )
    return list((await session.exec(statement)).all())


async def append_user_message(
    session: AsyncSession,
    *,
    chat_id: UUID,
    chat_run_id: UUID,
    actor_id: UUID,
    text: str,
) -> MessageTable:
    return await _append_committed_message(
        session,
        chat_id=chat_id,
        chat_run_id=chat_run_id,
        actor_id=actor_id,
        text=text,
        sender="user",
        sender_name="User",
        is_output=False,
    )


async def commit_assistant_message(
    session: AsyncSession,
    *,
    chat_id: UUID,
    chat_run_id: UUID,
    actor_id: UUID,
    text: str,
) -> MessageTable:
    return await _append_committed_message(
        session,
        chat_id=chat_id,
        chat_run_id=chat_run_id,
        actor_id=actor_id,
        text=text,
        sender="assistant",
        sender_name="Assistant",
        is_output=True,
    )


async def _append_committed_message(
    session: AsyncSession,
    *,
    chat_id: UUID,
    chat_run_id: UUID,
    actor_id: UUID,
    text: str,
    sender: str,
    sender_name: str,
    is_output: bool,
    max_attempts: int = _DEFAULT_MAX_ATTEMPTS,
    before_flush: Callable[[MessageTable], Awaitable[None] | None] | None = None,
) -> MessageTable:
    _validate_text(text)
    if not 1 <= max_attempts <= _DEFAULT_MAX_ATTEMPTS:
        raise ValueError(_ATTEMPTS_ERROR)

    await require_owned_chat(session, chat_id=chat_id, actor_id=actor_id)
    run = (
        await session.exec(select(ChatRun).where(ChatRun.id == chat_run_id, ChatRun.chat_id == chat_id))
    ).one_or_none()
    if run is None:
        raise ValueError(_RUN_OWNERSHIP_ERROR)

    for attempt in range(max_attempts):
        try:
            async with session.begin_nested():
                next_sequence = await _next_sequence(session, chat_id)
                message = MessageTable(
                    sender=sender,
                    sender_name=sender_name,
                    session_id=str(chat_id),
                    text=text,
                    files=[],
                    error=False,
                    edit=False,
                    properties={},
                    category="message",
                    content_blocks=[],
                    session_metadata=None,
                    chat_id=chat_id,
                    chat_run_id=chat_run_id,
                    chat_sequence=next_sequence,
                    is_output=is_output,
                )
                session.add(message)
                if before_flush is not None:
                    hook_result = before_flush(message)
                    if inspect.isawaitable(hook_result):
                        await hook_result
                await session.flush()
        except IntegrityError as error:
            if not _is_sequence_conflict(error):
                raise
            if attempt + 1 == max_attempts:
                raise ChatMessageAllocationError from error
        except OperationalError as error:
            if "database is locked" not in str(error).lower():
                raise
            await session.rollback()
            if attempt + 1 == max_attempts:
                raise ChatMessageAllocationError from error
            await asyncio.sleep(0)
        else:
            await session.commit()
            await session.refresh(message)
            return message

    raise ChatMessageAllocationError


async def _next_sequence(session: AsyncSession, chat_id: UUID) -> int:
    statement = select(func.coalesce(func.max(MessageTable.chat_sequence), 0)).where(MessageTable.chat_id == chat_id)
    return int((await session.exec(statement)).one()) + 1


def _validate_text(text: str) -> None:
    if not isinstance(text, str) or not text.strip():
        raise ValueError(_BLANK_TEXT_ERROR)
    if len(text) > _MAX_MESSAGE_LENGTH:
        raise ValueError(_TEXT_LENGTH_ERROR)


def _is_sequence_conflict(error: IntegrityError) -> bool:
    original = getattr(error, "orig", None)
    constraint_name = getattr(getattr(original, "diag", None), "constraint_name", None)
    if constraint_name == "uq_message_chat_sequence":
        return True
    return "message.chat_id, message.chat_sequence" in str(original).lower()


def messages_snapshot(messages: Sequence[MessageTable]) -> dict[str, object]:
    return {
        "type": "MESSAGES_SNAPSHOT",
        "messages": [
            {
                "id": str(message.id),
                "role": "assistant" if message.is_output else "user",
                "content": message.text,
            }
            for message in messages
        ],
    }
