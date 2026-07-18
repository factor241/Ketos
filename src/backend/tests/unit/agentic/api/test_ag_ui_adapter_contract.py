from __future__ import annotations

import hashlib
import importlib.util
import inspect
import zipfile
from pathlib import Path
from types import SimpleNamespace
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from types import ModuleType

REPO_ROOT = Path(__file__).resolve().parents[6]
PROBE_PATH = REPO_ROOT / "scripts" / "mvp" / "probe_ag_ui_adapter.py"
ADMISSION_PATH = REPO_ROOT / "docs" / "dev" / "handoff" / "STAGE_01_AG_UI_ADMISSION.md"
FORK_DECISION_PATH = REPO_ROOT / "docs" / "dev" / "handoff" / "STAGE_01_TEMPORARY_FORK_DECISION.md"
LICENSE_BYTES = b"MIT License\n\nCopyright (c) AG-UI contributors\n"
FORK_COMMIT = "1" * 40
UPSTREAM_BASE = "2" * 40


def _load_probe() -> ModuleType:
    assert PROBE_PATH.is_file(), f"missing executable admission probe: {PROBE_PATH}"
    spec = importlib.util.spec_from_file_location("probe_ag_ui_adapter", PROBE_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _complete_evidence(version: str = "0.0.43") -> dict[str, object]:
    return {
        "artifact": {
            "name": "ag-ui-langgraph",
            "version": version,
            "identity": f"ag-ui-langgraph=={version}",
            "path": f"ag_ui_langgraph-{version}-py3-none-any.whl",
            "archive_kind": "wheel",
            "metadata_path": f"ag_ui_langgraph-{version}.dist-info/METADATA",
            "sha256": "a" * 64,
            "license": "MIT",
            "license_path": f"ag_ui_langgraph-{version}.dist-info/licenses/LICENSE",
            "license_sha256": "b" * 64,
            "license_source": "artifact",
            "requires_python": ">=3.10",
            "archive_identity_bound": True,
            "runtime_identity_bound": True,
            "runtime_source_bound": True,
        },
        "contracts": {
            "constructor_api": True,
            "standard_run_finished_interrupt": True,
            "run_agent_input_resume_array": True,
            "all_open_interrupts": True,
            "safe_pre_dispatch_binding": True,
            "deprecated_forwarded_props_resume_absent": True,
        },
    }


def _write_wheel(
    tmp_path: Path,
    *,
    version: str = "0.0.43",
    include_license: bool = True,
    include_endpoint_source: bool = True,
) -> Path:
    wheel = tmp_path / f"ag_ui_langgraph-{version}-py3-none-any.whl"
    dist_info = f"ag_ui_langgraph-{version}.dist-info"
    metadata = "\n".join(
        (
            "Metadata-Version: 2.4",
            "Name: ag-ui-langgraph",
            f"Version: {version}",
            "License-Expression: MIT",
            "License-File: LICENSE",
            "Requires-Python: >=3.10,<3.15",
            "",
        )
    )
    with zipfile.ZipFile(wheel, "w") as archive:
        archive.writestr(f"{dist_info}/METADATA", metadata)
        archive.writestr("ag_ui_langgraph/agent.py", "class LangGraphAgent: pass\n")
        if include_endpoint_source:
            archive.writestr("ag_ui_langgraph/endpoint.py", "def endpoint(): pass\n")
        if include_license:
            archive.writestr(f"{dist_info}/licenses/LICENSE", LICENSE_BYTES)
    return wheel


def _fork_provenance(artifact: Path, source_archive: Path) -> dict[str, object]:
    return {
        "artifact_kind": "wheel",
        "package_name": "ag-ui-langgraph",
        "package_version": "0.0.43",
        "approved_owner": "factor241",
        "canonical_repo_url": "https://github.com/factor241/ag-ui",
        "upstream_base_sha": UPSTREAM_BASE,
        "fork_commit_sha": FORK_COMMIT,
        "artifact_filename": artifact.name,
        "artifact_sha256": hashlib.sha256(artifact.read_bytes()).hexdigest(),
        "source_archive_sha256": hashlib.sha256(source_archive.read_bytes()).hexdigest(),
        "license_spdx": "MIT",
        "license_sha256": hashlib.sha256(LICENSE_BYTES).hexdigest(),
        "changed_files": [
            "integrations/langgraph/python/ag_ui_langgraph/agent.py",
            "integrations/langgraph/python/ag_ui_langgraph/endpoint.py",
            "integrations/langgraph/python/tests/test_agent.py",
            "integrations/langgraph/python/tests/test_endpoint.py",
        ],
        "build_command": f"git checkout --detach {FORK_COMMIT} && uv build",
        "test_command": f"git checkout --detach {FORK_COMMIT} && uv run pytest",
    }


def test_published_0042_is_rejected_even_if_metadata_is_present() -> None:
    probe = _load_probe()

    result = probe.evaluate_candidate(_complete_evidence("0.0.42"))

    assert result["admitted"] is False
    assert "0.0.42" in result["reasons"]


def test_immutable_commit_is_not_misidentified_as_the_published_0042_wheel() -> None:
    probe = _load_probe()
    evidence = _complete_evidence("0.0.42")
    evidence["artifact"]["identity"] = (
        "git+https://github.com/ag-ui-protocol/ag-ui.git"
        "@3a7433ef055aab96ee7c9ece97417d721b21dc76"
        "#subdirectory=integrations/langgraph/python"
    )

    result = probe.evaluate_candidate(evidence)

    assert result == {"admitted": True, "reasons": []}


@pytest.mark.parametrize(
    "missing_contract",
    [
        "standard_run_finished_interrupt",
        "run_agent_input_resume_array",
        "all_open_interrupts",
        "safe_pre_dispatch_binding",
        "deprecated_forwarded_props_resume_absent",
    ],
)
def test_candidate_fails_closed_when_a_normative_contract_is_missing(
    missing_contract: str,
) -> None:
    probe = _load_probe()
    evidence = _complete_evidence()
    evidence["contracts"][missing_contract] = False

    result = probe.evaluate_candidate(evidence)

    assert result["admitted"] is False
    assert missing_contract in result["reasons"]


def test_only_complete_immutable_standard_contract_is_admitted() -> None:
    probe = _load_probe()

    result = probe.evaluate_candidate(_complete_evidence())

    assert result == {"admitted": True, "reasons": []}


def test_artifact_path_is_mandatory_and_identity_cannot_be_self_attested() -> None:
    probe = _load_probe()

    assert list(inspect.signature(probe.collect_evidence).parameters) == [
        "artifact_path",
        "fork_provenance_path",
        "source_archive_path",
    ]
    with pytest.raises(ValueError, match="artifact path is required"):
        probe.inspect_artifact(None)


def test_wheel_identity_hash_license_and_sources_are_derived_from_archive(tmp_path: Path) -> None:
    probe = _load_probe()
    wheel = _write_wheel(tmp_path)

    artifact = probe.inspect_artifact(wheel)

    assert artifact["identity"] == "ag-ui-langgraph==0.0.43"
    assert artifact["sha256"] == hashlib.sha256(wheel.read_bytes()).hexdigest()
    assert artifact["metadata_path"] == "ag_ui_langgraph-0.0.43.dist-info/METADATA"
    assert artifact["license"] == "MIT"
    assert artifact["license_path"] == "ag_ui_langgraph-0.0.43.dist-info/licenses/LICENSE"
    assert artifact["license_sha256"] == hashlib.sha256(LICENSE_BYTES).hexdigest()
    assert artifact["license_source"] == "artifact"
    assert set(artifact["source_sha256"]) == {
        "ag_ui_langgraph/agent.py",
        "ag_ui_langgraph/endpoint.py",
    }


def test_artifact_inspection_fails_closed_without_license_or_required_source(tmp_path: Path) -> None:
    probe = _load_probe()
    missing_license = _write_wheel(tmp_path, version="0.0.43.dev1", include_license=False)
    missing_source = _write_wheel(
        tmp_path,
        version="0.0.43.dev2",
        include_endpoint_source=False,
    )

    with pytest.raises(ValueError, match="license file"):
        probe.inspect_artifact(missing_license)
    with pytest.raises(ValueError, match="required source"):
        probe.inspect_artifact(missing_source)


def test_fork_provenance_binds_exact_owner_commits_artifact_source_and_license_hashes(
    tmp_path: Path,
) -> None:
    probe = _load_probe()
    wheel = _write_wheel(tmp_path)
    source_archive = tmp_path / "factor241-ag-ui-source.tgz"
    source_archive.write_bytes(b"immutable fork source archive")
    provenance = _fork_provenance(wheel, source_archive)

    result = probe.validate_fork_provenance(
        provenance,
        artifact_path=wheel,
        source_archive_path=source_archive,
        artifact=probe.inspect_artifact(wheel),
    )

    assert result["bound"] is True
    assert result["approved_owner"] == "factor241"
    assert result["fork_commit_sha"] == FORK_COMMIT
    assert result["upstream_base_sha"] == UPSTREAM_BASE
    assert result["artifact_sha256"] == hashlib.sha256(wheel.read_bytes()).hexdigest()
    assert result["source_archive_sha256"] == hashlib.sha256(source_archive.read_bytes()).hexdigest()


@pytest.mark.parametrize(
    ("mutation", "error"),
    [
        (lambda item: item.pop("fork_commit_sha"), "exact fields"),
        (lambda item: item.__setitem__("unexpected", "extra"), "exact fields"),
        (lambda item: item.__setitem__("approved_owner", "attacker"), "approved owner"),
        (
            lambda item: item.__setitem__("canonical_repo_url", "https://github.com/factor241/ag-ui/tree/main"),
            "canonical repository",
        ),
        (lambda item: item.__setitem__("fork_commit_sha", "main"), "fork commit"),
        (lambda item: item.__setitem__("package_version", "latest"), "package_version"),
        (lambda item: item.__setitem__("artifact_sha256", "0" * 64), "artifact SHA-256"),
        (
            lambda item: item.__setitem__("source_archive_sha256", "0" * 64),
            "source archive SHA-256",
        ),
        (lambda item: item.__setitem__("license_sha256", "0" * 64), "license SHA-256"),
        (
            lambda item: item.__setitem__("changed_files", ["../../outside.py"]),
            "changed_files",
        ),
        (
            lambda item: item.__setitem__("changed_files", [{"path": "agent.py"}]),
            "changed_files",
        ),
        (
            lambda item: item.__setitem__("build_command", "git checkout main && uv build"),
            "fork commit",
        ),
    ],
)
def test_fork_provenance_rejects_missing_extra_unapproved_floating_or_hash_mismatch(
    tmp_path: Path,
    mutation,
    error: str,
) -> None:
    probe = _load_probe()
    wheel = _write_wheel(tmp_path)
    source_archive = tmp_path / "factor241-ag-ui-source.tgz"
    source_archive.write_bytes(b"immutable fork source archive")
    provenance = _fork_provenance(wheel, source_archive)
    mutation(provenance)

    with pytest.raises(ValueError, match=error):
        probe.validate_fork_provenance(
            provenance,
            artifact_path=wheel,
            source_archive_path=source_archive,
            artifact=probe.inspect_artifact(wheel),
        )


def test_fork_provenance_schema_is_reusable_for_a_source_tgz(tmp_path: Path) -> None:
    probe = _load_probe()
    source_archive = tmp_path / "ag-ui-langgraph-source.tgz"
    source_archive.write_bytes(b"immutable source artifact")
    provenance = _fork_provenance(source_archive, source_archive)
    provenance["artifact_kind"] = "tgz"
    provenance["artifact_filename"] = source_archive.name
    provenance["artifact_sha256"] = hashlib.sha256(source_archive.read_bytes()).hexdigest()
    artifact = {
        "name": "ag-ui-langgraph",
        "version": provenance["package_version"],
        "license": "MIT",
        "license_sha256": provenance["license_sha256"],
    }

    result = probe.validate_fork_provenance(
        provenance,
        artifact_path=source_archive,
        source_archive_path=None,
        artifact=artifact,
    )

    assert result["bound"] is True
    assert result["artifact_kind"] == "tgz"


def test_runtime_binding_requires_exact_archive_metadata_and_source_hashes() -> None:
    probe = _load_probe()
    artifact = {
        "name": "ag-ui-langgraph",
        "version": "0.0.43",
        "license": "MIT",
        "requires_python": ">=3.10,<3.15",
        "source_sha256": {"agent.py": "a" * 64, "endpoint.py": "b" * 64},
    }
    runtime = {
        "name": "ag-ui-langgraph",
        "version": "0.0.43",
        "license": "MIT",
        "requires_python": ">=3.10,<3.15",
        "source_sha256": {"agent.py": "a" * 64, "endpoint.py": "b" * 64},
    }

    assert probe.bind_runtime_to_artifact(artifact, runtime) == {
        "identity": True,
        "source": True,
    }
    runtime["version"] = "0.0.42"
    runtime["source_sha256"]["agent.py"] = "c" * 64
    assert probe.bind_runtime_to_artifact(artifact, runtime) == {
        "identity": False,
        "source": False,
    }


def test_resume_annotation_must_be_an_array_of_resume_entries() -> None:
    probe = _load_probe()
    entry_type = SimpleNamespace

    assert probe.is_resume_array(list[SimpleNamespace] | None, entry_type) is True
    assert probe.is_resume_array(SimpleNamespace | None, entry_type) is False
    assert probe.is_resume_array(list[str] | None, entry_type) is False


class _AcceptingResumeAgent:
    def _build_command_from_agui_resume(self, entries, *, open_interrupts):
        del open_interrupts
        return SimpleNamespace(
            resume={entry.interrupt_id: entry.payload for entry in entries},
        )


class _ExceptionResumeAgent:
    def _build_command_from_agui_resume(self, entries, *, open_interrupts):
        entry_ids = [entry.interrupt_id for entry in entries]
        open_ids = [interrupt.id for interrupt in open_interrupts]
        if (
            set(entry_ids) == set(open_ids)
            and len(entry_ids) == len(open_ids)
            and len(entry_ids) == len(set(entry_ids))
            and all(entry.status in {"resolved", "cancelled"} for entry in entries)
        ):
            return SimpleNamespace(
                resume={entry.interrupt_id: entry.payload for entry in entries},
            )
        message = "not a standard protocol denial"
        raise ValueError(message)


class _StandardResumeAgent:
    def _build_command_from_agui_resume(self, entries, *, open_interrupts):
        entry_ids = [entry.interrupt_id for entry in entries]
        open_ids = [interrupt.id for interrupt in open_interrupts]
        valid_statuses = {"resolved", "cancelled"}
        full_valid = (
            set(entry_ids) == set(open_ids)
            and len(entry_ids) == len(open_ids)
            and len(entry_ids) == len(set(entry_ids))
            and all(entry.status in valid_statuses for entry in entries)
        )
        if not full_valid:
            return SimpleNamespace(type="RUN_ERROR", message="invalid resume")
        return SimpleNamespace(
            resume={entry.interrupt_id: entry.payload for entry in entries},
        )


@pytest.mark.parametrize("agent_type", [_AcceptingResumeAgent, _ExceptionResumeAgent])
def test_resume_matrix_rejects_acceptance_or_exception_as_standard_denial(agent_type) -> None:
    probe = _load_probe()

    result = probe.probe_resume_matrix(agent_type(), SimpleNamespace)

    assert result["full_all_open_success"] is True
    assert result["all_invalid_standard_run_error"] is False
    assert set(result["cases"]) == {
        "full_all_open",
        "full_all_open_reordered",
        "partial",
        "stale",
        "duplicate",
        "unknown",
        "invalid",
    }
    assert result["cases"]["partial"]["outcome"] in {"accepted", "exception"}


def test_resume_matrix_requires_full_success_and_standard_denial_for_every_invalid_variant() -> None:
    probe = _load_probe()

    result = probe.probe_resume_matrix(_StandardResumeAgent(), SimpleNamespace)

    assert result["full_all_open_success"] is True
    assert result["all_invalid_standard_run_error"] is True
    assert all(
        result["cases"][case]["outcome"] == "standard_run_error"
        for case in ("partial", "stale", "duplicate", "unknown", "invalid")
    )
    assert result["cases"]["full_all_open_reordered"]["outcome"] == "accepted"


def test_standard_outcome_helpers_require_run_error_or_terminal_interrupt_shape() -> None:
    probe = _load_probe()
    interrupt = SimpleNamespace(
        type="RUN_FINISHED",
        outcome=SimpleNamespace(
            type="interrupt",
            interrupts=[SimpleNamespace(id="interrupt-a"), SimpleNamespace(id="interrupt-b")],
        ),
    )
    error = SimpleNamespace(type="RUN_ERROR", message="invalid resume")

    assert probe.standard_run_error([error]) is True
    assert probe.standard_interrupt_outcome([interrupt], {"interrupt-a", "interrupt-b"}) is True
    assert probe.standard_run_error(ValueError("not an event")) is False
    assert (
        probe.standard_interrupt_outcome(
            [SimpleNamespace(type="RUN_FINISHED", outcome=None)],
            {"interrupt-a", "interrupt-b"},
        )
        is False
    )


def test_source_unavailability_never_proves_deprecated_resume_absent_or_binding_safe() -> None:
    probe = _load_probe()

    assert probe.deprecated_resume_absent(None) is False
    assert probe.probe_safe_pre_dispatch_binding(lambda: None, None, SimpleNamespace)[0] is False


def test_binding_gate_requires_documented_executable_dependency_semantics() -> None:
    probe = _load_probe()

    def name_only_endpoint(app, agent, path="/", authorize=None):
        """An auth-looking name without executable dependency semantics."""

    assert (
        probe.probe_safe_pre_dispatch_binding(
            name_only_endpoint,
            inspect.getsource(name_only_endpoint),
            SimpleNamespace,
        )[0]
        is False
    )


def test_binding_gate_proves_dependency_runs_before_agent_dispatch() -> None:
    probe = _load_probe()

    def documented_endpoint(app, agent, path="/", dependencies=(), before_dispatch=None):
        """Register FastAPI dependencies and before_dispatch before agent dispatch."""
        from fastapi import Request

        async def route(input_data: dict, request):
            if before_dispatch is not None:
                await before_dispatch(input_data, request)
            agent.dispatched = True
            return input_data

        route.__annotations__["request"] = Request
        app.post(path, dependencies=list(dependencies))(route)

    passed, details = probe.probe_safe_pre_dispatch_binding(
        documented_endpoint,
        inspect.getsource(documented_endpoint),
        SimpleNamespace,
    )

    assert passed is True
    assert details["dependency_called"] is True
    assert details["before_dispatch_called"] is True
    assert details["call_order"] == ["dependency", "before_dispatch"]
    assert details["agent_dispatched"] is False
    assert details["observed_thread_id"] == "binding-thread"
    assert details["observed_run_id"] == "binding-run"
    assert details["response_status"] == 403


@pytest.mark.parametrize("wired_hook", ["before_dispatch", "dependency"])
def test_binding_gate_rejects_when_dependency_or_before_dispatch_is_unwired(
    wired_hook: str,
) -> None:
    probe = _load_probe()

    def unwired_endpoint(app, agent, path="/", dependencies=(), before_dispatch=None):
        """Claim dependencies and before_dispatch while leaving one unwired."""

        async def route(input_data: dict):
            if wired_hook == "before_dispatch" and before_dispatch is not None:
                await before_dispatch(input_data, None)
            agent.dispatched = True
            return input_data

        app.post(path, dependencies=list(dependencies) if wired_hook == "dependency" else [])(route)

    passed, details = probe.probe_safe_pre_dispatch_binding(
        unwired_endpoint,
        inspect.getsource(unwired_endpoint),
        SimpleNamespace,
    )

    assert passed is False
    if wired_hook == "dependency":
        assert details["dependency_called"] is True
        assert details["before_dispatch_called"] is False
    else:
        assert details["dependency_called"] is False


def test_binding_gate_is_black_box_and_does_not_require_endpoint_source() -> None:
    probe = _load_probe()

    def opaque_endpoint(app, agent, path="/", dependencies=(), before_dispatch=None):
        from fastapi import Request

        async def route(input_data: dict, request):
            if before_dispatch is not None:
                await before_dispatch(input_data, request)
            agent.dispatched = True
            return input_data

        route.__annotations__["request"] = Request
        app.post(path, dependencies=list(dependencies))(route)

    passed, details = probe.probe_safe_pre_dispatch_binding(
        opaque_endpoint,
        None,
        SimpleNamespace,
    )

    assert passed is True
    assert details["source_available"] is False
    assert details["black_box_http"] is True


def test_admission_handoff_retains_exact_non_placeholder_evidence() -> None:
    text = ADMISSION_PATH.read_text()

    assert "<exact candidate requirement>" not in text
    assert "<registry-or-subtree-sha256>" not in text
    assert "sha512-Zv20...j7pg==" not in text
    assert "sha512-JDxE...zMJg==" not in text
    assert "sha512-twdk...My0w==" not in text
    assert "sha512-Xap2...0MHw==" not in text
    for exact_value in (
        "sha512-Zv20Rebsh6VcvO00HDbh9B0Q6XnmEYygv8BKur0+OS4eRb1gR4QmWjff/+sjJgweFpgb645jY1i0FB4MU7j7pg==",
        "sha512-JDxEMBdT5k477iS+mOBMBePXnE+Z0stUGC4wUC/a5z2C3EqOS7OuYHHy370Qh+g6tkvL4DtRNl2XZ8gYn0zMJg==",
        "sha512-twdk0ax0VfiuGG3zg5xcpYr44n8VMeBjWv0aW0a5xOo+CFgG3GSMu8e3vzz6Vgblmq0p+k6Z43sQuwFC32My0w==",
        "sha512-Xap2alG9Z0/j5kb3x4D7oTpe2sw1dfrC9rgJJr2NZu5vKcm8dzIPNd31mF2B4zS3BKqYIu245yxKPhEtT30MHw==",
        "03bb89a6c73228c4a3d0a196ed106fce701655428b866387a3f45d986ae3dc76",
        "ag_ui_langgraph-0.0.42.dist-info/licenses/LICENSE",
        "integrations/langgraph/python/LICENSE",
        "--artifact-path /tmp/ketos-s01-a01-artifacts/ag_ui_langgraph-0.0.42.whl",
    ):
        assert exact_value in text
    assert "### Retained redacted probe JSON" in text
    assert text.count('"admitted": false') >= 3
    assert "+### Retained redacted probe JSON" not in text
    assert "final 22 passed" in text
    assert "mcp__context7__query_docs" in text
    assert (
        "At pinned CopilotKit v2, document the exact import path, generic signature, "
        "render arguments, and resolver payload type for useInterrupt"
    ) in text
    assert "Monthly quota exceeded" in text
    assert "node_modules/@copilotkit/react-core/dist/v2/headless.d.cts" in text
    assert "rg -n 'type InterruptResolveFn|interface InterruptRenderProps|declare function useInterrupt'" in text
    assert text.count('"documented_dependencies": false') >= 3


def test_deprecated_forwarded_props_resume_is_detected_without_a_deprecation_label() -> None:
    probe = _load_probe()
    published_0042_shape = """
    forwarded_props = input.forwarded_props or {}
    command_input = forwarded_props.get('command', {})
    resume_input = command_input.get('resume', None)
    """

    assert probe.uses_deprecated_forwarded_props_resume(published_0042_shape) is True
    assert probe.uses_deprecated_forwarded_props_resume("input.resume") is False


def test_deprecated_resume_detector_tracks_dot_bracket_and_alias_data_flow() -> None:
    probe = _load_probe()
    dot_access = "return input.forwardedProps.command.resume"
    aliased_access = """
    props = input.forwarded_props
    command = props.get("command", {})
    resume = command["resume"]
    return resume
    """

    assert probe.uses_deprecated_forwarded_props_resume(dot_access) is True
    assert probe.uses_deprecated_forwarded_props_resume(aliased_access) is True


@pytest.mark.parametrize(
    "source",
    [
        "# forwarded_props command resume",
        'message = "forwardedProps.command.resume"',
        "forwarded_props = {}; command = {}; resume = input.resume",
        'return forwarded_props["command"]["resume"]',
        'return input.forwarded_props.get("resume")',
        'return input.command.get("resume")',
    ],
)
def test_deprecated_resume_detector_rejects_string_search_false_positives(source: str) -> None:
    probe = _load_probe()

    assert probe.uses_deprecated_forwarded_props_resume(source) is False


def test_temporary_fork_decision_only_supersedes_dependency_source_and_keeps_gates() -> None:
    text = FORK_DECISION_PATH.read_text(encoding="utf-8")

    assert "factor241" in text
    assert "dependency-source" in text
    assert "protocol" in text
    assert "security" in text
    assert "PENDING" in text
    assert "does not grant PASS" in text


def test_admission_handoff_marks_fork_artifacts_pending_without_claiming_pass() -> None:
    text = ADMISSION_PATH.read_text(encoding="utf-8")

    assert "Temporary fork evidence: **PENDING**" in text
    assert "STAGE_01_TEMPORARY_FORK_DECISION.md" in text
    assert "Verdict: **BLOCKED**" in text
