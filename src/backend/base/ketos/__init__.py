"""Ketos backend package.

The canonical ``custom``, ``io`` and ``schema`` facades live as normal Ketos
submodules.  Importing this package deliberately installs no compatibility
finder and creates no aliases for the retired namespace.
"""

from ketos.helpers.windows_postgres_helper import configure_windows_postgres_event_loop

configure_windows_postgres_event_loop(source="package_init")
