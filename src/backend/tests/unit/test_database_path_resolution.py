"""Tests for database path resolution in settings.

These tests verify that the database path resolves only under KETOS_DATA_DIR.
"""

import os
from unittest.mock import patch


class TestDatabasePathResolution:
    """Test database path resolution in Settings."""

    def test_database_path_uses_data_dir_even_when_obsolete_save_flag_is_false(self, tmp_path):
        from kfx.services.settings.base import Settings

        env_vars = {
            "KETOS_CONFIG_DIR": str(tmp_path),
            "KETOS_DATA_DIR": str(tmp_path / "data"),
            "KETOS_SAVE_DB_IN_CONFIG_DIR": "false",
        }
        # Remove DATABASE_URL from env to trigger path resolution
        env = {k: v for k, v in os.environ.items() if k != "KETOS_DATABASE_URL"}
        env.update(env_vars)

        with patch.dict(os.environ, env, clear=True):
            settings = Settings()

        assert settings.database_url is not None
        assert settings.database_url == f"sqlite:///{tmp_path / 'data' / 'ketos.db'}"

    def test_database_path_uses_data_dir_even_when_obsolete_save_flag_is_true(self, tmp_path):
        from kfx.services.settings.base import Settings

        config_dir = tmp_path / "config"
        config_dir.mkdir()

        env_vars = {
            "KETOS_CONFIG_DIR": str(config_dir),
            "KETOS_DATA_DIR": str(tmp_path / "data"),
            "KETOS_SAVE_DB_IN_CONFIG_DIR": "true",
        }
        # Remove DATABASE_URL from env to trigger path resolution
        env = {k: v for k, v in os.environ.items() if k != "KETOS_DATABASE_URL"}
        env.update(env_vars)

        with patch.dict(os.environ, env, clear=True):
            settings = Settings()

        assert settings.database_url is not None
        assert settings.database_url == f"sqlite:///{tmp_path / 'data' / 'ketos.db'}"

    def test_database_path_does_not_import_ketos_package(self, tmp_path):
        """Database discovery is independent of installed package paths."""
        from kfx.services.settings.base import Settings

        env_vars = {
            "KETOS_CONFIG_DIR": str(tmp_path),
            "KETOS_DATA_DIR": str(tmp_path / "data"),
            "KETOS_SAVE_DB_IN_CONFIG_DIR": "false",
        }
        env = {k: v for k, v in os.environ.items() if k != "KETOS_DATABASE_URL"}
        env.update(env_vars)

        with patch.dict(os.environ, env, clear=True):
            settings = Settings()

        assert settings.database_url == f"sqlite:///{tmp_path / 'data' / 'ketos.db'}"

    def test_explicit_database_url_env_var_takes_precedence(self, tmp_path):
        """KETOS_DATABASE_URL env var should take precedence over path resolution."""
        from kfx.services.settings.base import Settings

        custom_url = "sqlite:///custom/path/test.db"

        with patch.dict(
            os.environ,
            {"KETOS_DATABASE_URL": custom_url, "KETOS_CONFIG_DIR": str(tmp_path)},
            clear=False,
        ):
            settings = Settings(config_dir=str(tmp_path))

        assert settings.database_url == custom_url
