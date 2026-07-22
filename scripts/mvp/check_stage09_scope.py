#!/usr/bin/env python3
# ruff: noqa: EM101, EM102, TRY003, S603, S607, PTH115
"""Fail-closed Stage-09 frozen-tree and filesystem scope checks."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
ALLOWED_PATHS = {
    "scripts/mvp/check_stage09_scope.py",
    "scripts/mvp/finalize_stage09_evidence.py",
    "scripts/mvp/restart_harness.py",
    "scripts/mvp/restart_restore_smoke.sh",
    "scripts/mvp/run_stage09_backend_package.sh",
    "scripts/mvp/stage09_gate_controller.py",
    "scripts/mvp/tests/test_stage09_gate_controller.py",
    "src/backend/base/ketos/agentic/api/router.py",
    "src/backend/base/ketos/agentic/persistence/__init__.py",
    "src/backend/base/ketos/agentic/persistence/checkpointer.py",
    "src/backend/base/ketos/main.py",
    "src/backend/base/ketos/services/chat_threads/messages.py",
    "src/backend/base/ketos/services/chat_threads/recovery.py",
    "src/backend/base/ketos/services/chat_threads/repository.py",
    "src/backend/base/ketos/services/commands/recovery.py",
    "src/backend/base/ketos/services/commands/service.py",
    "src/backend/base/ketos/services/jobs/board_claim.py",
    "src/backend/base/ketos/services/jobs/board_contracts.py",
    "src/backend/base/ketos/services/jobs/board_results.py",
    "src/backend/base/ketos/services/jobs/recovery.py",
    "src/backend/tests/integration/test_mvp_restart_recovery.py",
    "src/backend/tests/unit/agentic/persistence/test_checkpointer.py",
    "src/backend/tests/unit/services/chat_threads/test_messages_snapshot.py",
    "src/backend/tests/unit/services/chat_threads/test_recovery.py",
    "src/backend/tests/unit/services/commands/test_recovery.py",
    "src/backend/tests/unit/services/jobs/test_board_claim.py",
    "src/backend/tests/unit/services/jobs/test_board_results.py",
    "src/backend/tests/unit/services/jobs/test_restart_recovery.py",
    "src/backend/tests/unit/test_setup_superuser.py",
    "src/frontend/src/components/core/board/placements/ChatPlacement.reconnect.test.tsx",
    "src/frontend/src/components/core/board/placements/ChatPlacement.test.tsx",
    "src/frontend/src/components/core/board/placements/ChatPlacement.tsx",
    "src/frontend/src/components/core/chats/FlowCommandConfirmation.tsx",
    "src/frontend/src/components/core/chats/__tests__/FlowCommandConfirmation.reconnect.test.tsx",
    "src/frontend/src/components/core/chats/__tests__/use-flow-command-interrupt.reconnect.test.tsx",
    "src/frontend/src/controllers/API/queries/chat-threads/__tests__/use-chat-reconnect.test.tsx",
    "src/frontend/src/controllers/API/queries/chat-threads/index.ts",
    "src/frontend/src/controllers/API/queries/chat-threads/use-chat-reconnect.ts",
    "src/frontend/src/locales/en.json",
    "src/frontend/src/locales/ru.json",
    "src/frontend/src/pages/BoardPage/hooks/__tests__/use-board-restore.test.tsx",
    "src/frontend/src/pages/BoardPage/hooks/use-board-restore.ts",
    "src/frontend/src/pages/BoardPage/index.tsx",
    "src/frontend/playwright.mvp.config.ts",
    "src/frontend/tests/core/features/mvp-restart-restore.spec.ts",
    "docs/dev/handoff/stage-09-restart-recovery-runbook.md",
    "docs/dev/handoff/schemas/stage-09-evidence.schema.json",
}
BASELINE_REMEDIATION_PATHS = {
    "src/backend/tests/unit/alembic/test_api_key_created_at_default.py",
    "src/backend/tests/unit/brand_state/test_database.py",
    "src/backend/tests/unit/services/database/test_brand_state_db_preservation.py",
    "src/backend/tests/unit/test_logger.py",
    "src/backend/tests/unit/test_ketos_namespace_cutover.py",
    "src/frontend/.gitignore",
    "src/kfx/src/kfx/log/logger.py",
}
ALLOWED_PATHS |= BASELINE_REMEDIATION_PATHS
FORBIDDEN_PARTS = {"alembic", "migrations", "event_store", "outbox", "leader_election"}
FORBIDDEN_NAMES = {
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "uv.lock",
    "poetry.lock",
    "LICENSE",
    "NOTICE",
}
REDIRECTED_ARTIFACT_DIRS = (
    ".hypothesis",
    "src/copilot-runtime/dist",
    "src/frontend/coverage",
    "src/frontend/node_modules/.vite",
    "src/frontend/playwright-report",
    "src/frontend/temp",
    "src/frontend/test-results",
)
ARTIFACT_REDIRECT_SCHEMA = 1
ARTIFACT_REDIRECT_MANIFEST = "repo-artifact-redirects.json"
SHA256_HEX_LENGTH = 64


class ScopeError(RuntimeError):
    pass


def _git(*args: str) -> str:
    result = subprocess.run(["git", *args], cwd=REPO_ROOT, check=True, capture_output=True, text=True)
    return result.stdout


def _head() -> str:
    return _git("rev-parse", "HEAD").strip()


def _assert_frozen(code_sha: str) -> None:
    if _head() != code_sha:
        raise ScopeError(f"HEAD mismatch: expected {code_sha}, got {_head()}")
    dirty = _git("status", "--porcelain=v1", "--untracked-files=all")
    if dirty:
        raise ScopeError(f"frozen worktree is dirty:\n{dirty.rstrip()}")


def _file_record(path: Path) -> dict[str, Any]:
    info = path.lstat()
    record: dict[str, Any] = {
        "mode": stat.S_IMODE(info.st_mode),
        "size": info.st_size,
        "mtime_ns": info.st_mtime_ns,
    }
    if path.is_symlink():
        record["kind"] = "symlink"
        record["target"] = os.readlink(path)
    elif path.is_file():
        record["kind"] = "file"
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        record["sha256"] = digest.hexdigest()
    else:
        record["kind"] = "other"
    return record


def _snapshot(code_sha: str) -> dict[str, Any]:
    _assert_frozen(code_sha)
    files: dict[str, Any] = {}
    for root, directories, names in os.walk(REPO_ROOT, topdown=True, followlinks=False):
        root_path = Path(root)
        if root_path != REPO_ROOT:
            relative_root = root_path.relative_to(REPO_ROOT).as_posix()
            if relative_root in REDIRECTED_ARTIFACT_DIRS:
                files[relative_root] = _file_record(root_path)
        if root_path == REPO_ROOT:
            directories[:] = sorted(name for name in directories if name != ".git")
        else:
            directories.sort()
        symlink_directories = [name for name in directories if (root_path / name).is_symlink()]
        for name in symlink_directories:
            path = root_path / name
            files[path.relative_to(REPO_ROOT).as_posix()] = _file_record(path)
        directories[:] = [name for name in directories if name not in symlink_directories]
        for name in sorted(names):
            path = root_path / name
            files[path.relative_to(REPO_ROOT).as_posix()] = _file_record(path)
    return {"schema_version": 1, "code_sha": code_sha, "files": files}


def _external_run_dir(run_dir: Path) -> Path:
    resolved = run_dir.expanduser().resolve(strict=True)
    if not resolved.is_dir() or resolved == REPO_ROOT or resolved.is_relative_to(REPO_ROOT):
        raise ScopeError("artifact run directory must be an existing directory outside the repository")
    return resolved


def _move_directory(source: Path, destination: Path) -> None:
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        source.rename(destination)
    except OSError:
        shutil.move(str(source), str(destination))


def _artifact_redirect_paths(run_root: Path) -> tuple[Path, Path, Path]:
    temporary = run_root / "tmp"
    return (
        temporary / "repo-artifact-originals",
        temporary / "repo-artifact-live",
        temporary / ARTIFACT_REDIRECT_MANIFEST,
    )


def _directory_fingerprint(path: Path) -> str:
    if not path.is_dir() or path.is_symlink():
        raise ScopeError(f"cannot fingerprint non-directory artifact payload: {path}")
    digest = hashlib.sha256()
    for root, directories, names in os.walk(path, topdown=True, followlinks=False):
        root_path = Path(root)
        directories.sort()
        names.sort()
        symlink_directories = [name for name in directories if (root_path / name).is_symlink()]
        paths = [root_path, *(root_path / name for name in symlink_directories)]
        paths.extend(root_path / name for name in names)
        for candidate in paths:
            relative = "." if candidate == path else candidate.relative_to(path).as_posix()
            record = json.dumps(_file_record(candidate), sort_keys=True, separators=(",", ":"))
            digest.update(relative.encode("utf-8"))
            digest.update(b"\0")
            digest.update(record.encode("utf-8"))
            digest.update(b"\0")
        directories[:] = [name for name in directories if name not in symlink_directories]
    return digest.hexdigest()


def _is_exact_symlink(source: Path, target: Path) -> bool:
    return source.is_symlink() and source.resolve(strict=False) == target.resolve(strict=False)


def _manifest_entries(payload: dict[str, Any]) -> list[dict[str, Any]]:
    entries = payload.get("entries")
    if (
        payload.get("schema_version") != ARTIFACT_REDIRECT_SCHEMA
        or payload.get("repo_root") != str(REPO_ROOT)
        or not isinstance(entries, list)
        or [entry.get("path") for entry in entries if isinstance(entry, dict)] != list(REDIRECTED_ARTIFACT_DIRS)
    ):
        raise ScopeError("invalid artifact redirect restoration manifest")
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("original_present"), bool):
            raise ScopeError("invalid artifact redirect restoration manifest")
        fingerprint = entry.get("original_fingerprint")
        if bool(entry["original_present"]):
            if not isinstance(fingerprint, str) or len(fingerprint) != SHA256_HEX_LENGTH:
                raise ScopeError("invalid artifact redirect restoration fingerprint")
            try:
                int(fingerprint, 16)
            except ValueError as exc:
                raise ScopeError("invalid artifact redirect restoration fingerprint") from exc
        elif fingerprint is not None:
            raise ScopeError("absent artifact entry must not have a fingerprint")
    return entries


def _prepare_artifact_redirects(run_dir: Path) -> None:
    run_root = _external_run_dir(run_dir)
    originals_root, live_root, manifest_path = _artifact_redirect_paths(run_root)
    for path in (originals_root, live_root, manifest_path):
        if path.exists() or path.is_symlink():
            raise ScopeError(f"artifact redirect state already exists: {path}")

    entries: list[dict[str, Any]] = []
    for relative in REDIRECTED_ARTIFACT_DIRS:
        source = REPO_ROOT / relative
        if not source.parent.is_dir():
            raise ScopeError(f"artifact parent directory is missing: {source.parent}")
        if source.is_symlink():
            raise ScopeError(f"refusing to replace existing artifact symlink: {relative}")
        if source.exists() and not source.is_dir():
            raise ScopeError(f"artifact path is not a directory: {relative}")
        present = source.exists()
        entries.append(
            {
                "path": relative,
                "original_present": present,
                "original_fingerprint": _directory_fingerprint(source) if present else None,
            }
        )

    originals_root.mkdir(mode=0o700, parents=True)
    live_root.mkdir(mode=0o700, parents=True)
    try:
        _write_json(
            manifest_path,
            {
                "schema_version": ARTIFACT_REDIRECT_SCHEMA,
                "repo_root": str(REPO_ROOT),
                "entries": entries,
            },
        )
    except Exception:
        live_root.rmdir()
        originals_root.rmdir()
        raise

    try:
        for entry in entries:
            relative = str(entry["path"])
            source = REPO_ROOT / relative
            original = originals_root / relative
            live = live_root / relative
            if bool(entry["original_present"]):
                _move_directory(source, original)
            live.mkdir(mode=0o700, parents=True)
            source.symlink_to(live, target_is_directory=True)
    except Exception:
        try:
            _restore_artifact_redirects(run_root)
        except Exception as restore_error:
            raise ScopeError(
                "artifact redirect preparation failed and automatic recovery was incomplete; "
                f"preserved recovery manifest: {manifest_path}; originals: {originals_root}"
            ) from restore_error
        raise


def _real_directory_matches(path: Path, fingerprint: str) -> bool:
    return path.is_dir() and not path.is_symlink() and _directory_fingerprint(path) == fingerprint


def _validate_empty_scaffolding(root: Path) -> None:
    if not root.exists():
        return
    if not root.is_dir() or root.is_symlink():
        raise ScopeError(f"artifact recovery root is not a real directory: {root}")
    allowed = {root}
    for relative in REDIRECTED_ARTIFACT_DIRS:
        candidate = root
        for part in Path(relative).parts:
            candidate /= part
            allowed.add(candidate)
    for candidate in root.rglob("*"):
        if candidate not in allowed or candidate.is_symlink() or not candidate.is_dir():
            raise ScopeError(f"unexpected payload remains in artifact recovery root: {candidate}")


def _restore_artifact_entry(entry: dict[str, Any], *, originals_root: Path, live_root: Path) -> None:
    relative = str(entry["path"])
    source = REPO_ROOT / relative
    original = originals_root / relative
    live = live_root / relative
    present = bool(entry["original_present"])

    if live.exists() and (not live.is_dir() or live.is_symlink()):
        raise ScopeError(f"artifact live payload is not a real directory: {live}")
    if original.exists() and (not original.is_dir() or original.is_symlink()):
        raise ScopeError(f"artifact original payload is not a real directory: {original}")

    if not present:
        if original.exists() or original.is_symlink():
            raise ScopeError(f"unexpected original payload for absent artifact: {original}")
        if source.exists() or source.is_symlink():
            if not _is_exact_symlink(source, live):
                raise ScopeError(f"artifact path was replaced during recovery: {relative}")
            source.unlink()
        if live.exists():
            shutil.rmtree(live)
        return

    fingerprint = str(entry["original_fingerprint"])
    source_matches = _real_directory_matches(source, fingerprint) if not source.is_symlink() else False
    original_matches = _real_directory_matches(original, fingerprint) if not original.is_symlink() else False
    if original.exists() and not original_matches:
        raise ScopeError(f"preserved artifact original failed its fingerprint: {original}")
    if (source.exists() or source.is_symlink()) and not source_matches:
        if not _is_exact_symlink(source, live):
            raise ScopeError(f"artifact path was replaced during recovery: {relative}")
        if not original_matches:
            raise ScopeError(f"artifact original is unavailable for recovery: {original}")
        source.unlink()
        _move_directory(original, source)
        source_matches = _real_directory_matches(source, fingerprint)
    elif not source_matches:
        if not original_matches:
            raise ScopeError(f"artifact original is unavailable for recovery: {original}")
        _move_directory(original, source)
        source_matches = _real_directory_matches(source, fingerprint)
    if not source_matches:
        raise ScopeError(f"restored artifact failed its fingerprint: {relative}")
    if live.exists():
        shutil.rmtree(live)


def _restore_artifact_redirects(run_dir: Path, *, fail_after_entries: int | None = None) -> None:
    run_root = _external_run_dir(run_dir)
    originals_root, live_root, manifest_path = _artifact_redirect_paths(run_root)
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ScopeError("invalid artifact redirect restoration manifest")
    entries = _manifest_entries(payload)

    for index, entry in enumerate(entries, start=1):
        _restore_artifact_entry(entry, originals_root=originals_root, live_root=live_root)
        if fail_after_entries == index:
            raise ScopeError(f"injected artifact restore failure after entry {index}")

    for entry in entries:
        relative = str(entry["path"])
        source = REPO_ROOT / relative
        original = originals_root / relative
        live = live_root / relative
        if bool(entry["original_present"]):
            fingerprint = str(entry["original_fingerprint"])
            if not _real_directory_matches(source, fingerprint):
                raise ScopeError(f"artifact restore is not complete: {relative}")
            if original.exists():
                if not _real_directory_matches(original, fingerprint):
                    raise ScopeError(f"artifact recovery copy failed its fingerprint: {original}")
                shutil.rmtree(original)
        elif source.exists() or source.is_symlink() or original.exists() or original.is_symlink():
            raise ScopeError(f"absent artifact was not restored to absence: {relative}")
        if live.exists() or live.is_symlink():
            raise ScopeError(f"artifact live payload remains after recovery: {live}")

    _validate_empty_scaffolding(live_root)
    _validate_empty_scaffolding(originals_root)
    if live_root.exists():
        shutil.rmtree(live_root)
    if originals_root.exists():
        shutil.rmtree(originals_root)
    manifest_path.unlink()


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def _compare(before_path: Path, code_sha: str, json_out: Path) -> None:
    before = json.loads(before_path.read_text(encoding="utf-8"))
    if before.get("code_sha") != code_sha:
        raise ScopeError("pre-run manifest belongs to a different code SHA")
    after = _snapshot(code_sha)
    changed = sorted(
        path
        for path in set(before["files"]) | set(after["files"])
        if before["files"].get(path) != after["files"].get(path)
    )
    payload = {**after, "matches_before": not changed, "changed_paths": changed}
    _write_json(json_out, payload)
    if changed:
        raise ScopeError("repository filesystem changed after freeze: " + ", ".join(changed[:50]))


def _check_changed_scope(base: str, code_sha: str) -> None:
    if _head() != code_sha:
        raise ScopeError("scope check code SHA is not current HEAD")
    changed = {
        line.strip() for line in _git("diff", "--name-only", f"{base}...{code_sha}").splitlines() if line.strip()
    }
    forbidden: list[str] = []
    for path in sorted(changed):
        parts = set(Path(path).parts)
        if (
            path not in ALLOWED_PATHS
            or (parts & FORBIDDEN_PARTS and path not in BASELINE_REMEDIATION_PATHS)
            or Path(path).name in FORBIDDEN_NAMES
        ):
            forbidden.append(path)
    if forbidden:
        raise ScopeError("Stage-09 scope violation: " + ", ".join(forbidden))
    print(json.dumps({"status": "pass", "base": base, "code_sha": code_sha, "paths": len(changed)}))


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base")
    parser.add_argument("--code-sha")
    subparsers = parser.add_subparsers(dest="command")
    frozen = subparsers.add_parser("assert-frozen")
    frozen.add_argument("--code-sha", required=True)
    snapshot = subparsers.add_parser("snapshot")
    snapshot.add_argument("--code-sha", required=True)
    snapshot.add_argument("--json-out", type=Path, required=True)
    compare = subparsers.add_parser("compare")
    compare.add_argument("--before", type=Path, required=True)
    compare.add_argument("--code-sha", required=True)
    compare.add_argument("--json-out", type=Path, required=True)
    prepare = subparsers.add_parser("prepare-artifacts")
    prepare.add_argument("--run-dir", type=Path, required=True)
    restore = subparsers.add_parser("restore-artifacts")
    restore.add_argument("--run-dir", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    try:
        args = _parser().parse_args(argv)
        if args.command == "assert-frozen":
            _assert_frozen(args.code_sha)
        elif args.command == "snapshot":
            _write_json(args.json_out, _snapshot(args.code_sha))
        elif args.command == "compare":
            _compare(args.before, args.code_sha, args.json_out)
        elif args.command == "prepare-artifacts":
            _prepare_artifact_redirects(args.run_dir)
        elif args.command == "restore-artifacts":
            _restore_artifact_redirects(args.run_dir)
        elif args.base and args.code_sha:
            _check_changed_scope(args.base, args.code_sha)
        else:
            raise ScopeError("provide a command or --base and --code-sha")
    except (ScopeError, OSError, subprocess.CalledProcessError, json.JSONDecodeError) as exc:
        print(f"stage09 scope check failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
