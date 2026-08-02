"""Prove the ru/en preferred-locale cleanup on a disposable database.

The command upgrades to the locale-column revision, inserts representative
legacy values, then performs upgrade -> downgrade -> upgrade for the cleanup
revision. It therefore requires an explicit disposable-database acknowledgement
and never reads the application's configured database URL.
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
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

REVISION = "9a6e34f1c2d8"
DOWN_REVISION = "bb693ad2fbab"
FIXTURE_LOCALES = (
    "en",
    "en-US",
    "EN_us",
    " en-US ",
    " EN ",
    "english",
    "fr",
    "pt-BR",
    "ru",
    "ru-RU",
    "RU_ru",
    "zh-CN",
    None,
)
EXPECTED_LOCALES = ("en", "en", "en", "en", "en", "ru", "ru", "ru", "ru", "ru", "ru", "ru", None)
REPO_ROOT = Path(__file__).resolve().parents[2]
ALEMBIC_ROOT = REPO_ROOT / "src" / "backend" / "base" / "ketos"


class UnsupportedDatabaseError(ValueError):
    """Raised when the proof receives a non-SQLite/PostgreSQL URL."""


class MigrationProofError(RuntimeError):
    """Raised when migrated values do not satisfy the ru/en contract."""


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


def database_identity(database_url: str) -> str:
    parsed_url = make_url(database_url)
    return parsed_url.set(query={}).render_as_string(hide_password=True)


async def insert_fixtures(database_url: str, prefix: str) -> None:
    engine = create_async_engine(database_url)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            for index, locale in enumerate(FIXTURE_LOCALES):
                session.add(
                    User(
                        username=f"{prefix}-{index:02d}",
                        password="not-a-real-hash",  # noqa: S106
                        preferred_locale=locale,
                    )
                )
            await session.commit()
    finally:
        await engine.dispose()


async def read_fixtures(database_url: str, prefix: str) -> list[str | None]:
    engine = create_async_engine(database_url)
    try:
        async with AsyncSession(engine) as session:
            statement = select(User.preferred_locale).where(User.username.like(f"{prefix}-%")).order_by(User.username)
            return list((await session.exec(statement)).all())
    finally:
        await engine.dispose()


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
    prefix = f"locale-cleanup-proof-{uuid4()}"

    command.upgrade(config, DOWN_REVISION)
    asyncio.run(insert_fixtures(async_url, prefix))
    before = asyncio.run(read_fixtures(async_url, prefix))

    command.upgrade(config, REVISION)
    after_upgrade = asyncio.run(read_fixtures(async_url, prefix))

    command.downgrade(config, DOWN_REVISION)
    after_downgrade = asyncio.run(read_fixtures(async_url, prefix))

    command.upgrade(config, REVISION)
    after_reupgrade = asyncio.run(read_fixtures(async_url, prefix))

    expected_before = list(FIXTURE_LOCALES)
    expected_after = list(EXPECTED_LOCALES)
    if (
        before != expected_before
        or after_upgrade != expected_after
        or after_downgrade != expected_after
        or after_reupgrade != expected_after
    ):
        raise MigrationProofError

    parsed_url = make_url(async_url)
    return {
        "schema_version": 1,
        "executed_at": datetime.now(timezone.utc).isoformat(),
        "database": database_identity(async_url),
        "dialect": parsed_url.get_backend_name(),
        "database_server_version": asyncio.run(database_server_version(async_url)),
        "revision": REVISION,
        "before": before,
        "after_upgrade": after_upgrade,
        "after_downgrade": after_downgrade,
        "after_reupgrade": after_reupgrade,
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
