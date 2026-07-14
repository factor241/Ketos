from __future__ import annotations

from pathlib import Path

import pytest
from kfx.services.settings import BrandEnvConflictError, BrandEnvLegacyWarning
from kfx.services.settings.base import Settings


def _old_prefix() -> str:
    return "LANG" + "FLOW"


def test_settings_use_four_separate_ketos_roots(tmp_path, monkeypatch):
    roots = {
        "CONFIG_DIR": tmp_path / "config",
        "DATA_DIR": tmp_path / "data",
        "CACHE_DIR": tmp_path / "cache",
        "TEMP_DIR": tmp_path / "temp",
    }
    for suffix, path in roots.items():
        monkeypatch.setenv(f"KETOS_{suffix}", str(path))
    monkeypatch.delenv("KETOS_DATABASE_URL", raising=False)

    settings = Settings()

    assert Path(settings.config_dir) == roots["CONFIG_DIR"]
    assert Path(settings.data_dir) == roots["DATA_DIR"]
    assert Path(settings.cache_dir) == roots["CACHE_DIR"]
    assert Path(settings.temp_dir) == roots["TEMP_DIR"]
    assert settings.database_url == f"sqlite:///{roots['DATA_DIR'] / 'ketos.db'}"
    assert Path(settings.knowledge_bases_dir) == roots["DATA_DIR"] / "knowledge_bases"
    assert len(set(roots.values())) == 4


def test_legacy_config_path_resolves_with_deprecation_and_canonical_precedence(tmp_path, monkeypatch):
    legacy_config = tmp_path / "legacy"
    canonical_config = tmp_path / "canonical"
    monkeypatch.setenv(f"{_old_prefix()}_CONFIG_DIR", str(legacy_config))
    monkeypatch.delenv("KETOS_CONFIG_DIR", raising=False)

    with pytest.warns(BrandEnvLegacyWarning) as caught:
        settings = Settings()

    assert Path(settings.config_dir) == legacy_config
    assert caught[0].message.event.canonical_name == "KETOS_CONFIG_DIR"
    assert caught[0].message.event.legacy_name == f"{_old_prefix()}_CONFIG_DIR"
    assert caught[0].message.event.selected == "legacy"

    monkeypatch.delenv(f"{_old_prefix()}_CONFIG_DIR")
    monkeypatch.setenv("KETOS_CONFIG_DIR", str(canonical_config))
    assert Path(Settings().config_dir) == canonical_config

    monkeypatch.setenv(f"{_old_prefix()}_CONFIG_DIR", str(canonical_config))
    assert Path(Settings().config_dir) == canonical_config


def test_default_database_never_uses_cwd_or_package(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("KETOS_DATA_DIR", str(tmp_path / "canonical-data"))
    monkeypatch.delenv("KETOS_DATABASE_URL", raising=False)
    (tmp_path / "ketos.db").write_bytes(b"pre-cutover")

    settings = Settings()

    assert settings.database_url == f"sqlite:///{tmp_path / 'canonical-data' / 'ketos.db'}"
    assert (tmp_path / "ketos.db").read_bytes() == b"pre-cutover"


def test_settings_source_supports_dual_names_and_rejects_unprefixed_environment_aliases(monkeypatch):
    monkeypatch.setenv(f"{_old_prefix()}_PORT", "9999")
    monkeypatch.delenv("KETOS_PORT", raising=False)

    with pytest.warns(BrandEnvLegacyWarning):
        assert Settings().port == 9999

    monkeypatch.delenv(f"{_old_prefix()}_PORT")
    monkeypatch.setenv("KETOS_PORT", "9998")
    assert Settings().port == 9998

    monkeypatch.setenv(f"{_old_prefix()}_PORT", "9998")
    assert Settings().port == 9998

    canonical_database = "postgresql://canonical-user:canonical-password@db/canonical"
    legacy_database = "postgresql://legacy-user:legacy-password@db/legacy"
    monkeypatch.setenv("KETOS_DATABASE_URL", canonical_database)
    monkeypatch.setenv(f"{_old_prefix()}_DATABASE_URL", legacy_database)

    with pytest.raises(BrandEnvConflictError) as caught:
        Settings()

    diagnostic = caught.value
    assert diagnostic.event.canonical_name == "KETOS_DATABASE_URL"
    assert diagnostic.event.legacy_name == f"{_old_prefix()}_DATABASE_URL"
    assert diagnostic.event.sensitivity == "secret"
    assert canonical_database not in str(diagnostic)
    assert legacy_database not in str(diagnostic)
    assert "canonical-password" not in repr(diagnostic)
    assert "legacy-password" not in repr(diagnostic)

    monkeypatch.delenv("KETOS_DATABASE_URL")
    monkeypatch.delenv(f"{_old_prefix()}_DATABASE_URL")
    monkeypatch.delenv("KETOS_PORT")
    monkeypatch.delenv(f"{_old_prefix()}_PORT")
    monkeypatch.setenv("PORT", "9997")
    assert Settings().port != 9997


def test_canonical_path_helpers_use_the_same_dual_brand_resolver(tmp_path, monkeypatch):
    from kfx.config.paths import ketos_config_dir

    legacy = tmp_path / "legacy-config"
    canonical = tmp_path / "canonical-config"
    monkeypatch.delenv("KETOS_CONFIG_DIR", raising=False)
    monkeypatch.setenv(f"{_old_prefix()}_CONFIG_DIR", str(legacy))

    with pytest.warns(BrandEnvLegacyWarning):
        assert ketos_config_dir() == legacy

    monkeypatch.setenv("KETOS_CONFIG_DIR", str(canonical))
    with pytest.raises(BrandEnvConflictError):
        ketos_config_dir()
