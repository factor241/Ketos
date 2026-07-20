from __future__ import annotations

import math
from pathlib import Path
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from ketos.services.database.models import (
    BoardNote as RegisteredBoardNote,
)
from ketos.services.database.models import (
    Placement as RegisteredPlacement,
)
from ketos.services.database.models import (
    PlacementTargetKind,
)
from ketos.services.database.models.board_note.model import BoardNote
from ketos.services.database.models.placement.model import Placement
from ketos.services.database.service import SQLModel
from pydantic import ValidationError
from sqlalchemy import inspect

WORKSPACE = Path(__file__).resolve().parents[5]
ALEMBIC_ROOT = WORKSPACE / "src/backend/base/ketos/alembic"
REVISION = "c04d5e6f7a8b"
MIGRATION_FILE = ALEMBIC_ROOT / "versions/c04d5e6f7a8b_add_placement_and_board_note.py"


def _script() -> ScriptDirectory:
    config = Config()
    config.set_main_option("script_location", str(ALEMBIC_ROOT))
    return ScriptDirectory.from_config(config)


def _migration():
    return _script().get_revision(REVISION).module


def _normalized_sql(value: object) -> str:
    return " ".join(str(value).lower().replace('"', "").split())


def _default(column: sa.Column[object]) -> str:
    assert column.server_default is not None
    return str(column.server_default.arg).strip().strip("()")


def _placement_values(**changes: object) -> dict[str, object]:
    values: dict[str, object] = {
        "board_id": uuid4(),
        "target_kind": PlacementTargetKind.NOTE,
        "target_id": uuid4(),
        "x": 0,
        "y": 0,
    }
    values.update(changes)
    return values


def test_stage04_revision_is_the_single_additive_successor_to_stage03() -> None:
    assert MIGRATION_FILE.is_file()
    script = _script()
    revision = script.get_revision(REVISION)
    assert revision is not None
    assert revision.down_revision == "b03dca5a0001"
    migration = revision.module
    assert migration.revision == REVISION
    assert migration.down_revision == "b03dca5a0001"
    assert migration.branch_labels is None
    assert migration.depends_on is None


def test_models_are_registered_with_exact_columns_defaults_and_types() -> None:
    assert RegisteredPlacement is Placement
    assert RegisteredBoardNote is BoardNote
    assert SQLModel.metadata.tables["placement"] is Placement.__table__
    assert SQLModel.metadata.tables["board_note"] is BoardNote.__table__

    placement = Placement.__table__
    assert set(placement.columns.keys()) == {
        "id",
        "board_id",
        "target_kind",
        "target_id",
        "x",
        "y",
        "width",
        "height",
        "z_index",
        "display_state",
        "revision",
        "created_at",
        "updated_at",
    }
    assert isinstance(placement.c.id.type, sa.Uuid)
    assert placement.c.id.primary_key
    assert not placement.c.id.nullable
    assert isinstance(placement.c.target_kind.type, sa.Enum)
    assert placement.c.target_kind.type.native_enum is False
    assert placement.c.target_kind.type.enums == ["note", "chat", "automation", "job_result"]
    assert isinstance(placement.c.display_state.type, sa.Enum)
    assert placement.c.display_state.type.enums == ["normal", "collapsed", "maximized"]
    for name in ("x", "y", "width", "height"):
        assert isinstance(placement.c[name].type, sa.Double)
        assert not placement.c[name].nullable
    assert _default(placement.c.width) == "320"
    assert _default(placement.c.height) == "240"
    assert _default(placement.c.z_index) == "0"
    assert _default(placement.c.display_state) == "'normal'"
    assert _default(placement.c.revision) == "0"
    for name in ("created_at", "updated_at"):
        assert isinstance(placement.c[name].type, sa.DateTime)
        assert placement.c[name].type.timezone is True
        assert placement.c[name].server_default is not None

    note = BoardNote.__table__
    assert set(note.columns.keys()) == {
        "id",
        "project_id",
        "created_by_id",
        "content",
        "color",
        "revision",
        "created_at",
        "updated_at",
    }
    assert isinstance(note.c.content.type, sa.Text)
    assert isinstance(note.c.color.type, sa.String)
    assert note.c.color.type.length == 32
    assert _default(note.c.content) == "''"
    assert _default(note.c.color) == "'neutral'"
    assert _default(note.c.revision) == "0"


def test_models_declare_exact_indexes_foreign_keys_unique_and_checks() -> None:
    placement = Placement.__table__
    assert {(fk.parent.name, fk.target_fullname): fk.ondelete for fk in placement.foreign_keys} == {
        ("board_id", "board.id"): "CASCADE"
    }
    assert {tuple(column.name for column in index.columns) for index in placement.indexes} == {
        ("board_id",),
        ("target_id",),
    }
    uniques = {
        constraint.name: tuple(column.name for column in constraint.columns)
        for constraint in placement.constraints
        if isinstance(constraint, sa.UniqueConstraint)
    }
    assert uniques == {"uq_placement_board_target": ("board_id", "target_kind", "target_id")}
    assert {constraint.name for constraint in placement.constraints if isinstance(constraint, sa.CheckConstraint)} == {
        "ck_placement_target_kind_values",
        "ck_placement_display_state_values",
        "ck_placement_x_range",
        "ck_placement_y_range",
        "ck_placement_width_range",
        "ck_placement_height_range",
        "ck_placement_z_index_range",
        "ck_placement_revision_nonnegative",
    }

    note = BoardNote.__table__
    assert {(fk.parent.name, fk.target_fullname): fk.ondelete for fk in note.foreign_keys} == {
        ("project_id", "folder.id"): "CASCADE",
        ("created_by_id", "user.id"): "CASCADE",
    }
    assert {tuple(column.name for column in index.columns) for index in note.indexes} == {
        ("project_id",),
        ("created_by_id",),
    }
    checks = {
        constraint.name: _normalized_sql(constraint.sqltext)
        for constraint in note.constraints
        if isinstance(constraint, sa.CheckConstraint)
    }
    assert set(checks) == {
        "ck_board_note_content_length",
        "ck_board_note_color_values",
        "ck_board_note_revision_nonnegative",
    }
    assert "length(content) <= 10000" in checks["ck_board_note_content_length"]
    assert "violet" in checks["ck_board_note_color_values"]
    assert "substr(color" in checks["ck_board_note_color_values"]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("x", math.inf),
        ("y", math.nan),
        ("x", -1_000_001),
        ("y", 1_000_001),
        ("width", 239),
        ("width", 1601),
        ("height", 159),
        ("height", 1201),
        ("z_index", -1),
        ("z_index", 1_000_001),
    ],
)
def test_placement_model_rejects_invalid_geometry(field: str, value: object) -> None:
    with pytest.raises(ValidationError):
        Placement.model_validate(_placement_values(**{field: value}))


def test_board_note_model_accepts_tokens_and_hex_but_rejects_invalid_values() -> None:
    base = {"project_id": uuid4(), "created_by_id": uuid4()}
    for color in ("neutral", "yellow", "green", "blue", "violet", "pink", "#00aAfF"):
        assert BoardNote.model_validate({**base, "color": color}).color == color
    for color in ("red", "purple", "#12345", "#1234567", "#12ZZ99", "blue; color:red"):
        with pytest.raises(ValidationError):
            BoardNote.model_validate({**base, "color": color})
    with pytest.raises(ValidationError):
        BoardNote.model_validate({**base, "content": "x" * 10_001})


def test_upgrade_and_downgrade_execute_on_sqlite_without_touching_prerequisites(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table("folder", metadata, sa.Column("id", sa.Uuid(), primary_key=True))
    sa.Table("user", metadata, sa.Column("id", sa.Uuid(), primary_key=True))
    sa.Table("board", metadata, sa.Column("id", sa.Uuid(), primary_key=True))
    sa.Table("migration_sentinel", metadata, sa.Column("id", sa.Integer(), primary_key=True))
    metadata.create_all(engine)
    migration = _migration()
    with engine.begin() as connection:
        monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))
        migration.upgrade()
        inspector = inspect(connection)
        assert set(inspector.get_table_names()) == {
            "folder",
            "user",
            "board",
            "migration_sentinel",
            "board_note",
            "placement",
        }
        placement_columns = {column["name"]: column for column in inspector.get_columns("placement")}
        assert set(placement_columns) == set(Placement.__table__.columns.keys())
        assert str(placement_columns["width"]["default"]).strip("()") == "320"
        assert str(placement_columns["display_state"]["default"]).strip("()") == "'normal'"
        assert {tuple(index["column_names"]) for index in inspector.get_indexes("placement")} == {
            ("board_id",),
            ("target_id",),
        }
        assert {item["name"] for item in inspector.get_unique_constraints("placement")} == {"uq_placement_board_target"}
        assert {item["name"] for item in inspector.get_check_constraints("placement")} == {
            "ck_placement_target_kind_values",
            "ck_placement_display_state_values",
            "ck_placement_x_range",
            "ck_placement_y_range",
            "ck_placement_width_range",
            "ck_placement_height_range",
            "ck_placement_z_index_range",
            "ck_placement_revision_nonnegative",
        }
        assert {item["name"] for item in inspector.get_check_constraints("board_note")} == {
            "ck_board_note_content_length",
            "ck_board_note_color_values",
            "ck_board_note_revision_nonnegative",
        }
        migration.downgrade()
        assert set(inspect(connection).get_table_names()) == {"folder", "user", "board", "migration_sentinel"}
