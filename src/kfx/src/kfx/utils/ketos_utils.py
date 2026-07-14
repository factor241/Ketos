"""Ketos environment utility functions."""

import importlib.util

from kfx.log.logger import logger


class _KetosModule:
    # Static variable
    # Tri-state:
    # - None: Ketos check not performed yet
    # - True: Ketos is available
    # - False: Ketos is not available
    _available = None

    @classmethod
    def is_available(cls):
        return cls._available

    @classmethod
    def set_available(cls, value):
        cls._available = value


def has_ketos_memory():
    """Check if ketos.memory (with database support) and MessageTable are available."""
    # TODO: REVISIT: Optimize this implementation later
    # - Consider refactoring to use lazy loading or a more robust service discovery mechanism
    #   that can handle runtime availability changes.

    # Use cached check from previous invocation (if applicable)

    is_ketos_available = _KetosModule.is_available()

    if is_ketos_available is not None:
        return is_ketos_available

    # First check (lazy load and cache check)

    module_spec = None

    try:
        module_spec = importlib.util.find_spec("ketos")
    except ImportError:
        pass
    except (TypeError, ValueError) as e:
        logger.error(f"Error encountered checking for ketos.memory: {e}")

    is_ketos_available = module_spec is not None
    _KetosModule.set_available(is_ketos_available)

    return is_ketos_available


def has_ketos_db_backend() -> bool:
    """Return True iff ketos-backed memory calls have a real DB to hit.

    Requires both ketos to be importable AND the registered database
    service to be a non-noop implementation. Evaluated on every call because
    the database service is typically registered *after* this module is first
    imported (e.g., from Component class definitions loaded before graph setup).
    """
    if not has_ketos_memory():
        return False
    from kfx.services.database.service import NoopDatabaseService
    from kfx.services.deps import get_db_service

    try:
        return not isinstance(get_db_service(), NoopDatabaseService)
    except Exception:  # noqa: BLE001
        return False
