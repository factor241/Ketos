#!/usr/bin/env python3
"""Fail-closed admission probe for an installed AG-UI LangGraph adapter.

The probe intentionally has no dependency on Ketos. Run it inside an isolated
environment containing exactly one candidate adapter, and pass the registry-
verified artifact SHA-256 separately. External package content is inspected as
untrusted data; absence or ambiguity is a failed contract, never an inference.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import importlib.metadata
import inspect
import json
import re
import tarfile
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

    reasons.extend(
        f"artifact.{key}" for key in ARTIFACT_BINDINGS if artifact.get(key) is not True
    )

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
        license_name = str(
            metadata.get("License-Expression") or metadata.get("License") or ""
        ).strip()
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
        source_sha256 = {
            source: _bytes_sha256(archive.read(source)) for source in REQUIRED_ARCHIVE_SOURCES
        }
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
            _invalid(
                f"expected exactly one ag-ui-langgraph pyproject.toml, found {len(projects)}"
            )
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
        source_members = {
            source: f"{root}/{source}" if root else source for source in REQUIRED_ARCHIVE_SOURCES
        }
        missing_sources = [
            source for source, member in source_members.items() if member not in names
        ]
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


def bind_runtime_to_artifact(
    artifact: dict[str, Any], runtime: dict[str, Any]
) -> dict[str, bool]:
    """Require installed metadata and source bytes to match the candidate archive."""
    identity = (
        _canonical_name(str(artifact.get("name") or ""))
        == _canonical_name(str(runtime.get("name") or ""))
        and artifact.get("version") == runtime.get("version")
        and str(artifact.get("license") or "").strip().lower()
        == str(runtime.get("license") or "").strip().lower()
        and _normalized_specifier(str(artifact.get("requires_python") or ""))
        == _normalized_specifier(str(runtime.get("requires_python") or ""))
    )
    source = artifact.get("source_sha256") == runtime.get("source_sha256")
    return {"identity": identity, "source": source}


def uses_deprecated_forwarded_props_resume(source: str) -> bool:
    """Detect the legacy command.resume channel by its executable data flow."""
    return all(token in source for token in ("forwarded_props", "command", "resume"))


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


def _standard_run_error(result: Any) -> bool:
    items = result if isinstance(result, (list, tuple)) else [result]
    return any(str(getattr(item, "type", "")).endswith("RUN_ERROR") for item in items)


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
    if _standard_run_error(result):
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
        "partial": _resume_case(agent, [entry_a], open_ab),
        "stale": _resume_case(agent, [entry_a, entry_b], open_cd),
        "duplicate": _resume_case(agent, [entry_a, entry_a, entry_b], open_ab),
        "unknown": _resume_case(agent, [entry_a, unknown], open_ab),
        "invalid": _resume_case(agent, [entry_a, invalid], open_ab),
    }
    full = cases["full_all_open"]
    full_resume = str(full.get("resume") or "")
    full_success = (
        full.get("outcome") == "accepted"
        and "interrupt-a" in full_resume
        and "interrupt-b" in full_resume
    )
    invalid_cases = ("partial", "stale", "duplicate", "unknown", "invalid")
    standard_denial = all(
        cases[case].get("outcome") == "standard_run_error" for case in invalid_cases
    )
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
    """Fail closed until a candidate documents an executable binding contract."""
    del core_module
    details: dict[str, Any] = {"source_available": endpoint_source is not None}
    if endpoint_source is None:
        details["reason"] = "endpoint source inspection unavailable"
        return False, details
    signature = inspect.signature(endpoint)
    documentation = inspect.getdoc(endpoint) or ""
    details["signature"] = str(signature)
    details["documented_dependencies"] = (
        "dependencies" in signature.parameters and "dependenc" in documentation.lower()
    )
    details["reason"] = (
        "no documented FastAPI dependencies parameter"
        if not details["documented_dependencies"]
        else "no candidate-specific executable actor/thread/run binding semantics proven"
    )
    return False, details


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
    run_agent_input_resume_array = (
        resume_entry_type is not None and is_resume_array(resume_annotation, resume_entry_type)
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
            standard_output = (
                str(getattr(terminal, "type", "")).endswith("RUN_FINISHED")
                and getattr(outcome, "type", None) == "interrupt"
            )
            output_all_open = [item.id for item in mapped] == [
                "interrupt-a",
                "interrupt-b",
            ]
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
        uses_deprecated_forwarded_props_resume(agent_source)
        if agent_source is not None
        else None
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
        hashlib.sha256(endpoint_source.encode()).hexdigest()
        if endpoint_source is not None
        else None
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


def collect_evidence(artifact_path: Path) -> dict[str, Any]:
    artifact = inspect_artifact(artifact_path)
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
    evidence["decision"] = evaluate_candidate(evidence)
    return evidence


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact-path", type=Path, required=True)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    try:
        evidence = collect_evidence(args.artifact_path)
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
