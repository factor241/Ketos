"""Identity-preserving compatibility namespace for :mod:`ketos_stepflow`."""

from __future__ import annotations

import importlib
import sys

from ._aliases import install_aliases

install_aliases()
canonical = importlib.import_module("ketos_stepflow")
canonical.LangflowConverter = canonical.KetosConverter
if "LangflowConverter" not in canonical.__all__:
    canonical.__all__ = [*canonical.__all__, "LangflowConverter"]
sys.modules[__name__] = canonical
