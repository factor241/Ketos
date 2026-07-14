"""Resolve canonical and legacy branded environment variables safely."""

from __future__ import annotations

import os
import re
import warnings
from dataclasses import dataclass
from types import MappingProxyType
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from pydantic_settings import EnvSettingsSource, SettingsError
from typing_extensions import override

if TYPE_CHECKING:
    from collections.abc import Mapping

    from pydantic.fields import FieldInfo

T = TypeVar("T")

_SUFFIX_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]*$")
_MISSING = object()


@dataclass(frozen=True)
class BrandEnvPolicy:
    """Reviewed sensitivity and dual-value behavior for one suffix."""

    sensitivity: Literal["public", "secret"]
    conflict_policy: Literal["warn", "error"]


_PUBLIC_WARN_SUFFIXES = frozenset(
    {
        "ALEMBIC_LOG_FILE",
        "ALEMBIC_LOG_TO_STDOUT",
        "AUTO_SAVING",
        "AUTO_SAVING_INTERVAL",
        "ENVIRONMENT",
        "FRONTEND_TIMEOUT",
        "FS_FLOWS_POLLING_INTERVAL",
        "HEALTH_CHECK_MAX_RETRIES",
        "HIDE_GETTING_STARTED_PROGRESS",
        "HIDE_LOGOUT_BUTTON",
        "HIDE_NEW_FLOW_BUTTON",
        "HIDE_NEW_PROJECT_BUTTON",
        "HIDE_STARTER_PROJECTS",
        "LOG_ENV",
        "LOG_FILE",
        "LOG_FORMAT",
        "LOG_LEVEL",
        "LOG_LEVELS",
        "LOG_RETRIEVER_BUFFER_SIZE",
        "MAX_FILE_SIZE_UPLOAD",
        "MAX_FLOW_VERSION_ENTRIES_PER_FLOW",
        "MAX_INGESTION_TIMEOUT_SECS",
        "MAX_ITEMS_LENGTH",
        "MAX_TEXT_LENGTH",
        "MAX_TRANSACTIONS_TO_KEEP",
        "MAX_VERTEX_BUILDS_PER_VERTEX",
        "MAX_VERTEX_BUILDS_TO_KEEP",
        "OPEN_BROWSER",
        "PRETTY_LOGS",
        "PUBLIC_FLOW_CLEANUP_INTERVAL",
        "PUBLIC_FLOW_EXPIRATION",
        "SENTRY_PROFILES_SAMPLE_RATE",
        "SENTRY_TRACES_SAMPLE_RATE",
        "SERVICE_NAME",
        "TELEMETRY_WRITER_BATCH_SIZE",
        "TELEMETRY_WRITER_BATCH_SIZE_BYTES",
        "TELEMETRY_WRITER_CLEANUP_INTERVAL_S",
        "TELEMETRY_WRITER_FLUSH_INTERVAL_S",
        "TELEMETRY_WRITER_MAX_QUEUE",
        "TELEMETRY_WRITER_MAX_QUEUE_BYTES",
        "TELEMETRY_WRITER_ORPHAN_MAX_AGE_S",
        "TELEMETRY_WRITER_SHUTDOWN_DRAIN_S",
        "TELEMETRY_WRITER_SIZE_STRATEGY",
        "USER_AGENT",
        "VERSION",
        "WEBHOOK_POLLING_INTERVAL",
        "WORKERS",
        "WORKER_TIMEOUT",
    }
)

_PUBLIC_ERROR_SUFFIXES = frozenset(
    {
        "ACCESS_HTTPONLY",
        "ACCESS_SAME_SITE",
        "ACCESS_SECURE",
        "ACCESS_TOKEN_EXPIRE_SECONDS",
        "ADD_PROJECTS_TO_MCP_SERVERS",
        "AGENTIC_EXPERIENCE",
        "ALGORITHM",
        "ALLOW_COMPONENTS_PATHS_OVERRIDE",
        "ALLOW_CUSTOM_COMPONENTS",
        "ALLOW_PUBLIC_CUSTOM_COMPONENTS",
        "API_KEY_ALGORITHM",
        "API_KEY_SOURCE",
        "API_V1_STR",
        "ASSISTANT_VERIFY_FLOWS",
        "AUTHZ_AUDIT_ENABLED",
        "AUTHZ_AUDIT_RETENTION_DAYS",
        "AUTHZ_ENABLED",
        "AUTHZ_SUPERUSER_BYPASS",
        "AUTO_LOGIN",
        "BACKEND_ONLY",
        "BUNDLE_URLS",
        "CACHE_DIR",
        "CACHE_EXPIRE",
        "CACHE_TYPE",
        "CELERY_ENABLED",
        "COMPONENTS_INDEX_PATH",
        "COMPONENTS_PATH",
        "CONFIG_DIR",
        "COOKIE_DOMAIN",
        "CORS_ALLOW_CREDENTIALS",
        "CORS_ALLOW_HEADERS",
        "CORS_ALLOW_METHODS",
        "CORS_ORIGINS",
        "CREATE_STARTER_PROJECTS",
        "CUSTOM_COMPONENT_ADMIN_ONLY",
        "DATABASE_CONNECTION_RETRY",
        "DATA_DIR",
        "DB_CONNECT_TIMEOUT",
        "DEACTIVATE_TRACING",
        "DEBUG_FORK_GHOSTS",
        "DESKTOP",
        "DEV",
        "DEVELOPER_API_ENABLED",
        "DEV_EXTENSIONS_DIR",
        "DIRECTORY_COMPONENT_ALLOWED_ROOTS",
        "DISABLE_TRACK_APIKEY_USAGE",
        "DOWNLOAD_WEBHOOK_URL",
        "DO_NOT_TRACK",
        "EMBEDDED_MODE",
        "ENABLE_EXTENSION_RELOAD",
        "ENABLE_SIGNUP",
        "ENABLE_SUPERUSER_CLI",
        "ENV",
        "ENVIRONMENTS_FILE",
        "EVENT_DELIVERY",
        "FALLBACK_TO_ENV_VAR",
        "FEATURE_MVP_COMPONENTS",
        "FEATURE_WXO_DEPLOYMENTS",
        "FRONTEND_PATH",
        "FS_TOOL_BASE_DIR",
        "GUNICORN_PRELOAD",
        "HOST",
        "JOB_QUEUE_TYPE",
        "KB_ALLOWED_FOLDER_ROOTS",
        "KNOWLEDGE_BASES_DIR",
        "LANGCHAIN_CACHE",
        "LAZY_LOAD_COMPONENTS",
        "LIKE_WEBHOOK_URL",
        "LOAD_FLOWS_OVERWRITE_ON_NAME_MATCH",
        "LOAD_FLOWS_PATH",
        "LOG_REDACT_KEYS",
        "LOG_TRACE_LOCALS",
        "MAX_OVERFLOW",
        "MCP_BASE_URL",
        "MCP_COMPOSER_ENABLED",
        "MCP_COMPOSER_VERSION",
        "MCP_MAX_SESSIONS_PER_SERVER",
        "MCP_SERVERS_LOCKED",
        "MCP_SERVER_ENABLED",
        "MCP_SERVER_ENABLE_PROGRESS_NOTIFICATIONS",
        "MCP_SERVER_TIMEOUT",
        "MCP_SESSION_CLEANUP_INTERVAL",
        "MCP_SESSION_IDLE_TIMEOUT",
        "MCP_TOOL_EXECUTION_TIMEOUT",
        "MIGRATION_LOCK_TIMEOUT_S",
        "MODELS_DEV_REFRESH",
        "NATIVE_TRACING",
        "NEW_USER_IS_ACTIVE",
        "OBJECT_STORAGE_BUCKET_NAME",
        "OBJECT_STORAGE_PREFIX",
        "OBJECT_STORAGE_TAGS",
        "POOL_SIZE",
        "PORT",
        "PROMETHEUS_ENABLED",
        "PROMETHEUS_PORT",
        "PUBLIC_KEY",
        "RATE_LIMIT_ENABLED",
        "RATE_LIMIT_PER_MINUTE",
        "RATE_LIMIT_TRUST_PROXY",
        "REDIS_CACHE_EXPIRE",
        "REDIS_DB",
        "REDIS_HOST",
        "REDIS_PORT",
        "REDIS_QUEUE_CANCEL_CHANNEL_ENABLED",
        "REDIS_QUEUE_CANCEL_MARKER_TTL",
        "REDIS_QUEUE_DB",
        "REDIS_QUEUE_HOST",
        "REDIS_QUEUE_POLLING_STALE_THRESHOLD_S",
        "REDIS_QUEUE_POLLING_WATCHDOG_INTERVAL_S",
        "REDIS_QUEUE_PORT",
        "REDIS_QUEUE_STARTUP_GRACE_S",
        "REDIS_QUEUE_TTL",
        "REFRESH_HTTPONLY",
        "REFRESH_SAME_SITE",
        "REFRESH_SECURE",
        "REFRESH_TOKEN_EXPIRE_SECONDS",
        "REMOVE_API_KEYS",
        "ROOT_PATH",
        "RUNTIME_PORT",
        "SEED_DIR",
        "SERVER_URL",
        "SKIP_AUTH_AUTO_LOGIN",
        "SKIP_MCP_AUTO_INIT",
        "SQLITE_PRAGMAS",
        "SSL_CERT_FILE",
        "SSL_KEY_FILE",
        "SSO_CONFIG_FILE",
        "SSO_ENABLED",
        "SSO_PROVIDER",
        "SSRF_ALLOWED_HOSTS",
        "SSRF_PROTECTION_ENABLED",
        "STORAGE_TYPE",
        "STORE",
        "STORE_ENVIRONMENT_VARIABLES",
        "STORE_URL",
        "SUPERUSER",
        "TELEMETRY_BASE_URL",
        "TELEMETRY_WRITER_ENABLED",
        "TELEMETRY_WRITER_OUTBOX_DIR",
        "TEMP_DIR",
        "TRANSACTIONS_STORAGE_ENABLED",
        "UPDATE_STARTER_PROJECTS",
        "URL",
        "USE_NOOP_DATABASE",
        "VARIABLES_TO_GET_FROM_ENVIRONMENT",
        "VARIABLE_STORE",
        "VERTEX_BUILDS_STORAGE_ENABLED",
        "WEBHOOK_AUTH_ENABLE",
    }
)

_SECRET_ERROR_SUFFIXES = frozenset(
    {
        "API_KEY",
        "DATABASE_URL",
        "DB_CONNECTION_SETTINGS",
        "DB_DRIVER_CONNECTION_SETTINGS",
        "PRIVATE_KEY",
        "RATE_LIMIT_STORAGE_URI",
        "REDIS_QUEUE_URL",
        "REDIS_URL",
        "REQUEST_VARIABLES",
        "SECRET_KEY",
        "SENTRY_DSN",
        "SUPERUSER_PASSWORD",
        "SUPERUSER_TOKEN",
    }
)


def _build_policy_registry() -> MappingProxyType[str, BrandEnvPolicy]:
    policies = {
        suffix: BrandEnvPolicy(sensitivity="public", conflict_policy="warn") for suffix in _PUBLIC_WARN_SUFFIXES
    }
    policies.update(
        {suffix: BrandEnvPolicy(sensitivity="public", conflict_policy="error") for suffix in _PUBLIC_ERROR_SUFFIXES}
    )
    policies.update(
        {suffix: BrandEnvPolicy(sensitivity="secret", conflict_policy="error") for suffix in _SECRET_ERROR_SUFFIXES}
    )
    return MappingProxyType(policies)


BRAND_ENV_POLICIES = _build_policy_registry()


@dataclass(frozen=True)
class BrandEnvEvent:
    """Value-free metadata describing a resolver diagnostic."""

    code: Literal["legacy_env_used", "brand_env_conflict"]
    canonical_name: str
    legacy_name: str
    sensitivity: Literal["public", "secret"]
    selected: Literal["canonical", "legacy", "default"]


def _diagnostic_message(event: BrandEnvEvent) -> str:
    if event.code == "legacy_env_used":
        return f"{event.legacy_name} is deprecated; use {event.canonical_name}."
    return f"Conflicting brand environment variables {event.canonical_name} and {event.legacy_name}."


class _ImmutableBrandEnvDiagnostic:
    """Attach immutable, value-free event metadata to an exception or warning."""

    _event: BrandEnvEvent
    _sealed: bool

    def __init__(self, event: BrandEnvEvent) -> None:
        object.__setattr__(self, "_event", event)
        super().__init__(_diagnostic_message(event))
        object.__setattr__(self, "_sealed", True)

    @property
    def event(self) -> BrandEnvEvent:
        return self._event

    def __setattr__(self, name: str, value: object) -> None:
        if getattr(self, "_sealed", False) and name not in {
            "__cause__",
            "__context__",
            "__notes__",
            "__suppress_context__",
            "__traceback__",
        }:
            msg = f"{type(self).__name__} is immutable"
            raise AttributeError(msg)
        object.__setattr__(self, name, value)


class BrandEnvConflictError(_ImmutableBrandEnvDiagnostic, RuntimeError):
    """Raised when unequal dual values use the error conflict policy."""


class BrandEnvConflictWarning(_ImmutableBrandEnvDiagnostic, UserWarning):
    """Warn that unequal dual values selected the canonical variable."""


class BrandEnvLegacyWarning(_ImmutableBrandEnvDiagnostic, DeprecationWarning):
    """Warn that a legacy-only variable was selected."""


class UnclassifiedBrandEnvError(ValueError):
    """Raised when a branded suffix has no reviewed policy."""

    def __init__(self, name: str) -> None:
        super().__init__(f"Unclassified brand environment suffix: {name}")


def get_brand_env_policy(name: str) -> BrandEnvPolicy:
    """Return the reviewed policy for ``name`` or fail closed."""
    try:
        return BRAND_ENV_POLICIES[name]
    except KeyError as exc:
        raise UnclassifiedBrandEnvError(name) from exc


def _validate_inputs(
    name: str,
    sensitivity: Literal["public", "secret"],
    conflict_policy: Literal["warn", "error"],
) -> None:
    if not _SUFFIX_PATTERN.fullmatch(name) or name.startswith(("KETOS_", "LANGFLOW_")):
        msg = "Brand environment name must be an uppercase unprefixed suffix"
        raise ValueError(msg)
    if sensitivity not in {"public", "secret"} or conflict_policy not in {"warn", "error"}:
        msg = "Unsupported brand environment option"
        raise ValueError(msg)


def resolve_brand_env(
    name: str,
    default: T,
    *,
    sensitivity: Literal["public", "secret"],
    conflict_policy: Literal["warn", "error"],
) -> T:
    """Resolve ``KETOS_*`` before ``LANGFLOW_*`` without converting raw text.

    Environment-selected values are strings cast to ``T``. Existing Pydantic
    settings sources remain responsible for typed conversion.
    """
    return _read_brand_env(
        name,
        default,
        sensitivity=sensitivity,
        conflict_policy=conflict_policy,
        emit_warnings=True,
    )


def _read_brand_env(
    name: str,
    default: T,
    *,
    sensitivity: Literal["public", "secret"],
    conflict_policy: Literal["warn", "error"],
    emit_warnings: bool,
    environ: Mapping[str, str] | None = None,
) -> T:
    _validate_inputs(name, sensitivity, conflict_policy)
    policy = get_brand_env_policy(name)
    if (sensitivity, conflict_policy) != (policy.sensitivity, policy.conflict_policy):
        msg = "Brand environment options must match the reviewed policy registry"
        raise ValueError(msg)

    canonical_name = f"KETOS_{name}"
    legacy_name = f"LANGFLOW_{name}"
    source = os.environ if environ is None else environ
    canonical_value = source.get(canonical_name, _MISSING)
    legacy_value = source.get(legacy_name, _MISSING)

    if canonical_value is _MISSING:
        if legacy_value is _MISSING:
            return default
        event = BrandEnvEvent(
            code="legacy_env_used",
            canonical_name=canonical_name,
            legacy_name=legacy_name,
            sensitivity=sensitivity,
            selected="legacy",
        )
        if emit_warnings:
            warnings.warn(BrandEnvLegacyWarning(event), stacklevel=3)
        return cast("T", legacy_value)

    if legacy_value is not _MISSING and canonical_value != legacy_value:
        event = BrandEnvEvent(
            code="brand_env_conflict",
            canonical_name=canonical_name,
            legacy_name=legacy_name,
            sensitivity=sensitivity,
            selected="canonical",
        )
        if conflict_policy == "error":
            raise BrandEnvConflictError(event)
        if emit_warnings:
            warnings.warn(BrandEnvConflictWarning(event), stacklevel=3)

    return cast("T", canonical_value)


def _resolve_brand_env_from_mapping(
    name: str,
    default: T,
    *,
    environ: Mapping[str, str],
    sensitivity: Literal["public", "secret"],
    conflict_policy: Literal["warn", "error"],
) -> T:
    """Apply the frozen resolver contract to an injected environment mapping."""
    return _read_brand_env(
        name,
        default,
        sensitivity=sensitivity,
        conflict_policy=conflict_policy,
        emit_warnings=True,
        environ=environ,
    )


def _read_brand_env_without_warning(name: str, default: T) -> T:
    """Read branded env origin metadata without emitting a second diagnostic.

    This is reserved for post-source compatibility enforcement that must know
    whether a value originated in either branded environment family. Unequal
    error-policy conflicts still fail closed.
    """
    policy = get_brand_env_policy(name)
    return _read_brand_env(
        name,
        default,
        sensitivity=policy.sensitivity,
        conflict_policy=policy.conflict_policy,
        emit_warnings=False,
    )


def is_list_of_any(field: FieldInfo) -> bool:
    """Return whether a Pydantic field is a list or optional list."""
    if field.annotation is None:
        return False
    try:
        union_args = field.annotation.__args__ if hasattr(field.annotation, "__args__") else []
        return field.annotation.__origin__ is list or any(
            arg.__origin__ is list for arg in union_args if hasattr(arg, "__origin__")
        )
    except AttributeError:
        return False


class BrandEnvSettingsSource(EnvSettingsSource):
    """Pydantic source applying reviewed Ketos/Langflow precedence."""

    def __init__(self, settings_cls: type[Any], *, suffix_prefix: str = "") -> None:
        super().__init__(settings_cls)
        self._suffix_prefix = suffix_prefix

    @override
    def __call__(self) -> dict[str, Any]:
        try:
            return super().__call__()
        except SettingsError as exc:
            if isinstance(exc.__cause__, (BrandEnvConflictError, UnclassifiedBrandEnvError)):
                raise exc.__cause__ from exc
            raise

    @override
    def get_field_value(self, field: FieldInfo, field_name: str) -> tuple[Any, str, bool]:
        suffix = f"{self._suffix_prefix}{field_name.upper()}"
        policy = get_brand_env_policy(suffix)
        value = resolve_brand_env(
            suffix,
            None,
            sensitivity=policy.sensitivity,
            conflict_policy=policy.conflict_policy,
        )
        field_key, _, value_is_complex = self._extract_field_info(field, field_name)[-1]
        return value, field_key, value_is_complex

    @override
    def prepare_field_value(self, field_name: str, field: FieldInfo, value: Any, value_is_complex: bool) -> Any:
        if is_list_of_any(field):
            if isinstance(value, str):
                value = value.split(",")
            if isinstance(value, list):
                return value
        return super().prepare_field_value(field_name, field, value, value_is_complex)


__all__ = [
    "BRAND_ENV_POLICIES",
    "BrandEnvConflictError",
    "BrandEnvConflictWarning",
    "BrandEnvEvent",
    "BrandEnvLegacyWarning",
    "BrandEnvPolicy",
    "BrandEnvSettingsSource",
    "UnclassifiedBrandEnvError",
    "get_brand_env_policy",
    "is_list_of_any",
    "resolve_brand_env",
]
