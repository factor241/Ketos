"""Settings constants for kfx package."""

import os

# Development mode flag - can be overridden by environment variable
DEV = os.getenv("KETOS_DEV", "false").lower() == "true"
