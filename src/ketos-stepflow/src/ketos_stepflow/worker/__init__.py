"""Stepflow worker components for Ketos execution.

Run the worker server with: python -m ketos_stepflow.worker
"""

import os

DEFAULT_OTEL_SERVICE_NAME = "ketos-stepflow"

# Importing ``ketos_stepflow.worker.__main__`` loads this package first. Set the
# identity here so the Stepflow SDK sees it before its modules or server exist.
os.environ.setdefault("STEPFLOW_SERVICE_NAME", DEFAULT_OTEL_SERVICE_NAME)
