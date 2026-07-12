"""Unit tests for the isolation config layer of the FileSystem tool.

The config layer owns ONE responsibility: turn environment configuration into a
frozen ``IsolationConfig`` so the component code can treat it as immutable data.

Single env var: ``KETOS_FS_TOOL_BASE_DIR``. Pepper file is auto-derived under
``<base>/.fs_pepper``. Behavior (shared vs isolated) is decided by the
component at call time based on ``AUTO_LOGIN``, NOT by the config.
"""

from __future__ import annotations

from pathlib import Path

import pytest


class TestLoadIsolationConfig:
    """``load_isolation_config`` reads env vars into a frozen ``IsolationConfig``."""

    def test_should_default_base_dir_under_default_config_dir_when_env_var_unset(self, tmp_path: Path) -> None:
        from kfx.components.files_and_knowledge._filesystem_isolation import load_isolation_config

        config = load_isolation_config(env={}, default_config_dir=tmp_path)

        assert config.base_dir == (tmp_path / "fs_sandbox").resolve()

    def test_should_derive_pepper_path_under_base_dir(self, tmp_path: Path) -> None:
        from kfx.components.files_and_knowledge._filesystem_isolation import load_isolation_config

        config = load_isolation_config(env={}, default_config_dir=tmp_path)

        assert config.pepper_path == (tmp_path / "fs_sandbox" / ".fs_pepper").resolve()

    def test_should_override_base_dir_when_env_var_is_set(self, tmp_path: Path) -> None:
        from kfx.components.files_and_knowledge._filesystem_isolation import load_isolation_config

        custom_base = tmp_path / "custom_root"
        env = {"KETOS_FS_TOOL_BASE_DIR": str(custom_base)}

        config = load_isolation_config(env=env, default_config_dir=tmp_path)

        assert config.base_dir == custom_base.resolve()

    def test_should_track_pepper_path_under_overridden_base_dir(self, tmp_path: Path) -> None:
        from kfx.components.files_and_knowledge._filesystem_isolation import load_isolation_config

        custom_base = tmp_path / "custom_root"
        env = {"KETOS_FS_TOOL_BASE_DIR": str(custom_base)}

        config = load_isolation_config(env=env, default_config_dir=tmp_path)

        assert config.pepper_path == (custom_base / ".fs_pepper").resolve()

    def test_should_treat_empty_base_dir_env_var_as_unset(self, tmp_path: Path) -> None:
        # Empty env var must NOT make the component fail closed at config-read
        # time — falling back to the default keeps OSS / desktop installs alive
        # when an operator clears the var without thinking.
        from kfx.components.files_and_knowledge._filesystem_isolation import load_isolation_config

        env = {"KETOS_FS_TOOL_BASE_DIR": ""}

        config = load_isolation_config(env=env, default_config_dir=tmp_path)

        assert config.base_dir == (tmp_path / "fs_sandbox").resolve()

    def test_should_be_immutable(self, tmp_path: Path) -> None:
        # The config is read once per call and threaded through every helper;
        # mutating it mid-flight would invite TOCTOU bugs where one operation
        # sees one base_dir and another sees a different one.
        from kfx.components.files_and_knowledge._filesystem_isolation import load_isolation_config

        config = load_isolation_config(env={}, default_config_dir=tmp_path)

        with pytest.raises((AttributeError, TypeError)):
            config.base_dir = tmp_path / "other"  # type: ignore[misc]

    def test_runtime_filesystem_default_tracks_live_ketos_data_dir(self, tmp_path: Path, monkeypatch) -> None:
        from kfx.components.files_and_knowledge.filesystem import FileSystemToolComponent

        monkeypatch.delenv("KETOS_FS_TOOL_BASE_DIR", raising=False)
        first_data = tmp_path / "first-data"
        second_data = tmp_path / "second-data"

        monkeypatch.setenv("KETOS_DATA_DIR", str(first_data))
        component = FileSystemToolComponent(root_path="", read_only=False)
        first = component._isolation_config()

        monkeypatch.setenv("KETOS_DATA_DIR", str(second_data))
        second = component._isolation_config()

        suffix = Path("assistant") / "fs_sandbox"
        assert first.base_dir == (first_data / suffix).resolve()
        assert second.base_dir == (second_data / suffix).resolve()
        assert first.base_dir != second.base_dir
