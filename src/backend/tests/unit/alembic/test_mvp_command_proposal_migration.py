from __future__ import annotations

import os
import tempfile
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from threading import Barrier
from typing import TYPE_CHECKING
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from ketos.services.database.models.chat_thread.model import ChatRun, ChatThread
from ketos.services.database.models.command_proposal.model import (
    CommandProposal,
    CommandProposalCommandType,
    CommandProposalSourceKind,
    CommandProposalStatus,
)
from ketos.services.database.models.flow.model import Flow, FlowRead, FlowUpdate
from ketos.services.database.models.flow_version.model import FlowVersion
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.user.model import User

if TYPE_CHECKING:
    from collections.abc import Iterator
from sqlalchemy.exc import IntegrityError

WORKSPACE = Path(__file__).resolve().parents[5]
ALEMBIC_ROOT = WORKSPACE / "src/backend/base/ketos/alembic"
REVISION = "s08c0mmand01"
DOWN_REVISION = "505c0a700002"
POSTGRES_BLOCKER = "BLOCKED: MVP_POSTGRES_URI is required for Stage-08 PostgreSQL migration parity"


def _config(uri: str) -> Config:
    config = Config()
    config.set_main_option("script_location", str(ALEMBIC_ROOT))
    config.set_main_option("sqlalchemy.url", uri)
    return config


def _postgres_uri() -> str:
    uri = os.getenv("KETOS_TEST_DATABASE_URI") or os.getenv("MVP_POSTGRES_URI")
    if not uri:
        pytest.skip(POSTGRES_BLOCKER)
    if not uri.startswith(("postgresql://", "postgres://", "postgresql+psycopg://")):
        pytest.skip("PostgreSQL migration parity is exercised by the dedicated PostgreSQL gate")
    if uri.startswith("postgresql://"):
        return uri.replace("postgresql://", "postgresql+psycopg://", 1)
    if uri.startswith("postgres://"):
        return uri.replace("postgres://", "postgresql+psycopg://", 1)
    return uri


@contextmanager
def _postgres_test_uri() -> Iterator[str]:
    base_uri = _postgres_uri()
    database_name = f"ketos_s08_{uuid4().hex[:12]}"
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


def _constraint_names(table: sa.Table, kind: type[sa.Constraint]) -> set[str | None]:
    return {constraint.name for constraint in table.constraints if isinstance(constraint, kind)}


def test_flow_revision_and_version_provenance_model_contract() -> None:
    flow = Flow.__table__
    assert "revision" in flow.c
    assert isinstance(flow.c.revision.type, sa.Integer)
    assert flow.c.revision.nullable is False
    assert str(flow.c.revision.server_default.arg) == "0"
    assert Flow.model_fields["revision"].default == 0
    assert "revision" in FlowRead.model_fields
    assert "revision" not in FlowUpdate.model_fields

    version = FlowVersion.__table__
    assert {"source_flow_revision", "source_flow_hash"} <= set(version.c.keys())
    assert isinstance(version.c.source_flow_revision.type, sa.Integer)
    assert version.c.source_flow_revision.nullable
    assert isinstance(version.c.source_flow_hash.type, sa.String)
    assert version.c.source_flow_hash.type.length == 64
    assert version.c.source_flow_hash.nullable
    assert {
        "ck_flow_version_source_revision_nonnegative",
        "ck_flow_version_source_hash_shape",
        "ck_flow_version_source_pair",
    } <= _constraint_names(version, sa.CheckConstraint)
    source_hash_check = next(
        constraint for constraint in version.constraints if constraint.name == "ck_flow_version_source_hash_shape"
    )
    assert "replace(" in str(source_hash_check.sqltext)


def test_command_proposal_model_contract() -> None:
    table = CommandProposal.__table__

    assert set(CommandProposalSourceKind) == {
        CommandProposalSourceKind.AI_RUN,
        CommandProposalSourceKind.SERVER_RESTORE,
    }
    assert set(CommandProposalCommandType) == {
        CommandProposalCommandType.CREATE_FLOW,
        CommandProposalCommandType.ADD_NODE,
        CommandProposalCommandType.REMOVE_NODE,
        CommandProposalCommandType.SET_PARAMETER,
        CommandProposalCommandType.CONNECT_NODES,
        CommandProposalCommandType.DISCONNECT_NODES,
        CommandProposalCommandType.REPLACE_FLOW,
    }
    assert set(CommandProposalStatus) == {
        CommandProposalStatus.PROPOSED,
        CommandProposalStatus.AWAITING_CONFIRMATION,
        CommandProposalStatus.APPLIED,
        CommandProposalStatus.REJECTED,
        CommandProposalStatus.STALE,
        CommandProposalStatus.FAILED,
    }

    expected_columns = {
        "id",
        "actor_id",
        "project_id",
        "source_kind",
        "chat_run_id",
        "thread_id",
        "interrupt_id",
        "interrupt_bound_at",
        "source_proposal_id",
        "flow_id",
        "command_type",
        "canonical_payload",
        "preview",
        "proposal_hash",
        "base_flow_revision",
        "base_flow_hash",
        "result_flow_hash",
        "idempotency_key",
        "request_fingerprint",
        "status",
        "pinned_flow_version_id",
        "request_id",
        "sequence",
        "duration_ms",
        "outcome",
        "redacted_audit",
        "created_at",
        "resolved_at",
    }
    assert set(table.c.keys()) == expected_columns
    assert table.c.flow_id.foreign_keys == set()
    assert table.c.result_flow_hash.nullable is False
    assert table.c.redacted_audit.nullable is False

    foreign_keys = {(fk.parent.name, fk.target_fullname, fk.ondelete) for fk in table.foreign_keys}
    assert foreign_keys == {
        ("actor_id", "user.id", "RESTRICT"),
        ("project_id", "folder.id", "RESTRICT"),
        ("chat_run_id", "chat_run.id", "RESTRICT"),
        ("source_proposal_id", "command_proposal.id", "RESTRICT"),
        ("pinned_flow_version_id", "flow_version.id", "RESTRICT"),
    }

    assert {
        "uq_command_proposal_chat_run_id_idempotency_key",
        "uq_command_proposal_chat_run_id_sequence",
        "uq_command_proposal_chat_run_id_interrupt_id",
    } <= _constraint_names(table, sa.UniqueConstraint)
    assert {
        "ck_command_proposal_source_kind",
        "ck_command_proposal_command_type",
        "ck_command_proposal_status",
        "ck_command_proposal_base_flow",
        "ck_command_proposal_interrupt_phase",
        "ck_command_proposal_resolved_at",
        "ck_command_proposal_hashes",
        "ck_command_proposal_sequence_positive",
        "ck_command_proposal_duration_nonnegative",
    } <= _constraint_names(table, sa.CheckConstraint)


def test_stage08_migration_sqlite_upgrade_trigger_and_downgrade() -> None:
    script = ScriptDirectory.from_config(_config("sqlite://"))
    revision = script.get_revision(REVISION)
    assert revision is not None
    assert revision.down_revision == DOWN_REVISION
    assert script.get_current_head() == "ubw01cmdrec"

    with tempfile.NamedTemporaryFile(suffix="-stage08.db", delete=False) as handle:
        path = Path(handle.name)
    uri = f"sqlite+aiosqlite:///{path}"
    sync_uri = f"sqlite:///{path}"
    config = _config(uri)
    try:
        command.upgrade(config, REVISION)
        engine = sa.create_engine(sync_uri)
        try:
            with engine.begin() as connection:
                inspector = sa.inspect(connection)
                assert MigrationContext.configure(connection).get_current_revision() == REVISION
                assert "revision" in {column["name"] for column in inspector.get_columns("flow")}
                assert {"source_flow_revision", "source_flow_hash"} <= {
                    column["name"] for column in inspector.get_columns("flow_version")
                }
                assert "command_proposal" in inspector.get_table_names()
                assert {
                    "uq_command_proposal_chat_run_id_idempotency_key",
                    "uq_command_proposal_chat_run_id_sequence",
                    "uq_command_proposal_chat_run_id_interrupt_id",
                } == {item["name"] for item in inspector.get_unique_constraints("command_proposal")}
                trigger = connection.execute(
                    sa.text(
                        "SELECT sql FROM sqlite_master WHERE type='trigger' "
                        "AND name='trg_command_proposal_interrupt_immutable'"
                    )
                ).scalar_one()
                assert "interrupt binding is immutable" in trigger

                connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
                proposal_id = uuid4().hex
                values = {
                    "id": proposal_id,
                    "actor_id": uuid4().hex,
                    "project_id": uuid4().hex,
                    "source_kind": "ai_run",
                    "chat_run_id": uuid4().hex,
                    "thread_id": str(uuid4()),
                    "flow_id": uuid4().hex,
                    "command_type": "create_flow",
                    "canonical_payload": "{}",
                    "preview": "{}",
                    "proposal_hash": "a" * 64,
                    "result_flow_hash": "b" * 64,
                    "idempotency_key": "key",
                    "request_fingerprint": "c" * 64,
                    "status": "proposed",
                    "request_id": "request",
                    "sequence": 1,
                    "redacted_audit": "{}",
                }
                connection.execute(
                    sa.text(
                        "INSERT INTO command_proposal "
                        "(id,actor_id,project_id,source_kind,chat_run_id,thread_id,flow_id,command_type,"
                        "canonical_payload,preview,proposal_hash,result_flow_hash,idempotency_key,"
                        "request_fingerprint,status,request_id,sequence,redacted_audit) VALUES "
                        "(:id,:actor_id,:project_id,:source_kind,:chat_run_id,:thread_id,:flow_id,:command_type,"
                        ":canonical_payload,:preview,:proposal_hash,:result_flow_hash,:idempotency_key,"
                        ":request_fingerprint,:status,:request_id,:sequence,:redacted_audit)"
                    ),
                    values,
                )
                bound_at = "2026-07-21T00:00:00+00:00"
                connection.execute(
                    sa.text(
                        "UPDATE command_proposal SET status='awaiting_confirmation', "
                        "interrupt_id='interrupt-1', interrupt_bound_at=:bound_at WHERE id=:id"
                    ),
                    {"id": proposal_id, "bound_at": bound_at},
                )
                with (
                    pytest.raises(IntegrityError, match="interrupt binding is immutable"),
                    connection.begin_nested(),
                ):
                    connection.execute(
                        sa.text("UPDATE command_proposal SET interrupt_id='interrupt-2' WHERE id=:id"),
                        {"id": proposal_id},
                    )
        finally:
            engine.dispose()

        command.downgrade(config, DOWN_REVISION)
        engine = sa.create_engine(sync_uri)
        try:
            with engine.connect() as connection:
                inspector = sa.inspect(connection)
                assert MigrationContext.configure(connection).get_current_revision() == DOWN_REVISION
                assert "command_proposal" not in inspector.get_table_names()
                assert "revision" not in {column["name"] for column in inspector.get_columns("flow")}
                assert {"source_flow_revision", "source_flow_hash"}.isdisjoint(
                    column["name"] for column in inspector.get_columns("flow_version")
                )
        finally:
            engine.dispose()
    finally:
        for suffix in ("", "-wal", "-shm", "-journal"):
            Path(f"{path}{suffix}").unlink(missing_ok=True)


def test_stage08_migration_postgresql_concurrency_trigger_and_downgrade() -> None:
    with _postgres_test_uri() as uri:
        config = _config(uri)
        command.upgrade(config, REVISION)
        engine = sa.create_engine(uri)
        now = datetime.now(timezone.utc)
        actor_id = uuid4()
        project_id = uuid4()
        chat_id = uuid4()
        chat_run_id = uuid4()
        common_key = "concurrent-stage08-key"
        try:
            with engine.begin() as connection:
                assert MigrationContext.configure(connection).get_current_revision() == REVISION
                connection.execute(
                    User.__table__.insert().values(
                        id=actor_id,
                        username=f"stage08-{actor_id}",
                        password=actor_id.hex,
                        is_active=True,
                        is_superuser=False,
                        create_at=now,
                        updated_at=now,
                    )
                )
                connection.execute(
                    Folder.__table__.insert().values(
                        id=project_id,
                        name="Stage 08 Project",
                        user_id=actor_id,
                    )
                )
                connection.execute(
                    ChatThread.__table__.insert().values(
                        id=chat_id,
                        project_id=project_id,
                        created_by_id=actor_id,
                        title="Stage 08",
                        provider="test",
                        model_name="test-model",
                        context_policy="chat_only",
                        archived=False,
                        revision=0,
                        created_at=now,
                        updated_at=now,
                    )
                )
                connection.execute(
                    ChatRun.__table__.insert().values(
                        id=chat_run_id,
                        chat_id=chat_id,
                        ag_ui_run_id="stage08-run",
                        langgraph_thread_id=str(chat_id),
                        idempotency_key="chat-run-key",
                        request_fingerprint="d" * 64,
                        status="claimed",
                        replay_cursor=0,
                        request_id=uuid4(),
                        run_sequence=1,
                        redacted_audit={},
                        created_at=now,
                    )
                )

            barrier = Barrier(2)

            def insert_competing_proposal(sequence: int) -> str:
                proposal_id = uuid4()
                try:
                    with engine.begin() as connection:
                        barrier.wait(timeout=10)
                        connection.execute(
                            CommandProposal.__table__.insert().values(
                                id=proposal_id,
                                actor_id=actor_id,
                                project_id=project_id,
                                source_kind=CommandProposalSourceKind.AI_RUN,
                                chat_run_id=chat_run_id,
                                thread_id=str(chat_id),
                                flow_id=uuid4(),
                                command_type=CommandProposalCommandType.CREATE_FLOW,
                                canonical_payload={},
                                preview={},
                                proposal_hash="a" * 64,
                                result_flow_hash="b" * 64,
                                idempotency_key=common_key,
                                request_fingerprint="c" * 64,
                                status=CommandProposalStatus.PROPOSED,
                                request_id=f"request-{sequence}",
                                sequence=sequence,
                                redacted_audit={},
                                created_at=now,
                            )
                        )
                except IntegrityError:
                    return "duplicate"
                else:
                    return "inserted"

            with ThreadPoolExecutor(max_workers=2) as executor:
                outcomes = sorted(executor.map(insert_competing_proposal, (1, 2)))
            assert outcomes == ["duplicate", "inserted"]

            with engine.begin() as connection:
                winner_id = connection.execute(
                    sa.select(CommandProposal.id).where(CommandProposal.idempotency_key == common_key)
                ).scalar_one()
                bound_at = datetime.now(timezone.utc)
                connection.execute(
                    sa.update(CommandProposal)
                    .where(CommandProposal.id == winner_id)
                    .values(
                        status=CommandProposalStatus.AWAITING_CONFIRMATION,
                        interrupt_id="interrupt-1",
                        interrupt_bound_at=bound_at,
                    )
                )
                with (
                    pytest.raises(IntegrityError, match="interrupt binding is immutable"),
                    connection.begin_nested(),
                ):
                    connection.execute(
                        sa.update(CommandProposal)
                        .where(CommandProposal.id == winner_id)
                        .values(interrupt_id="interrupt-2")
                    )
        finally:
            engine.dispose()

        command.downgrade(config, DOWN_REVISION)
        engine = sa.create_engine(uri)
        try:
            with engine.connect() as connection:
                assert MigrationContext.configure(connection).get_current_revision() == DOWN_REVISION
                assert "command_proposal" not in sa.inspect(connection).get_table_names()
        finally:
            engine.dispose()
