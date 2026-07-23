from __future__ import annotations

import json
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlmodel import Session, SQLModel, create_engine, select
from sqlmodel.ext.asyncio.session import AsyncSession

import ketos.services.database.models  # noqa: F401
from ketos.services.board.service import (
    BoardNotFoundError,
    BoardRevisionConflictError,
    create_board,
    get_owned_board,
    require_owned_project,
    update_board_viewport,
)
from ketos.services.database.models.board.model import Board
from ketos.services.database.models.flow.model import Flow
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.user.model import User

_SEED_SCRIPT = Path(__file__).resolve().parents[4] / "scripts" / "mvp" / "seed_vertical_slice.py"
_SEED_SPEC = spec_from_file_location("ketos_stage10_seed_vertical_slice", _SEED_SCRIPT)
assert _SEED_SPEC is not None and _SEED_SPEC.loader is not None
_SEED_MODULE = module_from_spec(_SEED_SPEC)
_SEED_SPEC.loader.exec_module(_SEED_MODULE)
seed_main = _SEED_MODULE.main


SECRET_KEY_FRAGMENTS = {
    "api_key",
    "credential",
    "database_url",
    "password",
    "path",
    "secret",
}


def _assert_manifest_has_no_secret_bearing_keys(value: Any) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).casefold()
            assert not any(
                fragment in normalized for fragment in SECRET_KEY_FRAGMENTS
            ), f"secret-bearing manifest key: {key}"
            _assert_manifest_has_no_secret_bearing_keys(child)
    elif isinstance(value, list):
        for child in value:
            _assert_manifest_has_no_secret_bearing_keys(child)


def test_seed_idempotency_and_canonical_saver_path(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_path = (tmp_path / "acceptance.sqlite3").resolve()
    database_url = f"sqlite:///{database_path}"
    engine = create_engine(database_url)
    SQLModel.metadata.create_all(engine)

    data_dir = tmp_path / "ketos-data"
    monkeypatch.setenv("KETOS_DATA_DIR", str(data_dir))
    manifest_path = tmp_path / "seed-manifest.json"
    argv = [
        "--database-url",
        database_url,
        "--seed-key",
        "stage10-acceptance",
        "--output-seed-manifest",
        str(manifest_path),
        "--assert-canonical-saver-path",
    ]

    try:
        assert seed_main(argv) == 0
        first_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        assert seed_main(argv) == 0
        second_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        assert first_manifest["ids"] == second_manifest["ids"]
        assert first_manifest["row_counts"] == second_manifest["row_counts"]
        assert first_manifest["seed_key_sha256"] == second_manifest[
            "seed_key_sha256"
        ]
        assert first_manifest["operation"] == {"created": 4, "reused": 0}
        assert second_manifest["operation"] == {"created": 0, "reused": 4}
        assert second_manifest["row_counts"]["total"] == 4
        _assert_manifest_has_no_secret_bearing_keys(first_manifest)
        _assert_manifest_has_no_secret_bearing_keys(second_manifest)

        ids = second_manifest["ids"]
        with Session(engine) as session:
            users = session.exec(
                select(User).where(User.id == UUID(ids["user"])),
            ).all()
            projects = session.exec(
                select(Folder).where(Folder.id == UUID(ids["project"])),
            ).all()
            boards = session.exec(
                select(Board).where(Board.id == UUID(ids["board"])),
            ).all()
            flows = session.exec(
                select(Flow).where(Flow.id == UUID(ids["flow"])),
            ).all()

        assert len(users) == 1
        assert len(projects) == 1
        assert len(boards) == 1
        assert len(flows) == 1
        assert users[0].is_active is False
        assert users[0].is_superuser is False
        assert flows[0].data == {"nodes": [], "edges": []}
    finally:
        engine.dispose()


def test_seed_idempotency_rejects_relative_sqlite_url(tmp_path: Path) -> None:
    with pytest.raises(SystemExit, match="2"):
        seed_main(
            [
                "--database-url",
                "sqlite:///relative.sqlite3",
                "--seed-key",
                "stage10-invalid",
                "--output-seed-manifest",
                str(tmp_path / "must-not-exist.json"),
            ],
        )

    assert not (tmp_path / "must-not-exist.json").exists()


@pytest.mark.asyncio
async def test_project_board_ownership_revision_cas_and_persistence(
    async_session: AsyncSession,
) -> None:
    owner_uuid = uuid4()
    foreign_uuid = uuid4()
    project_uuid = uuid4()
    null_project_uuid = uuid4()
    null_board_uuid = uuid4()

    owner = User(
        id=owner_uuid,
        username=f"s10-owner-{owner_uuid}",
        password="!disabled-stage10!",
        is_active=True,
    )
    foreign = User(
        id=foreign_uuid,
        username=f"s10-foreign-{foreign_uuid}",
        password="!disabled-stage10!",
        is_active=True,
    )
    async_session.add_all([owner, foreign])
    await async_session.flush()

    project = Folder(
        id=project_uuid,
        name="Stage 10 Project",
        user_id=owner.id,
    )
    null_project = Folder(
        id=null_project_uuid,
        name="Stage 10 Null Owner Project",
        user_id=None,
    )
    async_session.add_all([project, null_project])
    await async_session.flush()

    null_board = Board(
        id=null_board_uuid,
        project_id=null_project.id,
        created_by_id=owner.id,
        title="Null owner",
    )
    async_session.add(null_board)
    await async_session.commit()

    owned_project = await require_owned_project(
        async_session,
        project_id=project_uuid,
        actor_id=owner_uuid,
    )
    assert owned_project.id == project_uuid
    assert owned_project.user_id == owner_uuid

    created = await create_board(
        async_session,
        project_id=project_uuid,
        actor_id=owner_uuid,
        title="Stage 10 Project Board",
    )
    board_uuid = created.id

    assert created.project_id == project_uuid
    assert created.created_by_id == owner_uuid
    assert created.revision == 0

    updated = await update_board_viewport(
        async_session,
        board_id=board_uuid,
        actor_id=owner_uuid,
        viewport=SimpleNamespace(
            x=125.5,
            y=-42.0,
            zoom=1.25,
            expected_revision=0,
        ),
    )

    assert updated.id == board_uuid
    assert updated.project_id == project_uuid
    assert updated.viewport_x == 125.5
    assert updated.viewport_y == -42.0
    assert updated.viewport_zoom == 1.25
    assert updated.revision == 1

    with pytest.raises(BoardRevisionConflictError):
        await update_board_viewport(
            async_session,
            board_id=board_uuid,
            actor_id=owner_uuid,
            viewport=SimpleNamespace(
                x=999.0,
                y=888.0,
                zoom=0.5,
                expected_revision=0,
            ),
        )

    with pytest.raises(BoardNotFoundError):
        await get_owned_board(
            async_session,
            board_id=board_uuid,
            actor_id=foreign_uuid,
        )

    with pytest.raises(BoardNotFoundError):
        await get_owned_board(
            async_session,
            board_id=null_board_uuid,
            actor_id=owner_uuid,
        )

    async with AsyncSession(
        async_session.bind,
        expire_on_commit=False,
    ) as reopened:
        persisted = await get_owned_board(
            reopened,
            board_id=board_uuid,
            actor_id=owner_uuid,
        )

        assert persisted.id == board_uuid
        assert persisted.project_id == project_uuid
        assert persisted.created_by_id == owner_uuid
        assert persisted.viewport_x == 125.5
        assert persisted.viewport_y == -42.0
        assert persisted.viewport_zoom == 1.25
        assert persisted.revision == 1
