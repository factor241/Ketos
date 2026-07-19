from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from ketos.services.database.models import Board as RegisteredBoard
from ketos.services.database.models.board.model import Board
from ketos.services.database.service import SQLModel
from pydantic import ValidationError
from sqlalchemy import inspect

WORKSPACE = Path(__file__).resolve().parents[5]
ALEMBIC_ROOT = WORKSPACE / "src/backend/base/ketos/alembic"
REVISION = "b03dca5a0001"
MIGRATION_FILE = ALEMBIC_ROOT / "versions/b03dca5a0001_add_board_table.py"


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
