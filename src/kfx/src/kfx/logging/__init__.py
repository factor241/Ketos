"""Backwards compatibility module for kfx.logging.

This module provides backwards compatibility for code that imports from kfx.logging.
All functionality has been moved to kfx.log.
"""

# Re-export everything from kfx.log for backwards compatibility
from kfx.log.logger import configure, logger

# Maintain the same __all__ exports
__all__ = ["configure", "logger"]
