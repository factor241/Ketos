"""Transactional journal tests for brand-state migration."""

# The package initializer is intentionally owned by the integration controller.
# ruff: noqa: INP001

from __future__ import annotations

import hashlib
import json
from dataclasses import replace
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import UUID

import ketos.brand_state.engine as engine_module
import pytest
from filelock import FileLock, Timeout
from ketos.brand_state.engine import BrandStateEngine, TransactionStateError
from ketos.brand_state.manifest import ManifestValidationError
from ketos.brand_state.model import (
    BrandStateDiscovery,
    BrandStateEntry,
    BrandStateRoots,
    MigrationPhase,
    Sensitivity,
    StateKind,
    StateOperation,
    StateStatus,
)

if TYPE_CHECKING:
    from ketos.brand_state.manifest import ManifestEntry

TRANSACTION_ID = UUID("d087395a-3a89-4cf1-a340-900e56c7b2e8")


class SimulatedPowerLoss(BaseException):
    """Models a process loss that normal exception handling cannot journal."""


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _discovery(tmp_path: Path, *, operation: StateOperation = StateOperation.COPY) -> BrandStateDiscovery:
    legacy_root = tmp_path / "legacy"
    legacy_root.mkdir(parents=True)
    source = legacy_root / "settings.json"
    source.write_bytes(b'{"credential":"do-not-journal"}')
    canonical_config = tmp_path / "canonical" / "config"
    roots = BrandStateRoots(
        canonical_config=canonical_config,
        canonical_data=tmp_path / "canonical" / "data",
        canonical_cache=tmp_path / "canonical" / "cache",
        canonical_temp=tmp_path / "canonical" / "temp",
        legacy_config=(legacy_root,),
        legacy_data=(),
        legacy_cache=(),
        legacy_temp=(),
        legacy_knowledge_bases=(),
    )
    entry = BrandStateEntry(
        relative_id="config/settings.json",
        kind=StateKind.SECRET,
        sensitivity=Sensitivity.SECRET,
        status=StateStatus.LEGACY_ONLY,
        source=source,
        destination=canonical_config / "settings.json",
        size=source.stat().st_size,
        sha256=_sha256(source.read_bytes()),
        operation=operation,
    )
    return BrandStateDiscovery(roots=roots, entries=(entry,))


def _journal_root(tmp_path: Path) -> Path:
    return tmp_path / "journal"


def _transaction_root(tmp_path: Path) -> Path:
    return _journal_root(tmp_path) / "transactions" / str(TRANSACTION_ID)


def test_construction_is_side_effect_free_and_does_not_import_settings(tmp_path: Path) -> None:
    journal_root = _journal_root(tmp_path)

    BrandStateEngine(journal_root=journal_root)

    assert not journal_root.exists()
    source = Path(__file__).parents[3] / "base" / "ketos" / "brand_state" / "engine.py"
    assert "services.settings" not in source.read_text()


def test_apply_writes_redacted_checksummed_journal_and_commits_atomically(tmp_path: Path) -> None:
    discovery = _discovery(tmp_path)
    engine = BrandStateEngine(journal_root=_journal_root(tmp_path))

    record = engine.apply(discovery, transaction_id=TRANSACTION_ID)

    destination = discovery.entries[0].destination
    assert record.phase is MigrationPhase.COMMITTED
    assert destination is not None
    assert destination.read_bytes() == discovery.entries[0].source.read_bytes()  # type: ignore[union-attr]
    assert record.created_paths == (str(destination),)
    transaction_root = _transaction_root(tmp_path)
    manifest_text = (transaction_root / "manifest.json").read_text()
    assert "do-not-journal" not in manifest_text
    manifest = json.loads(manifest_text)
    assert manifest["fingerprint_sha256"] == record.manifest_sha256
    state = json.loads((transaction_root / "state.json").read_text())
    assert state["phase"] == MigrationPhase.COMMITTED.value
    assert not (transaction_root / "RECOVERY_REQUIRED").exists()


@pytest.mark.parametrize(
    "interrupted_phase",
    [
        MigrationPhase.DISCOVERED,
        MigrationPhase.PLANNED,
        MigrationPhase.BACKED_UP,
        MigrationPhase.STAGED,
        MigrationPhase.VERIFIED,
        MigrationPhase.COMMITTING,
        MigrationPhase.COMMITTED,
    ],
)
def test_apply_resumes_after_process_loss_at_every_durable_phase(
    tmp_path: Path,
    interrupted_phase: MigrationPhase,
) -> None:
    discovery = _discovery(tmp_path)

    def interrupt(phase: MigrationPhase) -> None:
        if phase is interrupted_phase:
            raise SimulatedPowerLoss

    first = BrandStateEngine(journal_root=_journal_root(tmp_path), checkpoint=interrupt)
    with pytest.raises(SimulatedPowerLoss):
        first.apply(discovery, transaction_id=TRANSACTION_ID)

    assert first.status(TRANSACTION_ID).phase is interrupted_phase
    resumed = BrandStateEngine(journal_root=_journal_root(tmp_path)).apply(
        discovery,
        transaction_id=TRANSACTION_ID,
    )

    assert resumed.phase is MigrationPhase.COMMITTED
    assert discovery.entries[0].destination is not None
    assert discovery.entries[0].destination.exists()


def test_regular_failure_sets_recovery_marker_and_resume_clears_it(tmp_path: Path) -> None:
    discovery = _discovery(tmp_path)

    def fail_after_staging(phase: MigrationPhase) -> None:
        if phase is MigrationPhase.STAGED:
            message = "injected failure containing no state value"
            raise RuntimeError(message)

    engine = BrandStateEngine(journal_root=_journal_root(tmp_path), checkpoint=fail_after_staging)
    with pytest.raises(RuntimeError, match="injected failure"):
        engine.apply(discovery, transaction_id=TRANSACTION_ID)

    failed = engine.status(TRANSACTION_ID)
    assert failed.phase is MigrationPhase.RECOVERY_REQUIRED
    assert failed.resume_phase is MigrationPhase.STAGED
    marker = _transaction_root(tmp_path) / "RECOVERY_REQUIRED"
    marker_payload = json.loads(marker.read_text())
    assert marker_payload == {
        "phase": MigrationPhase.STAGED.value,
        "schema": "ketos.brand-state.recovery-marker.v1",
        "transaction_id": str(TRANSACTION_ID),
    }

    resumed = BrandStateEngine(journal_root=_journal_root(tmp_path)).apply(
        discovery,
        transaction_id=TRANSACTION_ID,
    )
    assert resumed.phase is MigrationPhase.COMMITTED
    assert not marker.exists()


def test_apply_twice_is_idempotent(tmp_path: Path) -> None:
    discovery = _discovery(tmp_path)
    engine = BrandStateEngine(journal_root=_journal_root(tmp_path))

    first = engine.apply(discovery, transaction_id=TRANSACTION_ID)
    destination = discovery.entries[0].destination
    assert destination is not None
    first_stat = destination.stat()
    second = engine.apply(discovery, transaction_id=TRANSACTION_ID)

    assert first == second
    assert destination.stat().st_ino == first_stat.st_ino
    assert destination.stat().st_mtime_ns == first_stat.st_mtime_ns


def test_source_drift_fails_closed_before_destination_commit(tmp_path: Path) -> None:
    discovery = _discovery(tmp_path)

    def interrupt(phase: MigrationPhase) -> None:
        if phase is MigrationPhase.PLANNED:
            raise SimulatedPowerLoss

    engine = BrandStateEngine(journal_root=_journal_root(tmp_path), checkpoint=interrupt)
    with pytest.raises(SimulatedPowerLoss):
        engine.apply(discovery, transaction_id=TRANSACTION_ID)
    source = discovery.entries[0].source
    assert source is not None
    source.write_bytes(b"changed after planning")

    with pytest.raises(Exception, match="checksum mismatch"):
        BrandStateEngine(journal_root=_journal_root(tmp_path)).apply(
            discovery,
            transaction_id=TRANSACTION_ID,
        )

    assert engine.status(TRANSACTION_ID).phase is MigrationPhase.RECOVERY_REQUIRED
    destination = discovery.entries[0].destination
    assert destination is not None
    assert not destination.exists()


def test_manifest_tamper_fails_closed_and_marks_recovery(tmp_path: Path) -> None:
    discovery = _discovery(tmp_path)

    def interrupt(phase: MigrationPhase) -> None:
        if phase is MigrationPhase.PLANNED:
            raise SimulatedPowerLoss

    engine = BrandStateEngine(journal_root=_journal_root(tmp_path), checkpoint=interrupt)
    with pytest.raises(SimulatedPowerLoss):
        engine.apply(discovery, transaction_id=TRANSACTION_ID)
    manifest_path = _transaction_root(tmp_path) / "manifest.json"
    payload = json.loads(manifest_path.read_text())
    payload["entries"][0]["source"] = "/tampered/source"
    manifest_path.write_text(json.dumps(payload))

    with pytest.raises(ManifestValidationError, match="fingerprint"):
        BrandStateEngine(journal_root=_journal_root(tmp_path)).apply(
            discovery,
            transaction_id=TRANSACTION_ID,
        )

    assert engine.status(TRANSACTION_ID).phase is MigrationPhase.RECOVERY_REQUIRED


def test_rollback_removes_only_transaction_created_destination_and_is_idempotent(tmp_path: Path) -> None:
    discovery = _discovery(tmp_path)
    engine = BrandStateEngine(journal_root=_journal_root(tmp_path))
    engine.apply(discovery, transaction_id=TRANSACTION_ID)

    rolled_back = engine.rollback(discovery, transaction_id=TRANSACTION_ID)

    assert rolled_back.phase is MigrationPhase.ROLLED_BACK
    destination = discovery.entries[0].destination
    assert destination is not None
    assert not destination.exists()
    assert engine.rollback(discovery, transaction_id=TRANSACTION_ID) == rolled_back


@pytest.mark.parametrize("interrupted_phase", [MigrationPhase.ROLLING_BACK, MigrationPhase.ROLLED_BACK])
def test_rollback_resumes_in_fresh_process_without_discovery(
    tmp_path: Path,
    interrupted_phase: MigrationPhase,
) -> None:
    discovery = _discovery(tmp_path)
    journal_root = _journal_root(tmp_path)
    BrandStateEngine(journal_root=journal_root).apply(discovery, transaction_id=TRANSACTION_ID)

    def interrupt(phase: MigrationPhase) -> None:
        if phase is interrupted_phase:
            raise SimulatedPowerLoss

    with pytest.raises(SimulatedPowerLoss):
        BrandStateEngine(journal_root=journal_root, checkpoint=interrupt).rollback(transaction_id=TRANSACTION_ID)

    assert BrandStateEngine(journal_root=journal_root).status(TRANSACTION_ID).phase is interrupted_phase
    rolled_back = BrandStateEngine(journal_root=journal_root).rollback(transaction_id=TRANSACTION_ID)

    assert rolled_back.phase is MigrationPhase.ROLLED_BACK
    assert discovery.entries[0].destination is not None
    assert not discovery.entries[0].destination.exists()


def test_rollback_recovers_commit_published_before_created_path_journal(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    discovery = _discovery(tmp_path)
    journal_root = _journal_root(tmp_path)
    real_copy = engine_module.copy_with_checksum
    destination = discovery.entries[0].destination
    assert destination is not None

    def crash_after_publish(*args: object, **kwargs: object):
        result = real_copy(*args, **kwargs)  # type: ignore[arg-type]
        if Path(args[1]) == destination:
            raise SimulatedPowerLoss
        return result

    monkeypatch.setattr(engine_module, "copy_with_checksum", crash_after_publish)
    with pytest.raises(SimulatedPowerLoss):
        BrandStateEngine(journal_root=journal_root).apply(discovery, transaction_id=TRANSACTION_ID)

    interrupted = BrandStateEngine(journal_root=journal_root).status(TRANSACTION_ID)
    assert interrupted.phase is MigrationPhase.COMMITTING
    assert interrupted.commit_intents == (str(destination),)
    assert interrupted.created_paths == ()
    assert destination.exists()
    monkeypatch.setattr(engine_module, "copy_with_checksum", real_copy)

    rolled_back = BrandStateEngine(journal_root=journal_root).rollback(transaction_id=TRANSACTION_ID)
    assert rolled_back.phase is MigrationPhase.ROLLED_BACK
    assert not destination.exists()


def test_rollback_resumes_when_file_was_removed_before_journal_update(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    discovery = _discovery(tmp_path)
    journal_root = _journal_root(tmp_path)
    BrandStateEngine(journal_root=journal_root).apply(discovery, transaction_id=TRANSACTION_ID)
    real_remove = engine_module.remove_transaction_created

    def crash_after_remove(*args: object, **kwargs: object) -> None:
        real_remove(*args, **kwargs)  # type: ignore[arg-type]
        raise SimulatedPowerLoss

    monkeypatch.setattr(engine_module, "remove_transaction_created", crash_after_remove)
    with pytest.raises(SimulatedPowerLoss):
        BrandStateEngine(journal_root=journal_root).rollback(transaction_id=TRANSACTION_ID)
    monkeypatch.setattr(engine_module, "remove_transaction_created", real_remove)

    rolled_back = BrandStateEngine(journal_root=journal_root).rollback(transaction_id=TRANSACTION_ID)
    assert rolled_back.phase is MigrationPhase.ROLLED_BACK


def test_rollback_refuses_modified_transaction_destination(tmp_path: Path) -> None:
    discovery = _discovery(tmp_path)
    engine = BrandStateEngine(journal_root=_journal_root(tmp_path))
    engine.apply(discovery, transaction_id=TRANSACTION_ID)
    destination = discovery.entries[0].destination
    assert destination is not None
    destination.write_bytes(b"user modified canonical state")

    with pytest.raises(Exception, match=r"destination conflict.*different"):
        engine.rollback(discovery, transaction_id=TRANSACTION_ID)

    assert destination.read_bytes() == b"user modified canonical state"
    assert engine.status(TRANSACTION_ID).phase is MigrationPhase.RECOVERY_REQUIRED


def test_rollback_rejects_tampered_created_directory_outside_manifest(tmp_path: Path) -> None:
    discovery = _discovery(tmp_path)
    journal_root = _journal_root(tmp_path)
    engine = BrandStateEngine(journal_root=journal_root)
    engine.apply(discovery, transaction_id=TRANSACTION_ID)
    victim = tmp_path / "unrelated-empty-directory"
    victim.mkdir()
    state_path = _transaction_root(tmp_path) / "state.json"
    state = json.loads(state_path.read_text())
    state["created_directories"].append(str(victim))
    state["created_directories"].sort()
    state_path.write_text(json.dumps(state))

    with pytest.raises(TransactionStateError, match="created directory is not an ancestor"):
        BrandStateEngine(journal_root=journal_root).rollback(transaction_id=TRANSACTION_ID)

    assert victim.exists()


def test_conflicting_discovery_is_rejected_before_any_copy(tmp_path: Path) -> None:
    discovery = _discovery(tmp_path)
    conflicting = replace(
        discovery,
        entries=(replace(discovery.entries[0], status=StateStatus.UNEQUAL, destination_sha256="0" * 64),),
    )
    engine = BrandStateEngine(journal_root=_journal_root(tmp_path))

    with pytest.raises(ValueError, match="unresolved brand-state conflict"):
        engine.apply(conflicting, transaction_id=TRANSACTION_ID)

    destination = conflicting.entries[0].destination
    assert destination is not None
    assert not destination.exists()
    assert engine.status(TRANSACTION_ID).phase is MigrationPhase.RECOVERY_REQUIRED


def test_duplicate_canonical_destination_is_rejected_before_any_copy(tmp_path: Path) -> None:
    discovery = _discovery(tmp_path)
    first = discovery.entries[0]
    duplicate = replace(first, relative_id="database/langflow-pre.db")
    duplicate_destination = replace(discovery, entries=(first, duplicate))
    engine = BrandStateEngine(journal_root=_journal_root(tmp_path))

    with pytest.raises(ValueError, match="duplicate canonical destination"):
        engine.apply(duplicate_destination, transaction_id=TRANSACTION_ID)

    assert first.destination is not None
    assert not first.destination.exists()
    assert engine.status(TRANSACTION_ID).phase is MigrationPhase.RECOVERY_REQUIRED


def test_single_file_lock_serializes_transactions(tmp_path: Path) -> None:
    discovery = _discovery(tmp_path)
    journal_root = _journal_root(tmp_path)
    journal_root.mkdir()
    lock = FileLock(journal_root / ".brand-state.lock")

    with lock, pytest.raises(Timeout):
        BrandStateEngine(journal_root=journal_root, lock_timeout=0).apply(
            discovery,
            transaction_id=TRANSACTION_ID,
        )

    assert not (journal_root / "transactions").exists()


def test_list_transactions_is_read_only_for_missing_journal_and_sorted(tmp_path: Path) -> None:
    journal_root = _journal_root(tmp_path)
    engine = BrandStateEngine(journal_root=journal_root)

    assert engine.list_transactions() == ()
    assert not journal_root.exists()

    first_discovery = _discovery(tmp_path / "first")
    second_discovery = _discovery(tmp_path / "second")
    first_id = UUID("10000000-0000-4000-8000-000000000000")
    second_id = UUID("20000000-0000-4000-8000-000000000000")
    engine.apply(second_discovery, transaction_id=second_id)
    engine.apply(first_discovery, transaction_id=first_id)

    assert tuple(record.transaction_id for record in engine.list_transactions()) == (str(first_id), str(second_id))


def test_public_transaction_root_is_deterministic_and_side_effect_free(tmp_path: Path) -> None:
    journal_root = _journal_root(tmp_path)
    engine = BrandStateEngine(journal_root=journal_root)

    assert engine.transaction_root(TRANSACTION_ID) == journal_root / "transactions" / str(TRANSACTION_ID)
    assert not journal_root.exists()


def test_status_rejects_symlink_transaction_directory(tmp_path: Path) -> None:
    journal_root = _journal_root(tmp_path)
    transactions = journal_root / "transactions"
    transactions.mkdir(parents=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    (transactions / str(TRANSACTION_ID)).symlink_to(outside, target_is_directory=True)

    with pytest.raises(TransactionStateError, match="directory chain contains a symlink"):
        BrandStateEngine(journal_root=journal_root).status(TRANSACTION_ID)


class _Artifact:
    def __init__(self, sha256: str, size: int) -> None:
        self.sha256 = sha256
        self.size = size


class _FakeDatabaseAdapter:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def backup(self, entry: ManifestEntry, *, destination: Path) -> _Artifact:
        self.calls.append("backup")
        assert entry.source is not None
        data = Path(entry.source).read_bytes()
        destination.write_bytes(data)
        return _Artifact(_sha256(data), len(data))

    def verify(self, entry: ManifestEntry, *, database: Path, expected_sha256: str) -> None:
        del entry
        self.calls.append("verify")
        assert _sha256(database.read_bytes()) == expected_sha256


def test_database_operations_use_injected_adapter_for_every_mutating_phase(tmp_path: Path) -> None:
    discovery = _discovery(tmp_path, operation=StateOperation.SQLITE_BACKUP)
    adapter = _FakeDatabaseAdapter()
    engine = BrandStateEngine(journal_root=_journal_root(tmp_path), database_adapter=adapter)

    committed = engine.apply(discovery, transaction_id=TRANSACTION_ID)
    rolled_back = engine.rollback(discovery, transaction_id=TRANSACTION_ID)

    assert committed.phase is MigrationPhase.COMMITTED
    assert rolled_back.phase is MigrationPhase.ROLLED_BACK
    assert adapter.calls == ["backup", "verify"]


def test_database_operation_without_adapter_fails_closed(tmp_path: Path) -> None:
    discovery = _discovery(tmp_path, operation=StateOperation.SQLITE_BACKUP)

    with pytest.raises(RuntimeError, match="database adapter"):
        BrandStateEngine(journal_root=_journal_root(tmp_path)).apply(
            discovery,
            transaction_id=TRANSACTION_ID,
        )

    assert BrandStateEngine(journal_root=_journal_root(tmp_path)).status(TRANSACTION_ID).phase is (
        MigrationPhase.RECOVERY_REQUIRED
    )


def test_rollback_handles_transaction_destinations_in_different_roots(tmp_path: Path) -> None:
    discovery = _discovery(tmp_path)
    first = discovery.entries[0]
    second_source = tmp_path / "legacy" / "state.json"
    second_source.write_bytes(b'{"state":"preserved"}')
    second = replace(
        first,
        relative_id="data/state.json",
        source=second_source,
        destination=discovery.roots.canonical_data / "state.json",
        size=second_source.stat().st_size,
        sha256=_sha256(second_source.read_bytes()),
    )
    multi_root = replace(discovery, entries=(first, second))
    engine = BrandStateEngine(journal_root=_journal_root(tmp_path))
    committed = engine.apply(multi_root, transaction_id=TRANSACTION_ID)

    assert committed.phase is MigrationPhase.COMMITTED
    assert all(entry.destination is not None and entry.destination.exists() for entry in multi_root.entries)

    rolled_back = engine.rollback(transaction_id=TRANSACTION_ID)

    assert rolled_back.phase is MigrationPhase.ROLLED_BACK
    assert all(entry.destination is not None and not entry.destination.exists() for entry in multi_root.entries)


def test_apply_or_resume_is_idempotent_after_commit(tmp_path: Path) -> None:
    discovery = _discovery(tmp_path)
    engine = BrandStateEngine(journal_root=_journal_root(tmp_path))

    first = engine.apply_or_resume(discovery)
    second = engine.apply_or_resume(discovery)

    assert second == first
    assert len(engine.list_transactions()) == 1


def test_concurrent_apply_or_resume_uses_one_transaction(tmp_path: Path) -> None:
    from concurrent.futures import ThreadPoolExecutor

    discovery = _discovery(tmp_path)
    journal_root = _journal_root(tmp_path)

    def apply_once():
        return BrandStateEngine(journal_root=journal_root).apply_or_resume(discovery)

    with ThreadPoolExecutor(max_workers=2) as executor:
        records = tuple(executor.map(lambda _index: apply_once(), range(2)))

    assert records[0].transaction_id == records[1].transaction_id
    assert records[0].phase is records[1].phase is MigrationPhase.COMMITTED
    assert len(BrandStateEngine(journal_root=journal_root).list_transactions()) == 1


def test_apply_or_resume_finishes_recovery_after_committed_checkpoint(tmp_path: Path) -> None:
    discovery = _discovery(tmp_path)

    def fail_after_commit(phase: MigrationPhase) -> None:
        if phase is MigrationPhase.COMMITTED:
            message = "post-commit interruption"
            raise RuntimeError(message)

    first = BrandStateEngine(journal_root=_journal_root(tmp_path), checkpoint=fail_after_commit)
    with pytest.raises(RuntimeError, match="post-commit"):
        first.apply(discovery, transaction_id=TRANSACTION_ID)

    failed = first.status(TRANSACTION_ID)
    assert failed.phase is MigrationPhase.RECOVERY_REQUIRED
    assert failed.resume_phase is MigrationPhase.COMMITTED

    resumed = BrandStateEngine(journal_root=_journal_root(tmp_path)).apply_or_resume(discovery)

    assert resumed.transaction_id == str(TRANSACTION_ID)
    assert resumed.phase is MigrationPhase.COMMITTED


def test_identical_external_file_after_intent_is_never_claimed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    discovery = _discovery(tmp_path)
    destination = discovery.entries[0].destination
    source = discovery.entries[0].source
    assert destination is not None
    assert source is not None
    real_copy = engine_module.copy_with_checksum

    def external_publish(*args: object, **kwargs: object):
        if Path(args[1]) == destination and not destination.exists():
            destination.write_bytes(source.read_bytes())
        return real_copy(*args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(engine_module, "copy_with_checksum", external_publish)
    engine = BrandStateEngine(journal_root=_journal_root(tmp_path))
    with pytest.raises(Exception, match="identical"):
        engine.apply(discovery, transaction_id=TRANSACTION_ID)

    assert destination.read_bytes() == source.read_bytes()
    with pytest.raises(Exception, match="identical"):
        engine.rollback(transaction_id=TRANSACTION_ID)
    assert destination.read_bytes() == source.read_bytes()


def test_rollback_preserves_byte_identical_replacement_file(tmp_path: Path) -> None:
    discovery = _discovery(tmp_path)
    engine = BrandStateEngine(journal_root=_journal_root(tmp_path))
    engine.apply(discovery, transaction_id=TRANSACTION_ID)
    destination = discovery.entries[0].destination
    source = discovery.entries[0].source
    assert destination is not None
    assert source is not None
    destination.unlink()
    destination.write_bytes(source.read_bytes())

    with pytest.raises(TransactionStateError, match="identity"):
        engine.rollback(transaction_id=TRANSACTION_ID)

    assert destination.read_bytes() == source.read_bytes()


def test_rollback_preserves_replacement_created_directory(tmp_path: Path) -> None:
    discovery = _discovery(tmp_path)
    engine = BrandStateEngine(journal_root=_journal_root(tmp_path))
    engine.apply(discovery, transaction_id=TRANSACTION_ID)
    destination = discovery.entries[0].destination
    assert destination is not None
    destination.unlink()
    destination.parent.rmdir()
    destination.parent.mkdir()

    with pytest.raises(TransactionStateError, match="directory identity"):
        engine.rollback(transaction_id=TRANSACTION_ID)

    assert destination.parent.is_dir()
