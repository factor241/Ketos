from __future__ import annotations

# ruff: noqa: INP001
import hashlib
import sqlite3
from typing import TYPE_CHECKING

import pytest
from ketos.brand_state import database as database_module
from ketos.brand_state.database import (
    POSTGRESQL_MIGRATION_ADVISORY_LOCK_ID,
    DatabasePreservationError,
    SQLiteDatabaseAdapter,
)
from ketos.brand_state.filesystem import FilesystemSafetyError
from ketos.brand_state.manifest import ManifestEntry
from ketos.brand_state.model import Sensitivity, StateKind, StateOperation, StateStatus

if TYPE_CHECKING:
    from pathlib import Path


def _entry(source: Path, destination: Path | None = None) -> ManifestEntry:
    return ManifestEntry(
        relative_id="database/langflow.db",
        kind=StateKind.SQLITE_DB,
        sensitivity=Sensitivity.PUBLIC,
        status=StateStatus.LEGACY_ONLY,
        operation=StateOperation.SQLITE_BACKUP,
        source=str(source),
        destination=str(destination) if destination is not None else None,
        size=None,
        sha256=None,
        destination_sha256=None,
        reason=None,
    )


def _create_database(path: Path, *, revisions: tuple[str | None, ...] = ("known-revision",)) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    connection.execute("CREATE TABLE alembic_version (version_num TEXT)")
    connection.executemany("INSERT INTO alembic_version VALUES (?)", [(revision,) for revision in revisions])
    connection.execute("CREATE TABLE payload (value TEXT NOT NULL)")
    connection.execute("INSERT INTO payload VALUES ('preserved')")
    connection.commit()
    return connection


def _adapter(source_root: Path, transaction_root: Path) -> SQLiteDatabaseAdapter:
    return SQLiteDatabaseAdapter(
        source_root=source_root,
        transaction_root=transaction_root,
        known_revisions={"known-revision"},
    )


def test_postgresql_lock_id_is_fixed_legacy_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KETOS_MIGRATION_LOCK_NAMESPACE", "must-not-change-lock")

    assert POSTGRESQL_MIGRATION_ADVISORY_LOCK_ID == 0x4C616E67666C6F77


def test_backup_preserves_logical_database_with_sqlite_backup_api(tmp_path: Path) -> None:
    source_root = tmp_path / "source"
    transaction_root = tmp_path / "transaction"
    source_root.mkdir()
    transaction_root.mkdir()
    source = source_root / "langflow.db"
    writer = _create_database(source)
    writer.execute("PRAGMA journal_mode=WAL")
    writer.execute("PRAGMA wal_autocheckpoint=0")
    writer.execute("INSERT INTO payload VALUES ('committed-in-wal')")
    writer.commit()
    destination = transaction_root / "backup.sqlite"

    try:
        artifact = _adapter(source_root, transaction_root).backup(_entry(source), destination=destination)
    finally:
        writer.close()

    with sqlite3.connect(destination) as preserved:
        assert preserved.execute("SELECT value FROM payload ORDER BY rowid").fetchall() == [
            ("preserved",),
            ("committed-in-wal",),
        ]
    encoded = destination.read_bytes()
    assert artifact.sha256 == hashlib.sha256(encoded).hexdigest()
    assert artifact.size == len(encoded)
    assert artifact.alembic_revision == "known-revision"
    assert artifact.integrity_result == "ok"


def test_wal_and_shm_are_inventory_evidence_only(tmp_path: Path) -> None:
    source_root = tmp_path / "source"
    transaction_root = tmp_path / "transaction"
    source_root.mkdir()
    transaction_root.mkdir()
    source = source_root / "langflow.db"
    writer = _create_database(source)
    writer.execute("PRAGMA journal_mode=WAL")
    writer.execute("PRAGMA wal_autocheckpoint=0")
    writer.execute("INSERT INTO payload VALUES ('wal-row')")
    writer.commit()

    try:
        artifact = _adapter(source_root, transaction_root).backup(
            _entry(source), destination=transaction_root / "backup.sqlite"
        )
        assert {item.suffix for item in artifact.sidecars} == {"-shm", "-wal"}
    finally:
        writer.close()

    assert not (transaction_root / "backup.sqlite-wal").exists()
    assert not (transaction_root / "backup.sqlite-shm").exists()
    assert all(item.size >= 0 and len(item.sha256) == 64 for item in artifact.sidecars)


@pytest.mark.parametrize(
    ("revisions", "message"),
    [
        ((), "missing"),
        ((None,), "blank"),
        (("",), "blank"),
        (("   ",), "blank"),
        (("removed-revision",), "unknown"),
        (("known-revision", "known-revision"), "overlap"),
    ],
)
def test_backup_fails_closed_for_invalid_alembic_history(
    tmp_path: Path,
    revisions: tuple[str | None, ...],
    message: str,
) -> None:
    source_root = tmp_path / "source"
    transaction_root = tmp_path / "transaction"
    source_root.mkdir()
    transaction_root.mkdir()
    source = source_root / "langflow.db"
    _create_database(source, revisions=revisions).close()
    destination = transaction_root / "backup.sqlite"

    with pytest.raises(DatabasePreservationError, match=message):
        _adapter(source_root, transaction_root).backup(_entry(source), destination=destination)

    assert not destination.exists()
    assert list(transaction_root.iterdir()) == []


def test_backup_fails_closed_when_alembic_table_is_absent(tmp_path: Path) -> None:
    source_root = tmp_path / "source"
    transaction_root = tmp_path / "transaction"
    source_root.mkdir()
    transaction_root.mkdir()
    source = source_root / "langflow.db"
    with sqlite3.connect(source) as connection:
        connection.execute("CREATE TABLE payload (value TEXT)")
    destination = transaction_root / "backup.sqlite"

    with pytest.raises(DatabasePreservationError, match=r"alembic_version.*missing"):
        _adapter(source_root, transaction_root).backup(_entry(source), destination=destination)

    assert not destination.exists()


def test_backup_rejects_non_database_without_leaving_partial_file(tmp_path: Path) -> None:
    source_root = tmp_path / "source"
    transaction_root = tmp_path / "transaction"
    source_root.mkdir()
    transaction_root.mkdir()
    source = source_root / "langflow.db"
    source.write_text("not a database", encoding="utf-8")
    destination = transaction_root / "backup.sqlite"

    with pytest.raises(DatabasePreservationError, match="integrity"):
        _adapter(source_root, transaction_root).backup(_entry(source), destination=destination)

    assert not destination.exists()
    assert list(transaction_root.iterdir()) == []


def test_backup_interruption_removes_staging_and_destination(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source_root = tmp_path / "source"
    transaction_root = tmp_path / "transaction"
    source_root.mkdir()
    transaction_root.mkdir()
    source = source_root / "langflow.db"
    _create_database(source).close()
    destination = transaction_root / "backup.sqlite"

    def interrupt(_source: Path, _destination: Path) -> None:
        message = "simulated interruption"
        raise RuntimeError(message)

    monkeypatch.setattr(database_module, "_native_backup_database", interrupt)

    with pytest.raises(RuntimeError, match="simulated interruption"):
        _adapter(source_root, transaction_root).backup(_entry(source), destination=destination)

    assert not destination.exists()
    assert list(transaction_root.iterdir()) == []


def test_backup_rejects_source_symlink(tmp_path: Path) -> None:
    source_root = tmp_path / "source"
    transaction_root = tmp_path / "transaction"
    source_root.mkdir()
    transaction_root.mkdir()
    outside = tmp_path / "outside.db"
    _create_database(outside).close()
    source = source_root / "langflow.db"
    source.symlink_to(outside)

    with pytest.raises(FilesystemSafetyError, match="symlink"):
        _adapter(source_root, transaction_root).backup(_entry(source), destination=transaction_root / "backup.sqlite")


def test_backup_rejects_source_swap_during_sqlite_open(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source_root = tmp_path / "source"
    transaction_root = tmp_path / "transaction"
    source_root.mkdir()
    transaction_root.mkdir()
    source = source_root / "langflow.db"
    replacement = source_root / "replacement.db"
    _create_database(source).close()
    replacement_connection = _create_database(replacement)
    replacement_connection.execute("INSERT INTO payload VALUES ('replacement-only')")
    replacement_connection.commit()
    replacement_connection.close()
    original = source_root / "original.db"
    real_backup = database_module._native_backup_database
    calls = 0

    def backup_with_first_call_swap_back(path: Path, destination: Path) -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            path.replace(original)
            replacement.replace(path)
            try:
                real_backup(path, destination)
            finally:
                path.replace(replacement)
                original.replace(path)
            return
        real_backup(path, destination)

    monkeypatch.setattr(database_module, "_native_backup_database", backup_with_first_call_swap_back)
    destination = transaction_root / "backup.sqlite"

    with pytest.raises(FilesystemSafetyError, match="changed during stable snapshot"):
        _adapter(source_root, transaction_root).backup(_entry(source), destination=destination)

    assert not destination.exists()
    assert list(transaction_root.iterdir()) == []


def test_backup_rejects_destination_parent_symlink(tmp_path: Path) -> None:
    source_root = tmp_path / "source"
    transaction_root = tmp_path / "transaction"
    outside = tmp_path / "outside"
    source_root.mkdir()
    transaction_root.mkdir()
    outside.mkdir()
    source = source_root / "langflow.db"
    _create_database(source).close()
    (transaction_root / "escaped").symlink_to(outside, target_is_directory=True)

    with pytest.raises(FilesystemSafetyError, match="symlink parent"):
        _adapter(source_root, transaction_root).backup(
            _entry(source), destination=transaction_root / "escaped" / "backup.sqlite"
        )

    assert list(outside.iterdir()) == []


def test_verify_checks_checksum_integrity_and_revision(tmp_path: Path) -> None:
    source_root = tmp_path / "source"
    transaction_root = tmp_path / "transaction"
    source_root.mkdir()
    transaction_root.mkdir()
    source = source_root / "langflow.db"
    _create_database(source).close()
    adapter = _adapter(source_root, transaction_root)
    entry = _entry(source)
    artifact = adapter.backup(entry, destination=transaction_root / "backup.sqlite")

    adapter.verify(entry, database=transaction_root / "backup.sqlite", expected_sha256=artifact.sha256)

    with sqlite3.connect(transaction_root / "backup.sqlite") as connection:
        connection.execute("UPDATE alembic_version SET version_num = 'removed-revision'")
        connection.commit()
    changed_hash = hashlib.sha256((transaction_root / "backup.sqlite").read_bytes()).hexdigest()
    with pytest.raises(DatabasePreservationError, match="unknown"):
        adapter.verify(entry, database=transaction_root / "backup.sqlite", expected_sha256=changed_hash)


def test_default_vendored_revision_inventory_is_complete() -> None:
    revisions = database_module.load_vendored_alembic_revisions()

    assert len(revisions) == 80
    assert "9a6e34f1c2d8" in revisions
    assert all(revision and not revision.isspace() for revision in revisions)


def _write_revision(path: Path, revision: str, down_revision: str | tuple[str, ...] | None) -> Path:
    path.write_text(
        f"revision = {revision!r}\ndown_revision = {down_revision!r}\n",
        encoding="utf-8",
    )
    return path


def test_vendored_revision_graph_requires_one_connected_root_and_head(tmp_path: Path) -> None:
    root = _write_revision(tmp_path / "root.py", "root", None)
    left = _write_revision(tmp_path / "left.py", "left", "root")
    right = _write_revision(tmp_path / "right.py", "right", "root")
    head = _write_revision(tmp_path / "head.py", "head", ("left", "right"))

    assert database_module._load_revision_graph((root, left, right, head)) == frozenset(
        {"root", "left", "right", "head"}
    )


@pytest.mark.parametrize(
    ("rows", "message"),
    [
        ((("root", None), ("head", "missing")), "missing parent"),
        ((("first", None), ("second", None)), "exactly one root"),
        ((("first", "second"), ("second", "first")), "exactly one root"),
        ((("root", None), ("left", "root"), ("right", "root")), "exactly one head"),
    ],
)
def test_vendored_revision_graph_fails_closed_for_incomplete_or_ambiguous_history(
    tmp_path: Path,
    rows: tuple[tuple[str, str | None], ...],
    message: str,
) -> None:
    paths = tuple(_write_revision(tmp_path / f"{revision}.py", revision, down) for revision, down in rows)

    with pytest.raises(DatabasePreservationError, match=message):
        database_module._load_revision_graph(paths)


def test_native_backup_never_follows_staging_symlink_to_external_database(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_root = tmp_path / "source"
    transaction_root = tmp_path / "transaction"
    source_root.mkdir()
    transaction_root.mkdir()
    source = source_root / "source.db"
    victim = tmp_path / "victim.db"
    _create_database(source).close()
    victim_connection = _create_database(victim)
    victim_connection.execute("INSERT INTO payload VALUES ('victim-only')")
    victim_connection.commit()
    victim_connection.close()
    before = victim.read_bytes()
    attack_path = transaction_root / "attacker-staging.db"
    attack_path.symlink_to(victim)
    monkeypatch.setattr(database_module, "_staging_path", lambda _destination: attack_path)

    with pytest.raises((DatabasePreservationError, FilesystemSafetyError)):
        _adapter(source_root, transaction_root).backup(_entry(source), destination=transaction_root / "backup.sqlite")

    assert victim.read_bytes() == before
