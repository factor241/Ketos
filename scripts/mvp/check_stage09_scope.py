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
    "src/frontend/tests/core/features/mvp-restart-restore.spec.ts",
    "docs/dev/handoff/stage-09-restart-recovery-runbook.md",
    "docs/dev/handoff/schemas/stage-09-evidence.schema.json",
}
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
    "src/copilot-runtime/dist",
    "src/frontend/coverage",
    "src/frontend/node_modules/.vite",
    "src/frontend/playwright-report",
    "src/frontend/temp",
    "src/frontend/test-results",
)


class ScopeError(RuntimeError):
    pass


def _git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=REPO_ROOT, check=True, capture_output=True, text=True
    )
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


def _prepare_artifact_redirects(run_dir: Path) -> None:
    run_root = _external_run_dir(run_dir)
    artifact_root = run_root / "tmp" / "repo-artifacts"
    artifact_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    for relative in REDIRECTED_ARTIFACT_DIRS:
        source = REPO_ROOT / relative
        destination = artifact_root / relative
        destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if source.is_symlink():
            raise ScopeError(f"refusing to replace existing artifact symlink: {relative}")
        if destination.exists() or destination.is_symlink():
            raise ScopeError(f"artifact redirect target already exists: {destination}")
        if source.exists():
            if not source.is_dir():
                raise ScopeError(f"artifact path is not a directory: {relative}")
            try:
                source.rename(destination)
            except OSError:
                shutil.move(str(source), str(destination))
        else:
            destination.mkdir(mode=0o700)
        source.parent.mkdir(parents=True, exist_ok=True)
        source.symlink_to(destination, target_is_directory=True)


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
        line.strip()
        for line in _git("diff", "--name-only", f"{base}...{code_sha}").splitlines()
        if line.strip()
    }
    forbidden: list[str] = []
    for path in sorted(changed):
        parts = set(Path(path).parts)
        if path not in ALLOWED_PATHS or parts & FORBIDDEN_PARTS or Path(path).name in FORBIDDEN_NAMES:
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
