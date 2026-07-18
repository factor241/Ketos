from __future__ import annotations

# ruff: noqa: S101, S603 - assertions and exact argv subprocesses are intentional.
import hashlib
import importlib.util
import io
import json
import shutil
import subprocess
import tarfile
from pathlib import Path

import pytest

GIT = shutil.which("git")
assert GIT is not None

SCRIPT = Path(__file__).parents[1] / "audit_copilotkit_provenance.py"
SPEC = importlib.util.spec_from_file_location("audit_copilotkit_provenance", SCRIPT)
assert SPEC is not None
assert SPEC.loader is not None
audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)


def _git(repo: Path, *arguments: str, input_bytes: bytes | None = None) -> str:
    result = subprocess.run(
        [GIT, "-C", str(repo), *arguments],
        input=input_bytes,
        check=True,
        capture_output=True,
    )
    return result.stdout.decode().strip()


def _fixture(tmp_path: Path) -> dict[str, object]:
    remote = tmp_path / "fork.git"
    upstream = tmp_path / "upstream.git"
    subprocess.run([GIT, "init", "--bare", str(remote)], check=True, capture_output=True)
    subprocess.run([GIT, "init", "--bare", str(upstream)], check=True, capture_output=True)
    repo = tmp_path / "repo"
    subprocess.run([GIT, "init", str(repo)], check=True, capture_output=True)
    _git(repo, "config", "user.name", "Stage 01 Test")
    _git(repo, "config", "user.email", "stage01@example.test")
    upstream_url = upstream.resolve().as_uri()
    package = repo / "packages/react-core"
    package.mkdir(parents=True)
    (package / "LICENSE").write_text("MIT fixture\n", encoding="utf-8")
    (package / "package.json").write_text(
        json.dumps(
            {
                "name": "@copilotkit/react-core",
                "version": "1.63.1-ketos.1",
                "license": "MIT",
                "repository": {"type": "git", "url": upstream_url},
            }
        ),
        encoding="utf-8",
    )
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "base")
    base = _git(repo, "rev-parse", "HEAD")
    _git(repo, "remote", "add", "upstream", upstream_url)
    _git(repo, "push", "upstream", f"{base}:refs/heads/main")
    (package / "src").mkdir()
    (package / "src/interrupt.ts").write_text("export type Decision = boolean;\n", encoding="utf-8")
    (package / "src/current.ts").symlink_to("interrupt.ts")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "fork delta")
    fork = _git(repo, "rev-parse", "HEAD")
    origin = remote.resolve().as_uri()
    _git(repo, "remote", "add", "origin", origin)
    _git(repo, "push", "origin", "HEAD:refs/heads/codex/typed-interrupt")

    source = tmp_path / f"CopilotKit-{fork}-source.tar.gz"
    archive = subprocess.run(
        [GIT, "-C", str(repo), "archive", "--format=tar.gz", f"--prefix=CopilotKit-{fork}/", fork],
        check=True,
        capture_output=True,
    ).stdout
    source.write_bytes(archive)
    artifact = tmp_path / "copilotkit-react-core-1.63.1-ketos.1.tgz"
    artifact.write_bytes(b"deterministic npm artifact\n")
    changed = _git(repo, "diff", "--name-only", base, fork).splitlines()
    license_hash = hashlib.sha256((package / "LICENSE").read_bytes()).hexdigest()
    epoch = 1_784_227_404
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "artifacts": {
                    "@copilotkit/react-core": {
                        "upstream_repository": upstream_url,
                        "fork_repository": origin,
                        "upstream_base_sha": base,
                        "fork_sha": fork,
                        "version": "1.63.1-ketos.1",
                        "artifact": artifact.name,
                        "artifact_sha256": hashlib.sha256(artifact.read_bytes()).hexdigest(),
                        "source_archive": source.name,
                        "source_archive_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                        "license_spdx": "MIT",
                        "license_sha256": license_hash,
                        "changed_files": changed,
                        "toolchain": {"source_date_epoch": epoch},
                        "rebuild": (
                            f"git checkout {fork} && SOURCE_DATE_EPOCH={epoch} "
                            "rm -rf packages/react-core/dist && "
                            "pnpm --dir packages/react-core run build && "
                            "pnpm --dir packages/react-core run pack:deterministic /tmp/out"
                        ),
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    return {
        "repo": repo,
        "source": source,
        "artifact": artifact,
        "manifest": manifest,
        "fork": fork,
        "base": base,
        "origin": origin,
        "upstream": upstream_url,
    }


def _audit(fixture: dict[str, object], **kwargs: object) -> dict[str, object]:
    return audit.audit_provenance(
        Path(fixture["source"]),
        manifest_path=Path(fixture["manifest"]),
        repository_path=Path(fixture["repo"]),
        artifact_path=Path(fixture["artifact"]),
        expected_fork_repository=str(fixture["origin"]),
        expected_upstream_repository=str(fixture["upstream"]),
        **kwargs,
    )


def test_accepts_live_commit_bound_tree_including_git_symlink(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)

    evidence = _audit(fixture)

    assert evidence["status"] == "PASS"
    assert evidence["source"]["commit"] == fixture["fork"]
    assert evidence["source"]["symlinks"] == 1
    assert evidence["git"]["fork_and_upstream_reachable"] is True
    assert evidence["manifest"]["artifact_bound"] is True


def test_rejects_spoofed_source_even_when_manifest_hash_is_updated(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)
    source = Path(fixture["source"])
    forged = source.with_name("forged.tar.gz")
    with (
        tarfile.open(source, "r:gz") as original,
        tarfile.open(forged, "w:gz", format=tarfile.PAX_FORMAT, pax_headers=dict(original.pax_headers)) as output,
    ):
        for member in original:
            stream = original.extractfile(member) if member.isfile() else None
            content = stream.read() if stream is not None else None
            if member.name.endswith("packages/react-core/src/interrupt.ts"):
                content = b"forged bytes\n"
                member.size = len(content)
            output.addfile(member, io.BytesIO(content) if content is not None else None)
    manifest = json.loads(Path(fixture["manifest"]).read_text())
    manifest["artifacts"]["@copilotkit/react-core"]["source_archive"] = forged.name
    manifest["artifacts"]["@copilotkit/react-core"]["source_archive_sha256"] = hashlib.sha256(
        forged.read_bytes()
    ).hexdigest()
    Path(fixture["manifest"]).write_text(json.dumps(manifest))

    with pytest.raises(audit.AuditError, match="Git tree"):
        audit.audit_provenance(
            forged,
            manifest_path=Path(fixture["manifest"]),
            repository_path=Path(fixture["repo"]),
            artifact_path=Path(fixture["artifact"]),
            expected_fork_repository=str(fixture["origin"]),
            expected_upstream_repository=str(fixture["upstream"]),
        )


def test_rejects_non_tree_fifo_member(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)
    source = Path(fixture["source"])
    forged = source.with_name("fifo.tar.gz")
    with (
        tarfile.open(source, "r:gz") as original,
        tarfile.open(forged, "w:gz", format=tarfile.PAX_FORMAT, pax_headers=dict(original.pax_headers)) as output,
    ):
        for member in original:
            stream = original.extractfile(member) if member.isfile() else None
            output.addfile(member, io.BytesIO(stream.read()) if stream is not None else None)
        fifo = tarfile.TarInfo(f"CopilotKit-{fixture['fork']}/fifo")
        fifo.type = tarfile.FIFOTYPE
        output.addfile(fifo)
    manifest = json.loads(Path(fixture["manifest"]).read_text())
    manifest["artifacts"]["@copilotkit/react-core"]["source_archive"] = forged.name
    manifest["artifacts"]["@copilotkit/react-core"]["source_archive_sha256"] = hashlib.sha256(
        forged.read_bytes()
    ).hexdigest()
    Path(fixture["manifest"]).write_text(json.dumps(manifest))

    with pytest.raises(audit.AuditError, match="regular file, directory, or Git symlink"):
        audit.audit_provenance(
            forged,
            manifest_path=Path(fixture["manifest"]),
            repository_path=Path(fixture["repo"]),
            artifact_path=Path(fixture["artifact"]),
            expected_fork_repository=str(fixture["origin"]),
            expected_upstream_repository=str(fixture["upstream"]),
        )


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        ("changed_files", "changed_files"),
        ("rebuild", "rebuild"),
        ("artifact", "artifact SHA-256"),
        ("origin", "origin"),
    ],
)
def test_rejects_manifest_and_remote_spoofs(tmp_path: Path, mutation: str, message: str) -> None:
    fixture = _fixture(tmp_path)
    manifest_path = Path(fixture["manifest"])
    manifest = json.loads(manifest_path.read_text())
    record = manifest["artifacts"]["@copilotkit/react-core"]
    if mutation == "changed_files":
        record["changed_files"] = []
    elif mutation == "rebuild":
        record["rebuild"] = "git checkout HEAD && pnpm pack"
    elif mutation == "artifact":
        Path(fixture["artifact"]).write_bytes(b"different artifact")
    else:
        _git(Path(fixture["repo"]), "remote", "set-url", "origin", "https://example.test/spoof.git")
    manifest_path.write_text(json.dumps(manifest))

    with pytest.raises(audit.AuditError, match=message):
        _audit(fixture)


def test_rejects_member_and_total_resource_overflow(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)
    with pytest.raises(audit.AuditError, match="member count"):
        _audit(fixture, max_members=1)
    with pytest.raises(audit.AuditError, match="total uncompressed"):
        _audit(fixture, max_uncompressed_bytes=1)


def test_cli_emits_machine_readable_pass(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    fixture = _fixture(tmp_path)
    exit_code = audit.main(
        [
            str(fixture["source"]),
            "--manifest-path",
            str(fixture["manifest"]),
            "--repository-path",
            str(fixture["repo"]),
            "--artifact-path",
            str(fixture["artifact"]),
            "--fork-repository",
            str(fixture["origin"]),
            "--upstream-repository",
            str(fixture["upstream"]),
            "--fork-sha",
            str(fixture["fork"]),
            "--upstream-base-sha",
            str(fixture["base"]),
            "--json",
        ]
    )

    assert exit_code == 0
    assert json.loads(capsys.readouterr().out)["status"] == "PASS"
