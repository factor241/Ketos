"""Contract tests for the reviewed Batch C brand-environment consumers."""

from __future__ import annotations

import ast
from pathlib import Path

from kfx.brand_env import get_brand_env_policy

BACKEND_ROOT = Path(__file__).parents[2] / "base" / "ketos"

EXPECTED_SUFFIXES_BY_FILE = {
    "settings.py": {"DEV"},
    "__main__.py": {"DO_NOT_TRACK", "GUNICORN_PRELOAD", "LOG_LEVEL"},
    "main.py": {"LOG_LEVEL", "MODELS_DEV_REFRESH", "PROMETHEUS_PORT"},
    "server.py": {"DEBUG_FORK_GHOSTS"},
    "core/celeryconfig.py": {"REDIS_HOST", "REDIS_PORT"},
    "services/tracing/native.py": {"NATIVE_TRACING"},
    "services/telemetry/service.py": {"DESKTOP", "DO_NOT_TRACK"},
    "services/database/models/api_key/crud.py": {"API_KEY"},
    "utils/migration_lock.py": {"MIGRATION_LOCK_TIMEOUT_S"},
}


def _literal_string(node: ast.AST) -> str | None:
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else None


def _is_os_environment_read(node: ast.Call) -> bool:
    function = node.func
    if isinstance(function, ast.Attribute) and isinstance(function.value, ast.Name):
        return function.value.id == "os" and function.attr == "getenv"
    if not isinstance(function, ast.Attribute) or function.attr != "get":
        return False
    environ = function.value
    return (
        isinstance(environ, ast.Attribute)
        and isinstance(environ.value, ast.Name)
        and environ.value.id == "os"
        and environ.attr == "environ"
    )


def _resolver_calls(tree: ast.AST) -> list[ast.Call]:
    return [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "resolve_brand_env"
    ]


def test_batch_c_uses_policy_exact_resolver_without_direct_environment_reads() -> None:
    for relative_path, expected_suffixes in EXPECTED_SUFFIXES_BY_FILE.items():
        tree = ast.parse((BACKEND_ROOT / relative_path).read_text(encoding="utf-8"))
        forbidden_names = {name for suffix in expected_suffixes for name in (f"KETOS_{suffix}", f"LANGFLOW_{suffix}")}
        if "DO_NOT_TRACK" in expected_suffixes:
            forbidden_names.add("DO_NOT_TRACK")

        direct_reads = {
            _literal_string(node.args[0])
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and node.args
            and _is_os_environment_read(node)
            and _literal_string(node.args[0]) in forbidden_names
        }
        assert direct_reads == set(), f"{relative_path} bypasses the brand environment resolver: {direct_reads}"

        actual_suffixes: set[str] = set()
        for call in _resolver_calls(tree):
            if not call.args or (suffix := _literal_string(call.args[0])) not in expected_suffixes:
                continue
            policy = get_brand_env_policy(suffix)
            keywords = {keyword.arg: _literal_string(keyword.value) for keyword in call.keywords}
            assert keywords["sensitivity"] == policy.sensitivity
            assert keywords["conflict_policy"] == policy.conflict_policy
            actual_suffixes.add(suffix)

        assert actual_suffixes == expected_suffixes, (
            f"{relative_path} resolver coverage mismatch: expected={expected_suffixes}, actual={actual_suffixes}"
        )
