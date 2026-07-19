from __future__ import annotations

import hashlib
import importlib
import importlib.metadata
import importlib.util
import inspect
import json
import stat
import subprocess
import sys
import tarfile
import time
import zipfile
from pathlib import Path
from types import SimpleNamespace
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from types import ModuleType

REPO_ROOT = Path(__file__).resolve().parents[6]
BACKEND_MANIFEST_PATH = REPO_ROOT / "src" / "backend" / "base" / "pyproject.toml"
PROBE_PATH = REPO_ROOT / "scripts" / "mvp" / "probe_ag_ui_adapter.py"
ADMISSION_PATH = REPO_ROOT / "docs" / "dev" / "handoff" / "STAGE_01_AG_UI_ADMISSION.md"
FORK_DECISION_PATH = REPO_ROOT / "docs" / "dev" / "handoff" / "STAGE_01_TEMPORARY_FORK_DECISION.md"
LICENSE_BYTES = b"MIT License\n\nCopyright (c) AG-UI contributors\n"
FORK_COMMIT = "1" * 40
UPSTREAM_BASE = "2" * 40
PROVENANCE_MAX_BYTES = 64 * 1024
GIT_EXECUTABLE = "/usr/bin/git"


def test_sqlite_checkpoint_dependency_is_exact_and_import_compatible() -> None:
    manifest = BACKEND_MANIFEST_PATH.read_text(encoding="utf-8")

    assert '"langgraph-checkpoint-sqlite==3.1.0",' in manifest
    assert importlib.metadata.version("langgraph-checkpoint-sqlite") == "3.1.0"

    sqlite_module = importlib.import_module("langgraph.checkpoint.sqlite")
    sqlite_aio_module = importlib.import_module("langgraph.checkpoint.sqlite.aio")
    assert sqlite_module.SqliteSaver.__module__ == "langgraph.checkpoint.sqlite"
    assert sqlite_aio_module.AsyncSqliteSaver.__module__ == "langgraph.checkpoint.sqlite.aio"


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
            "source_class": "approved-fork",
        },
        "fork_provenance": {
            "bound": True,
            "source_commit_bound": True,
            "source_tree_bound": True,
            "changed_files_derived": True,
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


def _git(repo: Path, *args: str) -> str:
    result = subprocess.run(  # noqa: S603 - hermetic fixture uses fixed git binary and no shell
        [GIT_EXECUTABLE, "-C", str(repo), *args],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def _write_git_bound_fork_fixture(
    tmp_path: Path,
) -> tuple[Path, Path, Path, dict[str, object], Path]:
    repo = tmp_path / "fork-repo"
    package_root = repo / "integrations" / "langgraph" / "python"
    source_root = package_root / "ag_ui_langgraph"
    tests_root = package_root / "tests"
    source_root.mkdir(parents=True)
    tests_root.mkdir()
    (package_root / "pyproject.toml").write_text(
        """[project]
name = "ag-ui-langgraph"
version = "0.0.43+ketos.1"
license = "MIT"
license-files = ["LICENSE"]
requires-python = ">=3.10,<3.15"
""",
        encoding="utf-8",
    )
    (package_root / "LICENSE").write_bytes(LICENSE_BYTES)
    (source_root / "agent.py").write_text("class LangGraphAgent: pass\n", encoding="utf-8")
    (source_root / "endpoint.py").write_text("def endpoint(): pass\n", encoding="utf-8")
    (tests_root / "test_agent.py").write_text("def test_base(): pass\n", encoding="utf-8")
    _git(repo.parent, "init", str(repo))
    _git(repo, "config", "user.email", "fork@example.test")
    _git(repo, "config", "user.name", "Fork Fixture")
    _git(repo, "remote", "add", "origin", "https://github.com/factor241/ag-ui.git")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "upstream base")
    upstream_sha = _git(repo, "rev-parse", "HEAD")
    (source_root / "agent.py").write_text(
        "class LangGraphAgent:\n    strict_resume = True\n",
        encoding="utf-8",
    )
    (tests_root / "test_agent.py").write_text(
        "def test_strict_resume(): assert True\n",
        encoding="utf-8",
    )
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "strict fork")
    fork_sha = _git(repo, "rev-parse", "HEAD")
    approved_remote = tmp_path / "approved-remote.git"
    _git(repo.parent, "clone", "--bare", str(repo), str(approved_remote))
    source_archive = tmp_path / "factor241-ag-ui-source.tar"
    _git(
        repo,
        "archive",
        "--format=tar",
        f"--output={source_archive}",
        fork_sha,
        "integrations/langgraph/python",
    )

    wheel = tmp_path / "ag_ui_langgraph-0.0.43+ketos.1-py3-none-any.whl"
    dist_info = "ag_ui_langgraph-0.0.43+ketos.1.dist-info"
    metadata = """Metadata-Version: 2.4
Name: ag-ui-langgraph
Version: 0.0.43+ketos.1
License-Expression: MIT
License-File: LICENSE
Requires-Python: >=3.10,<3.15
"""
    with zipfile.ZipFile(wheel, "w") as archive:
        archive.writestr(f"{dist_info}/METADATA", metadata)
        archive.writestr(
            "ag_ui_langgraph/agent.py",
            (source_root / "agent.py").read_bytes(),
        )
        archive.writestr(
            "ag_ui_langgraph/endpoint.py",
            (source_root / "endpoint.py").read_bytes(),
        )
        archive.writestr(
            f"{dist_info}/WHEEL",
            "Wheel-Version: 1.0\nGenerator: fixture\nRoot-Is-Purelib: true\nTag: py3-none-any\n",
        )
        archive.writestr(f"{dist_info}/licenses/LICENSE", LICENSE_BYTES)
        archive.writestr(f"{dist_info}/RECORD", "")

    provenance = _fork_provenance(wheel, source_archive)
    provenance.update(
        {
            "package_version": "0.0.43+ketos.1",
            "upstream_base_sha": upstream_sha,
            "fork_commit_sha": fork_sha,
            "changed_files": [
                "integrations/langgraph/python/ag_ui_langgraph/agent.py",
                "integrations/langgraph/python/tests/test_agent.py",
            ],
            "build_command": f"git checkout --detach {fork_sha} && uv build",
            "test_command": f"git checkout --detach {fork_sha} && uv run pytest",
        }
    )
    return repo, wheel, source_archive, provenance, approved_remote


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
        "fork_repository_path",
        "upstream_provenance_path",
        "upstream_repository_path",
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
    repo, wheel, source_archive, provenance, approved_remote = _write_git_bound_fork_fixture(tmp_path)
    probe.APPROVED_FORK_GIT_REMOTE = str(approved_remote)

    result = probe.validate_fork_provenance(
        provenance,
        artifact_path=wheel,
        source_archive_path=source_archive,
        repository_path=repo,
        artifact=probe.inspect_artifact(wheel),
    )

    assert result["bound"] is True
    assert result["approved_owner"] == "factor241"
    assert result["fork_commit_sha"] == provenance["fork_commit_sha"]
    assert result["upstream_base_sha"] == provenance["upstream_base_sha"]
    assert result["artifact_sha256"] == hashlib.sha256(wheel.read_bytes()).hexdigest()
    assert result["source_archive_sha256"] == hashlib.sha256(source_archive.read_bytes()).hexdigest()


def test_fork_provenance_rejects_extra_wheel_payload_even_with_recomputed_self_attested_hash(
    tmp_path: Path,
) -> None:
    probe = _load_probe()
    repo, wheel, source_archive, provenance, approved_remote = _write_git_bound_fork_fixture(tmp_path)
    probe.APPROVED_FORK_GIT_REMOTE = str(approved_remote)

    with zipfile.ZipFile(wheel, "a") as archive:
        archive.writestr("unapproved_payload.txt", b"not present in the bound fork source or build inventory")
    provenance["artifact_sha256"] = hashlib.sha256(wheel.read_bytes()).hexdigest()

    with pytest.raises(ValueError, match="wheel inventory"):
        probe.validate_fork_provenance(
            provenance,
            artifact_path=wheel,
            source_archive_path=source_archive,
            repository_path=repo,
            artifact=probe.inspect_artifact(wheel),
        )


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
    repo, wheel, source_archive, provenance, approved_remote = _write_git_bound_fork_fixture(tmp_path)
    probe.APPROVED_FORK_GIT_REMOTE = str(approved_remote)
    mutation(provenance)

    with pytest.raises(ValueError, match=error):
        probe.validate_fork_provenance(
            provenance,
            artifact_path=wheel,
            source_archive_path=source_archive,
            repository_path=repo,
            artifact=probe.inspect_artifact(wheel),
        )


def test_fork_changed_file_allowlist_includes_only_the_exact_interrupts_concept_doc() -> None:
    probe = _load_probe()

    assert probe._approved_changed_file("docs/concepts/interrupts.mdx") is True
    assert probe._approved_changed_file("integrations/langgraph/python/ag_ui_langgraph/__init__.py") is True
    assert probe._approved_changed_file("docs/concepts/other.mdx") is False


def test_fork_provenance_schema_is_reusable_for_a_source_tgz(tmp_path: Path) -> None:
    probe = _load_probe()
    repo, wheel, source_archive, provenance, approved_remote = _write_git_bound_fork_fixture(tmp_path)
    probe.APPROVED_FORK_GIT_REMOTE = str(approved_remote)
    del wheel
    provenance["artifact_kind"] = "tgz"
    provenance["artifact_filename"] = source_archive.name
    provenance["artifact_sha256"] = hashlib.sha256(source_archive.read_bytes()).hexdigest()
    artifact = probe.inspect_artifact(source_archive)

    result = probe.validate_fork_provenance(
        provenance,
        artifact_path=source_archive,
        source_archive_path=None,
        repository_path=repo,
        artifact=artifact,
    )

    assert result["bound"] is True
    assert result["artifact_kind"] == "tgz"


def test_official_upstream_archive_requires_remote_bound_git_provenance(tmp_path: Path) -> None:
    probe = _load_probe()
    repo, _wheel, source_archive, provenance, approved_remote = _write_git_bound_fork_fixture(tmp_path)
    _git(repo, "remote", "set-url", "origin", "https://github.com/ag-ui-protocol/ag-ui.git")
    provenance.update(
        {
            "artifact_kind": "tgz",
            "approved_owner": "ag-ui-protocol",
            "canonical_repo_url": "https://github.com/ag-ui-protocol/ag-ui",
            "artifact_filename": source_archive.name,
            "artifact_sha256": hashlib.sha256(source_archive.read_bytes()).hexdigest(),
        }
    )
    artifact = probe.inspect_artifact(source_archive)
    probe.OFFICIAL_UPSTREAM_GIT_REMOTE = str(approved_remote)

    result = probe.validate_upstream_provenance(
        provenance,
        artifact_path=source_archive,
        repository_path=repo,
        artifact=artifact,
    )

    assert all(result[key] is True for key in probe.UPSTREAM_PROVENANCE_BINDINGS)
    evidence = _complete_evidence(str(artifact["version"]))
    evidence["artifact"]["source_class"] = "upstream-commit"
    evidence.pop("fork_provenance")
    evidence["upstream_provenance"] = result
    assert probe.evaluate_candidate(evidence) == {"admitted": True, "reasons": []}


def test_git_bound_fork_provenance_matches_archive_commit_tree_and_derived_diff(
    tmp_path: Path,
) -> None:
    probe = _load_probe()
    repo, wheel, source_archive, provenance, approved_remote = _write_git_bound_fork_fixture(tmp_path)
    probe.APPROVED_FORK_GIT_REMOTE = str(approved_remote)

    result = probe.validate_fork_provenance(
        provenance,
        artifact_path=wheel,
        source_archive_path=source_archive,
        repository_path=repo,
        artifact=probe.inspect_artifact(wheel),
    )

    assert result["bound"] is True
    assert result["source_commit_bound"] is True
    assert result["source_tree_bound"] is True
    assert result["changed_files_derived"] is True


def test_fork_provenance_rejects_spoofed_fetch_origin_even_with_approved_push_url(
    tmp_path: Path,
) -> None:
    probe = _load_probe()
    repo, wheel, source_archive, provenance, approved_remote = _write_git_bound_fork_fixture(tmp_path)
    probe.APPROVED_FORK_GIT_REMOTE = str(approved_remote)
    _git(repo, "remote", "set-url", "origin", "https://github.com/attacker/ag-ui.git")
    _git(
        repo,
        "remote",
        "set-url",
        "--push",
        "origin",
        "https://github.com/factor241/ag-ui.git",
    )

    with pytest.raises(ValueError, match="fetch origin"):
        probe.validate_fork_provenance(
            provenance,
            artifact_path=wheel,
            source_archive_path=source_archive,
            repository_path=repo,
            artifact=probe.inspect_artifact(wheel),
        )


def test_fork_candidate_cannot_be_admitted_without_validated_provenance() -> None:
    probe = _load_probe()
    evidence = _complete_evidence("0.0.43+ketos.1")
    evidence["artifact"]["source_class"] = "approved-fork"
    evidence.pop("fork_provenance")

    result = probe.evaluate_candidate(evidence)

    assert result["admitted"] is False
    assert "fork_provenance" in result["reasons"]


def test_fork_candidate_uses_validated_provenance_in_admission_decision() -> None:
    probe = _load_probe()
    evidence = _complete_evidence("0.0.43+ketos.1")
    evidence["artifact"]["source_class"] = "approved-fork"
    evidence["fork_provenance"] = {
        "bound": True,
        "source_commit_bound": True,
        "source_tree_bound": True,
        "changed_files_derived": True,
    }

    assert probe.evaluate_candidate(evidence) == {"admitted": True, "reasons": []}


def test_relabeled_fork_selection_requires_provenance_without_local_version_suffix() -> None:
    probe = _load_probe()
    evidence = _complete_evidence("0.0.43")
    evidence["artifact"]["source_class"] = probe.classify_candidate_source(
        evidence["artifact"],
        fork_selected=True,
    )
    evidence.pop("fork_provenance")

    result = probe.evaluate_candidate(evidence)

    assert evidence["artifact"]["source_class"] == "approved-fork"
    assert result["admitted"] is False
    assert "fork_provenance" in result["reasons"]


def test_registry_release_fails_closed_without_separate_origin_and_hash_evidence() -> None:
    probe = _load_probe()
    evidence = _complete_evidence("0.0.43")
    evidence["artifact"]["source_class"] = "registry-release"
    evidence.pop("fork_provenance")

    result = probe.evaluate_candidate(evidence)

    assert result["admitted"] is False
    assert "registry_unsupported" in result["reasons"]


def test_registry_release_rejects_fabricated_positive_binding_flags() -> None:
    probe = _load_probe()
    evidence = _complete_evidence("0.0.43")
    evidence["artifact"]["source_class"] = "registry-release"
    evidence.pop("fork_provenance")
    evidence["registry_provenance"] = {
        "bound": True,
        "origin_bound": True,
        "expected_sha256_bound": True,
    }

    result = probe.evaluate_candidate(evidence)

    assert result["admitted"] is False
    assert "registry_unsupported" in result["reasons"]


@pytest.mark.parametrize("source_class", ["upstream-commit", "unknown"])
def test_bare_upstream_and_unknown_source_classes_never_admit(source_class: str) -> None:
    probe = _load_probe()
    evidence = _complete_evidence("0.0.43")
    evidence["artifact"]["source_class"] = source_class
    evidence.pop("fork_provenance", None)
    evidence.pop("registry_provenance", None)

    result = probe.evaluate_candidate(evidence)

    assert result["admitted"] is False
    expected = "upstream_provenance" if source_class == "upstream-commit" else "source_class"
    assert expected in result["reasons"]


def test_mutable_local_factor241_origin_does_not_prove_remote_commit_reachability(
    tmp_path: Path,
) -> None:
    probe = _load_probe()
    repo, wheel, source_archive, provenance, _fixture_remote = _write_git_bound_fork_fixture(tmp_path)
    unreachable_remote = tmp_path / "unreachable-approved-remote.git"
    _git(tmp_path, "init", "--bare", str(unreachable_remote))
    probe.APPROVED_FORK_GIT_REMOTE = str(unreachable_remote)

    with pytest.raises(ValueError, match=r"remote.*reach|fetch"):
        probe.validate_fork_provenance(
            provenance,
            artifact_path=wheel,
            source_archive_path=source_archive,
            repository_path=repo,
            artifact=probe.inspect_artifact(wheel),
        )


@pytest.mark.parametrize(
    ("member_type", "member_name", "link_name"),
    [
        (tarfile.SYMTYPE, "integrations/langgraph/python/escape-symlink", "../../etc/passwd"),
        (tarfile.LNKTYPE, "integrations/langgraph/python/escape-hardlink", "/etc/passwd"),
        (tarfile.CHRTYPE, "integrations/langgraph/python/device", ""),
        (tarfile.REGTYPE, "../../escape-file", ""),
        (tarfile.REGTYPE, "/absolute-file", ""),
    ],
)
def test_source_archive_rejects_links_devices_absolute_and_traversal_members(
    tmp_path: Path,
    member_type: bytes,
    member_name: str,
    link_name: str,
) -> None:
    probe = _load_probe()
    repo, wheel, source_archive, provenance, approved_remote = _write_git_bound_fork_fixture(tmp_path)
    probe.APPROVED_FORK_GIT_REMOTE = str(approved_remote)
    with tarfile.open(source_archive, mode="a") as archive:
        member = tarfile.TarInfo(member_name)
        member.type = member_type
        member.linkname = link_name
        member.size = 0
        archive.addfile(member)
    provenance["source_archive_sha256"] = hashlib.sha256(source_archive.read_bytes()).hexdigest()

    with pytest.raises(ValueError, match="unsafe archive member"):
        probe.validate_fork_provenance(
            provenance,
            artifact_path=wheel,
            source_archive_path=source_archive,
            repository_path=repo,
            artifact=probe.inspect_artifact(wheel),
        )


def test_archive_byte_limit_fails_closed_before_format_parsing(tmp_path: Path) -> None:
    probe = _load_probe()
    oversized = tmp_path / "oversized.whl"
    oversized.write_bytes(b"x" * 17)
    probe.ARCHIVE_MAX_BYTES = 16

    with pytest.raises(ValueError, match=r"archive exceeds.*size limit"):
        probe.inspect_artifact(oversized)


@pytest.mark.parametrize(
    ("limit_name", "limit", "error"),
    [
        ("ARCHIVE_MAX_MEMBERS", 1, "member limit"),
        ("ARCHIVE_MAX_MEMBER_BYTES", 1, "archive member exceeds"),
        ("ARCHIVE_MAX_UNCOMPRESSED_BYTES", 1, "uncompressed limit"),
    ],
)
def test_source_archive_member_and_uncompressed_limits_fail_closed(
    tmp_path: Path,
    limit_name: str,
    limit: int,
    error: str,
) -> None:
    probe = _load_probe()
    _repo, _wheel, source_archive, _provenance, _remote = _write_git_bound_fork_fixture(tmp_path)
    setattr(probe, limit_name, limit)

    with pytest.raises(ValueError, match=error):
        probe.inspect_artifact(source_archive)


def test_git_stdout_is_bounded(tmp_path: Path) -> None:
    probe = _load_probe()
    repo, _wheel, _source, _provenance, _remote = _write_git_bound_fork_fixture(tmp_path)
    probe.GIT_STDOUT_MAX_BYTES = 1
    with pytest.raises(ValueError, match="stdout exceeds"):
        probe._git_output(repo, "rev-parse", "HEAD")


@pytest.mark.parametrize("stream", ["stdout", "stderr"])
def test_subprocess_output_is_killed_as_soon_as_either_stream_exceeds_limit(stream: str) -> None:
    probe = _load_probe()
    script = f"import sys,time; target=sys.{stream}.buffer; target.write(b'x'*65536); target.flush(); time.sleep(5)"

    started = time.monotonic()
    with pytest.raises(ValueError, match=f"{stream} exceeds"):
        probe._run_bounded_process(
            [sys.executable, "-c", script],
            stdout_limit=1024,
            stderr_limit=1024,
            timeout_seconds=2,
        )
    assert time.monotonic() - started < 1


def test_subprocess_timeout_kills_process() -> None:
    probe = _load_probe()

    with pytest.raises(ValueError, match="timed out"):
        probe._run_bounded_process(
            [sys.executable, "-c", "import time; time.sleep(5)"],
            stdout_limit=1024,
            stderr_limit=1024,
            timeout_seconds=0.01,
        )


@pytest.mark.parametrize(
    "special_mode",
    [stat.S_IFIFO, stat.S_IFCHR, stat.S_IFBLK, stat.S_IFSOCK, stat.S_IFLNK],
)
def test_wheel_rejects_every_unix_special_member_type(tmp_path: Path, special_mode: int) -> None:
    probe = _load_probe()
    wheel = _write_wheel(tmp_path)
    with zipfile.ZipFile(wheel, "a") as archive:
        member = zipfile.ZipInfo("ag_ui_langgraph/special")
        member.create_system = 3
        member.external_attr = (special_mode | 0o600) << 16
        archive.writestr(member, b"")

    with pytest.raises(ValueError, match="unsafe archive member type"):
        probe.inspect_artifact(wheel)


def test_wheel_counts_directories_and_rejects_duplicate_or_backslash_names(tmp_path: Path) -> None:
    probe = _load_probe()
    directory_flood = _write_wheel(tmp_path, version="0.0.43.dev1")
    with zipfile.ZipFile(directory_flood, "a") as archive:
        for index in range(5):
            archive.writestr(f"extra-{index}/", b"")
    probe.ARCHIVE_MAX_MEMBERS = 4
    with pytest.raises(ValueError, match="member limit"):
        probe.inspect_artifact(directory_flood)

    probe.ARCHIVE_MAX_MEMBERS = 20_000
    duplicate = _write_wheel(tmp_path, version="0.0.43.dev2")
    with zipfile.ZipFile(duplicate, "a") as archive:
        archive.writestr("ag_ui_langgraph/agent.py", "duplicate = True\n")
    with pytest.raises(ValueError, match="duplicate archive member"):
        probe.inspect_artifact(duplicate)

    backslash = _write_wheel(tmp_path, version="0.0.43.dev3")
    with zipfile.ZipFile(backslash, "a") as archive:
        archive.writestr(r"..\escape.py", "escape = True\n")
    with pytest.raises(ValueError, match="unsafe archive member"):
        probe.inspect_artifact(backslash)


@pytest.mark.parametrize(
    "mutation",
    [
        "wheel_as_tgz",
        "non_tar_source",
        "wrong_archive_commit",
        "source_wheel_mismatch",
        "false_changed_files",
    ],
)
def test_fork_provenance_rejects_kind_source_commit_tree_or_diff_spoof(
    tmp_path: Path,
    mutation: str,
) -> None:
    probe = _load_probe()
    repo, wheel, source_archive, provenance, approved_remote = _write_git_bound_fork_fixture(tmp_path)
    probe.APPROVED_FORK_GIT_REMOTE = str(approved_remote)
    if mutation == "wheel_as_tgz":
        provenance["artifact_kind"] = "tgz"
        source_archive_path = None
    elif mutation == "non_tar_source":
        source_archive.write_bytes(b"not a tar archive")
        provenance["source_archive_sha256"] = hashlib.sha256(source_archive.read_bytes()).hexdigest()
        source_archive_path = source_archive
    elif mutation == "wrong_archive_commit":
        provenance["fork_commit_sha"] = provenance["upstream_base_sha"]
        source_archive_path = source_archive
    elif mutation == "source_wheel_mismatch":
        with zipfile.ZipFile(wheel, "a") as archive:
            archive.writestr("ag_ui_langgraph/agent.py", "tampered = True\n")
        provenance["artifact_sha256"] = hashlib.sha256(wheel.read_bytes()).hexdigest()
        source_archive_path = source_archive
    else:
        provenance["changed_files"] = ["integrations/langgraph/python/ag_ui_langgraph/endpoint.py"]
        source_archive_path = source_archive

    with pytest.raises(ValueError, match=r".+"):
        probe.validate_fork_provenance(
            provenance,
            artifact_path=wheel,
            source_archive_path=source_archive_path,
            repository_path=repo,
            artifact=probe.inspect_artifact(wheel),
        )


def test_provenance_json_loader_rejects_oversized_untrusted_input(tmp_path: Path) -> None:
    probe = _load_probe()
    path = tmp_path / "oversized-provenance.json"
    path.write_bytes(b" " * (PROVENANCE_MAX_BYTES + 1))

    with pytest.raises(ValueError, match="size limit"):
        probe.load_fork_provenance(path)


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


class _PublicStrictResumeAgent:
    def __init__(self) -> None:
        self.graph_dispatches = 0

    async def prepare_stream(self, input_data, state, config):
        del config
        open_ids = [interrupt.id for task in state.tasks for interrupt in task.interrupts]
        forwarded = input_data.forwarded_props or {}
        if "resume" in forwarded.get("command", {}):
            return {"events_to_dispatch": [SimpleNamespace(type="RUN_ERROR")], "stream": None}
        if input_data.resume is None:
            interrupts = [SimpleNamespace(id=item) for item in open_ids]
            return {
                "events_to_dispatch": [
                    SimpleNamespace(type="RUN_STARTED"),
                    SimpleNamespace(
                        type="RUN_FINISHED",
                        outcome=SimpleNamespace(type="interrupt", interrupts=interrupts),
                    ),
                ],
                "stream": None,
            }
        resume_ids = [entry.interrupt_id for entry in input_data.resume]
        if (
            len(resume_ids) != len(set(resume_ids))
            or set(resume_ids) != set(open_ids)
            or any(entry.status not in {"resolved", "cancelled"} for entry in input_data.resume)
        ):
            return {"events_to_dispatch": [SimpleNamespace(type="RUN_ERROR")], "stream": None}
        self.graph_dispatches += 1
        return {"events_to_dispatch": [], "stream": SimpleNamespace()}


def test_public_resume_probe_makes_legacy_denial_and_all_open_behavior_authoritative() -> None:
    probe = _load_probe()
    agent = _PublicStrictResumeAgent()

    result = probe.probe_public_resume_contract(agent, SimpleNamespace, SimpleNamespace)

    assert result["standard_interrupt_outcome"] is True
    assert result["legacy_resume_standard_run_error"] is True
    assert result["full_all_open_success"] is True
    assert result["all_invalid_standard_run_error"] is True
    assert result["graph_dispatches"] == 1
    error = SimpleNamespace(type="RUN_ERROR", message="invalid resume")
    interrupt = SimpleNamespace(
        type="RUN_FINISHED",
        outcome=SimpleNamespace(
            type="interrupt",
            interrupts=[SimpleNamespace(id="interrupt-a"), SimpleNamespace(id="interrupt-b")],
        ),
    )

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


def _approved_fork_endpoint_fixture(
    app,
    agent,
    path="/",
    *,
    dependencies=None,
    before_dispatch=None,
):
    """Install dependencies and before_dispatch, clone, bind, then dispatch run."""
    from fastapi import Request
    from fastapi.responses import StreamingResponse

    async def route(input_data: dict, request):
        request_agent = agent.clone()
        if before_dispatch is not None:
            hook_result = before_dispatch(input_data, request, request_agent)
            if inspect.isawaitable(hook_result):
                await hook_result

        async def events():
            async for event in request_agent.run(input_data):
                yield event

        return StreamingResponse(events(), media_type="text/event-stream")

    route.__annotations__["request"] = Request
    app.post(path, dependencies=list(dependencies or ()))(route)


def test_binding_gate_matches_three_argument_hook_clone_run_and_actor_contract() -> None:
    probe = _load_probe()

    passed, details = probe.probe_safe_pre_dispatch_binding(
        _approved_fork_endpoint_fixture,
        inspect.getsource(_approved_fork_endpoint_fixture),
        SimpleNamespace,
    )

    assert passed is True
    assert details["deny_call_order"] == [
        "dependency",
        "clone",
        "before_dispatch",
        "deny",
    ]
    assert "run" not in details["deny_call_order"]
    assert details["success_call_order"] == [
        "dependency",
        "clone",
        "before_dispatch",
        "run",
    ]
    assert details["run_actor"] == "server-actor"
    assert details["run_agent_label"] == "request"


def test_binding_gate_rejects_obsolete_two_argument_hook_contract() -> None:
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

    assert passed is False
    assert "three-argument" in details["reason"]


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
    assert "three-argument" in details["reason"]


def test_binding_gate_requires_source_and_documentation_evidence() -> None:
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

    assert passed is False
    assert details["source_available"] is False
    assert details["black_box_http"] is False


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
    assert "historical final 22 passed" in text
    assert "historical 62 passed" in text
    assert "historical 75 passed" in text
    assert "current R3 fork-review 89 passed" in text
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
        """
        def extract(run_input):
            return run_input.forwarded_props["command"]["resume"]
        """,
        """
        def extract(props):
            return props["command"]["resume"]
        def run(input):
            return extract(input.forwarded_props)
        """,
        """
        props, other = input.forwarded_props, {}
        return props["command"]["resume"]
        """,
        """
        props = getattr(input, "forwarded_props")
        return props["command"]["resume"]
        """,
        """
        def outer(run_input):
            packed = {"wire": run_input.forwarded_props}
            props = packed["wire"]
            command = next(item for item in [props["command"]])
            return "resume" in command
        """,
        """
        def outer(run_input):
            def nested(props):
                command = props.get("command", {})
                return command.get("resume")
            return nested(run_input.forwarded_props)
        """,
    ],
)
def test_deprecated_resume_detector_fails_closed_for_adversarial_data_flows(source: str) -> None:
    probe = _load_probe()

    assert probe.uses_deprecated_forwarded_props_resume(source) is True


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
    assert "ACTIVE" in text
    assert "does not grant PASS" in text


def test_admission_handoff_records_exact_admitted_fork_artifacts() -> None:
    text = ADMISSION_PATH.read_text(encoding="utf-8")

    assert "Temporary fork evidence: **PASS**" in text
    assert "STAGE_01_TEMPORARY_FORK_DECISION.md" in text
    assert "Verdict: **PASS**" in text
    for exact_value in (
        "85b94807e464c9b38f591938a41559923a712dbb",
        "5ae33b1bab5a9e0adfb1425c5e279476a7ba35a385019d71be2f3ee79e8913cc",
        "c853ac2b78cb57481cc2ca58eda4a865908c532b",
        "64711f7e9e94ab6126fef68fdb92f9ba80f400b88d64d3a72191ee1ed7da61aa",
        "sha512-ZHIeQdU9Iy+MoFKTfm5orw2Yy0aiG0FM3JIs4c1OtxfCG70TUpmUDqzt3lPx6GJkn3lrYwbSxFnIiSCv1CdVAQ==",
        'admitted": true',
    ):
        assert exact_value in text


def test_vendored_manifest_runs_agui_probe_with_declared_fastapi_extra() -> None:
    manifest = json.loads((REPO_ROOT / "vendor/stage01/manifest.json").read_text())

    agui = manifest["artifacts"]["ag-ui-langgraph"]
    command = agui["audit"]
    assert "ag_ui_langgraph-0.0.43+ketos.1-py3-none-any.whl[fastapi]" in command
    assert agui["toolchain"]["uv"]["version"] == "0.11.21"
    assert len(agui["toolchain"]["uv"]["distributions"]) == 4
    assert agui["toolchain"]["python"] == "3.13.14"
    assert agui["toolchain"]["source_date_epoch"] == 1765974360
    assert "rebuild_ag_ui_artifact.py" in agui["rebuild"]
    assert "85b94807e464c9b38f591938a41559923a712dbb" in agui["rebuild"]
    assert "--run-tests" in agui["test"]
    assert agui["wheel_inventory"]["build_metadata"] == [
        "METADATA",
        "WHEEL",
        "licenses/LICENSE",
        "RECORD",
    ]

    copilot = manifest["artifacts"]["@copilotkit/react-core"]
    assert "audit_copilotkit_provenance.py" in copilot["source_audit"]
    assert copilot["toolchain"]["node"]["version"] == "22.23.1"
    assert len(copilot["toolchain"]["node"]["distributions"]) == 4
    assert copilot["toolchain"]["pnpm"]["version"] == "10.33.4"
    assert copilot["toolchain"]["pnpm"]["sha256"] == (
        "8e70ddc6649b18bc3d895cf3a908c0291ea4c38039ad8722c47e018daf1e9cfc"
    )
    assert copilot["toolchain"]["source_date_epoch"] == 1784227404
    hermetic_command = (
        "uv run --no-sync python scripts/mvp/rebuild_copilotkit_artifact.py "
        "--output-dir /tmp/ketos-stage01-copilot-pack --run-tests --json"
    )
    assert copilot["rebuild"] == hermetic_command
    assert copilot["test"] == hermetic_command
    for forbidden in ("npx", "corepack", "command -v", "rm -rf"):
        assert forbidden not in copilot["rebuild"]
        assert forbidden not in copilot["test"]
