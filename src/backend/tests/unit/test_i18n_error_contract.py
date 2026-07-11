"""Stable API error-code and compatibility envelope contracts."""

from __future__ import annotations

import ast
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from langflow.api.error_codes import (
    API_ERROR_REGISTRY,
    ApiErrorCode,
    coded_http_error,
    normalize_validation_errors,
    register_api_error_handlers,
)
from langflow.schema.errors import ApiErrorResponse
from langflow.services.auth.exceptions import (
    InactiveUserError,
    InsufficientPermissionsError,
    InvalidCredentialsError,
    InvalidTokenError,
    MissingCredentialsError,
    TokenExpiredError,
)
from langflow.services.auth.utils import _auth_error_to_http
from pydantic import ValidationError


def test_registry_covers_first_party_localized_error_surfaces():
    required_prefixes = {
        "auth",
        "components",
        "deployments",
        "extensions",
        "files",
        "flows",
        "knowledge",
        "mcp",
        "request",
        "server",
    }

    assert required_prefixes <= {code.value.split(".", maxsplit=1)[0] for code in API_ERROR_REGISTRY}
    assert set(API_ERROR_REGISTRY) == set(ApiErrorCode)
    assert all(spec.frontend_key and spec.english_detail for spec in API_ERROR_REGISTRY.values())


def test_coded_http_error_preserves_english_compatibility_without_exposing_technical_detail():
    exc = coded_http_error(
        ApiErrorCode.FLOW_NOT_FOUND,
        params={"flow_id": "6ef6b919-7f7b-46df-b597-9e7958f83d4d"},
        technical_detail="SELECT returned no row for tenant internal-42",
    )

    assert exc.status_code == 404
    payload = exc.payload.model_dump(mode="json", exclude_none=True)
    assert payload == {
        "code": "flows.not_found",
        "detail": "Flow not found.",
        "message": "Flow not found.",
        "params": {"flow_id": "6ef6b919-7f7b-46df-b597-9e7958f83d4d"},
    }
    assert "internal-42" not in str(payload)
    assert exc.technical_detail == "SELECT returned no row for tenant internal-42"


@pytest.mark.parametrize(
    "relative_path",
    [
        "api/v1/endpoints.py",
        "api/v1/deployments.py",
        "api/v1/knowledge_bases.py",
        "api/v1/mappers/deployments/helpers.py",
        "api/v1/mappers/deployments/sync.py",
    ],
)
def test_migrated_coded_error_sites_do_not_promote_exception_text_to_compatibility_detail(relative_path):
    """Raw provider/runtime diagnostics must stay in technical_detail only."""
    api_root = Path(__file__).parents[2] / "base" / "langflow"
    source_path = api_root / relative_path
    tree = ast.parse(source_path.read_text(encoding="utf-8"), filename=str(source_path))
    parents = {child: parent for parent in ast.walk(tree) for child in ast.iter_child_nodes(parent)}
    violations: list[int] = []

    def is_user_owned_validation_detail(node: ast.AST) -> bool:
        parent = parents.get(node)
        while parent is not None:
            if (
                isinstance(parent, ast.ExceptHandler)
                and isinstance(parent.type, ast.Name)
                and parent.type.id == "CustomComponentValidationError"
            ):
                return True
            if isinstance(parent, ast.If) and any(
                isinstance(descendant, ast.Name) and descendant.id == "CustomComponentValidationError"
                for descendant in ast.walk(parent.test)
            ):
                return True
            parent = parents.get(parent)
        return False

    def contains_raw_exception_text(node: ast.AST) -> bool:
        for descendant in ast.walk(node):
            if (
                isinstance(descendant, ast.Call)
                and isinstance(descendant.func, ast.Name)
                and descendant.func.id == "str"
                and descendant.args
                and isinstance(descendant.args[0], ast.Name)
                and descendant.args[0].id in {"e", "exc", "iter_error"}
            ):
                return True
            if (
                isinstance(descendant, ast.Attribute)
                and descendant.attr == "message"
                and isinstance(descendant.value, ast.Name)
                and descendant.value.id in {"e", "exc", "iter_error"}
            ):
                return True
        return False

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name) or node.func.id != "coded_http_error":
            continue
        detail = next((keyword.value for keyword in node.keywords if keyword.arg == "detail"), None)
        if detail is not None and contains_raw_exception_text(detail) and not is_user_owned_validation_detail(node):
            violations.append(node.lineno)

    assert violations == [], f"raw exception detail exposed by coded_http_error at lines {violations}"


def test_user_owned_custom_component_validation_detail_remains_a_legacy_compatibility_field():
    """Stable codes are additive; user-authored validation output remains verbatim for old clients."""
    source_path = Path(__file__).parents[2] / "base" / "langflow" / "api" / "v1" / "endpoints.py"
    tree = ast.parse(source_path.read_text(encoding="utf-8"), filename=str(source_path))
    parents = {child: parent for parent in ast.walk(tree) for child in ast.iter_child_nodes(parent)}
    preserved_sites: list[int] = []

    def is_custom_component_handler(node: ast.AST) -> bool:
        parent = parents.get(node)
        while parent is not None:
            if (
                isinstance(parent, ast.ExceptHandler)
                and isinstance(parent.type, ast.Name)
                and parent.type.id == "CustomComponentValidationError"
            ):
                return True
            if isinstance(parent, ast.If) and any(
                isinstance(descendant, ast.Name) and descendant.id == "CustomComponentValidationError"
                for descendant in ast.walk(parent.test)
            ):
                return True
            parent = parents.get(parent)
        return False

    for call in (node for node in ast.walk(tree) if isinstance(node, ast.Call)):
        if not isinstance(call.func, ast.Name) or call.func.id != "coded_http_error":
            continue
        detail = next((keyword.value for keyword in call.keywords if keyword.arg == "detail"), None)
        if (
            isinstance(detail, ast.Call)
            and isinstance(detail.func, ast.Name)
            and detail.func.id == "str"
            and detail.args
            and isinstance(detail.args[0], ast.Name)
            and detail.args[0].id == "exc"
            and is_custom_component_handler(call)
        ):
            preserved_sites.append(call.lineno)

    assert len(preserved_sites) >= 2


@pytest.mark.parametrize(
    "relative_path",
    [
        "api/v1/login.py",
        "api/v1/flows.py",
        "api/v1/endpoints.py",
        "api/v1/extensions.py",
        "api/v1/mcp.py",
        "api/v1/deployments.py",
        "api/v1/knowledge_bases.py",
        "api/v1/mappers/deployments/helpers.py",
        "api/v1/mappers/deployments/sync.py",
        "api/v2/files.py",
        "api/v2/mcp.py",
    ],
)
def test_named_native_ui_routes_use_stable_error_envelopes(relative_path):
    """Every UI-facing raise in the named native migration wave carries a stable code."""
    api_root = Path(__file__).parents[2] / "base" / "langflow"
    source_path = api_root / relative_path
    tree = ast.parse(source_path.read_text(encoding="utf-8"), filename=str(source_path))
    raw_http_raises = [
        node.lineno
        for node in ast.walk(tree)
        if isinstance(node, ast.Raise)
        and isinstance(node.exc, ast.Call)
        and isinstance(node.exc.func, ast.Name)
        and node.exc.func.id == "HTTPException"
    ]

    assert raw_http_raises == [], f"uncoded HTTPException raises remain at lines {raw_http_raises}"


def test_error_params_are_exactly_validated_against_registry_schema():
    with pytest.raises(ValueError, match="missing required params"):
        coded_http_error(ApiErrorCode.FLOW_NOT_FOUND)
    with pytest.raises(ValueError, match="unexpected params"):
        coded_http_error(ApiErrorCode.FLOW_NOT_FOUND, params={"flow_id": "id", "secret": "no"})


def test_validation_errors_have_stable_codes_and_field_paths_with_legacy_detail():
    raw = [
        {
            "type": "string_too_short",
            "loc": ("body", "name"),
            "msg": "String should have at least 3 characters",
            "input": "x",
            "ctx": {"min_length": 3},
        },
        {
            "type": "missing",
            "loc": ("query", "page"),
            "msg": "Field required",
            "input": None,
        },
    ]

    payload = normalize_validation_errors(raw)

    assert isinstance(payload, ApiErrorResponse)
    assert payload.code == ApiErrorCode.REQUEST_VALIDATION_FAILED
    assert payload.detail == raw
    assert [error.model_dump(mode="json") for error in payload.field_errors] == [
        {
            "code": "validation.string_too_short",
            "location": "body",
            "path": ["name"],
            "message": "String should have at least 3 characters",
            "params": {"min_length": 3},
        },
        {
            "code": "validation.missing",
            "location": "query",
            "path": ["page"],
            "message": "Field required",
            "params": {},
        },
    ]


def test_error_response_rejects_non_scalar_params():
    with pytest.raises(ValidationError):
        ApiErrorResponse(
            code=ApiErrorCode.REQUEST_BAD_REQUEST,
            detail="Bad request.",
            message="Bad request.",
            params={"nested": {"secret": True}},
        )


def test_coded_error_preserves_legacy_typed_detail_objects():
    detail = {
        "code": "reload-failed",
        "message": "Bundle reload failed.",
        "hint": "Validate the extension manifest.",
    }

    exc = coded_http_error(
        ApiErrorCode.EXTENSION_INVALID_MANIFEST,
        detail=detail,
        status_code=422,
    )

    assert exc.payload.code == "extensions.invalid_manifest"
    assert exc.payload.detail == detail
    assert exc.payload.message == "Extension manifest is invalid."


def test_registered_handlers_serve_additive_coded_and_validation_envelopes():
    app = FastAPI()
    register_api_error_handlers(app)

    @app.get("/flows/{flow_id}")
    async def get_flow(flow_id: str):
        raise coded_http_error(ApiErrorCode.FLOW_NOT_FOUND, params={"flow_id": flow_id})

    @app.get("/items")
    async def get_items(page: int):
        return {"page": page}

    client = TestClient(app)
    coded = client.get("/flows/missing")
    validation = client.get("/items", params={"page": "not-an-integer"})

    assert coded.status_code == 404
    assert coded.json() == {
        "code": "flows.not_found",
        "detail": "Flow not found.",
        "message": "Flow not found.",
        "params": {"flow_id": "missing"},
    }
    assert validation.status_code == 422
    body = validation.json()
    assert body["code"] == "request.validation_failed"
    assert body["field_errors"][0]["location"] == "query"
    assert body["field_errors"][0]["path"] == ["page"]
    assert isinstance(body["detail"], list)


@pytest.mark.parametrize(
    ("error", "status_code", "code"),
    [
        (InvalidCredentialsError(), 403, "auth.invalid_credentials"),
        (MissingCredentialsError(), 403, "auth.missing_credentials"),
        (InsufficientPermissionsError(), 403, "auth.insufficient_permissions"),
        (InactiveUserError(), 401, "auth.inactive_user"),
        (TokenExpiredError(), 401, "auth.token_expired"),
        (InvalidTokenError(), 401, "auth.invalid_token"),
    ],
)
def test_auth_exception_adapter_adds_codes_without_changing_legacy_status(error, status_code, code):
    exc = _auth_error_to_http(error)

    assert exc.status_code == status_code
    assert exc.payload.code == code
    assert exc.detail == error.message
