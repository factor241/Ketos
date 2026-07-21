from __future__ import annotations

import os
import sys
from uuid import uuid4

import sqlalchemy as sa


def _postgres_uri() -> str:
    uri = os.environ.get("MVP_POSTGRES_URI", "")
    if uri.startswith("postgresql://"):
        return uri.replace("postgresql://", "postgresql+psycopg://", 1)
    if uri.startswith("postgres://"):
        return uri.replace("postgres://", "postgresql+psycopg://", 1)
    return uri


def main() -> int:
    uri = _postgres_uri()
    if not uri:
        print("BLOCKED: MVP_POSTGRES_URI is empty", file=sys.stderr)
        return 42
    database_name = f"ketos_s08_preflight_{uuid4().hex[:10]}"
    created = False
    engine = None
    try:
        url = sa.engine.make_url(uri)
        if url.get_backend_name() != "postgresql":
            print("BLOCKED: MVP_POSTGRES_URI is not PostgreSQL", file=sys.stderr)
            return 42
        admin_uri = url.set(database="postgres").render_as_string(hide_password=False)
        engine = sa.create_engine(admin_uri, isolation_level="AUTOCOMMIT")
        with engine.connect() as connection:
            connection.exec_driver_sql("SELECT 1")
            connection.exec_driver_sql(f'CREATE DATABASE "{database_name}"')
            created = True
        with engine.connect() as connection:
            connection.execute(
                sa.text("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :name"),
                {"name": database_name},
            )
            connection.exec_driver_sql(f'DROP DATABASE "{database_name}"')
            created = False
    except Exception as exc:  # noqa: BLE001 - every provisioning failure is a truthful blocker
        print(f"BLOCKED: PostgreSQL provisioning preflight failed ({type(exc).__name__})", file=sys.stderr)
        return 42
    finally:
        if engine is not None:
            if created:
                try:
                    with engine.connect() as connection:
                        connection.execute(
                            sa.text(
                                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :name"
                            ),
                            {"name": database_name},
                        )
                        connection.exec_driver_sql(f'DROP DATABASE IF EXISTS "{database_name}"')
                except (sa.exc.SQLAlchemyError, OSError, ValueError):
                    print("BLOCKED: PostgreSQL preflight cleanup could not confirm database removal", file=sys.stderr)
            engine.dispose()
    print("PostgreSQL provisioning preflight: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
