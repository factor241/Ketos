"""Legacy exception names backed by canonical exception objects."""

from ketos_sdk.exceptions import (
    KetosAuthError,
    KetosConnectionError,
    KetosEnvironmentConfigError,
    KetosEnvironmentNotFoundError,
    KetosError,
    KetosHTTPError,
    KetosNotFoundError,
    KetosTimeoutError,
    KetosValidationError,
)

LangflowError = KetosError
LangflowHTTPError = KetosHTTPError
LangflowNotFoundError = KetosNotFoundError
LangflowAuthError = KetosAuthError
LangflowValidationError = KetosValidationError
LangflowConnectionError = KetosConnectionError
LangflowTimeoutError = KetosTimeoutError
EnvironmentNotFoundError = KetosEnvironmentNotFoundError
EnvironmentConfigError = KetosEnvironmentConfigError

__all__ = [
    "EnvironmentConfigError",
    "EnvironmentNotFoundError",
    "KetosAuthError",
    "KetosConnectionError",
    "KetosEnvironmentConfigError",
    "KetosEnvironmentNotFoundError",
    "KetosError",
    "KetosHTTPError",
    "KetosNotFoundError",
    "KetosTimeoutError",
    "KetosValidationError",
    "LangflowAuthError",
    "LangflowConnectionError",
    "LangflowError",
    "LangflowHTTPError",
    "LangflowNotFoundError",
    "LangflowTimeoutError",
    "LangflowValidationError",
]
