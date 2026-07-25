from uuid import uuid4

import pytest
from ketos.api.v1.schemas.board_commands import BoardBootstrapCreate
from ketos.services.board.command_service import (
    BoardCommandTransactionError,
    IdempotencyKeyReusedError,
    bootstrap_board,
)
from ketos.services.database.models.board.model import Board
from ketos.services.database.models.board_command_receipt.model import BoardCommandReceipt
from ketos.services.database.models.flow.model import Flow
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.placement.model import Placement
from ketos.services.deps import session_scope
from sqlalchemy import UniqueConstraint
from sqlmodel import select

pytestmark = pytest.mark.usefixtures("client")


def test_receipt_uniqueness_is_scoped_by_principal_operation_and_key() -> None:
    constraints = {
        tuple(column.name for column in constraint.columns)
        for constraint in BoardCommandReceipt.__table__.constraints
        if isinstance(constraint, UniqueConstraint)
    }

    assert ("principal_id", "operation", "idempotency_key") in constraints


def test_receipt_keeps_canonical_hash_and_compound_result_ids() -> None:
    board_id = uuid4()
    flow_id = uuid4()
    placement_id = uuid4()
    receipt = BoardCommandReceipt(
        principal_id=uuid4(),
        operation="board_bootstrap",
        idempotency_key=uuid4(),
        request_hash="a" * 64,
        board_id=board_id,
        automation_id=flow_id,
        placement_id=placement_id,
    )

    assert receipt.request_hash == "a" * 64
    assert (receipt.board_id, receipt.automation_id, receipt.placement_id) == (
        board_id,
        flow_id,
        placement_id,
    )


async def _project(owner_id) -> Folder:
    async with session_scope() as session:
        project = Folder(name=f"Board command {uuid4()}", user_id=owner_id)
        session.add(project)
        await session.commit()
        await session.refresh(project)
        return project


def _bootstrap_payload(*, title: str = "Research", kind: str = "blank_automation") -> BoardBootstrapCreate:
    starter = {"kind": "clean"} if kind == "clean" else {"kind": kind, "name": f"{kind} starter"}
    return BoardBootstrapCreate.model_validate({"title": title, "starter": starter})


async def _run_bootstrap(*, project_id, actor_id, key, payload, fault=None):
    async with session_scope() as session:
        return await bootstrap_board(
            session,
            project_id=project_id,
            actor_id=actor_id,
            idempotency_key=key,
            payload=payload,
            fault=fault,
        )


async def test_clean_bootstrap_creates_only_board_and_receipt(active_user) -> None:
    project = await _project(active_user.id)
    result = await _run_bootstrap(
        project_id=project.id,
        actor_id=active_user.id,
        key=uuid4(),
        payload=_bootstrap_payload(kind="clean"),
    )

    assert result.automation is None
    assert result.placement is None
    assert result.idempotency_replayed is False
    async with session_scope() as session:
        assert len((await session.exec(select(Board).where(Board.project_id == project.id))).all()) == 1
        assert len((await session.exec(select(Flow).where(Flow.folder_id == project.id))).all()) == 0
        assert len((await session.exec(select(Placement).where(Placement.board_id == result.board.id))).all()) == 0


async def test_same_key_same_payload_replays_exact_compound_ids(active_user) -> None:
    project = await _project(active_user.id)
    key = uuid4()
    payload = _bootstrap_payload()

    first = await _run_bootstrap(project_id=project.id, actor_id=active_user.id, key=key, payload=payload)
    replay = await _run_bootstrap(project_id=project.id, actor_id=active_user.id, key=key, payload=payload)

    assert replay.idempotency_replayed is True
    assert (replay.board.id, replay.automation.id, replay.placement.id) == (
        first.board.id,
        first.automation.id,
        first.placement.id,
    )
    async with session_scope() as session:
        assert len((await session.exec(select(Board).where(Board.project_id == project.id))).all()) == 1
        assert len((await session.exec(select(Flow).where(Flow.folder_id == project.id))).all()) == 1
        receipts = (
            await session.exec(
                select(BoardCommandReceipt).where(
                    BoardCommandReceipt.principal_id == active_user.id,
                    BoardCommandReceipt.idempotency_key == key,
                )
            )
        ).all()
        assert len(receipts) == 1


async def test_same_key_different_payload_returns_conflict(active_user) -> None:
    project = await _project(active_user.id)
    key = uuid4()
    await _run_bootstrap(
        project_id=project.id,
        actor_id=active_user.id,
        key=key,
        payload=_bootstrap_payload(title="First"),
    )

    with pytest.raises(IdempotencyKeyReusedError):
        await _run_bootstrap(
            project_id=project.id,
            actor_id=active_user.id,
            key=key,
            payload=_bootstrap_payload(title="Different"),
        )


async def test_lost_response_after_commit_replays_the_committed_result(active_user) -> None:
    project = await _project(active_user.id)
    key = uuid4()
    payload = _bootstrap_payload()

    async def fail_after_commit(point: str) -> None:
        if point == "after_commit_before_response":
            message = "response lost"
            raise RuntimeError(message)

    with pytest.raises(RuntimeError, match="response lost"):
        await _run_bootstrap(
            project_id=project.id,
            actor_id=active_user.id,
            key=key,
            payload=payload,
            fault=fail_after_commit,
        )

    replay = await _run_bootstrap(
        project_id=project.id,
        actor_id=active_user.id,
        key=key,
        payload=payload,
    )

    assert replay.idempotency_replayed is True
    async with session_scope() as session:
        assert len((await session.exec(select(Board).where(Board.project_id == project.id))).all()) == 1
        assert len((await session.exec(select(Flow).where(Flow.folder_id == project.id))).all()) == 1
        receipts = (
            await session.exec(
                select(BoardCommandReceipt).where(
                    BoardCommandReceipt.principal_id == active_user.id,
                    BoardCommandReceipt.idempotency_key == key,
                )
            )
        ).all()
        assert len(receipts) == 1


async def test_command_refuses_to_commit_a_caller_owned_transaction(active_user) -> None:
    project = await _project(active_user.id)
    unrelated_id = uuid4()

    async with session_scope() as session, session.begin():
        session.add(
            Folder(
                id=unrelated_id,
                name=f"Caller-owned {unrelated_id}",
                user_id=active_user.id,
            )
        )
        await session.flush()
        with pytest.raises(BoardCommandTransactionError, match="transaction-free session"):
            await bootstrap_board(
                session,
                project_id=project.id,
                actor_id=active_user.id,
                idempotency_key=uuid4(),
                payload=_bootstrap_payload(),
            )
        await session.rollback()

    async with session_scope() as session:
        assert await session.get(Folder, unrelated_id) is None
        assert len((await session.exec(select(Board).where(Board.project_id == project.id))).all()) == 0


@pytest.mark.parametrize(
    "fault_point",
    [
        "after_receipt_update",
        "after_board_flush",
        "after_starter_clone",
        "after_flow_flush",
        "after_placement_creation",
        "before_commit",
    ],
)
async def test_fault_before_commit_rolls_back_every_compound_row(active_user, fault_point: str) -> None:
    project = await _project(active_user.id)
    key = uuid4()

    async def fail_at(point: str) -> None:
        if point == fault_point:
            message = f"injected:{point}"
            raise RuntimeError(message)

    with pytest.raises(RuntimeError, match=fault_point):
        await _run_bootstrap(
            project_id=project.id,
            actor_id=active_user.id,
            key=key,
            payload=_bootstrap_payload(),
            fault=fail_at,
        )

    async with session_scope() as session:
        assert len((await session.exec(select(Board).where(Board.project_id == project.id))).all()) == 0
        assert len((await session.exec(select(Flow).where(Flow.folder_id == project.id))).all()) == 0
        receipts = (
            await session.exec(
                select(BoardCommandReceipt).where(
                    BoardCommandReceipt.principal_id == active_user.id,
                    BoardCommandReceipt.idempotency_key == key,
                )
            )
        ).all()
        assert len(receipts) == 0
