#!/usr/bin/env python3
"""Deterministically seed the Stage 10 MVP vertical slice.

This command is intentionally bound to an explicit SQLite database URL. It
does not create or migrate schema and never discovers a database implicitly.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from collections.abc import Sequence
from pathlib import Path
from typing import Any, TypeVar
from uuid import UUID, uuid5

from sqlalchemy.engine import make_url
from sqlmodel import Session, SQLModel, create_engine

import ketos.services.database.models  # noqa: F401
from ketos.agentic.persistence.checkpointer import checkpoint_path
from ketos.services.database.models.board.model import Board
from ketos.services.database.models.flow.model import Flow
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.user.model import User

MANIFEST_SCHEMA = "ketos.mvp.vertical-slice-seed-manifest"
MANIFEST_VERSION = 1
SEED_NAMESPACE = UUID("f87938d9-98ae-5c18-a785-4a4aeed1fe7c")
DISABLED_PASSWORD_MARKER = "!stage10-seed-account-has-no-usable-password!"

ModelT = TypeVar("ModelT", bound=SQLModel)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Seed a deterministic, disabled Stage 10 vertical slice.",
    )
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--seed-key", required=True)
    parser.add_argument("--output-seed-manifest", required=True, type=Path)
    parser.add_argument(
        "--assert-canonical-saver-path",
        action="store_true",
        help="Verify the canonical saver path without creating a saver.",
    )
    return parser


def _validate_database_url(
    parser: argparse.ArgumentParser,
    database_url: str,
) -> None:
    try:
        parsed = make_url(database_url)
    except Exception as exc:
        parser.error(f"invalid --database-url: {exc}")

    if parsed.drivername not in {"sqlite", "sqlite+pysqlite"}:
        parser.error("--database-url must use SQLite")

    database = parsed.database
    if not database or database == ":memory:":
        parser.error("--database-url must name an on-disk SQLite database")

    database_path = Path(database).expanduser()
    if not database_path.is_absolute():
        parser.error("--database-url must contain an absolute SQLite path")


def _assert_canonical_checkpoint_path(parser: argparse.ArgumentParser) -> None:
    raw_data_dir = os.environ.get("KETOS_DATA_DIR")
    if raw_data_dir is None or not raw_data_dir.strip():
        parser.error(
            "KETOS_DATA_DIR is required with --assert-canonical-saver-path",
        )

    data_dir = Path(raw_data_dir).expanduser().resolve(strict=False)
    expected = (
        data_dir / "mvp" / "langgraph-checkpoints.sqlite3"
    ).resolve(strict=False)
    actual = Path(checkpoint_path(data_dir)).expanduser().resolve(strict=False)
    if actual != expected:
        parser.error("canonical checkpoint path assertion failed")


def _stable_id(seed_key: str, entity: str) -> UUID:
    return uuid5(SEED_NAMESPACE, f"{seed_key}:{entity}")


def _ensure_row(
    session: Session,
    model: type[ModelT],
    row_id: UUID,
    values: dict[str, Any],
) -> bool:
    """Ensure one exact deterministic row, returning True when it was reused."""
    existing = session.get(model, row_id)
    if existing is None:
        session.add(model(id=row_id, **values))
        return False

    mismatches = [
        field
        for field, expected in values.items()
        if getattr(existing, field) != expected
    ]
    if mismatches:
        joined = ", ".join(sorted(mismatches))
        raise RuntimeError(
            f"deterministic seed row {model.__name__} has mismatched fields: "
            f"{joined}",
        )
    return True


def _seed(database_url: str, seed_key: str) -> dict[str, Any]:
    seed_hash = hashlib.sha256(seed_key.encode("utf-8")).hexdigest()
    ids = {
        "user": _stable_id(seed_key, "user"),
        "project": _stable_id(seed_key, "project"),
        "board": _stable_id(seed_key, "board"),
        "flow": _stable_id(seed_key, "flow"),
    }

    engine = create_engine(database_url)
    reused: dict[str, bool] = {}
    try:
        with Session(engine) as session:
            reused["user"] = _ensure_row(
                session,
                User,
                ids["user"],
                {
                    "username": f"stage10-{seed_hash[:20]}",
                    "password": DISABLED_PASSWORD_MARKER,
                    "is_active": False,
                    "is_superuser": False,
                },
            )
            reused["project"] = _ensure_row(
                session,
                Folder,
                ids["project"],
                {
                    "name": "Stage 10 vertical slice",
                    "user_id": ids["user"],
                },
            )
            reused["board"] = _ensure_row(
                session,
                Board,
                ids["board"],
                {
                    "project_id": ids["project"],
                    "created_by_id": ids["user"],
                    "title": "Stage 10 vertical slice",
                    "viewport_x": 0,
                    "viewport_y": 0,
                    "viewport_zoom": 1,
                    "revision": 0,
                },
            )
            reused["flow"] = _ensure_row(
                session,
                Flow,
                ids["flow"],
                {
                    "name": "Stage 10 vertical slice",
                    "data": {"nodes": [], "edges": []},
                    "user_id": ids["user"],
                    "folder_id": ids["project"],
                    "revision": 0,
                },
            )
            session.commit()
    finally:
        engine.dispose()

    reused_count = sum(reused.values())
    return {
        "schema": MANIFEST_SCHEMA,
        "version": MANIFEST_VERSION,
        "seed_key_sha256": seed_hash,
        "ids": {name: str(value) for name, value in ids.items()},
        "row_counts": {
            "users": 1,
            "projects": 1,
            "boards": 1,
            "flows": 1,
            "total": 4,
        },
        "operation": {
            "created": len(reused) - reused_count,
            "reused": reused_count,
        },
    }


def _write_manifest(path: Path, manifest: dict[str, Any]) -> None:
    output = path.expanduser()
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = output.with_name(f".{output.name}.tmp")
    payload = json.dumps(
        manifest,
        indent=2,
        sort_keys=True,
        ensure_ascii=True,
    )
    temporary.write_text(f"{payload}\n", encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(output)
    output.chmod(0o600)


def main(argv: Sequence[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)

    if not args.seed_key:
        parser.error("--seed-key must not be empty")

    _validate_database_url(parser, args.database_url)
    if args.assert_canonical_saver_path:
        _assert_canonical_checkpoint_path(parser)

    manifest = _seed(args.database_url, args.seed_key)
    _write_manifest(args.output_seed_manifest, manifest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
