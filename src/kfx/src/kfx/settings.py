"""Settings constants for kfx package."""

from kfx.brand_env import get_brand_env_policy, resolve_brand_env

# Development mode flag - can be overridden by environment variable
_DEV_POLICY = get_brand_env_policy("DEV")
DEV = (
    resolve_brand_env(
        "DEV",
        "false",
        sensitivity=_DEV_POLICY.sensitivity,
        conflict_policy=_DEV_POLICY.conflict_policy,
    ).lower()
    == "true"
)
