from __future__ import annotations

from pathlib import Path

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


def test_old_environment_prefix_has_no_effect(tmp_path, monkeypatch):
    old_config = tmp_path / "old"
    monkeypatch.setenv(f"{_old_prefix()}_CONFIG_DIR", str(old_config))
    monkeypatch.delenv("KETOS_CONFIG_DIR", raising=False)

    settings = Settings()

    assert Path(settings.config_dir) != old_config
    assert not old_config.exists()


def test_default_database_never_uses_cwd_or_package(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("KETOS_DATA_DIR", str(tmp_path / "canonical-data"))
    monkeypatch.delenv("KETOS_DATABASE_URL", raising=False)
    (tmp_path / "ketos.db").write_bytes(b"pre-cutover")

    settings = Settings()

    assert settings.database_url == f"sqlite:///{tmp_path / 'canonical-data' / 'ketos.db'}"
    assert (tmp_path / "ketos.db").read_bytes() == b"pre-cutover"


def test_settings_source_is_ketos_only(monkeypatch):
    monkeypatch.setenv(f"{_old_prefix()}_PORT", "9999")
    monkeypatch.delenv("KETOS_PORT", raising=False)
    assert Settings().port != 9999
    monkeypatch.setenv("KETOS_PORT", "9998")
    assert Settings().port == 9998
