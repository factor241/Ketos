import hashlib
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TypeVar
from uuid import UUID, uuid4

from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlmodel import SQLModel, select
from sqlmodel.ext.asyncio.session import AsyncSession

from ketos.api.v1.schemas.board_commands import (
    BoardAutomationCreate,
    BoardBootstrapCreate,
    CleanStarter,
)
from ketos.api.v1.schemas.board_entities import PlacementGeometryCreate
from ketos.services.board.automation_starter_service import (
    PreparedAutomationStarter,
    create_started_automation_uncommitted,
    prepare_automation_starter,
)
from ketos.services.board.placement_service import (
    create_placement_uncommitted,
    require_owned_board,
)
from ketos.services.board.service import (
    create_board_uncommitted,
    require_owned_project,
)
from ketos.services.database.models.board.model import Board
from ketos.services.database.models.board_command_receipt.model import BoardCommandReceipt
from ketos.services.database.models.flow.model import Flow
from ketos.services.database.models.placement.model import Placement, PlacementTargetKind

BOARD_BOOTSTRAP_OPERATION = "board_bootstrap"
BOARD_AUTOMATION_OPERATION = "board_automation"
FaultInjector = Callable[[str], Awaitable[None]]
T = TypeVar("T")


class BoardCommandError(Exception):
    code = "board_command_error"


class IdempotencyKeyReusedError(BoardCommandError):
    code = "idempotency_key_reused"


class BoardCommandInvariantError(BoardCommandError):
    code = "board_command_receipt_invariant"


class BoardCommandTransactionError(BoardCommandInvariantError):
    """Raised when a command is called with a caller-owned transaction."""


@dataclass(frozen=True, slots=True)
class BoardBootstrapResult:
    board: Board
    automation: Flow | None
    placement: Placement | None
    idempotency_replayed: bool


@dataclass(frozen=True, slots=True)
class BoardAutomationResult:
    automation: Flow
    placement: Placement
    idempotency_replayed: bool


async def _no_fault(_point: str) -> None:
    return None


def _canonical_request_hash(*, operation: str, scope_id: UUID, payload: SQLModel) -> str:
    canonical = {
        "schema": "ketos-board-command/v1",
        "operation": operation,
        "scope_id": str(scope_id),
        "request": payload.model_dump(mode="json"),
    }
    encoded = json.dumps(canonical, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
    return hashlib.sha256(encoded).hexdigest()


async def _reserve_receipt(
    session: AsyncSession,
    *,
    principal_id: UUID,
    operation: str,
    idempotency_key: UUID,
    request_hash: str,
    board_id: UUID,
    automation_id: UUID | None,
    placement_id: UUID | None,
) -> tuple[BoardCommandReceipt, bool]:
    values = {
        "id": uuid4(),
        "principal_id": principal_id,
        "operation": operation,
        "idempotency_key": idempotency_key,
        "request_hash": request_hash,
        "board_id": board_id,
        "automation_id": automation_id,
        "placement_id": placement_id,
    }
    dialect = session.get_bind().dialect.name
    if dialect == "postgresql":
        statement = postgresql_insert(BoardCommandReceipt).values(**values)
    elif dialect == "sqlite":
        statement = sqlite_insert(BoardCommandReceipt).values(**values)
    else:
        message = f"Board commands do not support database dialect {dialect}"
        raise RuntimeError(message)
    statement = statement.on_conflict_do_nothing(
        index_elements=["principal_id", "operation", "idempotency_key"]
    ).returning(BoardCommandReceipt.id)
    result = await session.execute(statement)
    inserted_id = result.scalar_one_or_none()
    if inserted_id is not None:
        receipt = await session.get(BoardCommandReceipt, inserted_id)
        if receipt is None:
            raise BoardCommandInvariantError
        return receipt, True

    receipt = (
        await session.exec(
            select(BoardCommandReceipt)
            .where(
                BoardCommandReceipt.principal_id == principal_id,
                BoardCommandReceipt.operation == operation,
                BoardCommandReceipt.idempotency_key == idempotency_key,
            )
            .execution_options(populate_existing=True)
        )
    ).one_or_none()
    if receipt is None:
        raise BoardCommandInvariantError
    if receipt.request_hash != request_hash:
        raise IdempotencyKeyReusedError
    return receipt, False


async def _find_receipt(
    session: AsyncSession,
    *,
    principal_id: UUID,
    operation: str,
    idempotency_key: UUID,
    request_hash: str,
) -> BoardCommandReceipt | None:
    """Return a durable replay before revalidating mutable command inputs.

    This is only a replay fast path. Correct concurrent first-write arbitration
    remains owned by ``_reserve_receipt`` and its unique constraint.
    """
    receipt = (
        await session.exec(
            select(BoardCommandReceipt).where(
                BoardCommandReceipt.principal_id == principal_id,
                BoardCommandReceipt.operation == operation,
                BoardCommandReceipt.idempotency_key == idempotency_key,
            )
        )
    ).one_or_none()
    if receipt is None:
        return None
    if receipt.request_hash != request_hash:
        raise IdempotencyKeyReusedError
    return receipt


async def _load_bootstrap_result(
    session: AsyncSession,
    receipt: BoardCommandReceipt,
    *,
    replayed: bool,
) -> BoardBootstrapResult:
    board = await session.get(Board, receipt.board_id)
    automation = await session.get(Flow, receipt.automation_id) if receipt.automation_id is not None else None
    placement = await session.get(Placement, receipt.placement_id) if receipt.placement_id is not None else None
    if board is None or (receipt.automation_id is not None and automation is None) or (
        receipt.placement_id is not None and placement is None
    ):
        raise BoardCommandInvariantError
    return BoardBootstrapResult(
        board=board,
        automation=automation,
        placement=placement,
        idempotency_replayed=replayed,
    )


async def _load_automation_result(
    session: AsyncSession,
    receipt: BoardCommandReceipt,
    *,
    replayed: bool,
) -> BoardAutomationResult:
    if receipt.automation_id is None or receipt.placement_id is None:
        raise BoardCommandInvariantError
    automation = await session.get(Flow, receipt.automation_id)
    placement = await session.get(Placement, receipt.placement_id)
    if automation is None or placement is None:
        raise BoardCommandInvariantError
    return BoardAutomationResult(
        automation=automation,
        placement=placement,
        idempotency_replayed=replayed,
    )


async def _commit_command(
    session: AsyncSession,
    operation: Callable[[], Awaitable[T]],
    *,
    fault: FaultInjector,
) -> T:
    if session.in_transaction():
        message = "Board commands require a transaction-free session and own their commit"
        raise BoardCommandTransactionError(message)
    try:
        async with session.begin():
            result = await operation()
            await fault("before_commit")
    except Exception:
        if session.in_transaction():
            await session.rollback()
        raise
    await fault("after_commit_before_response")
    return result


async def bootstrap_board(
    session: AsyncSession,
    *,
    project_id: UUID,
    actor_id: UUID,
    idempotency_key: UUID,
    payload: BoardBootstrapCreate,
    fault: FaultInjector | None = None,
) -> BoardBootstrapResult:
    inject = fault or _no_fault
    request_hash = _canonical_request_hash(
        operation=BOARD_BOOTSTRAP_OPERATION,
        scope_id=project_id,
        payload=payload,
    )

    async def execute() -> BoardBootstrapResult:
        replay = await _find_receipt(
            session,
            principal_id=actor_id,
            operation=BOARD_BOOTSTRAP_OPERATION,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
        )
        if replay is not None:
            return await _load_bootstrap_result(session, replay, replayed=True)

        await require_owned_project(session, project_id=project_id, actor_id=actor_id)
        prepared: PreparedAutomationStarter | None = None
        if not isinstance(payload.starter, CleanStarter):
            prepared = await prepare_automation_starter(
                session,
                starter=payload.starter,
                actor_id=actor_id,
            )

        board_id = uuid4()
        automation_id = uuid4() if prepared is not None else None
        placement_id = uuid4() if prepared is not None else None
        receipt, inserted = await _reserve_receipt(
            session,
            principal_id=actor_id,
            operation=BOARD_BOOTSTRAP_OPERATION,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            board_id=board_id,
            automation_id=automation_id,
            placement_id=placement_id,
        )
        await inject("after_receipt_update")
        if not inserted:
            return await _load_bootstrap_result(session, receipt, replayed=True)

        board = await create_board_uncommitted(
            session,
            project_id=project_id,
            actor_id=actor_id,
            title=payload.title,
            board_id=board_id,
            project_validated=True,
        )
        await inject("after_board_flush")
        automation: Flow | None = None
        placement: Placement | None = None
        if prepared is not None and automation_id is not None and placement_id is not None:
            automation = await create_started_automation_uncommitted(
                session,
                prepared=prepared,
                actor_id=actor_id,
                project_id=project_id,
                flow_id=automation_id,
            )
            await inject("after_starter_clone")
            await inject("after_flow_flush")
            placement = await create_placement_uncommitted(
                session,
                board_id=board.id,
                actor_id=actor_id,
                target_kind=PlacementTargetKind.AUTOMATION,
                target_id=automation.id,
                geometry=PlacementGeometryCreate(x=0, y=0, width=360, height=240),
                placement_id=placement_id,
                board=board,
                target_validated=True,
            )
            await inject("after_placement_creation")
        return BoardBootstrapResult(
            board=board,
            automation=automation,
            placement=placement,
            idempotency_replayed=False,
        )

    return await _commit_command(session, execute, fault=inject)


async def create_board_automation(
    session: AsyncSession,
    *,
    board_id: UUID,
    actor_id: UUID,
    idempotency_key: UUID,
    payload: BoardAutomationCreate,
    fault: FaultInjector | None = None,
) -> BoardAutomationResult:
    inject = fault or _no_fault
    request_hash = _canonical_request_hash(
        operation=BOARD_AUTOMATION_OPERATION,
        scope_id=board_id,
        payload=payload,
    )

    async def execute() -> BoardAutomationResult:
        replay = await _find_receipt(
            session,
            principal_id=actor_id,
            operation=BOARD_AUTOMATION_OPERATION,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
        )
        if replay is not None:
            return await _load_automation_result(session, replay, replayed=True)

        board = await require_owned_board(session, board_id=board_id, actor_id=actor_id)
        prepared = await prepare_automation_starter(
            session,
            starter=payload.starter,
            actor_id=actor_id,
        )
        automation_id = uuid4()
        placement_id = uuid4()
        receipt, inserted = await _reserve_receipt(
            session,
            principal_id=actor_id,
            operation=BOARD_AUTOMATION_OPERATION,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            board_id=board.id,
            automation_id=automation_id,
            placement_id=placement_id,
        )
        await inject("after_receipt_update")
        if not inserted:
            return await _load_automation_result(session, receipt, replayed=True)

        automation = await create_started_automation_uncommitted(
            session,
            prepared=prepared,
            actor_id=actor_id,
            project_id=board.project_id,
            flow_id=automation_id,
        )
        await inject("after_starter_clone")
        await inject("after_flow_flush")
        placement = await create_placement_uncommitted(
            session,
            board_id=board.id,
            actor_id=actor_id,
            target_kind=PlacementTargetKind.AUTOMATION,
            target_id=automation.id,
            geometry=payload.placement,
            placement_id=placement_id,
            board=board,
            target_validated=True,
        )
        await inject("after_placement_creation")
        return BoardAutomationResult(
            automation=automation,
            placement=placement,
            idempotency_replayed=False,
        )

    return await _commit_command(session, execute, fault=inject)
