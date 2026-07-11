"""Stable first-party API error registry and compatibility envelope helpers."""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum
from http import HTTPStatus
from types import MappingProxyType
from typing import Any, Final

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from langflow.schema.errors import ApiErrorResponse, ApiFieldError, JsonScalar

VALIDATION_CODE_RE: Final = re.compile(r"[^a-z0-9_.-]+")
REQUEST_LOCATIONS: Final = frozenset({"body", "cookie", "header", "path", "query"})


class ApiErrorCode(StrEnum):
    REQUEST_BAD_REQUEST = "request.bad_request"
    REQUEST_VALIDATION_FAILED = "request.validation_failed"
    REQUEST_RATE_LIMITED = "request.rate_limited"
    SERVER_INTERNAL_ERROR = "server.internal_error"
    AUTH_INVALID_CREDENTIALS = "auth.invalid_credentials"
    AUTH_MISSING_CREDENTIALS = "auth.missing_credentials"
    AUTH_INACTIVE_USER = "auth.inactive_user"
    AUTH_INSUFFICIENT_PERMISSIONS = "auth.insufficient_permissions"
    AUTH_TOKEN_EXPIRED = "auth.token_expired"  # noqa: S105 - public error code, not a credential
    AUTH_INVALID_TOKEN = "auth.invalid_token"  # noqa: S105 - public error code, not a credential
    FLOW_NOT_FOUND = "flows.not_found"
    FLOW_ALREADY_EXISTS = "flows.already_exists"
    FLOW_INVALID = "flows.invalid"
    FILE_NOT_FOUND = "files.not_found"
    FILE_INVALID = "files.invalid"
    FILE_TOO_LARGE = "files.too_large"
    FILE_STORAGE_ERROR = "files.storage_error"
    KNOWLEDGE_NOT_FOUND = "knowledge.not_found"
    KNOWLEDGE_ALREADY_EXISTS = "knowledge.already_exists"
    KNOWLEDGE_INVALID_NAME = "knowledge.invalid_name"
    KNOWLEDGE_NO_FILES = "knowledge.no_files"
    DEPLOYMENT_NOT_FOUND = "deployments.not_found"
    DEPLOYMENT_CONFLICT = "deployments.conflict"
    DEPLOYMENT_UPDATE_FAILED = "deployments.update_failed"
    MCP_INVALID_JSON = "mcp.invalid_json"
    MCP_SERVER_EXISTS = "mcp.server_exists"
    MCP_SERVER_NOT_FOUND = "mcp.server_not_found"
    COMPONENT_NOT_FOUND = "components.not_found"
    COMPONENT_UPDATE_FAILED = "components.update_failed"
    EXTENSION_INVALID_MANIFEST = "extensions.invalid_manifest"
    EXTENSION_RELOAD_FAILED = "extensions.reload_failed"


@dataclass(frozen=True, slots=True)
class ApiErrorSpec:
    frontend_key: str
    english_detail: str
    status_code: int
    required_params: frozenset[str] = frozenset()
    optional_params: frozenset[str] = frozenset()


def _spec(
    frontend_key: str,
    english_detail: str,
    status_code: int,
    *,
    required: tuple[str, ...] = (),
    optional: tuple[str, ...] = (),
) -> ApiErrorSpec:
    return ApiErrorSpec(
        frontend_key=frontend_key,
        english_detail=english_detail,
        status_code=status_code,
        required_params=frozenset(required),
        optional_params=frozenset(optional),
    )


API_ERROR_REGISTRY = MappingProxyType(
    {
        ApiErrorCode.REQUEST_BAD_REQUEST: _spec("apiErrors.request.badRequest", "Bad request.", HTTPStatus.BAD_REQUEST),
        ApiErrorCode.REQUEST_VALIDATION_FAILED: _spec(
            "apiErrors.request.validationFailed", "Request validation failed.", HTTPStatus.UNPROCESSABLE_ENTITY
        ),
        ApiErrorCode.REQUEST_RATE_LIMITED: _spec(
            "apiErrors.request.rateLimited",
            "Too many requests. Please try again later.",
            HTTPStatus.TOO_MANY_REQUESTS,
            optional=("retry_after",),
        ),
        ApiErrorCode.SERVER_INTERNAL_ERROR: _spec(
            "apiErrors.server.internal", "Internal server error.", HTTPStatus.INTERNAL_SERVER_ERROR
        ),
        ApiErrorCode.AUTH_INVALID_CREDENTIALS: _spec(
            "apiErrors.auth.invalidCredentials", "Invalid credentials.", HTTPStatus.UNAUTHORIZED
        ),
        ApiErrorCode.AUTH_MISSING_CREDENTIALS: _spec(
            "apiErrors.auth.missingCredentials", "Credentials are required.", HTTPStatus.UNAUTHORIZED
        ),
        ApiErrorCode.AUTH_INACTIVE_USER: _spec(
            "apiErrors.auth.inactiveUser", "User account is inactive.", HTTPStatus.FORBIDDEN
        ),
        ApiErrorCode.AUTH_INSUFFICIENT_PERMISSIONS: _spec(
            "apiErrors.auth.insufficientPermissions", "Insufficient permissions.", HTTPStatus.FORBIDDEN
        ),
        ApiErrorCode.AUTH_TOKEN_EXPIRED: _spec(
            "apiErrors.auth.tokenExpired", "Authentication token has expired.", HTTPStatus.UNAUTHORIZED
        ),
        ApiErrorCode.AUTH_INVALID_TOKEN: _spec(
            "apiErrors.auth.invalidToken", "Authentication token is invalid.", HTTPStatus.UNAUTHORIZED
        ),
        ApiErrorCode.FLOW_NOT_FOUND: _spec(
            "apiErrors.flows.notFound", "Flow not found.", HTTPStatus.NOT_FOUND, required=("flow_id",)
        ),
        ApiErrorCode.FLOW_ALREADY_EXISTS: _spec(
            "apiErrors.flows.alreadyExists",
            "Flow already exists.",
            HTTPStatus.CONFLICT,
            optional=("flow_id", "name"),
        ),
        ApiErrorCode.FLOW_INVALID: _spec(
            "apiErrors.flows.invalid", "Flow is invalid.", HTTPStatus.BAD_REQUEST, optional=("flow_id",)
        ),
        ApiErrorCode.FILE_NOT_FOUND: _spec(
            "apiErrors.files.notFound", "File not found.", HTTPStatus.NOT_FOUND, optional=("file_id", "name")
        ),
        ApiErrorCode.FILE_INVALID: _spec(
            "apiErrors.files.invalid", "File is invalid.", HTTPStatus.BAD_REQUEST, optional=("name", "reason")
        ),
        ApiErrorCode.FILE_TOO_LARGE: _spec(
            "apiErrors.files.tooLarge",
            "File is too large.",
            HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
            optional=("name", "max_size_mb"),
        ),
        ApiErrorCode.FILE_STORAGE_ERROR: _spec(
            "apiErrors.files.storageError", "File storage operation failed.", HTTPStatus.INTERNAL_SERVER_ERROR
        ),
        ApiErrorCode.KNOWLEDGE_NOT_FOUND: _spec(
            "apiErrors.knowledge.notFound", "Knowledge base not found.", HTTPStatus.NOT_FOUND, required=("name",)
        ),
        ApiErrorCode.KNOWLEDGE_ALREADY_EXISTS: _spec(
            "apiErrors.knowledge.alreadyExists",
            "Knowledge base already exists.",
            HTTPStatus.CONFLICT,
            required=("name",),
        ),
        ApiErrorCode.KNOWLEDGE_INVALID_NAME: _spec(
            "apiErrors.knowledge.invalidName",
            "Knowledge base name is invalid.",
            HTTPStatus.BAD_REQUEST,
            optional=("min_length", "max_length"),
        ),
        ApiErrorCode.KNOWLEDGE_NO_FILES: _spec(
            "apiErrors.knowledge.noFiles", "No files were provided.", HTTPStatus.BAD_REQUEST
        ),
        ApiErrorCode.DEPLOYMENT_NOT_FOUND: _spec(
            "apiErrors.deployments.notFound",
            "Deployment not found.",
            HTTPStatus.NOT_FOUND,
            required=("deployment_id",),
        ),
        ApiErrorCode.DEPLOYMENT_CONFLICT: _spec(
            "apiErrors.deployments.conflict",
            "Deployment conflicts with the current state.",
            HTTPStatus.CONFLICT,
            optional=("deployment_id",),
        ),
        ApiErrorCode.DEPLOYMENT_UPDATE_FAILED: _spec(
            "apiErrors.deployments.updateFailed",
            "Deployment could not be updated.",
            HTTPStatus.INTERNAL_SERVER_ERROR,
            optional=("deployment_id",),
        ),
        ApiErrorCode.MCP_INVALID_JSON: _spec(
            "apiErrors.mcp.invalidJson", "MCP configuration is not valid JSON.", HTTPStatus.UNPROCESSABLE_ENTITY
        ),
        ApiErrorCode.MCP_SERVER_EXISTS: _spec(
            "apiErrors.mcp.serverExists", "MCP server already exists.", HTTPStatus.CONFLICT, optional=("name",)
        ),
        ApiErrorCode.MCP_SERVER_NOT_FOUND: _spec(
            "apiErrors.mcp.serverNotFound", "MCP server not found.", HTTPStatus.NOT_FOUND, optional=("name",)
        ),
        ApiErrorCode.COMPONENT_NOT_FOUND: _spec(
            "apiErrors.components.notFound", "Component not found.", HTTPStatus.NOT_FOUND, optional=("name",)
        ),
        ApiErrorCode.COMPONENT_UPDATE_FAILED: _spec(
            "apiErrors.components.updateFailed",
            "Component could not be updated.",
            HTTPStatus.INTERNAL_SERVER_ERROR,
            optional=("name",),
        ),
        ApiErrorCode.EXTENSION_INVALID_MANIFEST: _spec(
            "apiErrors.extensions.invalidManifest", "Extension manifest is invalid.", HTTPStatus.BAD_REQUEST
        ),
        ApiErrorCode.EXTENSION_RELOAD_FAILED: _spec(
            "apiErrors.extensions.reloadFailed",
            "Extension could not be reloaded.",
            HTTPStatus.INTERNAL_SERVER_ERROR,
            optional=("bundle",),
        ),
    }
)


class CodedHTTPException(HTTPException):
    """HTTPException carrying a stable additive error envelope and private diagnostics."""

    def __init__(
        self,
        payload: ApiErrorResponse,
        *,
        status_code: int,
        technical_detail: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(status_code=status_code, detail=payload.detail, headers=headers)
        self.payload = payload
        self.technical_detail = technical_detail


def _validate_params(code: ApiErrorCode, params: dict[str, JsonScalar]) -> None:
    spec = API_ERROR_REGISTRY[code]
    missing = spec.required_params - set(params)
    if missing:
        msg = f"{code.value}: missing required params: {', '.join(sorted(missing))}"
        raise ValueError(msg)
    unexpected = set(params) - spec.required_params - spec.optional_params
    if unexpected:
        msg = f"{code.value}: unexpected params: {', '.join(sorted(unexpected))}"
        raise ValueError(msg)


def coded_http_error(
    code: ApiErrorCode,
    *,
    params: dict[str, JsonScalar] | None = None,
    detail: str | list[dict[str, Any]] | dict[str, Any] | None = None,
    technical_detail: str | None = None,
    status_code: int | None = None,
    headers: dict[str, str] | None = None,
) -> CodedHTTPException:
    """Create a typed exception while preserving a stable English fallback."""
    resolved_params = dict(params or {})
    _validate_params(code, resolved_params)
    spec = API_ERROR_REGISTRY[code]
    compatibility_detail = detail if detail is not None else spec.english_detail
    english_message = compatibility_detail if isinstance(compatibility_detail, str) else spec.english_detail
    payload = ApiErrorResponse(
        code=code.value,
        detail=compatibility_detail,
        message=english_message,
        params=resolved_params,
    )
    return CodedHTTPException(
        payload,
        status_code=status_code or spec.status_code,
        technical_detail=technical_detail,
        headers=headers,
    )


def _scalar_context(context: Any) -> dict[str, JsonScalar]:
    if not isinstance(context, dict):
        return {}
    return {
        str(key): value
        for key, value in context.items()
        if value is None or isinstance(value, str | int | float | bool)
    }


def normalize_validation_errors(errors: list[dict[str, Any]]) -> ApiErrorResponse:
    """Add stable field codes/paths without removing FastAPI's legacy detail list."""
    field_errors: list[ApiFieldError] = []
    for error in errors:
        raw_location = list(error.get("loc") or [])
        if raw_location and isinstance(raw_location[0], str) and raw_location[0] in REQUEST_LOCATIONS:
            location = raw_location.pop(0)
        else:
            location = "request"
        raw_type = str(error.get("type") or "invalid").casefold()
        stable_type = VALIDATION_CODE_RE.sub("_", raw_type).strip("_") or "invalid"
        field_errors.append(
            ApiFieldError(
                code=f"validation.{stable_type}",
                location=location,
                path=[part for part in raw_location if isinstance(part, str | int)],
                message=str(error.get("msg") or "Invalid value"),
                params=_scalar_context(error.get("ctx")),
            )
        )

    spec = API_ERROR_REGISTRY[ApiErrorCode.REQUEST_VALIDATION_FAILED]
    return ApiErrorResponse(
        code=ApiErrorCode.REQUEST_VALIDATION_FAILED.value,
        detail=errors,
        message=spec.english_detail,
        params={},
        field_errors=field_errors,
    )


async def coded_http_exception_handler(_request: Request, exc: CodedHTTPException) -> JSONResponse:
    """Serialize a stable coded envelope; private diagnostics remain on the exception only."""
    return JSONResponse(
        status_code=exc.status_code,
        content=jsonable_encoder(exc.payload.model_dump(mode="json", exclude_none=True)),
        headers=exc.headers,
    )


async def request_validation_exception_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    """Preserve FastAPI's legacy detail list and add stable field identities."""
    payload = normalize_validation_errors(exc.errors())
    return JSONResponse(
        status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
        content=jsonable_encoder(payload.model_dump(mode="python", exclude_none=True)),
    )


def register_api_error_handlers(app: FastAPI) -> None:
    """Install additive handlers on an application without changing uncoded HTTP errors."""
    app.add_exception_handler(CodedHTTPException, coded_http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, request_validation_exception_handler)  # type: ignore[arg-type]
