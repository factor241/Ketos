#!/usr/bin/env python3
"""Emit a sanitized runtime route/capability inventory for Stage 01."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
from pathlib import Path
from typing import Any

from fastapi.routing import APIRoute

from ketos.main import create_app


BASELINE_SHA = "80878261d07c21ad257de017d98069f211ada2c2"
REVIEWED_PREFIXES = (
    "/api/mcp",
    "/api/v1/mcp",
    "/api/v2/mcp",
    "/api/v1/agentic",
    "/api/v1/responses",
    "/api/v1/run",
    "/api/v1/webhook",
    "/api/v1/build",
    "/api/v2/workflows",
    "/api/v1/files",
    "/api/v2/files",
)


def callable_name(value: object) -> str:
    module = getattr(value, "__module__", None)
    qualname = getattr(value, "__qualname__", None) or getattr(value, "__name__", None)
    if module and qualname:
        return f"{module}.{qualname}"
    value_type = type(value)
    return f"{value_type.__module__}.{value_type.__qualname__}"


def dependency_names(dependant: Any) -> list[str]:
    names: set[str] = set()

    def visit(node: Any) -> None:
        for dependency in node.dependencies:
            if dependency.call is not None:
                names.add(callable_name(dependency.call))
            visit(dependency)

    visit(dependant)
    return sorted(names)


def auth_contract(dependencies: list[str]) -> str:
    joined = " ".join(dependencies).casefold()
    if "get_webhook_auth" in joined:
        return "conditional-webhook-auth"
    if "current_active_user_mcp" in joined:
        return "mcp-resolver-config-sensitive"
    if "api_key_security" in joined or "api_key" in joined:
        return "api-key"
    if "current_active_user" in joined or "current_user" in joined:
        return "cookie-jwt-or-api-key"
    return "none-or-handler-internal"


def actor_source(dependencies: list[str]) -> str:
    joined = " ".join(dependencies).casefold()
    if "get_webhook_auth" in joined:
        return "get_webhook_auth; may impersonate flow owner when auth is disabled"
    if "current_active_user_mcp" in joined:
        return "CurrentActiveMCPUser; AUTO_LOGIN-sensitive"
    if "api_key_security" in joined:
        return "API-key subject"
    if "current_active_user" in joined or "current_user" in joined:
        return "current authenticated subject"
    return "anonymous, transport-bound, or resolved inside handler; review required"


def scope_for(path: str) -> str:
    lowered = path.casefold()
    if "build_public_tmp" in lowered or "/public_flow/" in lowered or path in {"/health", "/health_check"}:
        return "public or explicitly public capability"
    for resource in ("flow", "project", "folder", "job", "file", "message", "trace", "user", "server"):
        if "{" + resource in lowered:
            return f"path-scoped {resource}; handler/guard ownership must be verified"
    if "/authz/" in lowered or "/admin" in lowered:
        return "authorization/admin domain"
    return "current-user, collection, or global scope; handler review required"


def risk_for(method: str, path: str) -> str:
    lowered = path.casefold()
    if method == "DELETE" or any(token in lowered for token in ("/cancel", "/stop", "/delete")):
        return "destructive-or-cancellation/high"
    if any(token in lowered for token in ("/run", "/build", "/assist", "/workflow", "/mcp", "/webhook")):
        return "execution-or-external-io/high"
    if method in {"POST", "PUT", "PATCH"}:
        return "durable-mutation/high"
    if method in {"GET", "HEAD"}:
        return "read-or-disclosure/medium"
    return "unknown/review-required"


def profile_gate_for(path: str) -> str:
    if path.startswith("/api/mcp/"):
        return "mcp_server_enabled; additional top-level registration"
    if path.startswith("/api/v1/mcp/"):
        return "v1 registrar is unconditional; auth behavior is AUTO_LOGIN-sensitive"
    if path.startswith("/api/v1/agentic/"):
        return "router registered unconditionally; some behavior uses agentic_experience"
    if path.startswith("/api/v2/workflows"):
        return "developer API dependency"
    if path.startswith("/api/v1/webhook/"):
        return "WEBHOOK_AUTH_ENABLE changes authentication semantics"
    if path.startswith("/api/v1/deployments"):
        return "wxo_deployments feature flag"
    return "core/default profile or handler-local gate"


def walk(route_items: list[object], prefix: str = "") -> list[dict[str, object]]:
    collected: list[dict[str, object]] = []
    for item in route_items:
        if isinstance(item, APIRoute):
            dependencies = dependency_names(item.dependant)
            for method in sorted(item.methods or set()):
                path = prefix + item.path
                collected.append(
                    {
                        "method": method,
                        "path": path,
                        "endpoint": callable_name(item.endpoint),
                        "include_in_schema": item.include_in_schema,
                        "auth": auth_contract(dependencies),
                        "actor_source": actor_source(dependencies),
                        "scope": scope_for(path),
                        "risk": risk_for(method, path),
                        "profile_gate": profile_gate_for(path),
                        "review_status": (
                            "source-reviewed-current-sha"
                            if path.startswith(REVIEWED_PREFIXES)
                            else "runtime-inventory-only; independent source review pending"
                        ),
                        "dependencies": dependencies,
                        "tags": list(item.tags or []),
                    }
                )
        elif hasattr(item, "original_router") and hasattr(item, "include_context"):
            child_prefix = prefix + getattr(item.include_context, "prefix", "")
            collected.extend(walk(item.original_router.routes, child_prefix))
    return collected


def build_inventory() -> dict[str, object]:
    app = create_app()
    openapi = app.openapi()
    routes = sorted(walk(app.routes), key=lambda item: (item["path"], item["method"], item["endpoint"]))
    openapi_count = sum(
        1
        for path_item in openapi.get("paths", {}).values()
        for method in path_item
        if method.upper() in {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"}
    )
    plugins = sorted(
        {
            f"{entry_point.name}={entry_point.value}"
            for entry_point in importlib.metadata.entry_points(group="ketos.plugins")
        }
    )
    return {
        "schema_version": 1,
        "source_baseline_sha": BASELINE_SHA,
        "profile": "local-default-sanitized-no-lifespan",
        "runtime": {
            "app_title": app.title,
            "app_version": app.version,
            "openapi_path_count": len(openapi.get("paths", {})),
            "openapi_route_method_count": openapi_count,
            "route_method_registrations": len(routes),
            "hidden_route_method_count": sum(not route["include_in_schema"] for route in routes),
            "installed_plugin_entry_points": plugins,
        },
        "known_findings": [
            "G-01 CurrentActiveMCPUser accepts credential-less AUTO_LOGIN superuser",
            "G-02 WEBHOOK_AUTH_ENABLE=false runs unauthenticated as Flow owner",
            "G-03 protected build event/cancel accepts NULL-owner Job",
            "G-04 external MCP configuration is URL/subprocess capable",
            "G-05 legacy MCP post-back transport binding is not proven by route signature",
            "G-06 mcp_server_enabled adds a second /api/mcp surface in addition to /api/v1/mcp",
        ],
        "limitations": [
            "OpenAPI omits hidden routes; runtime recursion is the registration denominator.",
            "A populated field is not a security PASS: runtime-inventory-only rows remain review gaps.",
            "No application lifespan, request, external transport, migration, or database write was executed.",
        ],
        "unreviewed_route_method_count": sum(
            route["review_status"].startswith("runtime-inventory-only") for route in routes
        ),
        "routes": routes,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    payload = json.dumps(build_inventory(), indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
    print(payload, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
