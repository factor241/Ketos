"""Exceptions raised by the Ketos SDK."""

from __future__ import annotations


class KetosError(Exception):
    """Base class for all Ketos SDK errors."""


class KetosHTTPError(KetosError):
    """An HTTP error was returned by the Ketos API."""

    def __init__(self, status_code: int, detail: str) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"HTTP {status_code}: {detail}")


class KetosNotFoundError(KetosHTTPError):
    """The requested resource was not found (404)."""


class KetosAuthError(KetosHTTPError):
    """Authentication failed (401/403)."""


class KetosValidationError(KetosHTTPError):
    """The request payload was rejected by the server (422)."""


class KetosConnectionError(KetosError):
    """Could not connect to the Ketos instance."""


class KetosTimeoutError(KetosError):
    """A background job or polling operation exceeded its timeout.

    Adapted from ``KetosV2TimeoutError`` in ketos-ai/sdk PR #1
    (Janardan Singh Kavia, IBM Corp., Apache 2.0).
    """


class KetosEnvironmentNotFoundError(KetosError):
    """The named environment is not defined in the environments config."""

    def __init__(self, name: str) -> None:
        self.name = name
        super().__init__(f"Environment {name!r} not found. Check your ketos-environments.toml (or KETOS_ENV variable).")


class KetosEnvironmentConfigError(KetosError):
    """The environments config file is malformed or missing required fields."""
