"""Tests for database path resolution in settings.

These tests verify that the database path is correctly resolved
based on the save_db_in_config_dir setting and ketos package availability.
"""

import os
from pathlib import Path
from unittest.mock import patch


class TestDatabasePathResolution:
    """Test database path resolution in Settings."""

    def test_database_path_uses_ketos_package_when_save_db_in_config_dir_false(self, tmp_path):
        """When save_db_in_config_dir=False, database should be in ketos package dir."""
        import ketos
        from kfx.services.settings.base import Settings

        env_vars = {
            "KETOS_CONFIG_DIR": str(tmp_path),
            "KETOS_SAVE_DB_IN_CONFIG_DIR": "false",
        }
        # Remove DATABASE_URL from env to trigger path resolution
        env = {k: v for k, v in os.environ.items() if k != "KETOS_DATABASE_URL"}
        env.update(env_vars)

        with patch.dict(os.environ, env, clear=True):
            settings = Settings()

        expected_dir = Path(ketos.__file__).parent.resolve()
        assert settings.database_url is not None
        # The database_url should contain the ketos package path
        assert str(expected_dir) in settings.database_url

    def test_database_path_uses_config_dir_when_save_db_in_config_dir_true(self, tmp_path):
        """When save_db_in_config_dir=True, database should be in config_dir."""
        from kfx.services.settings.base import Settings

        config_dir = tmp_path / "config"
        config_dir.mkdir()

        env_vars = {
            "KETOS_CONFIG_DIR": str(config_dir),
            "KETOS_SAVE_DB_IN_CONFIG_DIR": "true",
        }
        # Remove DATABASE_URL from env to trigger path resolution
        env = {k: v for k, v in os.environ.items() if k != "KETOS_DATABASE_URL"}
        env.update(env_vars)

        with patch.dict(os.environ, env, clear=True):
            settings = Settings()

        assert settings.database_url is not None
        assert str(config_dir) in settings.database_url

    def test_database_path_falls_back_to_kfx_when_ketos_not_importable(self, tmp_path):
        """When ketos is not importable, should fall back to kfx package path."""
        import builtins

        import kfx.services.settings.base as settings_module
        from kfx.services.settings.base import Settings

        original_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name == "ketos":
                raise ImportError(name)
            return original_import(name, *args, **kwargs)

        env_vars = {
            "KETOS_CONFIG_DIR": str(tmp_path),
            "KETOS_SAVE_DB_IN_CONFIG_DIR": "false",
        }
        env = {k: v for k, v in os.environ.items() if k != "KETOS_DATABASE_URL"}
        env.update(env_vars)

        with (
            patch.dict(os.environ, env, clear=True),
            patch.object(builtins, "__import__", side_effect=mock_import),
        ):
            settings = Settings()

        # Should fall back to kfx path
        kfx_path = Path(settings_module.__file__).parent.parent.parent.resolve()
        assert settings.database_url is not None
        assert str(kfx_path) in settings.database_url

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
