from pathlib import Path

from pydantic import BaseModel, field_validator

from kfx.log.logger import logger
from kfx.utils.util_strings import is_valid_database_url, sanitize_database_url


class DatabaseSettings(BaseModel):
    """Database connection, pooling, and migration settings.

    Note: ``database_url`` is validated at the :class:`Settings` level because
    it reads ``data_dir`` from :class:`PathSettings`.
    """

    database_url: str | None = None
    """Database URL for Ketos. If not provided, Ketos will use a SQLite database.
    The driver shall be an async one like `sqlite+aiosqlite` (`sqlite` and `postgresql`
    will be automatically converted to the async drivers `sqlite+aiosqlite` and
    `postgresql+psycopg` respectively)."""

    database_connection_retry: bool = False
    """If True, Ketos will retry to connect to the database if it fails."""

    pool_size: int = 20
    """The number of connections to keep open in the connection pool.
    For high load scenarios, this should be increased based on expected concurrent users."""

    max_overflow: int = 30
    """The number of connections to allow that can be opened beyond the pool size.
    Should be 2x the pool_size for optimal performance under load."""

    db_connect_timeout: int = 30
    """The number of seconds to wait before giving up on a lock to released or establishing a connection to the
    database."""

    sqlite_pragmas: dict | None = {"synchronous": "NORMAL", "journal_mode": "WAL", "busy_timeout": 30000}
    """SQLite pragmas to use when connecting to the database."""

    db_driver_connection_settings: dict | None = None
    """Database driver connection settings."""

    db_connection_settings: dict | None = {
        "pool_size": 20,
        "max_overflow": 30,
        "pool_timeout": 30,
        "pool_pre_ping": True,
        "pool_recycle": 1800,
        "echo": False,
    }
    """Database connection settings optimized for high load scenarios.
    Note: These settings are most effective with PostgreSQL. For SQLite:
    - Reduce pool_size and max_overflow if experiencing lock contention
    - SQLite has limited concurrent write capability even with WAL mode
    - Best for read-heavy or moderate write workloads

    Settings:
    - pool_size: Number of connections to maintain (increase for higher concurrency)
    - max_overflow: Additional connections allowed beyond pool_size
    - pool_timeout: Seconds to wait for an available connection
    - pool_pre_ping: Validates connections before use to prevent stale connections
    - pool_recycle: Seconds before connections are recycled (prevents timeouts)
    - echo: Enable SQL query logging (development only)
    """

    use_noop_database: bool = False
    """If True, disables all database operations and uses a no-op session.
    Controlled by KETOS_USE_NOOP_DATABASE env variable."""

    @field_validator("use_noop_database", mode="before")
    @classmethod
    def set_use_noop_database(cls, value):
        if value:
            logger.info("Running with NOOP database session. All DB operations are disabled.")
        return value

    @field_validator("database_url", mode="before")
    @classmethod
    def set_database_url(cls, value, info):
        if value and not is_valid_database_url(value):
            sanitized = sanitize_database_url(value)
            msg = f"Invalid database_url provided: '{sanitized}'"
            raise ValueError(msg)

        if value is None:
            if not info.data.get("data_dir"):
                msg = "data_dir not set, please set it or provide a database_url"
                raise ValueError(msg)
            database_path = Path(info.data["data_dir"]) / "ketos.db"
            value = f"sqlite:///{database_path}"

        return value
