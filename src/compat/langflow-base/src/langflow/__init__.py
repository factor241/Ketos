"""Legacy backend namespace delegating to the canonical :mod:`ketos` package."""

from __future__ import annotations

import importlib
import sys

from langflow_compat import install_aliases

install_aliases()
sys.modules[__name__] = importlib.import_module("ketos")
