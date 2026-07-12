"""Logging module for kfx package."""

from kfx.log._streams import make_streams_resilient
from kfx.log.logger import configure, logger

make_streams_resilient()

__all__ = ["configure", "logger"]
