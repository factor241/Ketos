from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Annotated, TypeVar
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from kfx.services.deps import injectable_session_scope_manual
from sqlmodel.ext.asyncio.session import AsyncSession

from ketos.api.utils import CurrentActiveUser, DbSession
from ketos.api.v1.schemas.board_entities import PlacementRead
from ketos.api.v1.schemas.chat_threads import (
    BoardChatCreate,
    BoardChatCreateResponse,
    ChatCreate,
    ChatMessageRead,
    ChatPatch,
    ChatRead,
)
from ketos.services.board.command_service import (
    BoardCommandInvariantError,
    IdempotencyKeyReusedError,
    create_board_chat,
)
from ketos.services.board.exceptions import BoardResourceNotFoundError
from ketos.services.chat_threads.message_adapter import load_committed_messages
from ketos.services.chat_threads.repository import (
    ChatNotFoundError,
    ChatRevisionConflictError,
)
from ketos.services.chat_threads.service import (
    create_chat,
    get_chat,
    list_chats,
    patch_chat,
)

router = APIRouter(tags=["Chat threads"])
T = TypeVar("T")
CommandDbSession = Annotated[
    AsyncSession,
    Depends(injectable_session_scope_manual),
]


async def _run_service(call: Callable[[], Awaitable[T]]) -> T:
    try:
        return await call()
    except ChatNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "chat_not_found"},
        ) from exc
    except ChatRevisionConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": exc.code},
        ) from exc
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": "chat_validation_error"},
        ) from exc


async def _run_board_chat_command(call: Callable[[], Awaitable[T]]) -> T:
    try:
        return await call()
    except BoardResourceNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "board_command_resource_not_found"},
        ) from exc
    except IdempotencyKeyReusedError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": exc.code},
        ) from exc
    except BoardCommandInvariantError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": exc.code},
        ) from exc
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": "chat_validation_error"},
        ) from exc


@router.post("/projects/{project_id}/chats", status_code=status.HTTP_201_CREATED)
async def create_project_chat(
    project_id: UUID,
    payload: ChatCreate,
    session: DbSession,
    current_user: CurrentActiveUser,
) -> ChatRead:
    chat = await _run_service(
        lambda: create_chat(
            session,
            project_id=project_id,
            actor_id=current_user.id,
            **payload.model_dump(),
        )
    )
    return ChatRead.model_validate(chat)


@router.post(
    "/boards/{board_id}/chats",
    status_code=status.HTTP_201_CREATED,
)
async def create_chat_in_board(
    board_id: UUID,
    payload: BoardChatCreate,
    session: CommandDbSession,
    current_user: CurrentActiveUser,
    idempotency_key: Annotated[UUID, Header(alias="Idempotency-Key")],
) -> BoardChatCreateResponse:
    result = await _run_board_chat_command(
        lambda: create_board_chat(
            session,
            board_id=board_id,
            actor_id=current_user.id,
            idempotency_key=idempotency_key,
            payload=payload,
        )
    )
    return BoardChatCreateResponse(
        chat=ChatRead.model_validate(result.chat, from_attributes=True),
        placement=PlacementRead.model_validate(
            result.placement,
            from_attributes=True,
        ),
        idempotency_replayed=result.idempotency_replayed,
    )


@router.get("/projects/{project_id}/chats")
async def read_project_chats(
    project_id: UUID,
    session: DbSession,
    current_user: CurrentActiveUser,
    q: str | None = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 50,
    include_archived: Annotated[bool, Query()] = False,  # noqa: FBT002 - FastAPI query contract
) -> list[ChatRead]:
    chats = await _run_service(
        lambda: list_chats(
            session,
            project_id=project_id,
            actor_id=current_user.id,
            query=q,
            limit=limit,
            include_archived=include_archived,
        )
    )
    return [ChatRead.model_validate(chat) for chat in chats]


@router.get("/chats/{chat_id}")
async def read_chat(chat_id: UUID, session: DbSession, current_user: CurrentActiveUser) -> ChatRead:
    return ChatRead.model_validate(
        await _run_service(lambda: get_chat(session, chat_id=chat_id, actor_id=current_user.id))
    )


@router.get("/chats/{chat_id}/messages")
async def read_chat_messages(
    chat_id: UUID,
    session: DbSession,
    current_user: CurrentActiveUser,
) -> list[ChatMessageRead]:
    messages = await _run_service(lambda: load_committed_messages(session, chat_id=chat_id, actor_id=current_user.id))
    return [
        ChatMessageRead(
            id=message.id,
            role="assistant" if message.is_output else "user",
            content=message.text,
            sequence=message.chat_sequence,
        )
        for message in messages
    ]


@router.patch("/chats/{chat_id}")
async def update_chat(
    chat_id: UUID,
    payload: ChatPatch,
    session: DbSession,
    current_user: CurrentActiveUser,
) -> ChatRead:
    values = payload.model_dump(exclude={"expected_revision"}, exclude_none=True)
    chat = await _run_service(
        lambda: patch_chat(
            session,
            chat_id=chat_id,
            actor_id=current_user.id,
            expected_revision=payload.expected_revision,
            values=values,
        )
    )
    return ChatRead.model_validate(chat)
