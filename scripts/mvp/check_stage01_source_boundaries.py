#!/usr/bin/env python3
# ruff: noqa: EM101, EM102, PERF401, PLR2004, S603, TRY003
"""Fail-closed Stage 01 source and registrar boundary audit."""

from __future__ import annotations

import ast
import re
import shutil
import subprocess
import sys
from collections import Counter
from pathlib import Path

BASELINE_SHA = "5fe1cb74fe8b2db8b48f66859cfbf72e56cf3782"
INTEGRATION_START_SHA = "1fb8d841c6af8f75706f4bb4fb4319732134cc12"

ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = ROOT / "src/backend/base/ketos"
STAGE01_BACKEND = BACKEND_ROOT / "agentic/services/ag_ui"
FRONTEND_ROOT = ROOT / "src/frontend"
RUNTIME_SOURCE_ROOT = ROOT / "src/copilot-runtime/src"

FORBIDDEN_PRODUCTION_TOKENS = (
    "CustomEvent",
    "EventEncoder",
    "text/event-stream",
    "_resume_claim_registry",
    "_thread_lock_registry",
    "Electron",
    "OpenSwarm",
    "dispatchEvent",
    "TextDecoder",
    "EventSource",
)
FORBIDDEN_E2E_TOKENS = ("Command(resume",)
MANUAL_E2E_PATTERNS = (
    re.compile(r"\b(?:page\.)?evaluate\s*\("),
    re.compile(r"\bpage\s*\.\s*request\s*\.\s*\w+\s*\("),
    re.compile(r"\brequest\s*\.\s*(?:fetch|post|put|patch|delete|get|head)\s*\("),
    re.compile(r"\b(?:window\s*\.\s*)?fetch\s*\("),
    re.compile(r"\bXMLHttpRequest\b"),
    re.compile(r"\baxios(?:\s*\.\s*\w+)?\s*\("),
    re.compile(r"\bdispatchEvent\s*\("),
    re.compile(r"\b\w+\s*=\s*(?:window\s*\.\s*)?fetch\b"),
    re.compile(r"\bwindow\s*\[\s*['\"]fetch['\"]\s*\]"),
    re.compile(r"\b\w+\s*=\s*axios\b"),
    re.compile(r"\b\w+\s*=\s*page\s*\.\s*request\b"),
    re.compile(r"\bsendBeacon\s*\("),
    re.compile(r"\bWebSocket\s*\("),
    re.compile(r"\b(?:evaluateHandle|\$eval|\$\$eval)\s*\("),
)
FORBIDDEN_TS_PRODUCTION_PATTERNS = (
    re.compile(r"\bTextDecoder\b"),
    re.compile(r"\bEventSource\b"),
    re.compile(r"text/event-stream"),
    re.compile(r"\bdispatchEvent\s*\("),
    re.compile(r"forwarded_?Props?[\s\S]{0,120}command[\s\S]{0,120}resume", re.IGNORECASE),
    re.compile(r"\bCommand\s*\([\s\S]{0,120}\bresume\b"),
)

ALLOWED_STAGE01_DIRECTORIES: tuple[str, ...] = ()
ALLOWED_STAGE01_FILES = {
    "brand/compatibility/stage5-env-contract-v1.yaml",
    "docs/dev/handoff/STAGE_01_AG_UI_ADMISSION.md",
    "docs/dev/handoff/STAGE_01_COPILOTKIT_AG_UI_BRIDGE.md",
    "docs/dev/handoff/STAGE_01_COPILOTKIT_AG_UI_RUNBOOK.md",
    "docs/dev/handoff/STAGE_01_TEMPORARY_FORK_DECISION.md",
    "pyproject.toml",
    "scripts/ci/release-lock-ownership.json",
    "scripts/ci/test_release_lock_ownership.py",
    "scripts/mvp/ag_ui_build_requirements.lock",
    "scripts/mvp/audit_copilotkit_artifact.py",
    "scripts/mvp/audit_copilotkit_provenance.py",
    "scripts/mvp/chat_stack_smoke.sh",
    "scripts/mvp/check_stage01_source_boundaries.py",
    "scripts/mvp/probe_ag_ui_adapter.py",
    "scripts/mvp/rebuild_copilotkit_artifact.py",
    "scripts/mvp/rebuild_ag_ui_artifact.py",
    "scripts/mvp/tests/test_audit_copilotkit_artifact.py",
    "scripts/mvp/tests/test_audit_copilotkit_provenance.py",
    "scripts/mvp/tests/test_check_stage01_source_boundaries.py",
    "scripts/mvp/tests/test_rebuild_copilotkit_artifact.py",
    "scripts/mvp/tests/test_rebuild_ag_ui_artifact.py",
    "scripts/mvp/tests/test_stage01_harness_paths.py",
    "src/backend/base/ketos/agentic/api/ag_ui_router.py",
    "src/backend/base/ketos/agentic/api/router.py",
    "src/backend/base/ketos/agentic/services/ag_ui/__init__.py",
    "src/backend/base/ketos/agentic/services/ag_ui/adapter.py",
    "src/backend/base/ketos/agentic/services/ag_ui/assembly.py",
    "src/backend/base/ketos/agentic/services/ag_ui/auth.py",
    "src/backend/base/ketos/agentic/services/ag_ui/checkpoint.py",
    "src/backend/base/ketos/agentic/services/ag_ui/hitl_probe.py",
    "src/backend/base/ketos/agentic/services/ag_ui/probe_state.py",
    "src/backend/base/ketos/agentic/services/ag_ui/probe_tools.py",
    "src/backend/base/ketos/agentic/services/ag_ui/run_binding.py",
    "src/backend/base/ketos/agentic/services/ag_ui/stage01_runtime.py",
    "src/backend/base/ketos/main.py",
    "src/backend/base/pyproject.toml",
    "src/backend/tests/unit/agentic/api/ag_ui_contract_fixtures.py",
    "src/backend/tests/unit/agentic/api/test_ag_ui_adapter_contract.py",
    "src/backend/tests/unit/agentic/api/test_ag_ui_auth.py",
    "src/backend/tests/unit/agentic/api/test_ag_ui_interrupt_resume.py",
    "src/backend/tests/unit/agentic/api/test_ag_ui_probe.py",
    "src/backend/tests/unit/agentic/api/test_ag_ui_stage01_runtime.py",
    "src/backend/tests/unit/agentic/api/test_ag_ui_tool_state.py",
    "src/backend/tests/unit/api/v1/test_endpoints.py",
    "src/copilot-runtime/package-lock.json",
    "src/copilot-runtime/package.json",
    "src/copilot-runtime/src/__tests__/runtime-transport.test.ts",
    "src/copilot-runtime/src/credential-forwarding.ts",
    "src/copilot-runtime/src/origin-guard.ts",
    "src/copilot-runtime/src/runtime-log-boundary.ts",
    "src/copilot-runtime/src/server.ts",
    "src/copilot-runtime/tsconfig.build.json",
    "src/copilot-runtime/tsconfig.json",
    "src/frontend/package-lock.json",
    "src/frontend/package.json",
    "src/frontend/playwright.mvp.config.ts",
    "src/frontend/postcss.config.js",
    "src/frontend/src/__tests__/stage01-copilotkit-proxy-boundary.test.ts",
    "src/frontend/src/__tests__/stage01-postcss-boundary.test.ts",
    "src/frontend/src/components/core/assistantPanel/__tests__/copilotkit-interrupt-probe.test.tsx",
    "src/frontend/src/components/core/assistantPanel/__tests__/copilotkit-probe.test.tsx",
    "src/frontend/src/components/core/assistantPanel/copilotkit-interrupt-probe.tsx",
    "src/frontend/src/components/core/assistantPanel/copilotkit-probe.tsx",
    "src/frontend/src/controllers/API/queries/config/use-get-config.ts",
    "src/frontend/src/pages/AppInitPage/index.tsx",
    "src/frontend/src/pages/AppInitPage/__tests__/app-init-page-config-ready.test.tsx",
    "src/frontend/src/pages/CopilotKitProbePage/__tests__/CopilotKitProbePage.test.tsx",
    "src/frontend/src/pages/CopilotKitProbePage/index.tsx",
    "src/frontend/src/routes.tsx",
    "src/frontend/src/stores/__tests__/utilityStore.test.ts",
    "src/frontend/src/stores/utilityStore.ts",
    "src/frontend/src/types/zustand/utility/config.ts",
    "src/frontend/tests/core/integrations/copilotkit-ag-ui-probe.spec.ts",
    "src/frontend/vite.config.mts",
    "src/kfx/src/kfx/brand_env.py",
    "src/kfx/src/kfx/services/settings/feature_flags.py",
    "src/kfx/tests/unit/services/settings/test_brand_env_inventory.py",
    "src/kfx/tests/unit/services/settings/test_feature_flags_brand_env.py",
    "uv.lock",
    "vendor/stage01/.gitattributes",
    "vendor/stage01/CopilotKit-c853ac2b78cb57481cc2ca58eda4a865908c532b-source.tar.gz",
    "vendor/stage01/ag-ui-langgraph-0.0.43+ketos.1-source.tar",
    "vendor/stage01/ag-ui-langgraph.provenance.json",
    "vendor/stage01/ag_ui_langgraph-0.0.43+ketos.1-py3-none-any.whl",
    "vendor/stage01/copilotkit-react-core-1.63.1-ketos.1.tgz",
    "vendor/stage01/manifest.json",
}


class BoundaryError(RuntimeError):
    """One Stage 01 source-boundary contract failed."""


def _display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def _git(*args: str) -> subprocess.CompletedProcess[str]:
    git = shutil.which("git")
    if git is None:
        raise BoundaryError("git executable is unavailable")
    return subprocess.run(
        [git, *args],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )


def _workspace_changed_paths() -> set[str]:
    commands = (
        ("diff", "--name-only", f"{INTEGRATION_START_SHA}...HEAD"),
        ("diff", "--cached", "--name-only"),
        ("diff", "--name-only"),
        ("ls-files", "--others", "--exclude-standard"),
    )
    paths: set[str] = set()
    for command in commands:
        result = _git(*command)
        if result.returncode != 0:
            raise BoundaryError(f"cannot resolve Stage 01 workspace paths: git {' '.join(command)}")
        paths.update(line for line in result.stdout.splitlines() if line)
    return paths


def _require_ancestry() -> None:
    for name, commit in (("baseline", BASELINE_SHA), ("integration start", INTEGRATION_START_SHA)):
        resolved = _git("rev-parse", "--verify", f"{commit}^{{commit}}")
        if resolved.returncode != 0 or resolved.stdout.strip() != commit:
            raise BoundaryError(f"Stage 01 {name} commit is missing or not exact")
        ancestor = _git("merge-base", "--is-ancestor", commit, "HEAD")
        if ancestor.returncode != 0:
            raise BoundaryError(f"current HEAD is not descended from the Stage 01 {name}")


def _parse_python(path: Path) -> ast.Module:
    try:
        source = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise BoundaryError(f"cannot read Stage 01 source: {path}") from exc
    try:
        return ast.parse(source, filename=str(path))
    except SyntaxError as exc:
        raise BoundaryError(f"cannot parse Stage 01 source: {path}") from exc


def _constant_string(node: ast.AST, constants: dict[str, str] | None = None) -> str | None:
    constants = constants or {}
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Name):
        return constants.get(node.id)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left = _constant_string(node.left, constants)
        right = _constant_string(node.right, constants)
        return None if left is None or right is None else left + right
    if isinstance(node, ast.JoinedStr):
        pieces: list[str] = []
        for value in node.values:
            if not isinstance(value, ast.Constant) or not isinstance(value.value, str):
                return None
            pieces.append(value.value)
        return "".join(pieces)
    return None


def _string_constants(tree: ast.Module) -> dict[str, str]:
    constants: dict[str, str] = {}
    assignments = [node for node in ast.walk(tree) if isinstance(node, (ast.Assign, ast.AnnAssign))]
    for _ in range(len(assignments) + 1):
        changed = False
        for node in assignments:
            value = node.value
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            folded = _constant_string(value, constants)
            if folded is None:
                continue
            for target in targets:
                if isinstance(target, ast.Name) and constants.get(target.id) != folded:
                    constants[target.id] = folded
                    changed = True
        if not changed:
            break
    return constants


def _call_count(path: Path, function_name: str) -> int:
    tree = _parse_python(path)
    aliases = {function_name}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            aliases.update(alias.asname or alias.name for alias in node.names if alias.name == function_name)
    dataflow_aliases = _dataflow_aliases(tree)
    return sum(
        isinstance(node, ast.Call)
        and (called := _expanded_access_chain(node.func, dataflow_aliases)) is not None
        and (called[-1] in aliases or called[-1] == function_name)
        for node in ast.walk(tree)
    )


def _unexpected_callers(paths: list[Path], function_name: str, allowed_path: Path) -> list[Path]:
    return [path for path in paths if path != allowed_path and _call_count(path, function_name) > 0]


def _registrar_reference_violations(
    paths: list[Path],
    function_name: str,
    provider_path: Path | None,
    owner_path: Path,
) -> list[str]:
    violations: list[str] = []
    owner_direct_calls = 0
    for path in paths:
        tree = _parse_python(path)
        string_constants = _string_constants(tree)
        imported_aliases = {function_name}
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                for alias in node.names:
                    if alias.name == function_name:
                        imported_aliases.add(alias.asname or alias.name)
                        if path not in {owner_path, provider_path}:
                            violations.append(f"{_display_path(path)}: imported registrar {function_name}")

        allowed_nodes: set[ast.AST] = set()
        if path == owner_path:
            for node in ast.walk(tree):
                if isinstance(node, ast.Call) and (
                    (isinstance(node.func, ast.Name) and node.func.id in imported_aliases)
                    or (isinstance(node.func, ast.Attribute) and node.func.attr == function_name)
                ):
                    allowed_nodes.add(node.func)
                    owner_direct_calls += 1

        for node in ast.walk(tree):
            is_name_reference = isinstance(node, ast.Name) and node.id in imported_aliases
            is_attr_reference = isinstance(node, ast.Attribute) and node.attr == function_name
            is_string_reference = _constant_string(node, string_constants) == function_name
            provider_export = path == provider_path and is_string_reference
            if (
                (is_name_reference or is_attr_reference or is_string_reference)
                and node not in allowed_nodes
                and not provider_export
            ):
                violations.append(f"{_display_path(path)}: relayed registrar reference {function_name}")

    if owner_direct_calls != 1:
        violations.append(
            f"{_display_path(owner_path)} must directly call {function_name} exactly once; found {owner_direct_calls}"
        )
    return violations


def _access_chain(node: ast.AST) -> tuple[str, ...] | None:
    if isinstance(node, ast.Name):
        return (node.id,)
    if isinstance(node, ast.Attribute):
        parent = _access_chain(node.value)
        return None if parent is None else (*parent, node.attr)
    if isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Constant) and isinstance(node.slice.value, str):
        parent = _access_chain(node.value)
        return None if parent is None else (*parent, node.slice.value)
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "getattr"
        and len(node.args) >= 2
        and isinstance(node.args[1], ast.Constant)
        and isinstance(node.args[1].value, str)
    ):
        parent = _access_chain(node.args[0])
        return None if parent is None else (*parent, node.args[1].value)
    return None


def _resolved_chain(
    node: ast.AST,
    aliases: dict[str, tuple[str, ...]],
    constants: dict[str, str],
) -> tuple[str, ...] | None:
    if isinstance(node, ast.Name):
        return aliases.get(node.id, (node.id,))
    if isinstance(node, ast.Attribute):
        parent = _resolved_chain(node.value, aliases, constants)
        return None if parent is None else (*parent, node.attr)
    if isinstance(node, ast.Subscript):
        key = _constant_string(node.slice, constants)
        parent = _resolved_chain(node.value, aliases, constants)
        return None if parent is None or key is None else (*parent, key)
    if isinstance(node, ast.Call):
        function = _resolved_chain(node.func, aliases, constants)
        if function and function[-1] == "getattr" and len(node.args) >= 2:
            key = _constant_string(node.args[1], constants)
            parent = _resolved_chain(node.args[0], aliases, constants)
            return None if parent is None or key is None else (*parent, key)
        if function and function[-1] in {"__import__", "import_module"} and node.args:
            module = _constant_string(node.args[0], constants)
            return None if module is None else tuple(module.split("."))
    return None


def _expanded_access_chain(node: ast.AST, aliases: dict[str, tuple[str, ...]]) -> tuple[str, ...] | None:
    chain = _access_chain(node)
    if chain and chain[0] in aliases:
        return (*aliases[chain[0]], *chain[1:])
    return chain


def _dataflow_aliases(tree: ast.Module) -> dict[str, tuple[str, ...]]:
    assignments: list[tuple[str, ast.AST]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            assignments.extend((target.id, node.value) for target in node.targets if isinstance(target, ast.Name))
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.value is not None:
            assignments.append((node.target.id, node.value))

    aliases: dict[str, tuple[str, ...]] = {"getattr": ("getattr",), "__import__": ("__import__",)}
    constants = _string_constants(tree)
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            for alias in node.names:
                aliases[alias.asname or alias.name] = (*node.module.split("."), alias.name)
        elif isinstance(node, ast.Import):
            for alias in node.names:
                aliases[alias.asname or alias.name.split(".")[0]] = tuple(alias.name.split("."))
    # A bounded fixed point resolves chained aliases without risking cycles.
    for _ in range(len(assignments) + 1):
        changed = False
        for name, value in assignments:
            chain = _resolved_chain(value, aliases, constants)
            if chain is not None and aliases.get(name) != chain:
                aliases[name] = chain
                changed = True
        if not changed:
            break
    return aliases


def _python_bypass_violations(path: Path) -> list[str]:
    tree = _parse_python(path)
    dataflow_aliases = _dataflow_aliases(tree)
    constants = _string_constants(tree)
    command_names = {"Command"}
    command_modules: set[str] = set()
    violations: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == "langgraph.types":
            command_names.update(alias.asname or alias.name for alias in node.names if alias.name == "Command")
            if any(alias.name == "Command" for alias in node.names):
                violations.append("production langgraph Command reference")
        elif isinstance(node, ast.Import):
            command_modules.update(
                alias.asname or alias.name for alias in node.names if alias.name == "langgraph.types"
            )
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        value = node.value
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        if isinstance(value, ast.Call):
            factory = _expanded_access_chain(value.func, dataflow_aliases)
            if (
                factory
                and factory[-1] == "getattr"
                and len(value.args) >= 2
                and isinstance(value.args[1], ast.Constant)
                and value.args[1].value == "Command"
            ):
                command_names.update(target.id for target in targets if isinstance(target, ast.Name))

    for node in ast.walk(tree):
        chain = _resolved_chain(node, dataflow_aliases, constants)
        if (
            chain
            and len(chain) >= 3
            and chain[-3:]
            in {
                ("forwardedProps", "command", "resume"),
                ("forwarded_props", "command", "resume"),
            }
        ):
            violations.append("deprecated forwardedProps command resume access")
        if isinstance(node, ast.Call) and any(keyword.arg == "resume" for keyword in node.keywords):
            called = _resolved_chain(node.func, dataflow_aliases, constants)
            is_command_module_call = (
                called is not None and len(called) > 1 and called[0] in command_modules and called[-1] == "Command"
            )
            dynamic_command = (
                isinstance(node.func, ast.Call)
                and isinstance(node.func.func, ast.Name)
                and node.func.func.id == "getattr"
                and len(node.func.args) >= 2
                and isinstance(node.func.args[1], ast.Constant)
                and node.func.args[1].value == "Command"
            )
            if (called and (called[-1] in command_names or is_command_module_call)) or dynamic_command:
                violations.append("local Command(resume=...) construction")
        if isinstance(node, ast.Call):
            called = _resolved_chain(node.func, dataflow_aliases, constants)
            if called and called[-1] in {"__import__", "import_module"} and node.args:
                module = _constant_string(node.args[0], constants)
                if module == "langgraph.types":
                    violations.append("dynamic langgraph.types import")
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            imported = " ".join(alias.name for alias in node.names)
            if "CustomEvent" in imported or "EventEncoder" in imported:
                violations.append("custom event or encoder import")
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            lowered = node.name.lower()
            if "ag_ui" in lowered and any(word in lowered for word in ("parse", "encode", "decode")):
                violations.append("local AG-UI parser or encoder")
    return violations


def _require_exact_registrar_chain() -> None:
    expected = (
        (None, STAGE01_BACKEND / "adapter.py", "add_langgraph_fastapi_endpoint"),
        (
            STAGE01_BACKEND / "adapter.py",
            BACKEND_ROOT / "agentic/api/ag_ui_router.py",
            "register_langgraph_endpoint",
        ),
        (
            BACKEND_ROOT / "agentic/api/ag_ui_router.py",
            BACKEND_ROOT / "agentic/api/router.py",
            "create_ag_ui_router",
        ),
        (
            BACKEND_ROOT / "agentic/api/router.py",
            STAGE01_BACKEND / "stage01_runtime.py",
            "register_stage01_ag_ui",
        ),
        (
            STAGE01_BACKEND / "stage01_runtime.py",
            BACKEND_ROOT / "main.py",
            "compose_stage01_lifespan",
        ),
    )
    all_python = [path for path in BACKEND_ROOT.rglob("*.py") if "tests" not in path.parts]
    violations: list[str] = []
    for provider_path, owner_path, function_name in expected:
        violations.extend(_registrar_reference_violations(all_python, function_name, provider_path, owner_path))
    if violations:
        raise BoundaryError("registrar chain violations:\n" + "\n".join(sorted(set(violations))))


def _production_sources(changed_paths: set[str]) -> list[Path]:
    sources: list[Path] = []
    for relative in sorted(changed_paths):
        path = ROOT / relative
        if not path.is_file() or "__tests__" in path.parts or "tests" in path.parts:
            continue
        is_code_or_config = path.suffix in {".py", ".sh", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".mts"}
        if is_code_or_config and "vendor" not in path.parts:
            sources.append(path)
    return sources


ROUTE_MUTATORS = {
    "include_router",
    "add_api_route",
    "add_route",
    "mount",
    "api_route",
    "get",
    "post",
    "put",
    "patch",
    "delete",
}


def _route_fingerprints(tree: ast.Module) -> Counter[str]:
    aliases = _dataflow_aliases(tree)
    constants = _string_constants(tree)
    decorators = {
        decorator
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
        for decorator in node.decorator_list
    }
    fingerprints: Counter[str] = Counter()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        called = _resolved_chain(node.func, aliases, constants)
        if not called or called[-1] not in ROUTE_MUTATORS:
            continue
        if called[-1] in {"get", "post", "put", "patch", "delete"} and node not in decorators:
            continue
        fingerprints[ast.dump(node, include_attributes=False)] += 1
    return fingerprints


def _baseline_python(relative: str) -> str:
    result = _git("show", f"{INTEGRATION_START_SHA}:{relative}")
    return result.stdout if result.returncode == 0 else ""


def _allowed_stage01_route_fingerprints() -> dict[str, Counter[str]]:
    snippets = {
        "src/backend/base/ketos/agentic/api/ag_ui_router.py": "router.include_router(private_app.router)",
        "src/backend/base/ketos/agentic/api/router.py": (
            'app.include_router(stage01_router, prefix="/api/v1/agentic", tags=["Agentic"])'
        ),
    }
    return {relative: _route_fingerprints(ast.parse(source)) for relative, source in snippets.items()}


def _route_boundary_violations(paths: list[Path], baseline_sources: dict[str, str] | None = None) -> list[str]:
    route_sources = [path for path in paths if path.suffix == ".py" and path.is_relative_to(BACKEND_ROOT)]
    allowed = _allowed_stage01_route_fingerprints()
    ag_ui_paths: list[tuple[str, str]] = []
    violations: list[str] = []
    for path in route_sources:
        relative = str(path.relative_to(ROOT))
        tree = _parse_python(path)
        current = _route_fingerprints(tree)
        baseline_source = (
            baseline_sources.get(relative, "") if baseline_sources is not None else _baseline_python(relative)
        )
        baseline = _route_fingerprints(ast.parse(baseline_source)) if baseline_source else Counter()
        extras = current - baseline - allowed.get(relative, Counter())
        if extras:
            violations.append(f"{relative}: unapproved route mutation {list(extras.elements())}")

        constants = _string_constants(tree)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            for value_node in [*node.args, *(keyword.value for keyword in node.keywords)]:
                value = _constant_string(value_node, constants)
                if value and value.startswith("/") and "ag-ui" in value:
                    ag_ui_paths.append((relative, value))

    expected_path = [("src/backend/base/ketos/agentic/api/ag_ui_router.py", "/ag-ui")]
    if ag_ui_paths != expected_path:
        violations.append(f"AG-UI route path ownership mismatch: {ag_ui_paths}")
    return violations


def _e2e_transport_violations(source: str) -> list[str]:
    violations: list[str] = []
    if re.search(r"\b(?:window|globalThis)\s*\[", source):
        violations.append("computed browser global access")
    forbidden_symbols = re.compile(
        r"(?<![A-Za-z0-9_])(?:fetch|axios|XMLHttpRequest|sendBeacon|WebSocket|evaluate|evaluateHandle|"
        r"dispatchEvent|\$eval|\$\$eval)(?![A-Za-z0-9_])"
    )
    for line_number, line in enumerate(source.splitlines(), start=1):
        if forbidden_symbols.search(line):
            violations.append(f"line {line_number}: forbidden browser transport symbol")
        if re.search(r"(?<![A-Za-z0-9_])request(?![A-Za-z0-9_])", line):
            passive = (
                "response.request()" in line
                or 'page.on("request"' in line
                or "Approval request" in line
                or "approval request" in line
            )
            if not passive:
                violations.append(f"line {line_number}: non-passive request identifier")
        collapsed = re.sub(r"[\s'\"`+]", "", line)
        has_string_concatenation = bool(
            re.search(r"['\"][^'\"]*['\"]\s*\+\s*['\"][^'\"]*['\"]", line)
        )
        if has_string_concatenation and any(
            symbol in collapsed
            for symbol in ("fetch", "request", "evaluate", "sendBeacon", "WebSocket", "axios", "XMLHttpRequest")
        ):
            violations.append(f"line {line_number}: computed browser transport symbol")
    for pattern in MANUAL_E2E_PATTERNS:
        if pattern.search(source):
            violations.append(f"manual browser transport {pattern.pattern}")
    return violations


def _shell_bypass_violations(source: str) -> list[str]:
    violations = [token for token in FORBIDDEN_PRODUCTION_TOKENS if token in source]
    if re.search(r"\bpython(?:3(?:\.\d+)?)?\s+-c\b", source):
        violations.append("python -c")
    if "curl" in source and re.search(
        r"forwarded_?Props?|Command\s*\(\s*resume|command[^\n]{0,120}resume",
        source,
        re.IGNORECASE,
    ):
        violations.append("curl manual resume")
    return violations


def _require_no_bypass_tokens() -> None:
    changed_paths = _workspace_changed_paths()
    production_sources = _production_sources(changed_paths)
    violations: list[str] = []
    for path in production_sources:
        source = path.read_text(encoding="utf-8")
        if path.suffix == ".py":
            violations.extend(f"{path.relative_to(ROOT)}: {item}" for item in _python_bypass_violations(path))
            if path.is_relative_to(STAGE01_BACKEND) or path.name == "ag_ui_router.py":
                for token in FORBIDDEN_PRODUCTION_TOKENS:
                    if token in source:
                        violations.append(f"{path.relative_to(ROOT)}: {token}")
        elif path.suffix == ".sh":
            violations.extend(
                f"{path.relative_to(ROOT)}: shell custom protocol token {token}"
                for token in _shell_bypass_violations(source)
            )
        elif path.suffix in {".js", ".mjs", ".cjs", ".ts", ".tsx", ".mts"}:
            for pattern in FORBIDDEN_TS_PRODUCTION_PATTERNS:
                if pattern.search(source):
                    violations.append(f"{path.relative_to(ROOT)}: custom transport {pattern.pattern}")

    violations.extend(_route_boundary_violations(production_sources))

    e2e_path = FRONTEND_ROOT / "tests/core/integrations/copilotkit-ag-ui-probe.spec.ts"
    e2e_source = e2e_path.read_text(encoding="utf-8")
    admitted_api_literal = "/api/copilotkit/agent/ketos-mvp-probe/run"
    api_literals = re.findall(r"['\"](/api/(?:copilotkit|v1/agentic/ag-ui)[^'\"]*)['\"]", e2e_source)
    if api_literals != [admitted_api_literal]:
        violations.append(f"{e2e_path.relative_to(ROOT)}: API literal ownership mismatch {api_literals}")
    for token in FORBIDDEN_E2E_TOKENS:
        if token in e2e_source:
            violations.append(f"{e2e_path.relative_to(ROOT)}: {token}")
    violations.extend(f"{e2e_path.relative_to(ROOT)}: {item}" for item in _e2e_transport_violations(e2e_source))
    if violations:
        raise BoundaryError("forbidden Stage 01 bypasses:\n" + "\n".join(sorted(violations)))


def _require_frontend_route_ownership() -> None:
    routes = (FRONTEND_ROOT / "src/routes.tsx").read_text(encoding="utf-8")
    if routes.count('path="mvp/copilotkit-probe"') != 1:
        raise BoundaryError("the protected MVP probe route must be declared exactly once")
    if routes.count('path="flow/:id/"') != 1:
        raise BoundaryError("the legacy flow route must remain declared exactly once")

    allowed_interrupt_importers = {
        FRONTEND_ROOT / "src/components/core/assistantPanel/copilotkit-probe.tsx",
    }
    importers = {
        path
        for path in (FRONTEND_ROOT / "src").rglob("*.ts*")
        if "__tests__" not in path.parts and "copilotkit-interrupt-probe" in path.read_text(encoding="utf-8")
    }
    if importers != allowed_interrupt_importers:
        rendered = ", ".join(str(path.relative_to(ROOT)) for path in sorted(importers))
        raise BoundaryError(f"interrupt probe import ownership mismatch: {rendered}")


def _require_changed_path_ownership() -> None:
    changed_paths = _workspace_changed_paths()
    unowned = [
        path
        for path in sorted(changed_paths)
        if path not in ALLOWED_STAGE01_FILES
        and not any(path.startswith(directory) for directory in ALLOWED_STAGE01_DIRECTORIES)
    ]
    if unowned:
        raise BoundaryError("Stage 01 changed path is not owned:\n" + "\n".join(unowned))


def main() -> int:
    try:
        _require_ancestry()
        _require_exact_registrar_chain()
        _require_no_bypass_tokens()
        _require_frontend_route_ownership()
        _require_changed_path_ownership()
    except (BoundaryError, OSError, SyntaxError) as exc:
        print(f"stage01-source-boundary: FAIL: {exc}", file=sys.stderr)
        return 1
    print("stage01-source-boundary: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
