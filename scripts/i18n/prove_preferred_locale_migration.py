"""Prove preferred_locale migration and CRUD on a disposable database.

The command is intentionally destructive: it upgrades, downgrades one named
revision, and upgrades again. It therefore requires an explicit disposable-DB
acknowledgement and never reads the application's configured database URL.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from alembic import command
from alembic.config import Config
from ketos.services.database.models.user.model import User
from sqlalchemy import inspect
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel.ext.asyncio.session import AsyncSession

REVISION = "bb693ad2fbab"
DOWN_REVISION = "e1705947c729"
REPO_ROOT = Path(__file__).resolve().parents[2]
ALEMBIC_ROOT = REPO_ROOT / "src" / "backend" / "base" / "ketos"


class UnsupportedDatabaseError(ValueError):
    """Raised when the proof receives a non-SQLite/PostgreSQL URL."""


class MigrationProofError(RuntimeError):
    """Raised when a migration or CRUD invariant is not satisfied."""


def as_async_url(database_url: str) -> str:
    if database_url.startswith("sqlite+aiosqlite:"):
        return database_url
    if database_url.startswith("sqlite:"):
        return database_url.replace("sqlite:", "sqlite+aiosqlite:", 1)
    if database_url.startswith("postgresql+psycopg:"):
        return database_url
    if database_url.startswith("postgresql:"):
        return database_url.replace("postgresql:", "postgresql+psycopg:", 1)
    raise UnsupportedDatabaseError


def alembic_config(database_url: str) -> Config:
    config = Config(str(ALEMBIC_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ALEMBIC_ROOT / "alembic"))
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    return config


async def has_preferred_locale_column(database_url: str) -> bool:
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as connection:
            columns = await connection.run_sync(lambda sync: inspect(sync).get_columns("user"))
        return any(column["name"] == "preferred_locale" for column in columns)
    finally:
        await engine.dispose()


async def prove_crud(database_url: str) -> list[str | None]:
    engine = create_async_engine(database_url)
    observed: list[str | None] = []
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            user = User(
                username=f"locale-migration-proof-{uuid4()}",
                password="not-a-real-hash",  # noqa: S106
                is_active=True,
            )
            session.add(user)
            await session.flush()

            for locale in ("ru", "en", "ru", None):
                user.preferred_locale = locale
                await session.flush()
                await session.refresh(user)
                observed.append(user.preferred_locale)

            await session.commit()
    finally:
        await engine.dispose()
    return observed


async def database_server_version(database_url: str) -> str:
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as connection:
            version = await connection.run_sync(lambda sync: sync.dialect.server_version_info)
        return ".".join(str(part) for part in version) if version else "unknown"
    finally:
        await engine.dispose()


def run_proof(database_url: str) -> dict[str, object]:
    async_url = as_async_url(database_url)
    config = alembic_config(async_url)

    command.upgrade(config, REVISION)
    upgrade_has_column = asyncio.run(has_preferred_locale_column(async_url))
    observed = asyncio.run(prove_crud(async_url))

    command.downgrade(config, DOWN_REVISION)
    downgrade_has_column = asyncio.run(has_preferred_locale_column(async_url))

    command.upgrade(config, REVISION)
    reupgrade_has_column = asyncio.run(has_preferred_locale_column(async_url))

    expected_crud = ["ru", "en", "ru", None]
    if not upgrade_has_column or downgrade_has_column or not reupgrade_has_column or observed != expected_crud:
        raise MigrationProofError

    parsed_url = make_url(async_url)
    return {
        "schema_version": 1,
        "executed_at": datetime.now(timezone.utc).isoformat(),
        "database": parsed_url.render_as_string(hide_password=True),
        "dialect": parsed_url.get_backend_name(),
        "database_server_version": asyncio.run(database_server_version(async_url)),
        "revision": REVISION,
        "upgrade_has_column": upgrade_has_column,
        "downgrade_has_column": downgrade_has_column,
        "reupgrade_has_column": reupgrade_has_column,
        "crud_sequence": observed,
        "status": "PASS",
    }


def write_evidence(result: dict[str, object], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--output", type=Path, help="Write redacted JSON evidence to this path.")
    parser.add_argument(
        "--confirm-disposable",
        action="store_true",
        help="Required acknowledgement that the target database may be migrated destructively.",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if not args.confirm_disposable:
        parser.error("Refusing to run without --confirm-disposable")
    result = run_proof(args.database_url)
    if args.output is not None:
        write_evidence(result, args.output)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
