from __future__ import annotations

import os
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from ketos.services.database.models import (
    ChatContextPolicy,
    ChatRun,
    ChatRunStatus,
    ChatThread,
    Folder,
    MessageTable,
    User,
)
from sqlalchemy.exc import IntegrityError

if TYPE_CHECKING:
    from collections.abc import Iterator


WORKSPACE = Path(__file__).resolve().parents[5]
ALEMBIC_ROOT = WORKSPACE / "src/backend/base/ketos/alembic"
REVISION = "505c0a700001"
DOWN_REVISION = "c04d5e6f7a8b"
POSTGRES_BLOCKER = "BLOCKED: MVP_POSTGRES_URI is required for Stage-05 PostgreSQL migration parity"


def _config(uri: str) -> Config:
    config = Config()
    config.set_main_option("script_location", str(ALEMBIC_ROOT))
    config.set_main_option("sqlalchemy.url", uri)
    return config


def _script() -> ScriptDirectory:
    config = Config()
    config.set_main_option("script_location", str(ALEMBIC_ROOT))
    return ScriptDirectory.from_config(config)


def _sync_uri(uri: str) -> str:
    return uri.replace("sqlite+aiosqlite", "sqlite", 1)


def _postgres_uri() -> str:
    uri = os.getenv("KETOS_TEST_DATABASE_URI") or os.getenv("MVP_POSTGRES_URI")
    if not uri:
        pytest.fail(POSTGRES_BLOCKER)
    if uri.startswith("postgresql://"):
        return uri.replace("postgresql://", "postgresql+psycopg://", 1)
    if uri.startswith("postgres://"):
        return uri.replace("postgres://", "postgresql+psycopg://", 1)
    return uri


@contextmanager
def _postgres_test_uri() -> Iterator[str]:
    base_uri = _postgres_uri()
    database_name = f"ketos_s05_{uuid4().hex[:12]}"
    url = sa.engine.make_url(base_uri)
    admin_uri = url.set(database="postgres").render_as_string(hide_password=False)
    test_uri = url.set(database=database_name).render_as_string(hide_password=False)
    engine = sa.create_engine(admin_uri, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            connection.exec_driver_sql(f'CREATE DATABASE "{database_name}"')
        yield test_uri
    finally:
        with engine.connect() as connection:
            connection.execute(
                sa.text("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :name"),
                {"name": database_name},
            )
            connection.exec_driver_sql(f'DROP DATABASE IF EXISTS "{database_name}"')
        engine.dispose()


@contextmanager
def _sqlite_uri() -> Iterator[str]:
    with tempfile.NamedTemporaryFile(suffix="-stage05.db", delete=False) as handle:
        path = Path(handle.name)
    try:
        yield f"sqlite+aiosqlite:///{path}"
    finally:
        for suffix in ("", "-wal", "-shm", "-journal"):
            Path(f"{path}{suffix}").unlink(missing_ok=True)


def _current_revision(uri: str) -> str | None:
    engine = sa.create_engine(_sync_uri(uri))
    try:
        with engine.connect() as connection:
            if "alembic_version" not in sa.inspect(connection).get_table_names():
                return None
            return MigrationContext.configure(connection).get_current_revision()
    finally:
        engine.dispose()


@contextmanager
def _upgraded_database(uri: str, *, from_stage04: bool) -> Iterator[sa.Engine]:
    config = _config(uri)
    original_revision = _current_revision(uri)
    if original_revision not in {None, DOWN_REVISION}:
        pytest.fail(f"disposable migration database must be empty or at {DOWN_REVISION}, got {original_revision}")
    try:
        if original_revision is None and from_stage04:
            command.upgrade(config, DOWN_REVISION)
        command.upgrade(config, REVISION)
        engine = sa.create_engine(_sync_uri(uri))
        try:
            yield engine
        finally:
            engine.dispose()
    finally:
        current = _current_revision(uri)
        if current == REVISION:
            command.downgrade(config, original_revision or DOWN_REVISION)


def _constraint_names(table: sa.Table, kind: type) -> set[str | None]:
    return {constraint.name for constraint in table.constraints if isinstance(constraint, kind)}


def _assert_model_contract() -> None:
    assert {item.value for item in ChatContextPolicy} == {"chat_only", "board"}
    assert {item.value for item in ChatRunStatus} == {
        "claimed",
        "running",
        "succeeded",
        "failed",
        "failed_recoverable",
        "cancelled",
    }
    thread = ChatThread.__table__
    assert set(thread.c.keys()) == {
        "id",
        "project_id",
        "created_by_id",
        "title",
        "provider",
        "model_name",
        "context_policy",
        "archived",
        "revision",
        "created_at",
        "updated_at",
    }
    assert thread.c.title.type.length == 120
    assert thread.c.provider.type.length == 128
    assert thread.c.model_name.type.length == 256
    assert thread.c.context_policy.type.native_enum is False
    assert thread.c.created_at.type.timezone
    assert thread.c.updated_at.type.timezone
    assert _constraint_names(thread, sa.CheckConstraint) == {
        "ck_chat_thread_title_length",
        "ck_chat_thread_provider_length",
        "ck_chat_thread_model_name_length",
        "ck_chat_thread_context_policy_values",
        "ck_chat_thread_revision_nonnegative",
    }

    run = ChatRun.__table__
    assert set(run.c.keys()) == {
        "id",
        "chat_id",
        "ag_ui_run_id",
        "langgraph_thread_id",
        "idempotency_key",
        "request_fingerprint",
        "status",
        "replay_cursor",
        "request_id",
        "run_sequence",
        "duration_ms",
        "outcome",
        "redacted_audit",
        "created_at",
        "started_at",
        "finished_at",
    }
    assert run.c.status.type.native_enum is False
    assert run.c.created_at.type.timezone
    assert run.c.started_at.type.timezone
    assert run.c.finished_at.type.timezone
    assert _constraint_names(run, sa.UniqueConstraint) == {
        "uq_chat_run_chat_idempotency",
        "uq_chat_run_chat_sequence",
    }
    assert _constraint_names(run, sa.CheckConstraint) == {
        "ck_chat_run_status_values",
        "ck_chat_run_replay_cursor_nonnegative",
        "ck_chat_run_run_sequence_positive",
        "ck_chat_run_duration_nonnegative",
    }

    message = MessageTable.__table__
    assert {"chat_id", "chat_run_id", "chat_sequence"} <= set(message.c.keys())
    assert all(message.c[name].nullable for name in ("chat_id", "chat_run_id", "chat_sequence"))
    assert "ck_message_chat_fields_consistent" in _constraint_names(message, sa.CheckConstraint)
    partial = {index.name: index for index in message.indexes}["uq_message_chat_sequence"]
    assert partial.unique
    assert [column.name for column in partial.columns] == ["chat_id", "chat_sequence"]
    assert str(partial.dialect_options["postgresql"]["where"]).lower() == "chat_id is not null"
    assert str(partial.dialect_options["sqlite"]["where"]).lower() == "chat_id is not null"

    base_thread = {
        "project_id": uuid4(),
        "created_by_id": uuid4(),
        "title": " Durable ",
        "provider": " openai ",
        "model_name": " model ",
        "context_policy": "chat_only",
    }
    validated = ChatThread.model_validate(base_thread)
    assert (validated.title, validated.provider, validated.model_name) == ("Durable", "openai", "model")
    for field in ("title", "provider", "model_name"):
        with pytest.raises(ValueError, match="invalid length"):
            ChatThread.model_validate({**base_thread, field: "   "})
    with pytest.raises(ValueError, match="non-negative"):
        ChatThread.model_validate({**base_thread, "revision": -1})

    base_run = {
        "chat_id": uuid4(),
        "ag_ui_run_id": "run",
        "langgraph_thread_id": str(uuid4()),
        "idempotency_key": "key",
        "request_fingerprint": "a" * 64,
        "run_sequence": 1,
    }
    for field, value in (
        ("request_fingerprint", "A" * 64),
        ("replay_cursor", -1),
        ("run_sequence", 0),
        ("duration_ms", -1),
    ):
        with pytest.raises(ValueError, match="must be"):
            ChatRun.model_validate({**base_run, field: value})


def _assert_database_contract(engine: sa.Engine) -> None:
    with engine.connect() as connection:
        inspector = sa.inspect(connection)
        assert {"chat_thread", "chat_run", "message"} <= set(inspector.get_table_names())
        assert {item["name"] for item in inspector.get_unique_constraints("chat_run")} == {
            "uq_chat_run_chat_idempotency",
            "uq_chat_run_chat_sequence",
        }
        expected_run_checks = {
            "ck_chat_run_replay_cursor_nonnegative",
            "ck_chat_run_run_sequence_positive",
            "ck_chat_run_duration_nonnegative",
        }
        if connection.dialect.name == "sqlite":
            run_ddl = connection.exec_driver_sql(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='chat_run'"
            ).scalar_one()
            message_ddl = connection.exec_driver_sql(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='message'"
            ).scalar_one()
            assert all(name in run_ddl for name in expected_run_checks)
            assert "ck_message_chat_fields_consistent" in message_ddl
        else:
            assert expected_run_checks <= {item["name"] for item in inspector.get_check_constraints("chat_run")}
            assert "ck_message_chat_fields_consistent" in {
                item["name"] for item in inspector.get_check_constraints("message")
            }
        indexes = {item["name"]: item for item in inspector.get_indexes("message")}
        assert indexes["uq_message_chat_sequence"]["unique"]
        assert indexes["uq_message_chat_sequence"]["column_names"] == ["chat_id", "chat_sequence"]


def _insert_prerequisites(connection: sa.Connection) -> tuple[UUID, UUID]:
    test_password = uuid4().hex
    user = User(username=f"s05-{uuid4().hex}", password=test_password, is_active=True)
    folder = Folder(name=f"s05-{uuid4().hex}", user_id=user.id)
    connection.execute(User.__table__.insert().values(**user.model_dump()))
    connection.execute(Folder.__table__.insert().values(**folder.model_dump()))
    return UUID(str(user.id)), UUID(str(folder.id))


def _insert_thread(connection: sa.Connection, *, user_id: UUID, project_id: UUID) -> ChatThread:
    chat = ChatThread(
        project_id=project_id,
        created_by_id=user_id,
        title="Durable chat",
        provider="openai",
        model_name="stage05-model",
        context_policy=ChatContextPolicy.CHAT_ONLY,
    )
    connection.execute(ChatThread.__table__.insert().values(**chat.model_dump()))
    return chat


def _run(chat_id: UUID, *, key: str, sequence: int) -> ChatRun:
    return ChatRun(
        chat_id=chat_id,
        ag_ui_run_id=f"ag-{uuid4().hex}",
        langgraph_thread_id=str(chat_id),
        idempotency_key=key,
        request_fingerprint="a" * 64,
        run_sequence=sequence,
    )


def _expect_integrity(connection: sa.Connection, statement) -> None:
    with pytest.raises(IntegrityError), connection.begin_nested():
        statement()


def _message_values(chat: ChatThread, run: ChatRun, sequence: int, text: str) -> dict:
    message = MessageTable(
        sender="user",
        sender_name="User",
        session_id=str(chat.id),
        text=text,
        chat_id=chat.id,
        chat_run_id=run.id,
        chat_sequence=sequence,
    )
    values = message.model_dump()
    values["timestamp"] = datetime.now(timezone.utc)
    return values


def _exercise_database_constraints(engine: sa.Engine) -> None:
    with engine.begin() as connection:
        user_id, project_id = _insert_prerequisites(connection)
        chat_one = _insert_thread(connection, user_id=user_id, project_id=project_id)
        chat_two = _insert_thread(connection, user_id=user_id, project_id=project_id)
        run_one = _run(chat_one.id, key="same", sequence=1)
        connection.execute(ChatRun.__table__.insert().values(**run_one.model_dump()))
        _expect_integrity(
            connection,
            lambda: connection.execute(
                ChatRun.__table__.insert().values(**_run(chat_one.id, key="same", sequence=2).model_dump())
            ),
        )
        _expect_integrity(
            connection,
            lambda: connection.execute(
                ChatRun.__table__.insert().values(**_run(chat_one.id, key="other", sequence=1).model_dump())
            ),
        )
        run_two = _run(chat_two.id, key="same", sequence=1)
        connection.execute(ChatRun.__table__.insert().values(**run_two.model_dump()))

        connection.execute(MessageTable.__table__.insert().values(**_message_values(chat_one, run_one, 1, "one")))
        _expect_integrity(
            connection,
            lambda: connection.execute(
                MessageTable.__table__.insert().values(**_message_values(chat_one, run_one, 1, "duplicate"))
            ),
        )
        connection.execute(MessageTable.__table__.insert().values(**_message_values(chat_two, run_two, 1, "two")))
        invalid = _message_values(chat_one, run_one, 2, "invalid")
        invalid["chat_run_id"] = None
        _expect_integrity(
            connection,
            lambda: connection.execute(
                MessageTable.__table__.insert().values(**invalid),
            ),
        )


def _assert_revision_shape() -> None:
    script = _script()
    revision = script.get_revision(REVISION)
    assert revision is not None
    assert revision.down_revision == DOWN_REVISION
    assert script.get_current_head() == REVISION


def test_s05_chat_migration_sqlite() -> None:
    _assert_revision_shape()
    with _sqlite_uri() as uri, _upgraded_database(uri, from_stage04=True) as engine:
        _assert_database_contract(engine)
        _exercise_database_constraints(engine)


def test_s05_chat_model_parity_sqlite() -> None:
    _assert_model_contract()
    with _sqlite_uri() as uri, _upgraded_database(uri, from_stage04=False) as engine:
        _assert_database_contract(engine)


def test_s05_chat_migration_postgres() -> None:
    _assert_revision_shape()
    with _postgres_test_uri() as uri, _upgraded_database(uri, from_stage04=True) as engine:
        _assert_database_contract(engine)
        _exercise_database_constraints(engine)


def test_s05_chat_model_parity_postgres() -> None:
    _assert_model_contract()
    with _postgres_test_uri() as uri, _upgraded_database(uri, from_stage04=False) as engine:
        _assert_database_contract(engine)
