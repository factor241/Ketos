from kfx.brand_env import resolve_brand_env

DEV = (
    resolve_brand_env(
        "DEV",
        "false",
        sensitivity="public",
        conflict_policy="error",
    ).lower()
    == "true"
)


def _set_dev(value) -> None:
    global DEV  # noqa: PLW0603
    DEV = value


def set_dev(value) -> None:
    _set_dev(value)
