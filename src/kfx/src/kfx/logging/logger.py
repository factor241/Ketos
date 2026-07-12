"""Backwards compatibility module for kfx.logging.logger.

This module provides backwards compatibility for code that imports from kfx.logging.logger.
All functionality has been moved to kfx.log.logger.
"""

# Ensure we maintain all the original exports
from kfx.log.logger import (
    InterceptHandler,
    LogConfig,
    configure,
    logger,
    setup_gunicorn_logger,
    setup_uvicorn_logger,
)

__all__ = [
    "InterceptHandler",
    "LogConfig",
    "configure",
    "logger",
    "setup_gunicorn_logger",
    "setup_uvicorn_logger",
]
