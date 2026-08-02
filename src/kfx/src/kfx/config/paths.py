"""Canonical filesystem topology for Ketos.

The four roots are intentionally independent.  Callers may override each root
with its matching ``KETOS_*_DIR`` variable; no current-working-directory,
package-directory, or pre-cutover state is consulted.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from platformdirs import user_cache_path, user_config_path, user_data_path

from kfx.brand_env import resolve_brand_env

APP_NAME = "ketos"
APP_AUTHOR = "Ketos"


def _platform_roots() -> tuple[Path, Path, Path, Path]:
    config = Path(user_config_path(APP_NAME, APP_AUTHOR))
    data = Path(user_data_path(APP_NAME, APP_AUTHOR))
    # macOS maps config and data to the same Application Support directory.
    # Keep the public topology separate on every supported platform.
    if data == config:
        data /= "data"
    cache = Path(user_cache_path(APP_NAME, APP_AUTHOR))
    temp = Path(tempfile.gettempdir()) / APP_NAME
    return config, data, cache, temp


def _resolve(name: str, default: Path, *, create: bool = False) -> Path:
    raw = resolve_brand_env(name, "", sensitivity="public", conflict_policy="error").strip()
    path = Path(raw).expanduser() if raw else default
    path = path.resolve()
    if create:
        path.mkdir(parents=True, exist_ok=True)
    return path


def ketos_config_dir(*, create: bool = False) -> Path:
    return _resolve("CONFIG_DIR", _platform_roots()[0], create=create)


def ketos_data_dir(*, create: bool = False) -> Path:
    return _resolve("DATA_DIR", _platform_roots()[1], create=create)


def ketos_cache_dir(*, create: bool = False) -> Path:
    return _resolve("CACHE_DIR", _platform_roots()[2], create=create)


def ketos_temp_dir(*, create: bool = False) -> Path:
    return _resolve("TEMP_DIR", _platform_roots()[3], create=create)
