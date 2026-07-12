# Backwards compatibility module for ketos.schema.graph
# This module redirects imports to the new kfx.schema.graph module

from kfx.schema.graph import InputValue, Tweaks

__all__ = ["InputValue", "Tweaks"]
