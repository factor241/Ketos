from __future__ import annotations

import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from ketos.services.database.models import Board as RegisteredBoard
from ketos.services.database.models import BoardCommandReceipt, User
from ketos.services.database.models.board.model import Board
from ketos.services.database.service import SQLModel
from pydantic import ValidationError
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError

if TYPE_CHECKING:
    from collections.abc import Iterator

WORKSPACE = Path(__file__).resolve().parents[5]
ALEMBIC_ROOT = WORKSPACE / "src/backend/base/ketos/alembic"
REVISION = "b03dca5a0001"
MIGRATION_FILE = ALEMBIC_ROOT / "versions/b03dca5a0001_add_board_table.py"
COMMAND_REVISION = "ubw01cmdrec"
COMMAND_DOWN_REVISION = "s08c0mmand01"
_TEST_CREDENTIAL = "not-used"


def _migration():
    config = Config()
    config.set_main_option("script_location", str(ALEMBIC_ROOT))
    return ScriptDirectory.from_config(config).get_revision(REVISION).module


def _scalar_default(column: sa.Column[object]) -> object:
    assert column.default is not None
    assert not column.default.is_callable
    return column.default.arg


def _numeric_server_default(value: object) -> float:
    assert value is not None
    return float(str(value).strip().strip("()").strip("'\""))


def _normalized_sql(value: object) -> str:
    return " ".join(str(value).lower().replace('"', "").split())


def test_board_revision_metadata_is_an_additive_successor() -> None:
    assert MIGRATION_FILE.is_file()
    migration = _migration()
    assert migration.revision == REVISION
    assert migration.down_revision == "9a6e34f1c2d8"
    assert migration.branch_labels is None
    assert migration.depends_on is None


def test_board_is_registered_and_declares_the_exact_model_contract() -> None:
    assert RegisteredBoard is Board
    assert issubclass(Board, SQLModel)
    table = Board.__table__
    assert table.name == "board"
    assert set(table.columns.keys()) == {
        "id",
        "project_id",
        "created_by_id",
        "title",
        "viewport_x",
        "viewport_y",
        "viewport_zoom",
        "revision",
        "created_at",
        "updated_at",
    }
    assert isinstance(table.c.id.type, sa.Uuid)
    assert table.c.id.primary_key
    assert not table.c.id.nullable
    for name in ("project_id", "created_by_id"):
        column = table.c[name]
        assert isinstance(column.type, sa.Uuid)
        assert not column.nullable
    assert isinstance(table.c.title.type, sa.String)
    assert table.c.title.type.length == 255
    assert not table.c.title.nullable
    for name in ("viewport_x", "viewport_y", "viewport_zoom"):
        assert isinstance(table.c[name].type, sa.Double)
        assert not table.c[name].nullable
    assert isinstance(table.c.revision.type, sa.Integer)
    assert not table.c.revision.nullable
    assert _scalar_default(table.c.viewport_x) == 0
    assert _scalar_default(table.c.viewport_y) == 0
    assert _scalar_default(table.c.viewport_zoom) == 1
    assert _scalar_default(table.c.revision) == 0
    for name in ("created_at", "updated_at"):
        column = table.c[name]
        assert isinstance(column.type, sa.DateTime)
        assert column.type.timezone is True
        assert not column.nullable
        assert column.server_default is not None
    foreign_keys = {
        (foreign_key.parent.name, foreign_key.target_fullname): foreign_key.ondelete
        for foreign_key in table.foreign_keys
    }
    assert foreign_keys == {
        ("project_id", "folder.id"): "CASCADE",
        ("created_by_id", "user.id"): "CASCADE",
    }
    indexed_columns = {tuple(column.name for column in index.columns) for index in table.indexes}
    assert ("project_id",) in indexed_columns
    assert ("created_by_id",) in indexed_columns
    checks = {
        constraint.name: _normalized_sql(constraint.sqltext)
        for constraint in table.constraints
        if isinstance(constraint, sa.CheckConstraint)
    }
    assert set(checks) == {
        "ck_board_title_length",
        "ck_board_viewport_zoom_range",
        "ck_board_revision_nonnegative",
    }
    assert "title" in checks["ck_board_title_length"]
    assert "1" in checks["ck_board_title_length"]
    assert "255" in checks["ck_board_title_length"]
    assert "viewport_zoom" in checks["ck_board_viewport_zoom_range"]
    assert "0.5" in checks["ck_board_viewport_zoom_range"]
    assert "2" in checks["ck_board_viewport_zoom_range"]
    assert "revision" in checks["ck_board_revision_nonnegative"]
    assert "0" in checks["ck_board_revision_nonnegative"]


def test_board_title_is_trimmed_and_limited_to_1_through_255_characters() -> None:
    values = {"project_id": uuid4(), "created_by_id": uuid4(), "title": "  MVP board  "}
    assert Board.model_validate(values).title == "MVP board"
    with pytest.raises(ValidationError):
        Board.model_validate({**values, "title": "   "})
    with pytest.raises(ValidationError):
        Board.model_validate({**values, "title": "x" * 256})


def test_upgrade_and_downgrade_execute_on_sqlite_without_touching_other_tables(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table("folder", metadata, sa.Column("id", sa.Uuid(), primary_key=True))
    sa.Table("user", metadata, sa.Column("id", sa.Uuid(), primary_key=True))
    sa.Table("migration_sentinel", metadata, sa.Column("id", sa.Integer(), primary_key=True))
    metadata.create_all(engine)
    migration = _migration()
    with engine.begin() as connection:
        context = MigrationContext.configure(connection)
        monkeypatch.setattr(migration, "op", Operations(context))
        migration.upgrade()
        inspector = inspect(connection)
        assert set(inspector.get_table_names()) == {"board", "folder", "migration_sentinel", "user"}
        columns = {column["name"]: column for column in inspector.get_columns("board")}
        assert set(columns) == {
            "id",
            "project_id",
            "created_by_id",
            "title",
            "viewport_x",
            "viewport_y",
            "viewport_zoom",
            "revision",
            "created_at",
            "updated_at",
        }
        assert columns["id"]["primary_key"] == 1
        assert columns["title"]["nullable"] is False
        assert columns["title"]["type"].length == 255
        assert _numeric_server_default(columns["viewport_x"]["default"]) == 0
        assert _numeric_server_default(columns["viewport_y"]["default"]) == 0
        assert _numeric_server_default(columns["viewport_zoom"]["default"]) == 1
        assert _numeric_server_default(columns["revision"]["default"]) == 0
        for name in ("created_at", "updated_at"):
            assert columns[name]["nullable"] is False
            assert "current_timestamp" in _normalized_sql(columns[name]["default"])
        foreign_keys = {
            (fk["constrained_columns"][0], fk["referred_table"]): (fk.get("options") or {}).get("ondelete")
            for fk in inspector.get_foreign_keys("board")
        }
        assert foreign_keys == {
            ("project_id", "folder"): "CASCADE",
            ("created_by_id", "user"): "CASCADE",
        }
        indexed_columns = {tuple(index["column_names"]) for index in inspector.get_indexes("board")}
        assert ("project_id",) in indexed_columns
        assert ("created_by_id",) in indexed_columns
        checks = {
            check["name"]: _normalized_sql(check["sqltext"]) for check in inspector.get_check_constraints("board")
        }
        assert set(checks) == {
            "ck_board_title_length",
            "ck_board_viewport_zoom_range",
            "ck_board_revision_nonnegative",
        }
        migration.downgrade()
        assert set(inspect(connection).get_table_names()) == {"folder", "migration_sentinel", "user"}


def _command_config(uri: str) -> Config:
    config = Config()
    config.set_main_option("script_location", str(ALEMBIC_ROOT))
    config.set_main_option("sqlalchemy.url", uri)
    return config


@contextmanager
def _sqlite_database() -> Iterator[tuple[str, sa.Engine]]:
    with tempfile.NamedTemporaryFile(suffix="-unified-board.db", delete=False) as handle:
        path = Path(handle.name)
    uri = f"sqlite+aiosqlite:///{path}"
    engine = sa.create_engine(uri.replace("sqlite+aiosqlite", "sqlite", 1))
    try:
        yield uri, engine
    finally:
        engine.dispose()
        for suffix in ("", "-wal", "-shm", "-journal"):
            Path(f"{path}{suffix}").unlink(missing_ok=True)


def _legacy_schema(metadata: sa.MetaData) -> dict[str, sa.Table]:
    return {
        "user": sa.Table(
            "user",
            metadata,
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("username", sa.String(255), nullable=False),
        ),
        "folder": sa.Table(
            "folder",
            metadata,
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("name", sa.String(255), nullable=False),
        ),
        "board": sa.Table(
            "board",
            metadata,
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("project_id", sa.Uuid(), nullable=False),
            sa.Column("created_by_id", sa.Uuid(), nullable=False),
            sa.Column("title", sa.String(255), nullable=False),
        ),
        "flow": sa.Table(
            "flow",
            metadata,
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("folder_id", sa.Uuid(), nullable=False),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("data", sa.JSON(), nullable=False),
        ),
        "placement": sa.Table(
            "placement",
            metadata,
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("board_id", sa.Uuid(), nullable=False),
            sa.Column("target_kind", sa.String(32), nullable=False),
            sa.Column("target_id", sa.Uuid(), nullable=False),
        ),
        "board_note": sa.Table(
            "board_note",
            metadata,
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("project_id", sa.Uuid(), nullable=False),
            sa.Column("created_by_id", sa.Uuid(), nullable=False),
            sa.Column("content", sa.Text(), nullable=False),
        ),
        "chat_thread": sa.Table(
            "chat_thread",
            metadata,
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("project_id", sa.Uuid(), nullable=False),
            sa.Column("created_by_id", sa.Uuid(), nullable=False),
            sa.Column("title", sa.String(120), nullable=False),
        ),
        "job": sa.Table(
            "job",
            metadata,
            sa.Column("job_id", sa.Uuid(), primary_key=True),
            sa.Column("flow_id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("job_metadata", sa.JSON(), nullable=False),
        ),
        "alembic_version": sa.Table(
            "alembic_version",
            metadata,
            sa.Column("version_num", sa.String(32), primary_key=True),
        ),
    }


def test_command_receipt_revision_is_the_sole_additive_head() -> None:
    script = ScriptDirectory.from_config(_command_config("sqlite://"))
    heads = script.get_heads()
    revision = script.get_revision(COMMAND_REVISION)

    assert heads == [COMMAND_REVISION]
    assert revision is not None
    assert revision.down_revision == COMMAND_DOWN_REVISION


def test_fresh_upgrade_to_command_receipt_head_matches_model_contract() -> None:
    with _sqlite_database() as (uri, engine):
        command.upgrade(_command_config(uri), "head")
        with engine.connect() as connection:
            inspector = inspect(connection)
            assert MigrationContext.configure(connection).get_current_revision() == COMMAND_REVISION
            assert "board_command_receipt" in inspector.get_table_names()
            columns = {column["name"]: column for column in inspector.get_columns("board_command_receipt")}
            assert set(columns) == set(BoardCommandReceipt.__table__.columns.keys())
            assert columns["automation_id"]["nullable"] is True
            assert columns["chat_id"]["nullable"] is True
            assert columns["placement_id"]["nullable"] is True
            assert {item["name"] for item in inspector.get_unique_constraints("board_command_receipt")} == {
                "uq_board_command_receipt_principal_operation_key"
            }
            assert {tuple(item["column_names"]) for item in inspector.get_indexes("board_command_receipt")} == {
                ("principal_id",)
            }
            foreign_keys = inspector.get_foreign_keys("board_command_receipt")
            assert [(item["constrained_columns"], item["referred_table"]) for item in foreign_keys] == [
                (["principal_id"], "user")
            ]


def test_upgrade_from_s08_preserves_mixed_legacy_board_flow_chat_note_and_run_data() -> None:
    with _sqlite_database() as (uri, engine):
        metadata = sa.MetaData()
        tables = _legacy_schema(metadata)
        metadata.create_all(engine)
        users = [uuid4(), uuid4()]
        projects = [uuid4(), uuid4()]
        boards = [uuid4(), uuid4()]
        flows = [uuid4(), uuid4()]
        chats = [uuid4(), uuid4()]
        notes = [uuid4(), uuid4()]
        runs = [uuid4(), uuid4()]
        placements = [
            (uuid4(), boards[0], "automation", flows[0]),
            (uuid4(), boards[0], "chat", chats[0]),
            (uuid4(), boards[0], "note", notes[0]),
            (uuid4(), boards[0], "job_result", runs[0]),
            (uuid4(), boards[1], "automation", flows[1]),
        ]
        with engine.begin() as connection:
            connection.execute(
                tables["user"].insert(),
                [
                    {"id": users[0], "username": "owner"},
                    {"id": users[1], "username": "other"},
                ],
            )
            connection.execute(
                tables["folder"].insert(),
                [
                    {"id": projects[0], "user_id": users[0], "name": "Owned"},
                    {"id": projects[1], "user_id": users[1], "name": "Other"},
                ],
            )
            for index in range(2):
                connection.execute(
                    tables["board"]
                    .insert()
                    .values(
                        id=boards[index],
                        project_id=projects[index],
                        created_by_id=users[index],
                        title=f"Board {index}",
                    )
                )
                connection.execute(
                    tables["flow"]
                    .insert()
                    .values(
                        id=flows[index],
                        user_id=users[index],
                        folder_id=projects[index],
                        name=f"Automation {index}",
                        data={"nodes": [], "edges": []},
                    )
                )
                connection.execute(
                    tables["chat_thread"]
                    .insert()
                    .values(
                        id=chats[index],
                        project_id=projects[index],
                        created_by_id=users[index],
                        title=f"Chat {index}",
                    )
                )
                connection.execute(
                    tables["board_note"]
                    .insert()
                    .values(
                        id=notes[index],
                        project_id=projects[index],
                        created_by_id=users[index],
                        content=f"Note {index}",
                    )
                )
                connection.execute(
                    tables["job"]
                    .insert()
                    .values(
                        job_id=runs[index],
                        flow_id=flows[index],
                        user_id=users[index],
                        job_metadata={"mvp": {"board_id": str(boards[index])}},
                    )
                )
            connection.execute(
                tables["placement"].insert(),
                [
                    {
                        "id": placement_id,
                        "board_id": board_id,
                        "target_kind": target_kind,
                        "target_id": target_id,
                    }
                    for placement_id, board_id, target_kind, target_id in placements
                ],
            )
            connection.execute(tables["alembic_version"].insert().values(version_num=COMMAND_DOWN_REVISION))

        command.upgrade(_command_config(uri), "head")

        with engine.connect() as connection:
            assert MigrationContext.configure(connection).get_current_revision() == COMMAND_REVISION
            actual_users = connection.execute(
                sa.select(tables["user"].c.id).order_by(tables["user"].c.username)
            ).scalars()
            assert set(actual_users) == set(users)
            assert set(connection.execute(sa.select(tables["folder"].c.id)).scalars()) == set(projects)
            assert set(connection.execute(sa.select(tables["board"].c.id)).scalars()) == set(boards)
            assert set(connection.execute(sa.select(tables["flow"].c.id)).scalars()) == set(flows)
            assert set(connection.execute(sa.select(tables["chat_thread"].c.id)).scalars()) == set(chats)
            assert set(connection.execute(sa.select(tables["board_note"].c.id)).scalars()) == set(notes)
            assert set(connection.execute(sa.select(tables["job"].c.job_id)).scalars()) == set(runs)
            actual_placements = connection.execute(
                sa.select(
                    tables["placement"].c.id,
                    tables["placement"].c.board_id,
                    tables["placement"].c.target_kind,
                    tables["placement"].c.target_id,
                )
            ).all()
            assert set(actual_placements) == set(placements)


def _receipt_values(
    *,
    principal_id: UUID,
    operation: str = "board_bootstrap",
    idempotency_key: UUID | None = None,
) -> dict[str, object]:
    return {
        "id": uuid4(),
        "principal_id": principal_id,
        "operation": operation,
        "idempotency_key": idempotency_key or uuid4(),
        "request_hash": "a" * 64,
        "board_id": uuid4(),
    }


def test_receipt_unique_constraint_is_enforced_and_clean_downgrade_preserves_legacy_data() -> None:
    with _sqlite_database() as (uri, engine):
        config = _command_config(uri)
        command.upgrade(config, COMMAND_DOWN_REVISION)
        with engine.begin() as connection:
            user = User(
                username=f"rollback-{uuid4()}",
                password=_TEST_CREDENTIAL,
                is_active=True,
            )
            principal_id = UUID(str(user.id))
            connection.execute(User.__table__.insert().values(**user.model_dump()))
        command.upgrade(config, "head")
        with engine.begin() as connection:
            receipt = BoardCommandReceipt.__table__
            key = uuid4()
            values = _receipt_values(principal_id=principal_id, idempotency_key=key)
            connection.execute(receipt.insert().values(**values))
            with pytest.raises(IntegrityError), connection.begin_nested():
                connection.execute(receipt.insert().values(**{**values, "id": uuid4()}))
            connection.execute(
                receipt.insert().values(
                    **_receipt_values(
                        principal_id=principal_id,
                        operation="board_automation",
                        idempotency_key=key,
                    ),
                    automation_id=uuid4(),
                    placement_id=uuid4(),
                )
            )

    with _sqlite_database() as (uri, engine):
        config = _command_config(uri)
        command.upgrade(config, "head")
        with engine.begin() as connection:
            sentinel = sa.Table(
                "migration_sentinel",
                sa.MetaData(),
                sa.Column("id", sa.Integer(), primary_key=True),
            )
            sentinel.create(connection)
            connection.execute(sentinel.insert().values(id=1))
        command.downgrade(config, COMMAND_DOWN_REVISION)
        with engine.connect() as connection:
            assert "board_command_receipt" not in inspect(connection).get_table_names()
            assert connection.execute(sa.text("SELECT id FROM migration_sentinel")).scalar_one() == 1
