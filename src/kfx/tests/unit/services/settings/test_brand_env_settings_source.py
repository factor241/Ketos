"""Integration tests for branded Pydantic settings sources and direct validators."""

from __future__ import annotations

import importlib
import warnings
from types import SimpleNamespace

import pytest
from kfx.services.settings.auth import AuthSettings
from kfx.services.settings.base import Settings
from kfx.services.settings.constants import AGENTIC_VARIABLES
from kfx.services.settings.groups.components import ComponentsSettings
from kfx.services.settings.groups.database import DatabaseSettings
from kfx.services.settings.groups.variables import VariablesSettings


def _brand_env_module():
    return importlib.import_module("kfx.services.settings.brand_env")


@pytest.fixture(autouse=True)
def _clean_branded_environment(monkeypatch):
    for name in list(importlib.import_module("os").environ):
        if name.startswith(("KETOS_", "LANGFLOW_")):
            monkeypatch.delenv(name, raising=False)


def _configure_paths(monkeypatch, tmp_path):
    for suffix, child in (
        ("CONFIG_DIR", "config"),
        ("DATA_DIR", "data"),
        ("TEMP_DIR", "temp"),
        ("KNOWLEDGE_BASES_DIR", "knowledge"),
    ):
        monkeypatch.setenv(f"KETOS_{suffix}", str(tmp_path / child))


def _legacy_warnings(caught, canonical_name):
    module = _brand_env_module()
    return [
        item
        for item in caught
        if isinstance(item.message, module.BrandEnvLegacyWarning)
        and item.message.event.canonical_name == canonical_name
    ]


def test_settings_parses_legacy_values_with_existing_pydantic_types(monkeypatch, tmp_path):
    _configure_paths(monkeypatch, tmp_path)
    monkeypatch.setenv("LANGFLOW_PORT", "8123")
    monkeypatch.setenv("LANGFLOW_OPEN_BROWSER", "true")
    monkeypatch.setenv("LANGFLOW_KB_ALLOWED_FOLDER_ROOTS", "/one,/two")
    monkeypatch.setenv("LANGFLOW_SQLITE_PRAGMAS", '{"journal_mode":"DELETE","busy_timeout":10}')

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        settings = Settings()

    assert settings.port == 8123
    assert settings.open_browser is True
    assert settings.kb_allowed_folder_roots == ["/one", "/two"]
    assert settings.sqlite_pragmas == {"journal_mode": "DELETE", "busy_timeout": 10}


def test_settings_environment_remains_before_explicit_init(monkeypatch, tmp_path):
    _configure_paths(monkeypatch, tmp_path)
    monkeypatch.setenv("KETOS_PORT", "8123")

    assert Settings(port=7000).port == 8123


def test_warn_policy_selects_canonical_on_unequal_dual_values(monkeypatch, tmp_path):
    _configure_paths(monkeypatch, tmp_path)
    monkeypatch.setenv("KETOS_LOG_LEVEL", "debug")
    monkeypatch.setenv("LANGFLOW_LOG_LEVEL", "info")
    module = _brand_env_module()

    with pytest.warns(module.BrandEnvConflictWarning):
        settings = Settings()

    assert settings.log_level == "debug"


def test_error_policy_rejects_unequal_dual_values(monkeypatch, tmp_path):
    _configure_paths(monkeypatch, tmp_path)
    monkeypatch.setenv("KETOS_PORT", "8123")
    monkeypatch.setenv("LANGFLOW_PORT", "8124")
    module = _brand_env_module()

    with pytest.raises(module.BrandEnvConflictError):
        Settings()


def test_equal_dual_error_policy_value_is_accepted(monkeypatch, tmp_path):
    _configure_paths(monkeypatch, tmp_path)
    monkeypatch.setenv("KETOS_PORT", "8123")
    monkeypatch.setenv("LANGFLOW_PORT", "8123")

    assert Settings().port == 8123


def test_database_legacy_only_emits_one_warning(monkeypatch, tmp_path):
    _configure_paths(monkeypatch, tmp_path)
    monkeypatch.setenv("LANGFLOW_DATABASE_URL", "sqlite:///legacy.db")

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        settings = Settings()

    assert settings.database_url == "sqlite:///legacy.db"
    assert len(_legacy_warnings(caught, "KETOS_DATABASE_URL")) == 1


def test_components_path_legacy_only_emits_one_warning(monkeypatch, tmp_path):
    _configure_paths(monkeypatch, tmp_path)
    legacy_components = tmp_path / "legacy-components"
    legacy_components.mkdir()
    monkeypatch.setenv("LANGFLOW_COMPONENTS_PATH", str(legacy_components))

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        settings = Settings()

    assert str(legacy_components) in settings.components_path
    assert len(_legacy_warnings(caught, "KETOS_COMPONENTS_PATH")) == 1


def test_agentic_experience_legacy_only_emits_one_warning(monkeypatch, tmp_path):
    _configure_paths(monkeypatch, tmp_path)
    monkeypatch.setenv("LANGFLOW_AGENTIC_EXPERIENCE", "true")

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        settings = Settings()

    assert settings.agentic_experience is True
    assert set(AGENTIC_VARIABLES).issubset(settings.variables_to_get_from_environment)
    assert len(_legacy_warnings(caught, "KETOS_AGENTIC_EXPERIENCE")) == 1


def test_auth_source_parses_legacy_values_but_explicit_init_wins(monkeypatch, tmp_path):
    explicit_config = tmp_path / "explicit"
    explicit_config.mkdir()
    monkeypatch.setenv("KETOS_CONFIG_DIR", str(tmp_path / "environment"))
    monkeypatch.setenv("LANGFLOW_ACCESS_TOKEN_EXPIRE_SECONDS", "42")
    monkeypatch.setenv("LANGFLOW_AUTO_LOGIN", "false")

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        settings = AuthSettings(CONFIG_DIR=str(explicit_config))

    assert str(explicit_config) == settings.CONFIG_DIR
    assert settings.ACCESS_TOKEN_EXPIRE_SECONDS == 42
    assert settings.AUTO_LOGIN is False


def test_unprefixed_ui_alias_is_not_an_environment_fallback(monkeypatch, tmp_path):
    _configure_paths(monkeypatch, tmp_path)
    monkeypatch.setenv("HIDE_GETTING_STARTED_PROGRESS", "true")

    assert Settings().hide_getting_started_progress is False


def test_database_direct_validator_uses_already_resolved_value(monkeypatch, tmp_path):
    monkeypatch.setenv("KETOS_DATABASE_URL", "sqlite:///canonical.db")
    monkeypatch.setenv("LANGFLOW_DATABASE_URL", "sqlite:///legacy.db")
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        value = DatabaseSettings.set_database_url(
            "sqlite:///already-resolved.db", SimpleNamespace(data={"data_dir": str(tmp_path)})
        )

    assert value == "sqlite:///already-resolved.db"
    assert _legacy_warnings(caught, "KETOS_DATABASE_URL") == []


def test_database_direct_validator_does_not_read_legacy_environment(monkeypatch, tmp_path):
    monkeypatch.setenv("LANGFLOW_DATABASE_URL", "sqlite:///legacy.db")
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        value = DatabaseSettings.set_database_url(
            "sqlite:///legacy.db", SimpleNamespace(data={"data_dir": str(tmp_path)})
        )

    assert value == "sqlite:///legacy.db"
    assert _legacy_warnings(caught, "KETOS_DATABASE_URL") == []


def test_components_direct_validator_uses_silent_origin_lookup(monkeypatch, tmp_path):
    legacy = tmp_path / "legacy"
    legacy.mkdir()
    monkeypatch.setenv("LANGFLOW_COMPONENTS_PATH", str(legacy))
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        result = ComponentsSettings.set_components_path([])

    assert result == [str(legacy)]
    assert _legacy_warnings(caught, "KETOS_COMPONENTS_PATH") == []


def test_components_override_enforcer_recognizes_legacy_source(monkeypatch, tmp_path):
    _configure_paths(monkeypatch, tmp_path)
    monkeypatch.setenv("KETOS_ALLOW_CUSTOM_COMPONENTS", "false")
    monkeypatch.setenv("KETOS_ALLOW_COMPONENTS_PATHS_OVERRIDE", "false")
    monkeypatch.setenv("LANGFLOW_COMPONENTS_INDEX_PATH", "/legacy/index.json")

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        settings = Settings()

    assert settings.components_index_path is None


def test_variables_direct_model_uses_already_resolved_agentic_value(monkeypatch):
    monkeypatch.setenv("KETOS_AGENTIC_EXPERIENCE", "false")
    monkeypatch.setenv("LANGFLOW_AGENTIC_EXPERIENCE", "true")
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        settings = VariablesSettings(agentic_experience=False)

    assert settings.agentic_experience is False
    assert set(settings.variables_to_get_from_environment).isdisjoint(AGENTIC_VARIABLES)
    assert _legacy_warnings(caught, "KETOS_AGENTIC_EXPERIENCE") == []


def test_variables_direct_model_honors_resolved_true_without_env_lookup(monkeypatch):
    monkeypatch.setenv("LANGFLOW_AGENTIC_EXPERIENCE", "false")

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        settings = VariablesSettings(agentic_experience=True)

    assert set(AGENTIC_VARIABLES).issubset(settings.variables_to_get_from_environment)


def test_unknown_field_in_brand_source_fails_closed():
    from pydantic_settings import BaseSettings, PydanticBaseSettingsSource

    source_class = _brand_env_module().BrandEnvSettingsSource

    class UnknownSettings(BaseSettings):
        unknown_field: str = "default"

        @classmethod
        def settings_customise_sources(
            cls,
            settings_cls,
            init_settings,
            env_settings,
            dotenv_settings,
            file_secret_settings,
        ) -> tuple[PydanticBaseSettingsSource, ...]:
            del env_settings, dotenv_settings, file_secret_settings
            return (source_class(settings_cls), init_settings)

    error = _brand_env_module().UnclassifiedBrandEnvError
    with pytest.raises(error, match="UNKNOWN_FIELD"):
        UnknownSettings()
