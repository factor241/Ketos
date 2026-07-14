from __future__ import annotations

# ruff: noqa: INP001 -- test package initializer is owned by the integration controller.
import os
import sqlite3
from dataclasses import FrozenInstanceError
from pathlib import Path
from uuid import UUID

import pytest
from ketos.brand_state.discovery import discover_brand_state
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

PERSISTED_ID = UUID("7f28a12b-7e4d-4f7c-af50-ea5e76ef4d0e")


def _environment(tmp_path: Path) -> tuple[dict[str, str], dict[str, Path]]:
    roots = {
        "legacy_config": tmp_path / "legacy-config",
        "legacy_data": tmp_path / "legacy-data",
        "legacy_cache": tmp_path / "legacy-cache",
        "legacy_temp": tmp_path / "legacy-temp",
        "config": tmp_path / "ketos-config",
        "data": tmp_path / "ketos-data",
        "cache": tmp_path / "ketos-cache",
        "temp": tmp_path / "ketos-temp",
    }
    environ = {
        "LANGFLOW_CONFIG_DIR": str(roots["legacy_config"]),
        "LANGFLOW_DATA_DIR": str(roots["legacy_data"]),
        "LANGFLOW_CACHE_DIR": str(roots["legacy_cache"]),
        "LANGFLOW_TEMP_DIR": str(roots["legacy_temp"]),
        "KETOS_CONFIG_DIR": str(roots["config"]),
        "KETOS_DATA_DIR": str(roots["data"]),
        "KETOS_CACHE_DIR": str(roots["cache"]),
        "KETOS_TEMP_DIR": str(roots["temp"]),
    }
    return environ, roots


def _entry(discovery: BrandStateDiscovery, relative_id: str) -> BrandStateEntry:
    matches = [entry for entry in discovery.entries if entry.relative_id == relative_id]
    assert len(matches) == 1, matches
    return matches[0]


def test_model_contract_is_immutable_and_uses_string_enums(tmp_path: Path) -> None:
    roots = BrandStateRoots(
        canonical_config=tmp_path / "config",
        canonical_data=tmp_path / "data",
        canonical_cache=tmp_path / "cache",
        canonical_temp=tmp_path / "temp",
        legacy_config=(),
        legacy_data=(),
        legacy_cache=(),
        legacy_temp=(),
        legacy_knowledge_bases=(),
    )
    discovery = BrandStateDiscovery(roots=roots, entries=())

    assert StateKind.SECRET == "secret"  # noqa: S105 -- enum label
    assert Sensitivity.SECRET == "secret"  # noqa: S105 -- enum label
    assert StateStatus.UNEQUAL == "unequal"
    assert StateOperation.SQLITE_BACKUP == "sqlite_backup"
    assert MigrationPhase.RECOVERY_REQUIRED == "recovery_required"
    with pytest.raises(FrozenInstanceError):
        discovery.entries = ()  # type: ignore[misc]


def test_create_true_is_rejected_before_any_filesystem_creation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    environ, _ = _environment(tmp_path)
    mkdir_calls: list[Path] = []
    original_mkdir = Path.mkdir

    def tracked_mkdir(path: Path, *args, **kwargs):
        mkdir_calls.append(path)
        return original_mkdir(path, *args, **kwargs)

    monkeypatch.setattr(Path, "mkdir", tracked_mkdir)

    with pytest.raises(ValueError, match="create=False"):
        discover_brand_state(create=True, environ=environ, home=tmp_path / "home", cwd=tmp_path / "project")

    assert mkdir_calls == []


def test_discovery_is_read_only_and_does_not_open_sqlite(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    environ, roots = _environment(tmp_path)
    roots["legacy_config"].mkdir()
    (roots["legacy_config"] / "langflow.db").write_bytes(b"not-opened-as-sqlite")
    before = sorted(str(path.relative_to(tmp_path)) for path in tmp_path.rglob("*"))

    def forbidden(*_args, **_kwargs):
        msg = "discovery attempted a mutating or SQLite operation"
        raise AssertionError(msg)

    monkeypatch.setattr(Path, "mkdir", forbidden)
    monkeypatch.setattr(Path, "touch", forbidden)
    monkeypatch.setattr(sqlite3, "connect", forbidden)

    discover_brand_state(environ=environ, home=tmp_path / "home", cwd=tmp_path / "project")

    after = sorted(str(path.relative_to(tmp_path)) for path in tmp_path.rglob("*"))
    assert after == before


def test_legacy_database_and_sidecars_map_to_canonical_data(tmp_path: Path) -> None:
    environ, roots = _environment(tmp_path)
    roots["legacy_config"].mkdir()
    for suffix in ("", "-wal", "-shm", "-journal"):
        (roots["legacy_config"] / f"langflow.db{suffix}").write_bytes(suffix.encode() or b"database")

    result = discover_brand_state(environ=environ, home=tmp_path / "home", cwd=tmp_path / "project")

    database = _entry(result, "database/langflow.db")
    assert database.kind is StateKind.SQLITE_DB
    assert database.destination == roots["data"] / "ketos.db"
    assert database.status is StateStatus.LEGACY_ONLY
    for suffix in ("-wal", "-shm", "-journal"):
        sidecar = _entry(result, f"database/langflow.db{suffix}")
        assert sidecar.kind is StateKind.SQLITE_SIDECAR
        assert sidecar.destination == roots["data"] / f"ketos.db{suffix}"


def test_secrets_mcp_uploads_extensions_and_persisted_ids_are_classified(tmp_path: Path) -> None:
    environ, roots = _environment(tmp_path)
    user_dir = roots["legacy_config"] / str(PERSISTED_ID)
    user_dir.mkdir(parents=True)
    (roots["legacy_config"] / "secret_key").write_text("super-secret", encoding="utf-8")
    (roots["legacy_config"] / "private_key.pem").write_text("private-material", encoding="utf-8")
    (user_dir / f"_mcp_servers_{PERSISTED_ID}.json").write_text(
        '{"headers":{"Authorization":"super-secret"}}', encoding="utf-8"
    )
    (user_dir / "upload.txt").write_text("payload", encoding="utf-8")
    extension = roots["legacy_config"] / "extensions" / "owned" / "extension.py"
    extension.parent.mkdir(parents=True)
    extension.write_text("VALUE = 1", encoding="utf-8")

    result = discover_brand_state(environ=environ, home=tmp_path / "home", cwd=tmp_path / "project")

    secret = _entry(result, "config/secret_key")
    assert secret.kind is StateKind.SECRET
    assert secret.sensitivity is Sensitivity.SECRET
    assert secret.destination == roots["config"] / "secret_key"
    private_key = _entry(result, "config/private_key.pem")
    assert private_key.kind is StateKind.SECRET
    mcp = _entry(result, f"mcp/{PERSISTED_ID}/_mcp_servers_{PERSISTED_ID}.json")
    assert mcp.kind is StateKind.MCP
    assert mcp.sensitivity is Sensitivity.SECRET
    assert mcp.destination == roots["config"] / str(PERSISTED_ID) / f"_mcp_servers_{PERSISTED_ID}.json"
    upload = _entry(result, f"uploads/{PERSISTED_ID}/upload.txt")
    assert upload.kind is StateKind.UPLOAD
    assert upload.destination == roots["data"] / str(PERSISTED_ID) / "upload.txt"
    extension_entry = _entry(result, "extensions/owned/extension.py")
    assert extension_entry.kind is StateKind.CONFIG
    assert extension_entry.destination == roots["config"] / "extensions" / "owned" / "extension.py"

    rendered = repr(result)
    assert "super-secret" not in rendered
    assert "private-material" not in rendered
    assert "Authorization" not in rendered


def test_knowledge_base_and_sdk_candidates_have_deterministic_destinations(tmp_path: Path) -> None:
    environ, roots = _environment(tmp_path)
    home = tmp_path / "home"
    cwd = tmp_path / "project"
    kb_file = home / ".langflow" / "knowledge_bases" / "alice" / "legal" / "chroma.sqlite3"
    kb_file.parent.mkdir(parents=True)
    kb_file.write_bytes(b"kb")
    sdk_file = cwd / "langflow-environments.toml"
    sdk_file.parent.mkdir(parents=True)
    sdk_file.write_text('[environments.local]\napi_key="super-secret"\n', encoding="utf-8")
    project_lfx = cwd / ".lfx" / "environments.yaml"
    project_lfx.parent.mkdir()
    project_lfx.write_text("environments: {}", encoding="utf-8")
    user_lfx = home / ".lfx" / "environments.yml"
    user_lfx.parent.mkdir()
    user_lfx.write_text("environments: {}", encoding="utf-8")

    result = discover_brand_state(environ=environ, home=home, cwd=cwd)

    kb = _entry(result, "knowledge_bases/alice/legal/chroma.sqlite3")
    assert kb.kind is StateKind.KNOWLEDGE_BASE
    assert kb.destination == roots["data"] / "knowledge_bases" / "alice" / "legal" / "chroma.sqlite3"
    sdk = _entry(result, "sdk/langflow-environments.toml")
    assert sdk.kind is StateKind.SDK_ENV
    assert sdk.sensitivity is Sensitivity.SECRET
    assert sdk.destination == roots["config"] / "ketos-environments.toml"
    project = _entry(result, "sdk/project/.lfx/environments.yaml")
    assert project.destination == cwd / ".kfx" / "environments.yaml"
    user = _entry(result, "sdk/user/.lfx/environments.yml")
    assert user.destination == home / ".kfx" / "environments.yml"
    assert "super-secret" not in repr(result)


@pytest.mark.parametrize(
    ("legacy", "canonical", "expected"),
    [
        (b"old", None, StateStatus.LEGACY_ONLY),
        (None, b"new", StateStatus.CANONICAL_ONLY),
        (b"same", b"same", StateStatus.EQUAL),
        (b"old", b"new", StateStatus.UNEQUAL),
    ],
)
def test_old_new_equal_and_unequal_classification(
    tmp_path: Path,
    legacy: bytes | None,
    canonical: bytes | None,
    expected: StateStatus,
) -> None:
    environ, roots = _environment(tmp_path)
    source = roots["legacy_config"] / "secret_key"
    destination = roots["config"] / "secret_key"
    if legacy is not None:
        source.parent.mkdir()
        source.write_bytes(legacy)
    if canonical is not None:
        destination.parent.mkdir()
        destination.write_bytes(canonical)

    result = discover_brand_state(environ=environ, home=tmp_path / "home", cwd=tmp_path / "project")
    entry = _entry(result, "config/secret_key")

    assert entry.status is expected
    assert result.has_conflicts is (expected is StateStatus.UNEQUAL)


def test_explicit_legacy_sdk_file_wins_over_historical_candidate(tmp_path: Path) -> None:
    environ, roots = _environment(tmp_path)
    home = tmp_path / "home"
    cwd = tmp_path / "project"
    explicit = tmp_path / "external" / "selected.toml"
    explicit.parent.mkdir()
    explicit.write_text("selected=true", encoding="utf-8")
    historical = cwd / "langflow-environments.toml"
    historical.parent.mkdir()
    historical.write_text("selected=false", encoding="utf-8")
    environ["LANGFLOW_ENVIRONMENTS_FILE"] = str(explicit)

    result = discover_brand_state(environ=environ, home=home, cwd=cwd)

    sdk = _entry(result, "sdk/langflow-environments.toml")
    assert sdk.source == explicit
    assert sdk.destination == roots["config"] / "ketos-environments.toml"


def test_symlinks_and_special_files_are_conflicts_without_following_them(tmp_path: Path) -> None:
    environ, roots = _environment(tmp_path)
    roots["legacy_config"].mkdir()
    outside = tmp_path / "outside-secret"
    outside.write_text("must-not-be-read", encoding="utf-8")
    (roots["legacy_config"] / "linked-secret").symlink_to(outside)
    if hasattr(os, "mkfifo"):
        os.mkfifo(roots["legacy_config"] / "state.pipe")

    result = discover_brand_state(environ=environ, home=tmp_path / "home", cwd=tmp_path / "project")

    linked = _entry(result, "config/linked-secret")
    assert linked.status is StateStatus.CONFLICT
    assert linked.reason == "path_escape"
    assert linked.sha256 is None
    if hasattr(os, "mkfifo"):
        fifo = _entry(result, "config/state.pipe")
        assert fifo.status is StateStatus.CONFLICT
        assert fifo.reason == "special_file"


def test_entries_are_deterministic_and_source_ids_are_not_rewritten(tmp_path: Path) -> None:
    environ, roots = _environment(tmp_path)
    user_dir = roots["legacy_config"] / str(PERSISTED_ID)
    user_dir.mkdir(parents=True)
    (user_dir / "z.txt").write_text("z", encoding="utf-8")
    (user_dir / "a.txt").write_text("a", encoding="utf-8")

    first = discover_brand_state(environ=environ, home=tmp_path / "home", cwd=tmp_path / "project")
    second = discover_brand_state(
        environ=dict(reversed(tuple(environ.items()))),
        home=tmp_path / "home",
        cwd=tmp_path / "project",
    )

    assert first == second
    assert tuple(entry.relative_id for entry in first.entries) == tuple(
        sorted(entry.relative_id for entry in first.entries)
    )
    for name in ("a.txt", "z.txt"):
        entry = _entry(first, f"uploads/{PERSISTED_ID}/{name}")
        assert entry.destination.parts[-2:] == (str(PERSISTED_ID), name)


def test_duplicate_legacy_sources_and_database_destinations_are_conflicts(tmp_path: Path) -> None:
    environ, _ = _environment(tmp_path)
    home = tmp_path / "home"
    initial = discover_brand_state(environ=environ, home=home, cwd=tmp_path / "project")
    explicit, historical = initial.roots.legacy_config[:2]
    explicit.mkdir(parents=True)
    historical.mkdir(parents=True)
    (explicit / "same.txt").write_text("explicit", encoding="utf-8")
    (historical / "same.txt").write_text("historical", encoding="utf-8")
    (explicit / "langflow.db").write_bytes(b"primary")
    (explicit / "langflow-pre.db").write_bytes(b"pre")

    result = discover_brand_state(environ=environ, home=home, cwd=tmp_path / "project")

    assert _entry(result, "config/same.txt").status is StateStatus.CONFLICT
    assert _entry(result, "config/same.txt").reason == "ambiguous_state_mapping"
    assert _entry(result, "database/langflow.db").status is StateStatus.CONFLICT
    assert _entry(result, "database/langflow-pre.db").status is StateStatus.CONFLICT


def test_canonical_root_symlink_is_never_followed(tmp_path: Path) -> None:
    environ, roots = _environment(tmp_path)
    roots["legacy_config"].mkdir()
    (roots["legacy_config"] / "settings.json").write_text("legacy", encoding="utf-8")
    outside = tmp_path / "outside-canonical"
    outside.mkdir()
    (outside / "settings.json").write_text("legacy", encoding="utf-8")
    roots["config"].symlink_to(outside, target_is_directory=True)

    result = discover_brand_state(environ=environ, home=tmp_path / "home", cwd=tmp_path / "project")
    entry = _entry(result, "config/settings.json")

    assert entry.status is StateStatus.CONFLICT
    assert entry.reason == "path_escape"
    assert entry.destination_sha256 is None


def test_trusted_platform_temp_alias_is_normalized_before_manifest_freeze(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    physical = tmp_path / "physical-temp"
    physical.mkdir()
    alias = tmp_path / "platform-temp-alias"
    alias.symlink_to(physical, target_is_directory=True)
    monkeypatch.setattr("ketos.brand_state.discovery.tempfile.gettempdir", lambda: str(alias))

    discovery = discover_brand_state(environ={}, home=tmp_path / "home", cwd=tmp_path)

    assert discovery.roots.canonical_temp == physical / "ketos"
