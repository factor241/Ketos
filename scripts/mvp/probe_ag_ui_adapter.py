#!/usr/bin/env python3
"""Fail-closed admission probe for an installed AG-UI LangGraph adapter.

The probe intentionally has no dependency on Ketos. Run it inside an isolated
environment containing exactly one candidate adapter, and pass the registry-
verified artifact SHA-256 separately. External package content is inspected as
untrusted data; absence or ambiguity is a failed contract, never an inference.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import importlib
import importlib.metadata
import inspect
import json
import re
import tarfile
import textwrap
import zipfile
from email.parser import BytesParser
from email.policy import default as email_policy
from pathlib import Path, PurePosixPath
from types import SimpleNamespace
from typing import Any, NoReturn, get_args, get_origin

import tomllib

REQUIRED_CONTRACTS = (
    "constructor_api",
    "standard_run_finished_interrupt",
    "run_agent_input_resume_array",
    "all_open_interrupts",
    "safe_pre_dispatch_binding",
    "deprecated_forwarded_props_resume_absent",
)
SHA256_HEX_LENGTH = 64
REQUIRED_ARCHIVE_SOURCES = (
    "ag_ui_langgraph/agent.py",
    "ag_ui_langgraph/endpoint.py",
)
ARTIFACT_STRING_FIELDS = (
    "name",
    "version",
    "identity",
    "path",
    "archive_kind",
    "metadata_path",
    "sha256",
    "license",
    "license_path",
    "license_sha256",
    "license_source",
    "requires_python",
)
ARTIFACT_BINDINGS = (
    "archive_identity_bound",
    "runtime_identity_bound",
    "runtime_source_bound",
)
FORK_PROVENANCE_FIELDS = frozenset(
    {
        "artifact_kind",
        "package_name",
        "package_version",
        "approved_owner",
        "canonical_repo_url",
        "upstream_base_sha",
        "fork_commit_sha",
        "artifact_filename",
        "artifact_sha256",
        "source_archive_sha256",
        "license_spdx",
        "license_sha256",
        "changed_files",
        "build_command",
        "test_command",
    }
)
APPROVED_FORK_OWNER = "factor241"
APPROVED_FORK_REPOSITORY = "https://github.com/factor241/ag-ui"
APPROVED_FORK_PACKAGE = "ag-ui-langgraph"
APPROVED_FORK_SOURCE_FILES = frozenset(
    {
        "integrations/langgraph/python/ag_ui_langgraph/agent.py",
        "integrations/langgraph/python/ag_ui_langgraph/endpoint.py",
    }
)
APPROVED_FORK_TEST_PREFIX = "integrations/langgraph/python/tests/"


def _invalid(message: str) -> NoReturn:
    raise ValueError(message)


def evaluate_candidate(evidence: dict[str, Any]) -> dict[str, Any]:
    """Return a deterministic admission decision from collected evidence."""
    artifact = evidence.get("artifact") or {}
    contracts = evidence.get("contracts") or {}
    reasons: list[str] = []

    if artifact.get("version") == "0.0.42" and artifact.get("identity") == "ag-ui-langgraph==0.0.42":
        reasons.append("0.0.42")

    for key in ARTIFACT_STRING_FIELDS:
        value = artifact.get(key)
        if not isinstance(value, str) or not value.strip():
            reasons.append(f"artifact.{key}")

    reasons.extend(f"artifact.{key}" for key in ARTIFACT_BINDINGS if artifact.get(key) is not True)

    digest = artifact.get("sha256")
    if isinstance(digest, str) and (
        len(digest) != SHA256_HEX_LENGTH or any(char not in "0123456789abcdef" for char in digest.lower())
    ):
        reasons.append("artifact.sha256")

    reasons.extend(contract for contract in REQUIRED_CONTRACTS if contracts.get(contract) is not True)

    return {"admitted": not reasons, "reasons": list(dict.fromkeys(reasons))}


def _source(module: Any) -> str | None:
    try:
        return inspect.getsource(module)
    except (OSError, TypeError):
        return None


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _bytes_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _canonical_name(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _normalized_specifier(value: str) -> tuple[str, ...]:
    return tuple(sorted(part.strip() for part in value.split(",") if part.strip()))


def _exact_sha256(value: Any, description: str) -> str:
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
        _invalid(f"{description} must be a lowercase 64-character SHA-256")
    return value


def _exact_git_sha(value: Any, description: str) -> str:
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{40}", value) is None:
        _invalid(f"{description} must be an exact lowercase 40-character commit SHA")
    return value


def _approved_changed_file(value: Any) -> bool:
    if not isinstance(value, str) or not value or "\\" in value:
        return False
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or any(char in value for char in "*?[]"):
        return False
    return value in APPROVED_FORK_SOURCE_FILES or (
        value.startswith(APPROVED_FORK_TEST_PREFIX) and value.endswith(".py")
    )


def validate_fork_provenance(
    provenance: dict[str, Any],
    *,
    artifact_path: Path,
    source_archive_path: Path | None,
    artifact: dict[str, Any],
) -> dict[str, Any]:
    """Bind an approved fork declaration to immutable local artifact bytes."""
    if set(provenance) != FORK_PROVENANCE_FIELDS:
        missing = sorted(FORK_PROVENANCE_FIELDS - set(provenance))
        extra = sorted(set(provenance) - FORK_PROVENANCE_FIELDS)
        _invalid(f"fork provenance must contain exact fields; missing={missing}, extra={extra}")

    kind = provenance["artifact_kind"]
    if kind not in {"wheel", "tgz"}:
        _invalid("artifact_kind must be exactly 'wheel' or 'tgz'")
    if provenance["package_name"] != APPROVED_FORK_PACKAGE:
        _invalid(f"package_name must be {APPROVED_FORK_PACKAGE}")
    package_version = provenance["package_version"]
    if (
        not isinstance(package_version, str)
        or re.fullmatch(
            r"[0-9]+(?:\.[0-9]+){1,2}(?:[A-Za-z0-9.+-]*)?",
            package_version,
        )
        is None
    ):
        _invalid("package_version must be an exact non-floating version")
    if provenance["approved_owner"] != APPROVED_FORK_OWNER:
        _invalid(f"approved owner must be {APPROVED_FORK_OWNER}")
    if provenance["canonical_repo_url"] != APPROVED_FORK_REPOSITORY:
        _invalid(f"canonical repository must be {APPROVED_FORK_REPOSITORY}")

    upstream_sha = _exact_git_sha(provenance["upstream_base_sha"], "upstream base commit")
    fork_sha = _exact_git_sha(provenance["fork_commit_sha"], "fork commit")
    if upstream_sha == fork_sha:
        _invalid("fork commit must differ from upstream base commit")

    resolved_artifact = artifact_path.resolve(strict=True)
    if provenance["artifact_filename"] != resolved_artifact.name:
        _invalid("artifact filename does not match the supplied artifact")
    artifact_sha = _exact_sha256(provenance["artifact_sha256"], "artifact SHA-256")
    if artifact_sha != _sha256(resolved_artifact):
        _invalid("artifact SHA-256 mismatch")

    resolved_source = (
        resolved_artifact
        if kind == "tgz" and source_archive_path is None
        else source_archive_path.resolve(strict=True)
        if source_archive_path is not None
        else None
    )
    if resolved_source is None:
        _invalid("source archive path is required for a wheel fork artifact")
    source_sha = _exact_sha256(provenance["source_archive_sha256"], "source archive SHA-256")
    if source_sha != _sha256(resolved_source):
        _invalid("source archive SHA-256 mismatch")

    if provenance["license_spdx"] != "MIT" or artifact.get("license") != "MIT":
        _invalid("license SPDX must match the artifact MIT declaration")
    license_sha = _exact_sha256(provenance["license_sha256"], "license SHA-256")
    if license_sha != artifact.get("license_sha256"):
        _invalid("license SHA-256 mismatch")
    if artifact.get("name") != provenance["package_name"]:
        _invalid("fork package name does not match the artifact")
    if artifact.get("version") != package_version:
        _invalid("fork package version does not match the artifact")

    changed_files = provenance["changed_files"]
    if (
        not isinstance(changed_files, list)
        or not changed_files
        or not all(isinstance(item, str) for item in changed_files)
        or len(changed_files) != len(set(changed_files))
        or not all(_approved_changed_file(item) for item in changed_files)
    ):
        _invalid("changed_files must be a unique non-empty approved path allowlist")

    for field in ("build_command", "test_command"):
        command = provenance[field]
        if not isinstance(command, str) or fork_sha not in command:
            _invalid(f"{field} must bind the exact fork commit {fork_sha}")
        if re.search(
            r"(?:^|[/@\s])(main|master|head|latest)(?:$|[/@\s])",
            command,
            re.IGNORECASE,
        ):
            _invalid(f"{field} contains a floating ref instead of the fork commit")

    return {
        **provenance,
        "bound": True,
        "artifact_path": str(resolved_artifact),
        "source_archive_path": str(resolved_source),
    }


def load_fork_provenance(path: Path) -> dict[str, Any]:
    """Load a provenance sidecar as untrusted JSON data."""
    resolved = path.resolve(strict=True)
    parsed = json.loads(resolved.read_text(encoding="utf-8"))
    if not isinstance(parsed, dict):
        _invalid("fork provenance JSON must contain one object")
    return parsed


def _safe_archive_names(names: list[str]) -> None:
    for name in names:
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts:
            _invalid(f"unsafe archive member: {name}")


def _one(items: list[str], description: str) -> str:
    if len(items) != 1:
        _invalid(f"expected exactly one {description}, found {len(items)}")
    return items[0]


def _license_member(names: list[str], root: str, declared: list[str]) -> str:
    candidates: list[str] = []
    for item in declared:
        expected = f"{root}/{item}" if root else item
        if expected in names:
            candidates.append(expected)
            continue
        basename = PurePosixPath(item).name
        candidates.extend(
            name
            for name in names
            if PurePosixPath(name).name == basename
            and ("licenses" in PurePosixPath(name).parts or name.startswith(f"{root}/"))
        )
    unique = list(dict.fromkeys(candidates))
    return _one(unique, "declared license file")


def _wheel_artifact(path: Path) -> dict[str, Any]:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        _safe_archive_names(names)
        metadata_path = _one(
            [name for name in names if name.endswith(".dist-info/METADATA")],
            "wheel METADATA",
        )
        metadata = BytesParser(policy=email_policy).parsebytes(archive.read(metadata_path))
        name = str(metadata.get("Name") or "").strip()
        version = str(metadata.get("Version") or "").strip()
        license_name = str(metadata.get("License-Expression") or metadata.get("License") or "").strip()
        requires_python = str(metadata.get("Requires-Python") or "").strip()
        if not all((name, version, license_name, requires_python)):
            _invalid("wheel METADATA lacks required identity/license/Python fields")
        declared_licenses = [str(item) for item in metadata.get_all("License-File", [])]
        if not declared_licenses:
            _invalid("wheel METADATA does not declare a license file")
        dist_info_root = str(PurePosixPath(metadata_path).parent)
        license_path = _license_member(names, dist_info_root, declared_licenses)
        missing_sources = [source for source in REQUIRED_ARCHIVE_SOURCES if source not in names]
        if missing_sources:
            _invalid(f"artifact missing required source: {', '.join(missing_sources)}")
        source_sha256 = {source: _bytes_sha256(archive.read(source)) for source in REQUIRED_ARCHIVE_SOURCES}
        license_bytes = archive.read(license_path)
    return {
        "name": name,
        "version": version,
        "identity": f"{_canonical_name(name)}=={version}",
        "path": path.name,
        "archive_kind": "wheel",
        "metadata_path": metadata_path,
        "sha256": _sha256(path),
        "license": license_name,
        "license_path": license_path,
        "license_sha256": _bytes_sha256(license_bytes),
        "license_source": "artifact",
        "requires_python": requires_python,
        "source_sha256": source_sha256,
        "archive_identity_bound": True,
    }


def _source_artifact(path: Path) -> dict[str, Any]:
    with tarfile.open(path) as archive:
        members = [member for member in archive.getmembers() if member.isfile()]
        names = [member.name for member in members]
        _safe_archive_names(names)
        commit = str(archive.pax_headers.get("comment") or "")
        if not re.fullmatch(r"[0-9a-f]{40}", commit):
            _invalid("source archive lacks a bound 40-character git commit")
        projects: list[tuple[str, dict[str, Any]]] = []
        for name in names:
            if not name.endswith("pyproject.toml"):
                continue
            file_object = archive.extractfile(name)
            if file_object is None:
                continue
            parsed = tomllib.loads(file_object.read().decode("utf-8"))
            project = parsed.get("project") or {}
            if _canonical_name(str(project.get("name") or "")) == "ag-ui-langgraph":
                projects.append((name, project))
        if len(projects) != 1:
            _invalid(f"expected exactly one ag-ui-langgraph pyproject.toml, found {len(projects)}")
        metadata_path, project = projects[0]
        root_path = PurePosixPath(metadata_path).parent
        root = "" if str(root_path) == "." else str(root_path)
        name = str(project.get("name") or "").strip()
        version = str(project.get("version") or "").strip()
        license_value = project.get("license")
        license_name = (
            str(license_value.get("text") or "").strip()
            if isinstance(license_value, dict)
            else str(license_value or "").strip()
        )
        requires_python = str(project.get("requires-python") or "").strip()
        if not all((name, version, license_name, requires_python)):
            _invalid("source pyproject lacks required identity/license/Python fields")
        declared_licenses = [str(item) for item in project.get("license-files") or []]
        if not declared_licenses:
            _invalid("source pyproject does not declare a license file")
        license_path = _license_member(names, root, declared_licenses)
        source_members = {source: f"{root}/{source}" if root else source for source in REQUIRED_ARCHIVE_SOURCES}
        missing_sources = [source for source, member in source_members.items() if member not in names]
        if missing_sources:
            _invalid(f"artifact missing required source: {', '.join(missing_sources)}")
        source_sha256: dict[str, str] = {}
        for source, member in source_members.items():
            file_object = archive.extractfile(member)
            if file_object is None:
                _invalid(f"artifact missing required source: {source}")
            source_sha256[source] = _bytes_sha256(file_object.read())
        license_file = archive.extractfile(license_path)
        if license_file is None:
            _invalid("artifact license file cannot be read")
        license_bytes = license_file.read()
    subdirectory = root or "."
    return {
        "name": name,
        "version": version,
        "identity": f"git:{commit}#subdirectory={subdirectory}",
        "path": path.name,
        "archive_kind": "git-archive",
        "metadata_path": metadata_path,
        "sha256": _sha256(path),
        "git_commit": commit,
        "license": license_name,
        "license_path": license_path,
        "license_sha256": _bytes_sha256(license_bytes),
        "license_source": "artifact",
        "requires_python": requires_python,
        "source_sha256": source_sha256,
        "archive_identity_bound": True,
    }


def inspect_artifact(artifact_path: Path | None) -> dict[str, Any]:
    """Derive candidate identity and integrity only from a mandatory archive."""
    if artifact_path is None:
        _invalid("artifact path is required")
    path = artifact_path.resolve(strict=True)
    if not path.is_file():
        _invalid(f"artifact path is not a file: {path}")
    if zipfile.is_zipfile(path):
        return _wheel_artifact(path)
    if tarfile.is_tarfile(path):
        return _source_artifact(path)
    _invalid(f"unsupported candidate artifact format: {path.name}")


def bind_runtime_to_artifact(artifact: dict[str, Any], runtime: dict[str, Any]) -> dict[str, bool]:
    """Require installed metadata and source bytes to match the candidate archive."""
    identity = (
        _canonical_name(str(artifact.get("name") or "")) == _canonical_name(str(runtime.get("name") or ""))
        and artifact.get("version") == runtime.get("version")
        and str(artifact.get("license") or "").strip().lower() == str(runtime.get("license") or "").strip().lower()
        and _normalized_specifier(str(artifact.get("requires_python") or ""))
        == _normalized_specifier(str(runtime.get("requires_python") or ""))
    )
    source = artifact.get("source_sha256") == runtime.get("source_sha256")
    return {"identity": identity, "source": source}


def _normalized_access_name(value: str) -> str:
    return "forwarded_props" if value in {"forwardedProps", "forwarded_props"} else value


class _DeprecatedResumeAccessVisitor(ast.NodeVisitor):
    """Track aliases that flow from input.forwardedProps to command.resume."""

    def __init__(self) -> None:
        self._environments: list[dict[str, tuple[str, ...]]] = [{}]
        self.found = False

    @property
    def environment(self) -> dict[str, tuple[str, ...]]:
        return self._environments[-1]

    def _record(self, path: tuple[str, ...] | None) -> tuple[str, ...] | None:
        if path is not None:
            normalized = tuple(_normalized_access_name(item) for item in path)
            for index in range(len(normalized) - 2):
                if normalized[index : index + 3] == (
                    "forwarded_props",
                    "command",
                    "resume",
                ):
                    self.found = True
                    break
        return path

    def _path(self, node: ast.AST | None) -> tuple[str, ...] | None:
        if node is None:
            return None
        if isinstance(node, ast.Name):
            path = self.environment.get(node.id)
            if path is None and node.id in {"input", "input_data"}:
                path = (node.id,)
            return self._record(path)
        if isinstance(node, ast.Attribute):
            base = self._path(node.value)
            return self._record((*base, node.attr) if base is not None else None)
        if isinstance(node, ast.Subscript):
            base = self._path(node.value)
            key = node.slice.value if isinstance(node.slice, ast.Constant) else None
            return self._record((*base, str(key)) if base is not None and isinstance(key, str) else None)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            base = self._path(node.func.value)
            if node.func.attr == "get" and node.args and isinstance(node.args[0], ast.Constant):
                key = node.args[0].value
                return self._record((*base, str(key)) if base is not None and isinstance(key, str) else None)
            if node.func.attr in {"items", "keys", "values", "copy"}:
                return self._record(base)
            return None
        if isinstance(node, (ast.BoolOp, ast.IfExp)):
            values = node.values if isinstance(node, ast.BoolOp) else [node.body, node.orelse]
            return next((path for value in values if (path := self._path(value)) is not None), None)
        if isinstance(node, (ast.DictComp, ast.ListComp, ast.SetComp, ast.GeneratorExp)):
            return next(
                (path for generator in node.generators if (path := self._path(generator.iter)) is not None),
                None,
            )
        return None

    def _bind(self, target: ast.AST, path: tuple[str, ...] | None) -> None:
        if isinstance(target, ast.Name):
            if path is None:
                self.environment.pop(target.id, None)
            else:
                self.environment[target.id] = path

    def visit_Assign(self, node: ast.Assign) -> None:
        path = self._path(node.value)
        for target in node.targets:
            self._bind(target, path)
        self.generic_visit(node.value)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        self._bind(node.target, self._path(node.value))
        if node.value is not None:
            self.generic_visit(node.value)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._environments.append({})
        for statement in node.body:
            self.visit(statement)
        self._environments.pop()

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self.visit_FunctionDef(node)

    def generic_visit(self, node: ast.AST) -> None:
        if isinstance(node, ast.expr):
            self._path(node)
        super().generic_visit(node)


def uses_deprecated_forwarded_props_resume(source: str) -> bool:
    """Detect actual AST/data flow from forwardedProps through command to resume."""
    try:
        tree = ast.parse(textwrap.dedent(source))
    except SyntaxError:
        return False
    visitor = _DeprecatedResumeAccessVisitor()
    visitor.visit(tree)
    return visitor.found


def deprecated_resume_absent(source: str | None) -> bool:
    """Absence is proven only when source inspection itself succeeded."""
    return source is not None and not uses_deprecated_forwarded_props_resume(source)


def is_resume_array(annotation: Any, entry_type: type[Any]) -> bool:
    """Require Optional[list[ResumeEntry]], not merely a field named resume."""
    alternatives = [item for item in get_args(annotation) if item is not type(None)]
    candidate = alternatives[0] if len(alternatives) == 1 else annotation
    return get_origin(candidate) is list and get_args(candidate) == (entry_type,)


def _resume_entry(entry_type: type[Any], interrupt_id: str, status: str, payload: Any) -> Any:
    try:
        return entry_type(interrupt_id=interrupt_id, status=status, payload=payload)
    except (TypeError, ValueError):
        return entry_type(interruptId=interrupt_id, status=status, payload=payload)


def standard_run_error(result: Any) -> bool:
    """Return true only for an emitted standard RUN_ERROR event."""
    items = result if isinstance(result, (list, tuple)) else [result]
    return any(str(getattr(item, "type", "")).endswith("RUN_ERROR") for item in items)


def standard_interrupt_outcome(result: Any, expected_ids: set[str]) -> bool:
    """Require a terminal RUN_FINISHED interrupt outcome with the exact open set."""
    items = result if isinstance(result, (list, tuple)) else [result]
    if not items:
        return False
    terminal = items[-1]
    outcome = getattr(terminal, "outcome", None)
    interrupts = list(getattr(outcome, "interrupts", []) or [])
    observed_ids = [str(getattr(item, "id", "")) for item in interrupts]
    return (
        str(getattr(terminal, "type", "")).endswith("RUN_FINISHED")
        and getattr(outcome, "type", None) == "interrupt"
        and len(observed_ids) == len(expected_ids)
        and set(observed_ids) == expected_ids
    )


def _serialized_resume(result: Any) -> str:
    resume = getattr(result, "resume", result)
    try:
        return json.dumps(resume, sort_keys=True, default=lambda item: vars(item))
    except (TypeError, ValueError):
        return repr(resume)


def _resume_case(agent: Any, entries: list[Any], open_interrupts: list[Any]) -> dict[str, Any]:
    try:
        result = agent._build_command_from_agui_resume(  # noqa: SLF001 - upstream hook probe
            entries,
            open_interrupts=open_interrupts,
        )
    except Exception as exc:  # noqa: BLE001 - exceptions are recorded but never accepted as denial
        return {
            "outcome": "exception",
            "error": f"{type(exc).__name__}: {exc}",
        }
    if standard_run_error(result):
        return {"outcome": "standard_run_error"}
    return {
        "outcome": "accepted",
        "resume": _serialized_resume(result),
    }


def probe_resume_matrix(agent: Any, entry_type: type[Any]) -> dict[str, Any]:
    """Prove full success and standard RUN_ERROR denial for every invalid shape."""
    open_ab = [SimpleNamespace(id="interrupt-a"), SimpleNamespace(id="interrupt-b")]
    open_cd = [SimpleNamespace(id="interrupt-c"), SimpleNamespace(id="interrupt-d")]
    entry_a = _resume_entry(entry_type, "interrupt-a", "resolved", {"approved": True})
    entry_b = _resume_entry(entry_type, "interrupt-b", "resolved", {"approved": False})
    unknown = _resume_entry(entry_type, "interrupt-unknown", "resolved", {"approved": True})
    invalid = SimpleNamespace(
        interrupt_id="interrupt-b",
        status="invalid",
        payload={"approved": True},
    )
    cases = {
        "full_all_open": _resume_case(agent, [entry_a, entry_b], open_ab),
        "full_all_open_reordered": _resume_case(agent, [entry_b, entry_a], open_ab),
        "partial": _resume_case(agent, [entry_a], open_ab),
        "stale": _resume_case(agent, [entry_a, entry_b], open_cd),
        "duplicate": _resume_case(agent, [entry_a, entry_a, entry_b], open_ab),
        "unknown": _resume_case(agent, [entry_a, unknown], open_ab),
        "invalid": _resume_case(agent, [entry_a, invalid], open_ab),
    }
    full = cases["full_all_open"]
    reordered = cases["full_all_open_reordered"]
    full_resume = str(full.get("resume") or "")
    reordered_resume = str(reordered.get("resume") or "")
    full_success = (
        full.get("outcome") == "accepted"
        and "interrupt-a" in full_resume
        and "interrupt-b" in full_resume
        and reordered.get("outcome") == "accepted"
        and "interrupt-a" in reordered_resume
        and "interrupt-b" in reordered_resume
    )
    invalid_cases = ("partial", "stale", "duplicate", "unknown", "invalid")
    standard_denial = all(cases[case].get("outcome") == "standard_run_error" for case in invalid_cases)
    return {
        "full_all_open_success": full_success,
        "all_invalid_standard_run_error": standard_denial,
        "cases": cases,
    }


def probe_safe_pre_dispatch_binding(
    endpoint: Any,
    endpoint_source: str | None,
    core_module: Any,
) -> tuple[bool, dict[str, Any]]:
    """Black-box prove dependencies and before_dispatch execute before dispatch."""
    del core_module
    details: dict[str, Any] = {
        "source_available": endpoint_source is not None,
        "dependency_called": False,
        "before_dispatch_called": False,
        "agent_dispatched": False,
        "black_box_http": False,
        "call_order": [],
    }
    signature = inspect.signature(endpoint)
    documentation = inspect.getdoc(endpoint) or ""
    details["signature"] = str(signature)
    details["documented_dependencies"] = "dependencies" in signature.parameters and "dependenc" in documentation.lower()
    details["declared_hooks"] = {
        "dependencies": "dependencies" in signature.parameters,
        "before_dispatch": "before_dispatch" in signature.parameters,
    }
    if not all(details["declared_hooks"].values()):
        details["reason"] = "endpoint lacks dependencies and before_dispatch parameters"
        return False, details

    try:
        from fastapi import Depends, FastAPI, HTTPException, Request, status
        from fastapi.testclient import TestClient

        class ProbeAgent:
            name = "binding-probe"
            dispatched = False

        async def dependency(request) -> None:
            payload = await request.json()
            details["dependency_called"] = True
            details["call_order"].append("dependency")
            details["observed_thread_id"] = payload.get("threadId")
            details["observed_run_id"] = payload.get("runId")

        async def before_dispatch(input_data, request) -> None:
            del request
            details["before_dispatch_called"] = True
            details["call_order"].append("before_dispatch")
            payload = (
                input_data.model_dump(mode="json", by_alias=True) if hasattr(input_data, "model_dump") else input_data
            )
            details["observed_thread_id"] = payload.get("threadId")
            details["observed_run_id"] = payload.get("runId")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="binding probe deny",
            )

        dependency.__annotations__["request"] = Request
        app = FastAPI()
        agent = ProbeAgent()
        endpoint(
            app,
            agent,
            path="/binding-probe",
            dependencies=[Depends(dependency)],
            before_dispatch=before_dispatch,
        )
        body = {
            "threadId": "binding-thread",
            "runId": "binding-run",
            "state": {},
            "messages": [],
            "tools": [],
            "context": [],
            "forwardedProps": {},
        }
        with TestClient(app) as client:
            response = client.post("/binding-probe", json=body)
        details["black_box_http"] = True
        details["response_status"] = response.status_code
        details["agent_dispatched"] = agent.dispatched
    except Exception as exc:  # noqa: BLE001 - candidate hook is fail-closed
        details["reason"] = f"binding execution failed: {type(exc).__name__}: {exc}"
        return False, details
    passed = (
        details["dependency_called"] is True
        and details["before_dispatch_called"] is True
        and details["call_order"] == ["dependency", "before_dispatch"]
        and details["agent_dispatched"] is False
        and details.get("observed_thread_id") == "binding-thread"
        and details.get("observed_run_id") == "binding-run"
        and details.get("response_status") == status.HTTP_403_FORBIDDEN
    )
    if not passed:
        details["reason"] = "dependency did not deny before agent dispatch with bound IDs"
    return passed, details


def _runtime_contracts() -> tuple[dict[str, bool], dict[str, Any]]:
    details: dict[str, Any] = {}
    try:
        agent_module = importlib.import_module("ag_ui_langgraph.agent")
        endpoint_module = importlib.import_module("ag_ui_langgraph.endpoint")
        core_module = importlib.import_module("ag_ui.core")
        agent_type = agent_module.LangGraphAgent
    except Exception as exc:  # noqa: BLE001 - candidate import is intentionally fail-closed
        details["import_error"] = f"{type(exc).__name__}: {exc}"
        return dict.fromkeys(REQUIRED_CONTRACTS, False), details

    signature = inspect.signature(agent_type)
    parameters = signature.parameters
    constructor_api = {
        "name",
        "graph",
        "description",
        "config",
    }.issubset(parameters)
    details["constructor_signature"] = str(signature)

    input_type = core_module.RunAgentInput
    model_fields = getattr(input_type, "model_fields", {})
    resume_field = model_fields.get("resume")
    resume_annotation = getattr(resume_field, "annotation", None)
    resume_entry_type = getattr(core_module, "ResumeEntry", None)
    run_agent_input_resume_array = resume_entry_type is not None and is_resume_array(
        resume_annotation, resume_entry_type
    )
    details["run_agent_input_resume_annotation"] = str(resume_annotation)

    standard_output = False
    output_all_open = False
    emitted: list[dict[str, Any]] = []
    if hasattr(agent_type, "_emit_interrupt_finish"):
        try:
            agent = object.__new__(agent_type)
            agent.enable_legacy_on_interrupt_event = False
            agent.emit_interrupt_outcome = True
            interrupts = [
                SimpleNamespace(
                    id="interrupt-a",
                    value={"reason": "confirmation", "message": "Approve A?"},
                    ns=["approval:a"],
                    resumable=True,
                    when="during",
                ),
                SimpleNamespace(
                    id="interrupt-b",
                    value={"reason": "confirmation", "message": "Approve B?"},
                    ns=["approval:b"],
                    resumable=True,
                    when="during",
                ),
            ]
            events = agent._emit_interrupt_finish(  # noqa: SLF001 - executable upstream contract
                thread_id="thread-probe",
                run_id="run-probe",
                lg_interrupts=interrupts,
            )
            emitted.extend(
                (
                    event.model_dump(mode="json", by_alias=True)
                    if hasattr(event, "model_dump")
                    else {"type": str(getattr(event, "type", None))}
                )
                for event in events
            )
            terminal = events[-1]
            outcome = getattr(terminal, "outcome", None)
            mapped = list(getattr(outcome, "interrupts", []) or [])
            expected_interrupt_ids = {"interrupt-a", "interrupt-b"}
            standard_output = standard_interrupt_outcome(
                events,
                expected_interrupt_ids,
            )
            output_all_open = (
                len(mapped) == len(expected_interrupt_ids) and {item.id for item in mapped} == expected_interrupt_ids
            )
        except Exception as exc:  # noqa: BLE001 - candidate behavior is fail-closed
            details["interrupt_output_error"] = f"{type(exc).__name__}: {exc}"
    details["emitted_events"] = emitted

    resume_matrix: dict[str, Any] = {
        "full_all_open_success": False,
        "all_invalid_standard_run_error": False,
        "cases": {},
    }
    if (
        hasattr(agent_type, "_build_command_from_agui_resume")
        and run_agent_input_resume_array
        and resume_entry_type is not None
    ):
        try:
            agent = object.__new__(agent_type)
            resume_matrix = probe_resume_matrix(agent, resume_entry_type)
        except Exception as exc:  # noqa: BLE001 - candidate behavior is fail-closed
            details["resume_validation_error"] = f"{type(exc).__name__}: {exc}"
    details["resume_matrix"] = resume_matrix

    agent_source = _source(agent_module)
    endpoint_source = _source(endpoint_module)
    deprecated_absent = deprecated_resume_absent(agent_source)
    details["source_inspection"] = {
        "agent": agent_source is not None,
        "endpoint": endpoint_source is not None,
    }
    details["deprecated_resume_source_present"] = (
        uses_deprecated_forwarded_props_resume(agent_source) if agent_source is not None else None
    )

    endpoint_signature = inspect.signature(endpoint_module.add_langgraph_fastapi_endpoint)
    details["endpoint_signature"] = str(endpoint_signature)
    safe_pre_dispatch_binding, binding_details = probe_safe_pre_dispatch_binding(
        endpoint_module.add_langgraph_fastapi_endpoint,
        endpoint_source,
        core_module,
    )
    details["pre_dispatch_binding"] = binding_details
    details["endpoint_source_sha256"] = (
        hashlib.sha256(endpoint_source.encode()).hexdigest() if endpoint_source is not None else None
    )

    contracts = {
        "constructor_api": constructor_api,
        "standard_run_finished_interrupt": standard_output,
        "run_agent_input_resume_array": run_agent_input_resume_array,
        "all_open_interrupts": (
            output_all_open
            and resume_matrix["full_all_open_success"] is True
            and resume_matrix["all_invalid_standard_run_error"] is True
        ),
        "safe_pre_dispatch_binding": safe_pre_dispatch_binding,
        "deprecated_forwarded_props_resume_absent": deprecated_absent,
    }
    return contracts, details


def _runtime_snapshot(distribution_name: str) -> dict[str, Any]:
    distribution = importlib.metadata.distribution(distribution_name)
    metadata = distribution.metadata
    name = metadata.get("Name", distribution_name)
    version = distribution.version
    license_name = metadata.get("License-Expression") or metadata.get("License") or ""
    requires_python = metadata.get("Requires-Python") or ""
    source_sha256: dict[str, str] = {}
    source_paths: dict[str, str] = {}
    for module_name, relative_path in (
        ("ag_ui_langgraph.agent", "ag_ui_langgraph/agent.py"),
        ("ag_ui_langgraph.endpoint", "ag_ui_langgraph/endpoint.py"),
    ):
        module = importlib.import_module(module_name)
        module_path_value = getattr(module, "__file__", None)
        if not module_path_value:
            _invalid(f"runtime source path unavailable: {module_name}")
        module_path = Path(module_path_value).resolve(strict=True)
        source_sha256[relative_path] = _sha256(module_path)
        source_paths[relative_path] = str(module_path)
    return {
        "name": name,
        "version": version,
        "license": str(license_name),
        "requires_python": str(requires_python),
        "source_sha256": source_sha256,
        "source_paths": source_paths,
    }


def collect_evidence(
    artifact_path: Path,
    fork_provenance_path: Path | None = None,
    source_archive_path: Path | None = None,
) -> dict[str, Any]:
    artifact = inspect_artifact(artifact_path)
    fork_provenance = None
    if fork_provenance_path is not None:
        fork_provenance = validate_fork_provenance(
            load_fork_provenance(fork_provenance_path),
            artifact_path=artifact_path,
            source_archive_path=source_archive_path,
            artifact=artifact,
        )
    runtime = _runtime_snapshot(str(artifact["name"]))
    bindings = bind_runtime_to_artifact(artifact, runtime)
    artifact["runtime_identity_bound"] = bindings["identity"]
    artifact["runtime_source_bound"] = bindings["source"]

    contracts, details = _runtime_contracts()
    details["artifact_binding"] = bindings
    details["runtime"] = runtime
    if not all(bindings.values()):
        contracts = dict.fromkeys(contracts, False)

    evidence = {
        "artifact": artifact,
        "contracts": contracts,
        "details": details,
    }
    if fork_provenance is not None:
        evidence["fork_provenance"] = fork_provenance
    evidence["decision"] = evaluate_candidate(evidence)
    return evidence


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact-path", type=Path, required=True)
    parser.add_argument("--fork-provenance-path", type=Path)
    parser.add_argument("--source-archive-path", type=Path)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    try:
        evidence = collect_evidence(
            args.artifact_path,
            args.fork_provenance_path,
            args.source_archive_path,
        )
    except Exception as exc:  # noqa: BLE001 - candidate metadata is intentionally fail-closed
        evidence = {
            "artifact": {
                "path": args.artifact_path.name,
            },
            "contracts": {},
            "details": {"probe_error": f"{type(exc).__name__}: {exc}"},
        }
        evidence["decision"] = evaluate_candidate(evidence)

    output = json.dumps(evidence, indent=2, sort_keys=True)
    print(output)
    return 0 if evidence["decision"]["admitted"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
