"""End-to-end contract for the ru/en preferred-locale cleanup migration."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

SCRIPT_PATH = Path(__file__).parents[1] / "prove_restrict_preferred_locale_to_ru_en.py"


def load_script():
    assert SCRIPT_PATH.exists(), "the ru/en preferred-locale migration proof script must exist"  # noqa: S101
    spec = importlib.util.spec_from_file_location("restrict_preferred_locale_migration_proof", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        pytest.fail("unable to load ru/en preferred-locale migration proof")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_disposable_sqlite_proof_rewrites_removed_locales_and_preserves_ru_en_null(tmp_path: Path) -> None:
    module = load_script()
    database_url = f"sqlite:///{tmp_path / 'proof.db'}"

    result = module.run_proof(database_url)

    assert result["revision"] == "9a6e34f1c2d8"  # noqa: S101
    assert result["before"] == [  # noqa: S101
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
    ]
    assert result["after_upgrade"] == [  # noqa: S101
        "en",
        "en",
        "en",
        "en",
        "en",
        "ru",
        "ru",
        "ru",
        "ru",
        "ru",
        "ru",
        "ru",
        None,
    ]
    assert result["after_downgrade"] == result["after_upgrade"]  # noqa: S101
    assert result["after_reupgrade"] == result["after_upgrade"]  # noqa: S101
    assert result["status"] == "PASS"  # noqa: S101


def test_database_identity_redacts_password_and_all_query_parameters() -> None:
    module = load_script()
    database_url = "postgresql://proof-user:proof-password@db.example/proof?sslmode=require&api_key=top-secret"

    identity = module.database_identity(database_url)

    assert identity == "postgresql://proof-user:***@db.example/proof"  # noqa: S101
    assert "proof-password" not in identity  # noqa: S101
    assert "top-secret" not in identity  # noqa: S101
    assert "?" not in identity  # noqa: S101
