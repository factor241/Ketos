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
from pathlib import Path
from types import SimpleNamespace
from typing import Any

REQUIRED_CONTRACTS = (
    "constructor_api",
    "standard_run_finished_interrupt",
    "run_agent_input_resume_array",
    "all_open_interrupts",
    "safe_pre_dispatch_binding",
    "deprecated_forwarded_props_resume_absent",
)
SHA256_HEX_LENGTH = 64


def evaluate_candidate(evidence: dict[str, Any]) -> dict[str, Any]:
    """Return a deterministic admission decision from collected evidence."""
    artifact = evidence.get("artifact") or {}
    contracts = evidence.get("contracts") or {}
    reasons: list[str] = []

    if artifact.get("version") == "0.0.42" and artifact.get("identity") == "ag-ui-langgraph==0.0.42":
        reasons.append("0.0.42")

    for key in ("identity", "sha256", "license", "requires_python"):
        value = artifact.get(key)
        if not isinstance(value, str) or not value.strip():
            reasons.append(f"artifact.{key}")

    digest = artifact.get("sha256")
    if isinstance(digest, str) and (
        len(digest) != SHA256_HEX_LENGTH or any(char not in "0123456789abcdef" for char in digest.lower())
    ):
        reasons.append("artifact.sha256")

    reasons.extend(contract for contract in REQUIRED_CONTRACTS if contracts.get(contract) is not True)

    return {"admitted": not reasons, "reasons": list(dict.fromkeys(reasons))}


def _source(module: Any) -> str:
    try:
        return inspect.getsource(module)
    except (OSError, TypeError):
        return ""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def uses_deprecated_forwarded_props_resume(source: str) -> bool:
    """Detect the legacy command.resume channel by its executable data flow."""
    return all(token in source for token in ("forwarded_props", "command", "resume"))


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
    run_agent_input_resume_array = resume_field is not None
    details["run_agent_input_resume_annotation"] = str(getattr(resume_field, "annotation", None))

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

    exact_resume_validation = False
    if hasattr(agent_type, "_build_command_from_agui_resume") and resume_field is not None:
        try:
            agent = object.__new__(agent_type)
            entry = core_module.ResumeEntry(
                interrupt_id="interrupt-a",
                status="resolved",
                payload={"approved": True},
            )
            open_interrupts = [
                SimpleNamespace(id="interrupt-a"),
                SimpleNamespace(id="interrupt-b"),
            ]
            try:
                agent._build_command_from_agui_resume(  # noqa: SLF001 - upstream hook probe
                    [entry],
                    open_interrupts=open_interrupts,
                )
            except Exception:  # noqa: BLE001 - any rejection satisfies this negative probe
                exact_resume_validation = True
        except Exception as exc:  # noqa: BLE001 - candidate behavior is fail-closed
            details["resume_validation_error"] = f"{type(exc).__name__}: {exc}"
    details["partial_resume_rejected"] = exact_resume_validation

    agent_source = _source(agent_module)
    endpoint_source = _source(endpoint_module)
    deprecated_absent = not uses_deprecated_forwarded_props_resume(agent_source)
    details["deprecated_resume_source_present"] = not deprecated_absent

    endpoint_signature = inspect.signature(endpoint_module.add_langgraph_fastapi_endpoint)
    details["endpoint_signature"] = str(endpoint_signature)
    safe_binding_tokens = (
        "dependency",
        "dependencies",
        "before_dispatch",
        "authorize",
        "auth_context",
        "actor",
    )
    safe_pre_dispatch_binding = any(token in endpoint_signature.parameters for token in safe_binding_tokens)
    details["endpoint_source_sha256"] = hashlib.sha256(endpoint_source.encode()).hexdigest()

    contracts = {
        "constructor_api": constructor_api,
        "standard_run_finished_interrupt": standard_output,
        "run_agent_input_resume_array": run_agent_input_resume_array,
        "all_open_interrupts": output_all_open and exact_resume_validation,
        "safe_pre_dispatch_binding": safe_pre_dispatch_binding,
        "deprecated_forwarded_props_resume_absent": deprecated_absent,
    }
    return contracts, details


def collect_evidence(
    distribution_name: str,
    artifact_sha256: str,
    artifact_path: Path | None = None,
    artifact_identity: str | None = None,
) -> dict[str, Any]:
    distribution = importlib.metadata.distribution(distribution_name)
    metadata = distribution.metadata
    name = metadata.get("Name", distribution_name)
    version = distribution.version
    license_name = metadata.get("License-Expression") or metadata.get("License") or ""
    requires_python = metadata.get("Requires-Python") or ""

    observed_sha256 = _sha256(artifact_path) if artifact_path else artifact_sha256
    hash_matches = observed_sha256.lower() == artifact_sha256.lower()
    contracts, details = _runtime_contracts()
    details["artifact_hash_matches"] = hash_matches
    if not hash_matches:
        contracts = dict.fromkeys(contracts, False)

    evidence = {
        "artifact": {
            "name": name,
            "version": version,
            "identity": artifact_identity or f"{name}=={version}",
            "sha256": observed_sha256,
            "expected_sha256": artifact_sha256,
            "license": license_name,
            "requires_python": requires_python,
        },
        "contracts": contracts,
        "details": details,
    }
    evidence["decision"] = evaluate_candidate(evidence)
    return evidence


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--distribution", default="ag-ui-langgraph")
    parser.add_argument("--artifact-sha256", required=True)
    parser.add_argument("--artifact-path", type=Path)
    parser.add_argument("--artifact-identity")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    try:
        evidence = collect_evidence(
            args.distribution,
            args.artifact_sha256,
            args.artifact_path,
            args.artifact_identity,
        )
    except Exception as exc:  # noqa: BLE001 - candidate metadata is intentionally fail-closed
        evidence = {
            "artifact": {"name": args.distribution},
            "contracts": {},
            "details": {"probe_error": f"{type(exc).__name__}: {exc}"},
        }
        evidence["decision"] = evaluate_candidate(evidence)

    output = json.dumps(evidence, indent=2, sort_keys=True)
    print(output)
    return 0 if evidence["decision"]["admitted"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
