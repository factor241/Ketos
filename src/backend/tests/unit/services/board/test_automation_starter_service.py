from uuid import UUID, uuid4

import pytest
from ketos.api.v1.schemas.board_commands import (
    BoardAutomationCreate,
    BoardBootstrapCreate,
)
from ketos.initial_setup.constants import STARTER_FOLDER_NAME
from ketos.services.board.command_service import bootstrap_board, create_board_automation
from ketos.services.board.exceptions import BoardResourceNotFoundError
from ketos.services.board.service import create_board
from ketos.services.database.models.flow.model import Flow
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.placement.model import Placement, PlacementTargetKind
from ketos.services.database.models.user.model import User
from ketos.services.deps import session_scope
from sqlmodel import select

pytestmark = pytest.mark.usefixtures("client")


async def _project(owner_id: UUID | None, name: str = "Starter project") -> Folder:
    async with session_scope() as session:
        project = Folder(name=f"{name} {uuid4()}", user_id=owner_id)
        session.add(project)
        await session.commit()
        await session.refresh(project)
        return project


async def _foreign_user() -> User:
    async with session_scope() as session:
        user = User(username=f"foreign-starter-{uuid4()}", password="x", is_active=True)  # noqa: S106
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user


@pytest.mark.parametrize(
    ("kind", "expected_nodes"),
    [("simple_agent", 7), ("vector_store_rag", 8)],
)
async def test_named_starter_clones_canonical_data(active_user, kind: str, expected_nodes: int) -> None:
    project = await _project(active_user.id)
    payload = BoardBootstrapCreate.model_validate(
        {"title": "Named starter", "starter": {"kind": kind, "name": f"My {kind}"}}
    )
    async with session_scope() as session:
        result = await bootstrap_board(
            session,
            project_id=project.id,
            actor_id=active_user.id,
            idempotency_key=uuid4(),
            payload=payload,
        )

    assert result.automation is not None
    assert result.automation.name == f"My {kind}"
    assert len(result.automation.data["nodes"]) == expected_nodes
    assert result.placement is not None
    assert result.placement.target_kind is PlacementTargetKind.AUTOMATION
    assert result.placement.target_id == result.automation.id


async def test_authorized_template_is_cloned_without_mutating_source(active_user) -> None:
    source_project = await _project(active_user.id, "Source")
    target_project = await _project(active_user.id, "Target")
    source_data = {"nodes": [{"id": "source"}], "edges": []}
    async with session_scope() as session:
        template = Flow(
            name=f"Template {uuid4()}",
            user_id=active_user.id,
            folder_id=source_project.id,
            data=source_data,
            is_component=False,
        )
        session.add(template)
        await session.commit()
        await session.refresh(template)
        template_id = template.id

    payload = BoardBootstrapCreate.model_validate(
        {
            "title": "Template board",
            "starter": {"kind": "template", "template_id": template_id, "name": "Cloned automation"},
        }
    )
    async with session_scope() as session:
        result = await bootstrap_board(
            session,
            project_id=target_project.id,
            actor_id=active_user.id,
            idempotency_key=uuid4(),
            payload=payload,
        )

    assert result.automation is not None
    assert result.automation.id != template_id
    assert result.automation.folder_id == target_project.id
    assert result.automation.data == source_data
    async with session_scope() as session:
        persisted_source = await session.get(Flow, template_id)
        assert persisted_source is not None
        assert persisted_source.folder_id == source_project.id
        assert persisted_source.data == source_data


async def test_system_starter_template_is_authorized_for_board_wizard(active_user) -> None:
    target_project = await _project(active_user.id, "System target")
    async with session_scope() as session:
        starter_project = (await session.exec(select(Folder).where(Folder.name == STARTER_FOLDER_NAME))).first()
        if starter_project is None:
            starter_project = Folder(name=STARTER_FOLDER_NAME, user_id=None)
            session.add(starter_project)
            await session.flush()
        template = Flow(
            name=f"System template {uuid4()}",
            user_id=None,
            folder_id=starter_project.id,
            data={"nodes": [{"id": "system-source"}], "edges": []},
            is_component=False,
        )
        session.add(template)
        await session.commit()
        await session.refresh(template)
        template_id = template.id

    payload = BoardBootstrapCreate.model_validate(
        {
            "title": "System template board",
            "starter": {
                "kind": "template",
                "template_id": template_id,
                "name": "System clone",
            },
        }
    )
    async with session_scope() as session:
        result = await bootstrap_board(
            session,
            project_id=target_project.id,
            actor_id=active_user.id,
            idempotency_key=uuid4(),
            payload=payload,
        )

    assert result.automation is not None
    assert result.automation.folder_id == target_project.id
    assert result.automation.data == {"nodes": [{"id": "system-source"}], "edges": []}


async def test_unowned_template_outside_system_starter_folder_is_hidden(active_user) -> None:
    source_project = await _project(None, "Unowned non-system")
    target_project = await _project(active_user.id, "Unowned target")
    async with session_scope() as session:
        template = Flow(
            name=f"Unowned template {uuid4()}",
            user_id=None,
            folder_id=source_project.id,
            data={"nodes": [], "edges": []},
            is_component=False,
        )
        session.add(template)
        await session.commit()
        await session.refresh(template)
        template_id = template.id

    payload = BoardBootstrapCreate.model_validate(
        {
            "title": "Hidden system-looking template",
            "starter": {
                "kind": "template",
                "template_id": template_id,
                "name": "Hidden",
            },
        }
    )
    with pytest.raises(BoardResourceNotFoundError):
        async with session_scope() as session:
            await bootstrap_board(
                session,
                project_id=target_project.id,
                actor_id=active_user.id,
                idempotency_key=uuid4(),
                payload=payload,
            )


async def test_template_replay_does_not_revalidate_deleted_source(active_user) -> None:
    source_project = await _project(active_user.id, "Replay source")
    target_project = await _project(active_user.id, "Replay target")
    async with session_scope() as session:
        template = Flow(
            name=f"Replay template {uuid4()}",
            user_id=active_user.id,
            folder_id=source_project.id,
            data={"nodes": [{"id": "durable-source"}], "edges": []},
            is_component=False,
        )
        session.add(template)
        await session.commit()
        await session.refresh(template)
        template_id = template.id

    key = uuid4()
    payload = BoardBootstrapCreate.model_validate(
        {
            "title": "Durable replay",
            "starter": {
                "kind": "template",
                "template_id": template_id,
                "name": "Durable clone",
            },
        }
    )
    async with session_scope() as session:
        first = await bootstrap_board(
            session,
            project_id=target_project.id,
            actor_id=active_user.id,
            idempotency_key=key,
            payload=payload,
        )
    async with session_scope() as session:
        source = await session.get(Flow, template_id)
        assert source is not None
        await session.delete(source)
        await session.commit()
    async with session_scope() as session:
        replay = await bootstrap_board(
            session,
            project_id=target_project.id,
            actor_id=active_user.id,
            idempotency_key=key,
            payload=payload,
        )

    assert replay.idempotency_replayed is True
    assert (replay.board.id, replay.automation.id, replay.placement.id) == (
        first.board.id,
        first.automation.id,
        first.placement.id,
    )


async def test_foreign_template_is_hidden(active_user) -> None:
    foreign = await _foreign_user()
    source_project = await _project(foreign.id, "Foreign")
    target_project = await _project(active_user.id, "Target")
    async with session_scope() as session:
        template = Flow(
            name=f"Foreign template {uuid4()}",
            user_id=foreign.id,
            folder_id=source_project.id,
            data={"nodes": [], "edges": []},
            is_component=False,
        )
        session.add(template)
        await session.commit()
        await session.refresh(template)
        template_id = template.id
    payload = BoardBootstrapCreate.model_validate(
        {
            "title": "Forbidden",
            "starter": {"kind": "template", "template_id": template_id, "name": "Hidden"},
        }
    )

    with pytest.raises(BoardResourceNotFoundError):
        async with session_scope() as session:
            await bootstrap_board(
                session,
                project_id=target_project.id,
                actor_id=active_user.id,
                idempotency_key=uuid4(),
                payload=payload,
            )


async def test_existing_board_command_derives_project_and_replays(active_user) -> None:
    project = await _project(active_user.id)
    async with session_scope() as session:
        board = await create_board(
            session,
            project_id=project.id,
            actor_id=active_user.id,
            title="Existing board",
        )
    key = uuid4()
    payload = BoardAutomationCreate.model_validate(
        {
            "starter": {"kind": "blank_automation", "name": "Inside board"},
            "placement": {"x": 42, "y": 84, "width": 360, "height": 240},
        }
    )
    async with session_scope() as session:
        first = await create_board_automation(
            session,
            board_id=board.id,
            actor_id=active_user.id,
            idempotency_key=key,
            payload=payload,
        )
    async with session_scope() as session:
        replay = await create_board_automation(
            session,
            board_id=board.id,
            actor_id=active_user.id,
            idempotency_key=key,
            payload=payload,
        )

    assert first.automation.folder_id == project.id
    assert (first.placement.x, first.placement.y) == (42, 84)
    assert replay.idempotency_replayed is True
    assert (replay.automation.id, replay.placement.id) == (first.automation.id, first.placement.id)
    async with session_scope() as session:
        assert len((await session.exec(select(Flow).where(Flow.folder_id == project.id))).all()) == 1
        assert len((await session.exec(select(Placement).where(Placement.board_id == board.id))).all()) == 1


@pytest.mark.parametrize(
    ("kind", "expected_nodes"),
    [("simple_agent", 7), ("vector_store_rag", 8)],
)
async def test_existing_board_command_supports_named_starters(
    active_user,
    kind: str,
    expected_nodes: int,
) -> None:
    project = await _project(active_user.id)
    async with session_scope() as session:
        board = await create_board(
            session,
            project_id=project.id,
            actor_id=active_user.id,
            title="Named starter board",
        )
    payload = BoardAutomationCreate.model_validate(
        {
            "starter": {"kind": kind, "name": f"Inside {kind}"},
            "placement": {"x": 15, "y": 25},
        }
    )

    async with session_scope() as session:
        result = await create_board_automation(
            session,
            board_id=board.id,
            actor_id=active_user.id,
            idempotency_key=uuid4(),
            payload=payload,
        )

    assert result.automation.folder_id == project.id
    assert len(result.automation.data["nodes"]) == expected_nodes
    assert result.placement.target_id == result.automation.id


async def test_existing_board_command_clones_authorized_template_into_board_project(active_user) -> None:
    source_project = await _project(active_user.id, "Source")
    target_project = await _project(active_user.id, "Target")
    source_data = {"nodes": [{"id": "source-node"}], "edges": []}
    async with session_scope() as session:
        template = Flow(
            name=f"Board template {uuid4()}",
            user_id=active_user.id,
            folder_id=source_project.id,
            data=source_data,
            is_component=False,
        )
        session.add(template)
        await session.commit()
        await session.refresh(template)
        template_id = template.id
        board = await create_board(
            session,
            project_id=target_project.id,
            actor_id=active_user.id,
            title="Template target",
        )
    payload = BoardAutomationCreate.model_validate(
        {
            "starter": {
                "kind": "template",
                "template_id": template_id,
                "name": "Cloned inside Board",
            },
            "placement": {"x": 5, "y": 10},
        }
    )

    async with session_scope() as session:
        result = await create_board_automation(
            session,
            board_id=board.id,
            actor_id=active_user.id,
            idempotency_key=uuid4(),
            payload=payload,
        )

    assert result.automation.id != template_id
    assert result.automation.folder_id == target_project.id
    assert result.automation.data == source_data
    async with session_scope() as session:
        persisted_template = await session.get(Flow, template_id)
        assert persisted_template is not None
        assert persisted_template.folder_id == source_project.id
        assert persisted_template.data == source_data
