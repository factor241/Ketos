"""Contract tests for the disposable preferred-locale migration proof."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

SCRIPT_PATH = Path(__file__).parents[1] / "prove_preferred_locale_migration.py"


def load_script():
    spec = importlib.util.spec_from_file_location("preferred_locale_migration_proof", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        pytest.fail("unable to load preferred locale migration proof")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize(
    ("database_url", "expected"),
    [
        ("sqlite:///tmp/proof.db", "sqlite+aiosqlite:///tmp/proof.db"),
        ("sqlite+aiosqlite:///tmp/proof.db", "sqlite+aiosqlite:///tmp/proof.db"),
        (
            "postgresql://postgres:postgres@localhost/proof",
            "postgresql+psycopg://postgres:postgres@localhost/proof",
        ),
        (
            "postgresql+psycopg://postgres:postgres@localhost/proof",
            "postgresql+psycopg://postgres:postgres@localhost/proof",
        ),
    ],
)
def test_as_async_url_uses_repo_supported_drivers(database_url: str, expected: str) -> None:
    module = load_script()

    assert module.as_async_url(database_url) == expected  # noqa: S101


def test_as_async_url_rejects_unsupported_database() -> None:
    module = load_script()

    with pytest.raises(module.UnsupportedDatabaseError):
        module.as_async_url("mysql://localhost/proof")
