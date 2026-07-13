from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

import tomllib

ROOT = Path(__file__).resolve().parents[2]
PRODUCER = ROOT / "scripts/ci/generate_supply_chain.py"
OCI_COLLECTOR = ROOT / "scripts/ci/collect_oci_subjects.py"
CANONICAL_RELEASE_WORKFLOW = ROOT / ".github/workflows/release.yml"
DOCKER_RELEASE_WORKFLOW = ROOT / ".github/workflows/docker-build-v2.yml"


def _run_producer(artifact_root: Path, output_dir: Path) -> None:
    subprocess.run(  # noqa: S603 - arguments are fixed test-controlled paths and values
        [
            sys.executable,
            str(PRODUCER),
            "--artifact-root",
            str(artifact_root),
            "--artifact",
            "dist/ketos-1.10.2.tar.gz",
            "--artifact",
            "dist/ketos-1.10.2-py3-none-any.whl",
            "--artifact",
            "release-archives/ketos-1.10.2-source.tar.gz",
            "--artifact",
            "release-archives/ketos-1.10.2-source.zip",
            "--oci-subject",
            "registry.invalid/ketos/ketos@sha256:a5e9420b6d74f9fe3a9bf1d53266d443db4ce69dd7b1424ff39dc2421532deed",
            "--output-dir",
            str(output_dir),
            "--source-uri",
            "https://git.ketos.test/ketos/ketos",
            "--commit-sha",
            "0123456789abcdef0123456789abcdef01234567",
            "--source-date-epoch",
            "1704067200",
            "--name",
            "ketos",
            "--version",
            "1.10.2",
        ],
        cwd=ROOT,
        check=True,
    )


def _write_release_inputs(root: Path) -> None:
    dist = root / "dist"
    dist.mkdir(parents=True)
    (dist / "ketos-1.10.2.tar.gz").write_bytes(b"canonical sdist\n")
    (dist / "ketos-1.10.2-py3-none-any.whl").write_bytes(b"canonical wheel\n")
    archives = root / "release-archives"
    archives.mkdir(parents=True)
    (archives / "ketos-1.10.2-source.tar.gz").write_bytes(b"canonical release archive\n")
    (archives / "ketos-1.10.2-source.zip").write_bytes(b"canonical zip release archive\n")


def test_supply_chain_outputs_are_deterministic_and_root_independent(tmp_path: Path) -> None:
    first_root = tmp_path / "first-tree"
    second_root = tmp_path / "second-tree"
    _write_release_inputs(first_root)
    _write_release_inputs(second_root)

    first_output = tmp_path / "first-output"
    second_output = tmp_path / "second-output"
    _run_producer(first_root, first_output)
    _run_producer(second_root, second_output)

    expected_names = {
        "ketos.intoto.jsonl",
        "ketos.spdx.json",
        "ketos.supply-chain-manifest.json",
    }
    assert {path.name for path in first_output.iterdir()} == expected_names
    assert {path.name for path in second_output.iterdir()} == expected_names
    for name in expected_names:
        assert (first_output / name).read_bytes() == (second_output / name).read_bytes()

    serialized = b"".join((first_output / name).read_bytes() for name in sorted(expected_names))
    assert str(tmp_path).encode() not in serialized


def test_supply_chain_documents_bind_artifact_hashes_and_source(tmp_path: Path) -> None:
    artifact_root = tmp_path / "release-tree"
    _write_release_inputs(artifact_root)
    output_dir = tmp_path / "supply-chain"
    _run_producer(artifact_root, output_dir)

    wheel_name = "dist/ketos-1.10.2-py3-none-any.whl"
    wheel_bytes = (artifact_root / wheel_name).read_bytes()
    wheel_sha = hashlib.sha256(wheel_bytes).hexdigest()

    sbom = json.loads((output_dir / "ketos.spdx.json").read_text(encoding="utf-8"))
    assert sbom["spdxVersion"] == "SPDX-2.3"
    wheel_file = next(item for item in sbom["files"] if item["fileName"] == wheel_name)
    checksums = {item["algorithm"]: item["checksumValue"] for item in wheel_file["checksums"]}
    assert checksums == {"SHA1": hashlib.sha1(wheel_bytes).hexdigest(), "SHA256": wheel_sha}  # noqa: S324
    assert sbom["creationInfo"]["created"] == "2024-01-01T00:00:00Z"
    file_sha1s = sorted(
        next(checksum["checksumValue"] for checksum in item["checksums"] if checksum["algorithm"] == "SHA1")
        for item in sbom["files"]
    )
    expected_verification_code = hashlib.sha1("".join(file_sha1s).encode()).hexdigest()  # noqa: S324
    release_package = next(item for item in sbom["packages"] if item["name"] == "ketos")
    assert release_package["packageVerificationCode"] == {"packageVerificationCodeValue": expected_verification_code}
    component_packages = {item["name"]: item for item in sbom["packages"] if item["name"] != "ketos"}
    assert set(component_packages) == {
        "dist/ketos-1.10.2-py3-none-any.whl",
        "dist/ketos-1.10.2.tar.gz",
        "release-archives/ketos-1.10.2-source.tar.gz",
        "release-archives/ketos-1.10.2-source.zip",
        "registry.invalid/ketos/ketos@sha256:a5e9420b6d74f9fe3a9bf1d53266d443db4ce69dd7b1424ff39dc2421532deed",
    }
    assert {item["comment"].removeprefix("Ketos release component type: ") for item in component_packages.values()} == {
        "oci-image",
        "release-archive",
        "sdist",
        "wheel",
    }
    assert all(item["filesAnalyzed"] is False for item in component_packages.values())

    provenance_text = (output_dir / "ketos.intoto.jsonl").read_text(encoding="utf-8")
    assert len(provenance_text.splitlines()) == 1
    statement = json.loads(provenance_text)
    assert statement["_type"] == "https://in-toto.io/Statement/v1"
    assert statement["predicateType"] == "https://slsa.dev/provenance/v1"
    assert {subject["name"] for subject in statement["subject"]} == {
        "dist/ketos-1.10.2-py3-none-any.whl",
        "dist/ketos-1.10.2.tar.gz",
        "release-archives/ketos-1.10.2-source.tar.gz",
        "release-archives/ketos-1.10.2-source.zip",
        "registry.invalid/ketos/ketos@sha256:a5e9420b6d74f9fe3a9bf1d53266d443db4ce69dd7b1424ff39dc2421532deed",
    }
    assert statement["predicate"]["buildDefinition"]["resolvedDependencies"] == [
        {
            "digest": {"gitCommit": "0123456789abcdef0123456789abcdef01234567"},
            "uri": "git+https://git.ketos.test/ketos/ketos",
        }
    ]
    assert statement["predicate"]["buildDefinition"]["externalParameters"]["source_date_epoch"] == 1704067200

    manifest = json.loads((output_dir / "ketos.supply-chain-manifest.json").read_text(encoding="utf-8"))
    assert manifest["schema_version"] == 2
    assert manifest["source"]["commit_sha"] == "0123456789abcdef0123456789abcdef01234567"
    assert manifest["artifacts"][0]["path"] < manifest["artifacts"][1]["path"]
    assert manifest["oci_subjects"] == [
        {
            "kind": "oci-image",
            "name": "registry.invalid/ketos/ketos@sha256:"
            "a5e9420b6d74f9fe3a9bf1d53266d443db4ce69dd7b1424ff39dc2421532deed",
            "sha256": "a5e9420b6d74f9fe3a9bf1d53266d443db4ce69dd7b1424ff39dc2421532deed",
        }
    ]


def test_canonical_release_invokes_supply_chain_with_immutable_inputs() -> None:
    workflow = CANONICAL_RELEASE_WORKFLOW.read_text(encoding="utf-8")
    docker_workflow = DOCKER_RELEASE_WORKFLOW.read_text(encoding="utf-8")

    assert "scripts/ci/generate_supply_chain.py" in workflow
    for required_argument in (
        "--artifact-root",
        "--artifact",
        "--oci-subject",
        "--output-dir",
        "--source-uri",
        "--commit-sha",
        "--source-date-epoch",
        "--name",
        "--version",
    ):
        assert required_argument in workflow
    assert '--commit-sha "$GITHUB_SHA"' in workflow
    assert '--source-date-epoch "$SOURCE_DATE_EPOCH"' in workflow
    assert 'SOURCE_DATE_EPOCH="$(git show -s --format=%ct "$GITHUB_SHA")"' in workflow
    assert "git archive" in workflow
    assert "git archive --format=zip" in workflow
    assert "gzip -n" in workflow
    assert "supply-chain/" in workflow
    assert ".artifacts" not in workflow
    assert "oci_subjects:" not in workflow
    assert "pattern: oci-subject-*" in workflow
    assert "scripts/ci/collect_oci_subjects.py" in workflow
    assert workflow.count("--expected-release-type") >= 3
    assert docker_workflow.count("id: oci_build") == 6
    assert "steps.oci_build.outputs.digest" in docker_workflow
    assert "name: oci-subject-${{ inputs.release_type }}-${{ matrix.arch }}" in docker_workflow


def _write_oci_record(root: Path, release_type: str, arch: str, *, subject: str | None = None) -> None:
    root.mkdir(parents=True, exist_ok=True)
    if subject is None:
        image = {
            "base": "ketos",
            "main": "ketos",
            "main-backend": "ketos-backend",
            "main-frontend": "ketos-frontend",
            "main-ep": "ketos-ep",
            "main-all": "ketos-all",
        }[release_type]
        subject = f"registry.invalid/ketos/{image}@sha256:{'a' * 64}"
    (root / f"oci-subject-{release_type}-{arch}.json").write_text(
        json.dumps({"arch": arch, "release_type": release_type, "subject": subject}),
        encoding="utf-8",
    )


def _run_oci_collector(root: Path, *expected_release_types: str) -> subprocess.CompletedProcess[str]:
    command = [sys.executable, str(OCI_COLLECTOR), "--input-dir", str(root)]
    for release_type in expected_release_types:
        command.extend(("--expected-release-type", release_type))
    return subprocess.run(command, cwd=ROOT, check=False, capture_output=True, text=True)  # noqa: S603


def test_oci_collector_requires_two_actual_architecture_subjects_per_selected_image(tmp_path: Path) -> None:
    _write_oci_record(tmp_path, "main", "amd64")
    _write_oci_record(tmp_path, "main", "arm64", subject=f"registry.invalid/ketos/ketos@sha256:{'b' * 64}")

    result = _run_oci_collector(tmp_path, "main")

    assert result.returncode == 0, result.stderr
    assert result.stdout.splitlines() == [
        f"registry.invalid/ketos/ketos@sha256:{'a' * 64}",
        f"registry.invalid/ketos/ketos@sha256:{'b' * 64}",
    ]


def test_oci_collector_rejects_missing_extra_and_mismatched_records(tmp_path: Path) -> None:
    missing = tmp_path / "missing"
    _write_oci_record(missing, "main", "amd64")
    assert _run_oci_collector(missing, "main").returncode != 0

    extra = tmp_path / "extra"
    for release_type in ("main", "base"):
        for arch in ("amd64", "arm64"):
            _write_oci_record(extra, release_type, arch)
    assert _run_oci_collector(extra, "main").returncode != 0

    mismatched = tmp_path / "mismatched"
    _write_oci_record(mismatched, "main", "amd64")
    _write_oci_record(
        mismatched,
        "main",
        "arm64",
        subject=f"registry.invalid/ketos/main:tag@sha256:{'b' * 64}",
    )
    record = mismatched / "oci-subject-main-arm64.json"
    payload = json.loads(record.read_text(encoding="utf-8"))
    payload["release_type"] = "base"
    record.write_text(json.dumps(payload), encoding="utf-8")
    assert _run_oci_collector(mismatched, "main").returncode != 0


def _workflows_that_build_or_publish_artifacts() -> list[Path]:
    artifact_markers = (
        "docker/build-push-action",
        "ncipollo/release-action",
        "softprops/action-gh-release",
        "actions/upload-artifact",
        "uv build",
        "uv publish",
        "npm publish",
        "pnpm publish",
        "docker build",
        "docker bake",
    )
    workflows: list[Path] = []
    paths = sorted((ROOT / ".github/workflows").glob("*.yml")) + sorted((ROOT / ".github/workflows").glob("*.yaml"))
    for path in paths:
        text = path.read_text(encoding="utf-8")
        if any(marker in text for marker in artifact_markers):
            workflows.append(path)
    return workflows


def test_release_artifact_workflows_do_not_disable_buildkit_provenance() -> None:
    offenders: list[str] = []
    workflows = _workflows_that_build_or_publish_artifacts()
    assert CANONICAL_RELEASE_WORKFLOW in workflows
    assert len(workflows) > 1
    for path in workflows:
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if re.search(r"\bprovenance\s*:\s*false\b", line):
                offenders.append(f"{path.relative_to(ROOT)}:{line_number}")
    assert not offenders, "BuildKit provenance is disabled:\n" + "\n".join(offenders)


def test_ketos_base_declares_worker_runtime_dependencies() -> None:
    manifest = tomllib.loads((ROOT / "src/backend/base/pyproject.toml").read_text(encoding="utf-8"))
    dependencies = manifest["project"]["dependencies"]
    assert "celery>=5.6.0,<6.0.0" in dependencies
    assert "eventlet>=0.41.0,<1.0.0" in dependencies
