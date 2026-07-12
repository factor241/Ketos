"""Shared helpers for TOML-based plugin discovery."""

from __future__ import annotations

import importlib
from pathlib import Path
from typing import Any

from kfx.config.paths import ketos_config_dir
from kfx.log.logger import logger


def resolve_config_dir(config_dir: Path | str | None, *, settings_service: Any | None = None) -> Path:
    """Resolve config directory using explicit value, settings, then Ketos config home.

    Resolution order:
    1. ``config_dir`` argument (if provided)
    2. ``settings_service.settings.config_dir`` (if present)
    3. Canonical Ketos config directory
    """
    if config_dir is not None:
        return Path(config_dir)

    settings = getattr(settings_service, "settings", None)
    settings_config_dir = getattr(settings, "config_dir", None)
    if settings_config_dir:
        return Path(settings_config_dir)

    default_dir = ketos_config_dir()
    logger.debug(f"No config_dir provided and no settings config_dir found; using Ketos config: {default_dir}")
    return default_dir


def get_preferred_config_source(
    config_dir: Path,
    *,
    kfx_root_path: tuple[str, ...],
    pyproject_root_path: tuple[str, ...],
) -> tuple[Path, tuple[str, ...]] | None:
    """Return first available config source, preferring ``kfx.toml``."""
    kfx_config = config_dir / "kfx.toml"
    if kfx_config.exists():
        return kfx_config, kfx_root_path

    pyproject_config = config_dir / "pyproject.toml"
    if pyproject_config.exists():
        return pyproject_config, pyproject_root_path

    return None


def load_toml_config(config_path: Path) -> dict[str, Any] | None:
    """Load TOML payload from disk and return it as dict, or ``None`` on failure."""
    try:
        import tomllib as tomli  # Python 3.11+
    except ImportError:
        import tomli  # Python 3.10

    try:
        with config_path.open("rb") as file_handle:
            return tomli.load(file_handle)
    except (ValueError, OSError) as exc:
        logger.warning(f"Failed to load config from {config_path}: {exc}")
        return None


def get_nested_section(config: dict[str, Any], path: tuple[str, ...]) -> dict[str, Any] | None:
    """Safely resolve nested dictionary section in TOML payloads."""
    node: Any = config
    for key in path:
        if not isinstance(node, dict):
            return None
        node = node.get(key)
    return node if isinstance(node, dict) else None


def load_object_from_import_path(
    import_path: Any,
    *,
    object_kind: str,
    object_key: str,
) -> Any | None:
    """Load a Python object from ``module:attribute`` import path.

    Returns ``None`` on invalid format or import resolution failures.
    """
    if not isinstance(import_path, str) or ":" not in import_path:
        logger.warning(f"Invalid {object_kind} path for key='{object_key}': '{import_path}'. Expected 'module:class'.")
        return None

    try:
        module_path, attribute_name = import_path.split(":", 1)
        module = importlib.import_module(module_path)
        return getattr(module, attribute_name)
    except (ModuleNotFoundError, AttributeError) as exc:
        logger.warning(f"Failed to load {object_kind} for key='{object_key}' from '{import_path}': {exc}")
        return None
    except (ImportError, SyntaxError) as exc:
        logger.error(
            f"Failed to import {object_kind} for key='{object_key}' from '{import_path}': {exc}",
            exc_info=True,
        )
        return None
    except Exception:
        logger.exception(
            f"Unexpected error loading {object_kind} for key='{object_key}' from '{import_path}'. "
            f"This may indicate a bug in the module or a misconfigured import path."
        )
        raise
