from __future__ import annotations

import os

import pytest

_SKIPPED: list[str] = []


def pytest_runtest_logreport(report: pytest.TestReport) -> None:
    if report.skipped:
        _SKIPPED.append(report.nodeid)


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:  # noqa: ARG001
    if os.getenv("KETOS_REQUIRE_POSTGRES_BEHAVIORAL") == "1" and _SKIPPED:
        session.exitstatus = pytest.ExitCode.TESTS_FAILED


@pytest.fixture(scope="session", autouse=True)
def require_postgres_behavioral_uri() -> None:
    if os.getenv("KETOS_REQUIRE_POSTGRES_BEHAVIORAL") != "1":
        return
    uri = os.getenv("MVP_POSTGRES_URI") or os.getenv("KETOS_TEST_DATABASE_URI")
    if not uri or not uri.startswith(("postgresql://", "postgres://", "postgresql+psycopg://")):
        pytest.fail("BLOCKED: Stage-08 PostgreSQL behavioral URI is missing or not PostgreSQL")
