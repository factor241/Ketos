"""Legacy import root delegating to the canonical :mod:`kfx` package."""

from __future__ import annotations

import importlib
import sys

from lfx_compat import install_aliases

install_aliases()
sys.modules[__name__] = importlib.import_module("kfx")
