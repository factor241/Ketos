"""Owner-scoped committed transcript snapshots for AG-UI reconnect."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import func
from sqlmodel import select

from ketos.services.chat_threads.message_adapter import load_committed_messages, messages_snapshot
from ketos.services.database.models.chat_thread.model import ChatThread
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.message.model import MessageTable

if TYPE_CHECKING:
    from sqlmodel.ext.asyncio.session import AsyncSession


@dataclass(frozen=True, slots=True)
class MessagesSnapshot:
    type: str
    messages: tuple[dict[str, str], ...]
    cursor: int

    def model_dump(self) -> dict[str, Any]:
        return {"type": self.type, "messages": list(self.messages), "cursor": self.cursor}


async def _authoritative_cursor(session: AsyncSession, *, owner_id: UUID, chat_id: UUID) -> int:
    result = await session.exec(
        select(func.coalesce(func.max(MessageTable.chat_sequence), 0))
        .join(ChatThread, MessageTable.chat_id == ChatThread.id)
        .join(Folder, ChatThread.project_id == Folder.id)
        .where(
            MessageTable.chat_id == chat_id,
            MessageTable.chat_run_id.is_not(None),
            MessageTable.chat_sequence.is_not(None),
            MessageTable.chat_sequence > 0,
            Folder.user_id == owner_id,
        )
    )
    return int(result.one())


async def build_messages_snapshot(
    *,
    session: AsyncSession,
    owner_id: UUID,
    chat_id: UUID,
    after_sequence: int = 0,
) -> MessagesSnapshot:
    """Build one read-only snapshot from committed rows and the server cursor."""
    if isinstance(after_sequence, bool) or not isinstance(after_sequence, int) or after_sequence < 0:
        raise ValueError("after_sequence must be a non-negative integer")

    # Read the maximum first. A concurrent later append is deliberately left
    # for the next cursor request instead of being returned beyond this cursor.
    cursor = await _authoritative_cursor(session, owner_id=owner_id, chat_id=chat_id)
    rows = await load_committed_messages(
        session,
        chat_id=chat_id,
        actor_id=owner_id,
        after_sequence=after_sequence,
        limit=200,
    )
    rows = [row for row in rows if row.chat_sequence is not None and row.chat_sequence <= cursor]
    delivered_cursor = int(rows[-1].chat_sequence) if rows else cursor
    payload = messages_snapshot(rows)
    return MessagesSnapshot(
        type="MESSAGES_SNAPSHOT",
        messages=tuple(payload["messages"]),
        cursor=delivered_cursor,
    )


__all__ = ["MessagesSnapshot", "build_messages_snapshot"]
