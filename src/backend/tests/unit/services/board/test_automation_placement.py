import asyncio
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from ketos.api.v1.schemas.board_commands import BoardAutomationCreate
from ketos.services.board.command_service import (
    IdempotencyKeyReusedError,
    create_board_automation,
)
from ketos.services.board.exceptions import BoardResourceNotFoundError
from ketos.services.board.placement_service import (
    create_placement,
    delete_placement_cas,
)
from ketos.services.board.service import (
    create_board,
    resolve_automation_return_context,
    validate_automation_target,
)
from ketos.services.database.models.flow.model import Flow
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.placement.model import (
    Placement,
    PlacementTargetKind,
)
from ketos.services.database.models.user.model import User
from ketos.services.deps import session_scope
from sqlalchemy import UniqueConstraint
from sqlmodel import select

pytestmark = pytest.mark.usefixtures("client")


def _geometry() -> SimpleNamespace:
    return SimpleNamespace(x=10, y=20, width=320, height=240, z_index=0)


def test_flow_remains_canonical_and_board_binding_remains_a_placement() -> None:
    assert "board_id" not in Flow.__table__.columns
    assert PlacementTargetKind.AUTOMATION.value == "automation"
    unique_columns = {
        tuple(column.name for column in constraint.columns)
        for constraint in Placement.__table__.constraints
        if isinstance(constraint, UniqueConstraint)
    }
    assert ("board_id", "target_kind", "target_id") in unique_columns


async def _user() -> User:
    async with session_scope() as session:
        user = User(username=f"automation-{uuid4()}", password="x", is_active=True)  # noqa: S106
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user


async def _project(owner_id: UUID | None) -> Folder:
    async with session_scope() as session:
        project = Folder(name=f"Automation {uuid4()}", user_id=owner_id)
        session.add(project)
        await session.commit()
        await session.refresh(project)
        return project


async def _board(project_id: UUID, actor_id: UUID):
    async with session_scope() as session:
        return await create_board(
            session,
            project_id=project_id,
            actor_id=actor_id,
            title="Automation board",
        )


async def _flow(*, owner_id: UUID | None, project_id: UUID, is_component: bool | None = False) -> Flow:
    async with session_scope() as session:
        flow = Flow(
            name=f"Automation {uuid4()}",
            user_id=owner_id,
            folder_id=project_id,
            is_component=is_component,
            data={"nodes": [], "edges": []},
        )
        session.add(flow)
        await session.commit()
        await session.refresh(flow)
        return flow


async def _place(board_id: UUID, actor_id: UUID, flow_id: UUID) -> Placement:
    async with session_scope() as session:
        return await create_placement(
            session,
            board_id=board_id,
            actor_id=actor_id,
            target_kind=PlacementTargetKind.AUTOMATION,
            target_id=flow_id,
            geometry=_geometry(),
        )


async def test_owned_ordinary_flow_is_reusable_for_create_and_return(active_user) -> None:
    project = await _project(active_user.id)
    board = await _board(project.id, active_user.id)
    flow = await _flow(owner_id=active_user.id, project_id=project.id)
    placement = await _place(board.id, active_user.id, flow.id)

    async with session_scope() as session:
        persisted_board = await session.get(type(board), board.id)
        assert persisted_board is not None
        assert (
            await validate_automation_target(
                session,
                board=persisted_board,
                flow_id=flow.id,
                actor_id=active_user.id,
            )
        ).id == flow.id
        context = await resolve_automation_return_context(
            session,
            board_id=board.id,
            placement_id=placement.id,
            flow_id=flow.id,
            actor_id=active_user.id,
        )
    assert (context.project_id, context.board_id, context.placement_id, context.flow_id) == (
        project.id,
        board.id,
        placement.id,
        flow.id,
    )


async def test_one_flow_keeps_distinct_return_context_for_each_board_placement(active_user) -> None:
    project = await _project(active_user.id)
    first_board = await _board(project.id, active_user.id)
    second_board = await _board(project.id, active_user.id)
    flow = await _flow(owner_id=active_user.id, project_id=project.id)
    first_placement = await _place(first_board.id, active_user.id, flow.id)
    second_placement = await _place(second_board.id, active_user.id, flow.id)

    async with session_scope() as session:
        first_context = await resolve_automation_return_context(
            session,
            board_id=first_board.id,
            placement_id=first_placement.id,
            flow_id=flow.id,
            actor_id=active_user.id,
        )
        second_context = await resolve_automation_return_context(
            session,
            board_id=second_board.id,
            placement_id=second_placement.id,
            flow_id=flow.id,
            actor_id=active_user.id,
        )

    assert first_context.flow_id == second_context.flow_id == flow.id
    assert (first_context.board_id, first_context.placement_id) == (
        first_board.id,
        first_placement.id,
    )
    assert (second_context.board_id, second_context.placement_id) == (
        second_board.id,
        second_placement.id,
    )


@pytest.mark.parametrize("variant", ["missing", "foreign", "null", "other_project", "component"])
async def test_automation_target_uniformly_hides_invalid_flows(active_user, variant: str) -> None:
    foreign = await _user()
    project = await _project(active_user.id)
    other_project = await _project(active_user.id)
    board = await _board(project.id, active_user.id)
    if variant == "missing":
        flow_id = uuid4()
    else:
        flow = await _flow(
            owner_id={"foreign": foreign.id, "null": None}.get(variant, active_user.id),
            project_id=other_project.id if variant == "other_project" else project.id,
            is_component=variant == "component",
        )
        flow_id = flow.id
    async with session_scope() as session:
        persisted_board = await session.get(type(board), board.id)
        assert persisted_board is not None
        with pytest.raises(BoardResourceNotFoundError):
            await validate_automation_target(
                session,
                board=persisted_board,
                flow_id=flow_id,
                actor_id=active_user.id,
            )


async def test_return_context_rejects_wrong_board_kind_and_flow(active_user) -> None:
    project = await _project(active_user.id)
    board = await _board(project.id, active_user.id)
    other_board = await _board(project.id, active_user.id)
    flow = await _flow(owner_id=active_user.id, project_id=project.id)
    other_flow = await _flow(owner_id=active_user.id, project_id=project.id)
    placement = await _place(board.id, active_user.id, flow.id)
    async with session_scope() as session:
        wrong_kind = Placement(
            board_id=board.id,
            target_kind=PlacementTargetKind.JOB_RESULT,
            target_id=flow.id,
            x=0,
            y=0,
        )
        session.add(wrong_kind)
        await session.commit()
        await session.refresh(wrong_kind)
    for candidate_board, candidate_placement, candidate_flow in (
        (other_board.id, placement.id, flow.id),
        (board.id, wrong_kind.id, flow.id),
        (board.id, placement.id, other_flow.id),
        (board.id, uuid4(), flow.id),
    ):
        async with session_scope() as session:
            with pytest.raises(BoardResourceNotFoundError):
                await resolve_automation_return_context(
                    session,
                    board_id=candidate_board,
                    placement_id=candidate_placement,
                    flow_id=candidate_flow,
                    actor_id=active_user.id,
                )


async def test_close_preserves_flow_and_replacement_uses_same_flow(active_user) -> None:
    project = await _project(active_user.id)
    board = await _board(project.id, active_user.id)
    flow = await _flow(owner_id=active_user.id, project_id=project.id)
    placement = await _place(board.id, active_user.id, flow.id)
    async with session_scope() as session:
        await delete_placement_cas(
            session,
            placement_id=placement.id,
            actor_id=active_user.id,
            expected_revision=0,
        )
    replacement = await _place(board.id, active_user.id, flow.id)
    async with session_scope() as session:
        assert await session.get(Flow, flow.id) is not None
        assert (await session.exec(select(Placement).where(Placement.id == placement.id))).first() is None
    assert replacement.id != placement.id
    assert replacement.target_id == flow.id


async def test_concurrent_same_key_creates_one_flow_and_one_placement(active_user) -> None:
    project = await _project(active_user.id)
    board = await _board(project.id, active_user.id)
    key = uuid4()
    payload = BoardAutomationCreate.model_validate(
        {
            "starter": {"kind": "blank_automation", "name": f"Concurrent {uuid4()}"},
            "placement": {"x": 0, "y": 0},
        }
    )

    async def submit():
        async with session_scope() as session:
            return await create_board_automation(
                session,
                board_id=board.id,
                actor_id=active_user.id,
                idempotency_key=key,
                payload=payload,
            )

    first, second = await asyncio.gather(submit(), submit())

    assert (first.automation.id, first.placement.id) == (second.automation.id, second.placement.id)
    assert {first.idempotency_replayed, second.idempotency_replayed} == {False, True}
    async with session_scope() as session:
        assert len((await session.exec(select(Flow).where(Flow.folder_id == project.id))).all()) == 1
        assert len((await session.exec(select(Placement).where(Placement.board_id == board.id))).all()) == 1


async def test_concurrent_same_key_different_payload_commits_one_result(active_user) -> None:
    project = await _project(active_user.id)
    board = await _board(project.id, active_user.id)
    key = uuid4()
    first_payload = BoardAutomationCreate.model_validate(
        {
            "starter": {"kind": "blank_automation", "name": "First"},
            "placement": {"x": 0, "y": 0},
        }
    )
    second_payload = BoardAutomationCreate.model_validate(
        {
            "starter": {"kind": "blank_automation", "name": "Second"},
            "placement": {"x": 10, "y": 20},
        }
    )

    async def submit(payload: BoardAutomationCreate):
        async with session_scope() as session:
            return await create_board_automation(
                session,
                board_id=board.id,
                actor_id=active_user.id,
                idempotency_key=key,
                payload=payload,
            )

    results = await asyncio.gather(
        submit(first_payload),
        submit(second_payload),
        return_exceptions=True,
    )

    assert sum(not isinstance(result, Exception) for result in results) == 1
    assert sum(isinstance(result, IdempotencyKeyReusedError) for result in results) == 1
    async with session_scope() as session:
        assert len((await session.exec(select(Flow).where(Flow.folder_id == project.id))).all()) == 1
        assert len((await session.exec(select(Placement).where(Placement.board_id == board.id))).all()) == 1
