"""Read-only discovery of legacy and canonical brand state."""

from __future__ import annotations

import hashlib
import os
import stat
import tempfile
from dataclasses import dataclass, replace
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import UUID

from platformdirs import user_cache_path, user_config_path, user_data_path

from ketos.brand_state.model import (
    BrandStateDiscovery,
    BrandStateEntry,
    BrandStateRoots,
    Sensitivity,
    StateKind,
    StateOperation,
    StateStatus,
)

if TYPE_CHECKING:
    from collections.abc import Mapping

_SQLITE_SIDECARS = ("-wal", "-shm", "-journal")
_SECRET_NAMES = frozenset({".env", "secret_key"})
_SECRET_SUFFIXES = (".key", ".pem", ".p12", ".pfx")
_SDK_FILENAMES = ("environments.yaml", "environments.yml")
_MIN_PERSISTED_PATH_PARTS = 2


@dataclass(frozen=True)
class _Candidate:
    relative_id: str
    source: Path
    destination: Path
    kind: StateKind
    sensitivity: Sensitivity = Sensitivity.PUBLIC
    source_root: Path | None = None
    operation: StateOperation = StateOperation.COPY


@dataclass(frozen=True)
class _FileFact:
    size: int | None
    sha256: str | None
    reason: str | None


def _unique(paths: list[Path]) -> tuple[Path, ...]:
    result: list[Path] = []
    seen: set[str] = set()
    for path in paths:
        key = os.path.normcase(str(path.absolute()))
        if key not in seen:
            seen.add(key)
            result.append(path)
    return tuple(result)


def _expand_path(raw: str, *, home: Path, cwd: Path) -> Path:
    if raw == "~":
        path = home
    elif raw.startswith(("~/", "~\\")):
        path = home / raw[2:]
    else:
        path = Path(raw)
    if not path.is_absolute():
        path = cwd / path
    return path.absolute()


def _relocate_home(path: Path, *, home: Path) -> Path:
    current_home = Path.home()
    try:
        relative = path.relative_to(current_home)
    except ValueError:
        return path
    return home / relative


def _root_from_env(
    environ: Mapping[str, str],
    name: str,
    default: Path,
    *,
    home: Path,
    cwd: Path,
) -> Path:
    raw = environ.get(name, "").strip()
    return _expand_path(raw, home=home, cwd=cwd) if raw else _relocate_home(default, home=home)


def _build_roots(environ: Mapping[str, str], *, home: Path, cwd: Path) -> BrandStateRoots:
    canonical_config_default = Path(user_config_path("ketos", "Ketos"))
    canonical_data_default = Path(user_data_path("ketos", "Ketos"))
    canonical_cache_default = Path(user_cache_path("ketos", "Ketos"))
    canonical_config = _root_from_env(environ, "KETOS_CONFIG_DIR", canonical_config_default, home=home, cwd=cwd)
    canonical_data = _root_from_env(environ, "KETOS_DATA_DIR", canonical_data_default, home=home, cwd=cwd)
    if canonical_data == canonical_config and not environ.get("KETOS_DATA_DIR", "").strip():
        canonical_data /= "data"
    canonical_cache = _root_from_env(environ, "KETOS_CACHE_DIR", canonical_cache_default, home=home, cwd=cwd)
    canonical_temp = _root_from_env(
        environ,
        "KETOS_TEMP_DIR",
        Path(tempfile.gettempdir()).resolve() / "ketos",
        home=home,
        cwd=cwd,
    )

    legacy_config_default = _relocate_home(Path(user_cache_path("langflow", "langflow")), home=home)
    legacy_config_paths: list[Path] = []
    if raw := environ.get("LANGFLOW_CONFIG_DIR", "").strip():
        legacy_config_paths.append(_expand_path(raw, home=home, cwd=cwd))
    legacy_config_paths.append(legacy_config_default)

    def legacy_override(name: str) -> tuple[Path, ...]:
        raw = environ.get(name, "").strip()
        return (_expand_path(raw, home=home, cwd=cwd),) if raw else ()

    legacy_kb_paths: list[Path] = []
    if raw := environ.get("LANGFLOW_KNOWLEDGE_BASES_DIR", "").strip():
        legacy_kb_paths.append(_expand_path(raw, home=home, cwd=cwd))
    legacy_kb_paths.append(home / ".langflow" / "knowledge_bases")
    legacy_kb_paths.extend(root / "knowledge_bases" for root in legacy_config_paths)

    return BrandStateRoots(
        canonical_config=canonical_config,
        canonical_data=canonical_data,
        canonical_cache=canonical_cache,
        canonical_temp=canonical_temp,
        legacy_config=_unique(legacy_config_paths),
        legacy_data=legacy_override("LANGFLOW_DATA_DIR"),
        legacy_cache=legacy_override("LANGFLOW_CACHE_DIR"),
        legacy_temp=legacy_override("LANGFLOW_TEMP_DIR"),
        legacy_knowledge_bases=_unique(legacy_kb_paths),
    )


def _walk(root: Path) -> tuple[Path, ...]:
    """List leaf filesystem entries without following directory symlinks."""
    try:
        root_stat = root.lstat()
    except (FileNotFoundError, NotADirectoryError, PermissionError, OSError):
        return ()
    if not stat.S_ISDIR(root_stat.st_mode):
        return (root,)

    result: list[Path] = []

    def visit(directory: Path) -> None:
        try:
            children = sorted(os.scandir(directory), key=lambda entry: entry.name)
        except OSError:
            result.append(directory)
            return
        for child in children:
            path = Path(child.path)
            try:
                is_directory = child.is_dir(follow_symlinks=False)
            except OSError:
                result.append(path)
                continue
            if is_directory:
                visit(path)
            else:
                result.append(path)

    visit(root)
    return tuple(result)


def _is_uuid(value: str) -> bool:
    try:
        UUID(value)
    except ValueError:
        return False
    return True


def _is_secret(path: Path) -> bool:
    folded = path.name.casefold()
    return folded in _SECRET_NAMES or folded.endswith(_SECRET_SUFFIXES)


def _config_candidate(path: Path, root: Path, roots: BrandStateRoots) -> _Candidate:
    relative = path.relative_to(root)
    parts = relative.parts
    name = path.name

    if name in {"langflow.db", "langflow-pre.db"}:
        return _Candidate(
            f"database/{name}",
            path,
            roots.canonical_data / "ketos.db",
            StateKind.SQLITE_DB,
            source_root=root,
            operation=StateOperation.SQLITE_BACKUP,
        )
    for suffix in _SQLITE_SIDECARS:
        if name in {f"langflow.db{suffix}", f"langflow-pre.db{suffix}"}:
            return _Candidate(
                f"database/{name}",
                path,
                roots.canonical_data / f"ketos.db{suffix}",
                StateKind.SQLITE_SIDECAR,
                source_root=root,
                operation=StateOperation.INVENTORY_ONLY,
            )
    if parts and parts[0] == "knowledge_bases":
        kb_relative = Path(*parts[1:])
        return _Candidate(
            f"knowledge_bases/{kb_relative.as_posix()}",
            path,
            roots.canonical_data / "knowledge_bases" / kb_relative,
            StateKind.KNOWLEDGE_BASE,
            source_root=root,
        )
    if len(parts) >= _MIN_PERSISTED_PATH_PARTS and _is_uuid(parts[0]):
        persisted_id = parts[0]
        if name == f"_mcp_servers_{persisted_id}.json":
            return _Candidate(
                f"mcp/{relative.as_posix()}",
                path,
                roots.canonical_config / relative,
                StateKind.MCP,
                Sensitivity.SECRET,
                root,
            )
        return _Candidate(
            f"uploads/{relative.as_posix()}",
            path,
            roots.canonical_data / relative,
            StateKind.UPLOAD,
            source_root=root,
        )
    sensitivity = Sensitivity.SECRET if _is_secret(path) else Sensitivity.PUBLIC
    kind = StateKind.SECRET if sensitivity is Sensitivity.SECRET else StateKind.CONFIG
    relative_id = (
        f"extensions/{Path(*parts[1:]).as_posix()}"
        if parts and parts[0] == "extensions"
        else f"config/{relative.as_posix()}"
    )
    return _Candidate(relative_id, path, roots.canonical_config / relative, kind, sensitivity, root)


def _root_candidate(
    path: Path,
    root: Path,
    destination_root: Path,
    *,
    id_prefix: str,
    kind: StateKind,
) -> _Candidate:
    relative = path.relative_to(root)
    return _Candidate(f"{id_prefix}/{relative.as_posix()}", path, destination_root / relative, kind, source_root=root)


def _sdk_candidates(
    environ: Mapping[str, str], *, home: Path, cwd: Path, roots: BrandStateRoots
) -> tuple[_Candidate, ...]:
    candidates: list[_Candidate] = []
    explicit = environ.get("LANGFLOW_ENVIRONMENTS_FILE", "").strip()
    if explicit:
        selected = _expand_path(explicit, home=home, cwd=cwd)
    else:
        historical = (cwd / "langflow-environments.toml", home / ".config" / "langflow" / "environments.toml")
        selected = next((path for path in historical if os.path.lexists(path)), historical[0])
    if os.path.lexists(selected):
        candidates.append(
            _Candidate(
                "sdk/langflow-environments.toml",
                selected,
                roots.canonical_config / "ketos-environments.toml",
                StateKind.SDK_ENV,
                Sensitivity.SECRET,
                selected.parent,
            )
        )

    project_roots: list[Path] = []
    for directory in (cwd, *cwd.parents):
        project_roots.append(directory)
        if (directory / ".git").is_dir() or directory.parent == directory:
            break
    for directory in project_roots:
        for name in _SDK_FILENAMES:
            source = directory / ".lfx" / name
            if os.path.lexists(source):
                candidates.append(
                    _Candidate(
                        f"sdk/project/.lfx/{name}",
                        source,
                        directory / ".kfx" / name,
                        StateKind.SDK_ENV,
                        Sensitivity.SECRET,
                        directory / ".lfx",
                    )
                )
                break
        if candidates and candidates[-1].relative_id.startswith("sdk/project/"):
            break
    for name in _SDK_FILENAMES:
        source = home / ".lfx" / name
        if os.path.lexists(source):
            candidates.append(
                _Candidate(
                    f"sdk/user/.lfx/{name}",
                    source,
                    home / ".kfx" / name,
                    StateKind.SDK_ENV,
                    Sensitivity.SECRET,
                    home / ".lfx",
                )
            )
            break
    return tuple(candidates)


def _hash_regular(path: Path, expected_stat: os.stat_result) -> _FileFact:
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
    except OSError:
        return _FileFact(None, None, "unreadable")
    try:
        opened_stat = os.fstat(descriptor)
        if not stat.S_ISREG(opened_stat.st_mode):
            return _FileFact(None, None, "special_file")
        if (opened_stat.st_dev, opened_stat.st_ino) != (expected_stat.st_dev, expected_stat.st_ino):
            return _FileFact(None, None, "changed_during_discovery")
        digest = hashlib.sha256()
        while chunk := os.read(descriptor, 1024 * 1024):
            digest.update(chunk)
        return _FileFact(opened_stat.st_size, digest.hexdigest(), None)
    except OSError:
        return _FileFact(None, None, "unreadable")
    finally:
        os.close(descriptor)


def _inspect(path: Path, *, root: Path | None) -> _FileFact | None:
    if root is not None:
        try:
            root_stat = root.lstat()
        except (FileNotFoundError, NotADirectoryError):
            root_stat = None
        except OSError:
            return _FileFact(None, None, "unreadable")
        if root_stat is not None:
            if stat.S_ISLNK(root_stat.st_mode):
                return _FileFact(None, None, "path_escape")
            if not stat.S_ISDIR(root_stat.st_mode):
                return _FileFact(None, None, "special_file")
            try:
                relative = path.absolute().relative_to(root.absolute())
            except ValueError:
                return _FileFact(None, None, "path_escape")
            current = root
            for part in relative.parts[:-1]:
                current /= part
                try:
                    ancestor = current.lstat()
                except (FileNotFoundError, NotADirectoryError):
                    break
                except OSError:
                    return _FileFact(None, None, "unreadable")
                if stat.S_ISLNK(ancestor.st_mode):
                    return _FileFact(None, None, "path_escape")
                if not stat.S_ISDIR(ancestor.st_mode):
                    return _FileFact(None, None, "special_file")
    try:
        path_stat = path.lstat()
    except (FileNotFoundError, NotADirectoryError):
        return None
    except OSError:
        return _FileFact(None, None, "unreadable")
    if stat.S_ISLNK(path_stat.st_mode):
        reason = "symlink"
        if root is not None:
            try:
                if not path.resolve(strict=False).is_relative_to(root.resolve(strict=False)):
                    reason = "path_escape"
            except OSError:
                reason = "symlink"
        return _FileFact(None, None, reason)
    if not stat.S_ISREG(path_stat.st_mode):
        return _FileFact(None, None, "special_file")
    return _hash_regular(path, path_stat)


def _entry_from_candidate(candidate: _Candidate) -> BrandStateEntry:
    source = _inspect(candidate.source, root=candidate.source_root)
    destination = _inspect(candidate.destination, root=candidate.destination.parent)
    if source is None:
        if destination is None:
            msg = "candidate has neither source nor destination"
            raise RuntimeError(msg)
        status = StateStatus.CONFLICT if destination.reason else StateStatus.CANONICAL_ONLY
    elif source.reason:
        status = StateStatus.CONFLICT
    elif destination is None:
        status = StateStatus.LEGACY_ONLY
    elif destination.reason:
        status = StateStatus.CONFLICT
    elif source.sha256 == destination.sha256:
        status = StateStatus.EQUAL
    else:
        status = StateStatus.UNEQUAL
    reason = source.reason if source is not None and source.reason else destination.reason if destination else None
    return BrandStateEntry(
        relative_id=candidate.relative_id,
        kind=candidate.kind,
        sensitivity=candidate.sensitivity,
        status=status,
        source=candidate.source if source is not None else None,
        destination=candidate.destination,
        size=source.size if source is not None else destination.size if destination else None,
        sha256=source.sha256 if source is not None else None,
        destination_sha256=destination.sha256 if destination is not None else None,
        reason=reason,
        operation=candidate.operation,
    )


def _canonical_candidate(path: Path, root: Path, *, prefix: str) -> _Candidate:
    relative = path.relative_to(root)
    if prefix == "config":
        sensitivity = Sensitivity.SECRET if _is_secret(path) else Sensitivity.PUBLIC
        kind = StateKind.SECRET if sensitivity is Sensitivity.SECRET else StateKind.CONFIG
        return _Candidate(f"config/{relative.as_posix()}", path, path, kind, sensitivity, root)
    if prefix == "data":
        if relative.as_posix() == "ketos.db":
            return _Candidate("database/ketos.db", path, path, StateKind.SQLITE_DB, source_root=root)
        if relative.parts and relative.parts[0] == "knowledge_bases":
            return _Candidate(
                f"knowledge_bases/{Path(*relative.parts[1:]).as_posix()}",
                path,
                path,
                StateKind.KNOWLEDGE_BASE,
                source_root=root,
            )
        if relative.parts and _is_uuid(relative.parts[0]):
            return _Candidate(f"uploads/{relative.as_posix()}", path, path, StateKind.UPLOAD, source_root=root)
        return _Candidate(f"data/{relative.as_posix()}", path, path, StateKind.DATA, source_root=root)
    kind = StateKind.CACHE if prefix == "cache" else StateKind.TEMP
    return _Candidate(f"{prefix}/{relative.as_posix()}", path, path, kind, source_root=root)


def discover_brand_state(
    *,
    create: bool = False,
    environ: Mapping[str, str] | None = None,
    home: Path | None = None,
    cwd: Path | None = None,
) -> BrandStateDiscovery:
    """Discover legacy and canonical state without creating or changing it.

    ``environ``, ``home``, and ``cwd`` are injectable so callers can inspect a
    frozen deployment view without mutating process-global environment state.
    File contents are reduced to SHA-256 digests and are never retained in the
    returned immutable model.
    """
    if create:
        msg = "Brand-state discovery is read-only; pass create=False"
        raise ValueError(msg)

    environment = os.environ if environ is None else environ
    selected_home = Path.home() if home is None else Path(home)
    selected_cwd = Path.cwd() if cwd is None else Path(cwd)
    roots = _build_roots(environment, home=selected_home, cwd=selected_cwd)

    candidates: list[_Candidate] = []
    for root in roots.legacy_config:
        candidates.extend(_config_candidate(path, root, roots) for path in _walk(root))
    for root in roots.legacy_data:
        for path in _walk(root):
            if path.name in {"langflow.db", "langflow-pre.db"} or any(
                path.name in {f"langflow.db{suffix}", f"langflow-pre.db{suffix}"} for suffix in _SQLITE_SIDECARS
            ):
                candidates.append(_config_candidate(path, root, roots))
            else:
                candidates.append(
                    _root_candidate(path, root, roots.canonical_data, id_prefix="data", kind=StateKind.DATA)
                )
    for root in roots.legacy_cache:
        candidates.extend(
            _root_candidate(path, root, roots.canonical_cache, id_prefix="cache", kind=StateKind.CACHE)
            for path in _walk(root)
        )
    for root in roots.legacy_temp:
        candidates.extend(
            _root_candidate(path, root, roots.canonical_temp, id_prefix="temp", kind=StateKind.TEMP)
            for path in _walk(root)
        )
    for root in roots.legacy_knowledge_bases:
        candidates.extend(
            _Candidate(
                f"knowledge_bases/{path.relative_to(root).as_posix()}",
                path,
                roots.canonical_data / "knowledge_bases" / path.relative_to(root),
                StateKind.KNOWLEDGE_BASE,
                source_root=root,
            )
            for path in _walk(root)
        )

    # Historical database fallback: old releases also consulted the working
    # directory. Package-directory discovery belongs to the frozen-artifact
    # adapter because it requires an installed-distribution inventory.
    for name in ("langflow.db", "langflow-pre.db"):
        for suffix in ("", *_SQLITE_SIDECARS):
            path = selected_cwd / f"{name}{suffix}"
            if os.path.lexists(path):
                candidates.append(_config_candidate(path, selected_cwd, roots))

    candidates.extend(_sdk_candidates(environment, home=selected_home, cwd=selected_cwd, roots=roots))

    # First source for a logical state id wins. Candidate ordering is part of
    # the contract: explicit overrides precede historical defaults, and SDK's
    # explicit file precedes cwd/user fallbacks.
    selected: dict[str, _Candidate] = {}
    conflicting_ids: set[str] = set()
    for candidate in candidates:
        previous = selected.setdefault(candidate.relative_id, candidate)
        if os.path.normcase(str(previous.source.absolute())) != os.path.normcase(str(candidate.source.absolute())):
            conflicting_ids.add(candidate.relative_id)

    covered_destinations = {os.path.normcase(str(item.destination.absolute())) for item in selected.values()}
    canonical_roots = (
        (roots.canonical_config, "config"),
        (roots.canonical_data, "data"),
        (roots.canonical_cache, "cache"),
        (roots.canonical_temp, "temp"),
    )
    for root, prefix in canonical_roots:
        for path in _walk(root):
            destination_key = os.path.normcase(str(path.absolute()))
            if destination_key in covered_destinations:
                continue
            candidate = _canonical_candidate(path, root, prefix=prefix)
            # A canonical-only candidate has no legacy source. Reuse the
            # candidate shape, then replace source with a guaranteed-missing
            # sibling for common classification below.
            missing_source = root / ".brand-state-legacy-source-absent" / path.relative_to(root)
            selected.setdefault(
                candidate.relative_id,
                _Candidate(
                    candidate.relative_id,
                    missing_source,
                    path,
                    candidate.kind,
                    candidate.sensitivity,
                    root,
                ),
            )

    # Project/user canonical KFX files live outside the four application roots.
    for scope, directory in (("project", selected_cwd), ("user", selected_home)):
        for name in _SDK_FILENAMES:
            path = directory / ".kfx" / name
            destination_key = os.path.normcase(str(path.absolute()))
            if not os.path.lexists(path) or destination_key in covered_destinations:
                continue
            relative_id = f"sdk/{scope}/.kfx/{name}"
            selected.setdefault(
                relative_id,
                _Candidate(
                    relative_id,
                    directory / ".lfx" / ".brand-state-source-absent" / name,
                    path,
                    StateKind.SDK_ENV,
                    Sensitivity.SECRET,
                    directory / ".lfx",
                ),
            )

    destinations: dict[str, str] = {}
    for relative_id, candidate in selected.items():
        destination = os.path.normcase(str(candidate.destination.absolute()))
        previous_id = destinations.setdefault(destination, relative_id)
        if previous_id != relative_id:
            conflicting_ids.update((previous_id, relative_id))

    entries = tuple(
        replace(_entry_from_candidate(selected[key]), status=StateStatus.CONFLICT, reason="ambiguous_state_mapping")
        if key in conflicting_ids
        else _entry_from_candidate(selected[key])
        for key in sorted(selected)
    )
    return BrandStateDiscovery(roots=roots, entries=entries)


__all__ = ["discover_brand_state"]
