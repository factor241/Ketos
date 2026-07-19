from __future__ import annotations

# ruff: noqa: S101, S603, SLF001 - assertions, exact argv, and helper probes are intentional.
import hashlib
import importlib.util
import io
import json
import shutil
import subprocess
import sys
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


def _fixture(
    tmp_path: Path, *, package_name: str = "@copilotkit/react-core", gitlink: bool = False
) -> dict[str, object]:
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
                "name": package_name,
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
    if gitlink:
        _git(repo, "update-index", "--add", "--cacheinfo", f"160000,{base},external/submodule")
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
                        "toolchain": audit._expected_toolchain(),
                        "rebuild": audit.CANONICAL_REBUILD,
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


@pytest.mark.parametrize("special_type", [tarfile.FIFOTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE])
def test_rejects_non_tree_special_member(tmp_path: Path, special_type: bytes) -> None:
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
        fifo.type = special_type
        if special_type == tarfile.LNKTYPE:
            fifo.linkname = f"CopilotKit-{fixture['fork']}/packages/react-core/LICENSE"
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


def test_rejects_rebuild_tokens_hidden_in_echo_commands(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)
    manifest_path = Path(fixture["manifest"])
    manifest = json.loads(manifest_path.read_text())
    fork = fixture["fork"]
    epoch = manifest["artifacts"]["@copilotkit/react-core"]["toolchain"]["source_date_epoch"]
    manifest["artifacts"]["@copilotkit/react-core"]["rebuild"] = (
        f"echo git checkout {fork} && echo SOURCE_DATE_EPOCH={epoch} && "
        "echo rm -rf packages/react-core/dist && echo pnpm --dir packages/react-core run build && "
        "echo pnpm --dir packages/react-core run pack:deterministic /tmp/ketos-stage01-copilot-pack"
    )
    manifest_path.write_text(json.dumps(manifest))

    with pytest.raises(audit.AuditError, match="rebuild"):
        _audit(fixture)


def test_canonical_rebuild_invokes_only_the_hermetic_executor() -> None:
    assert audit.CANONICAL_REBUILD == (
        "uv run --no-sync python scripts/mvp/rebuild_copilotkit_artifact.py "
        "--output-dir /tmp/ketos-stage01-copilot-pack --json"
    )
    assert "npx" not in audit.CANONICAL_REBUILD
    assert "corepack" not in audit.CANONICAL_REBUILD
    assert "git checkout" not in audit.CANONICAL_REBUILD


def test_rejects_alternate_or_spoofed_rebuild_executor(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)
    manifest_path = Path(fixture["manifest"])
    original = json.loads(manifest_path.read_text())
    canonical = audit.CANONICAL_REBUILD

    for spoof in (canonical.replace("uv run", "echo uv run", 1), canonical.replace("--no-sync", "", 1)):
        manifest = json.loads(json.dumps(original))
        manifest["artifacts"]["@copilotkit/react-core"]["rebuild"] = spoof
        manifest_path.write_text(json.dumps(manifest))
        with pytest.raises(audit.AuditError, match="rebuild"):
            _audit(fixture)


def test_rejects_member_and_total_resource_overflow(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)
    with pytest.raises(audit.AuditError, match="compressed"):
        _audit(fixture, max_archive_bytes=1)
    with pytest.raises(audit.AuditError, match="artifact exceeds"):
        _audit(fixture, max_artifact_bytes=1)
    with pytest.raises(audit.AuditError, match="member count"):
        _audit(fixture, max_members=1)
    with pytest.raises(audit.AuditError, match="member exceeds size"):
        _audit(fixture, max_member_bytes=1)
    with pytest.raises(audit.AuditError, match="total uncompressed"):
        _audit(fixture, max_uncompressed_bytes=1)


def test_rejects_package_artifact_over_resource_limit(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)

    with pytest.raises(audit.AuditError, match="package artifact exceeds"):
        _audit(fixture, max_artifact_bytes=1)


def test_rejects_unpinned_toolchain_metadata(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)
    manifest_path = Path(fixture["manifest"])
    manifest = json.loads(manifest_path.read_text())
    manifest["artifacts"]["@copilotkit/react-core"]["toolchain"]["node"]["version"] = "26.3.1"
    manifest_path.write_text(json.dumps(manifest))

    with pytest.raises(audit.AuditError, match="toolchain"):
        _audit(fixture)

    manifest = json.loads(manifest_path.read_text())
    record = manifest["artifacts"]["@copilotkit/react-core"]
    record["toolchain"]["node"]["version"] = audit.NODE_VERSION
    record["toolchain"]["source_date_epoch"] = 1
    record["rebuild"] = audit._canonical_rebuild(str(fixture["fork"]), 1)
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(audit.AuditError, match="toolchain"):
        _audit(fixture)


def test_rejects_extra_global_pax_and_symlink_target_spoofs(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)
    source = Path(fixture["source"])
    for mutation in ("pax", "symlink-target", "symlink-mode"):
        forged = source.with_name(f"{mutation}.tar.gz")
        with tarfile.open(source, "r:gz") as original:
            headers = dict(original.pax_headers)
            if mutation == "pax":
                headers["unexpected"] = "spoof"
            with tarfile.open(forged, "w:gz", format=tarfile.PAX_FORMAT, pax_headers=headers) as output:
                for member in original:
                    stream = original.extractfile(member) if member.isfile() else None
                    content = stream.read() if stream is not None else None
                    if mutation == "symlink-target" and member.issym():
                        member.linkname = "forged-target.ts"
                    if mutation == "symlink-mode" and member.issym():
                        member.mode = 0o600
                    output.addfile(member, io.BytesIO(content) if content is not None else None)
        manifest = json.loads(Path(fixture["manifest"]).read_text())
        record = manifest["artifacts"]["@copilotkit/react-core"]
        record["source_archive"] = forged.name
        record["source_archive_sha256"] = hashlib.sha256(forged.read_bytes()).hexdigest()
        Path(fixture["manifest"]).write_text(json.dumps(manifest))
        expected = "PAX" if mutation == "pax" else "Git tree"
        with pytest.raises(audit.AuditError, match=expected):
            audit.audit_provenance(
                forged,
                manifest_path=Path(fixture["manifest"]),
                repository_path=Path(fixture["repo"]),
                artifact_path=Path(fixture["artifact"]),
                expected_fork_repository=str(fixture["origin"]),
                expected_upstream_repository=str(fixture["upstream"]),
            )
        # Restore the immutable manifest for the next independent mutation.
        record["source_archive"] = source.name
        record["source_archive_sha256"] = hashlib.sha256(source.read_bytes()).hexdigest()
        Path(fixture["manifest"]).write_text(json.dumps(manifest))


def test_rejects_license_package_identity_and_symlinked_inputs(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path / "license")
    manifest_path = Path(fixture["manifest"])
    manifest = json.loads(manifest_path.read_text())
    manifest["artifacts"]["@copilotkit/react-core"]["license_sha256"] = "0" * 64
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(audit.AuditError, match="license SHA-256"):
        _audit(fixture)

    wrong_package = _fixture(tmp_path / "package", package_name="@spoof/react-core")
    with pytest.raises(audit.AuditError, match="package source metadata"):
        _audit(wrong_package)

    symlinked = _fixture(tmp_path / "symlink")
    artifact = Path(symlinked["artifact"])
    real_artifact = artifact.with_suffix(".real")
    artifact.rename(real_artifact)
    artifact.symlink_to(real_artifact)
    with pytest.raises(audit.AuditError, match="regular file"):
        _audit(symlinked)

    source_symlinked = _fixture(tmp_path / "source-symlink")
    source = Path(source_symlinked["source"])
    real_source = source.with_suffix(".real")
    source.rename(real_source)
    source.symlink_to(real_source)
    with pytest.raises(audit.AuditError, match="regular file"):
        _audit(source_symlinked)


def test_rejects_fork_sha_not_advertised_by_fixed_remote(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)
    _git(
        Path(fixture["repo"]),
        "push",
        "--force",
        "origin",
        f"{fixture['base']}:refs/heads/codex/typed-interrupt",
    )
    with pytest.raises(audit.AuditError, match="not advertised"):
        _audit(fixture)


def test_bounded_runner_stops_output_and_time_overflow() -> None:
    with pytest.raises(audit.AuditError, match="output resource"):
        audit._run_bounded(
            [sys.executable, "-c", "import sys; sys.stdout.write('x' * 200000)"],
            timeout=10,
            max_output_bytes=1024,
        )
    with pytest.raises(audit.AuditError, match="time resource"):
        audit._run_bounded(
            [sys.executable, "-c", "import time; time.sleep(2)"],
            timeout=0.01,
            max_output_bytes=1024,
        )


def test_git_authority_ignores_environment_url_rewrite(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fixture = _fixture(tmp_path)
    malicious = (tmp_path / "missing-redirect.git").resolve().as_uri()
    monkeypatch.setenv("GIT_CONFIG_COUNT", "1")
    monkeypatch.setenv("GIT_CONFIG_KEY_0", f"url.{malicious}.insteadOf")
    monkeypatch.setenv("GIT_CONFIG_VALUE_0", str(fixture["upstream"]))
    monkeypatch.setenv("GIT_DIR", str(tmp_path / "spoof-git-dir"))
    monkeypatch.setenv("GIT_WORK_TREE", str(tmp_path / "spoof-work-tree"))

    evidence = _audit(fixture)

    assert evidence["status"] == "PASS"
    if Path("/usr/bin/git").is_file():
        assert audit.GIT == "/usr/bin/git"


def test_git_environment_is_from_scratch_and_local_rewrite_is_rejected(tmp_path: Path) -> None:
    home = tmp_path / "empty-home"
    home.mkdir()
    environment = audit._git_environment(home)

    assert environment["HOME"] == str(home)
    assert environment["GIT_CONFIG_GLOBAL"] == "/dev/null"
    assert environment["GIT_CONFIG_NOSYSTEM"] == "1"
    assert environment["GIT_ATTR_NOSYSTEM"] == "1"
    assert environment["GIT_OPTIONAL_LOCKS"] == "0"
    assert not any("PROXY" in key.upper() or key.startswith("SSH_") for key in environment)

    fixture = _fixture(tmp_path / "fixture")
    redirect = (tmp_path / "redirect.git").resolve().as_uri()
    _git(Path(fixture["repo"]), "config", f"url.{redirect}.insteadOf", str(fixture["upstream"]))
    with pytest.raises(audit.AuditError, match="forbidden URL rewrite"):
        _audit(fixture)


def test_verified_authority_isolated_from_caller_dirt_and_rejects_gitlinks(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path / "dirty")
    repository = Path(fixture["repo"])
    (repository / "caller-untracked").write_text("must not enter proof\n", encoding="utf-8")
    (repository / "packages/react-core/LICENSE").write_text("caller modification\n", encoding="utf-8")

    assert _audit(fixture)["status"] == "PASS"

    gitlink = _fixture(tmp_path / "gitlink", gitlink=True)
    with pytest.raises(audit.AuditError, match="gitlink"):
        _audit(gitlink)


def test_rejects_base_only_dangling_on_official_remote(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)
    attacker = tmp_path / "unrelated"
    subprocess.run([GIT, "init", str(attacker)], check=True, capture_output=True)
    _git(attacker, "config", "user.name", "Stage 01 Test")
    _git(attacker, "config", "user.email", "stage01@example.test")
    (attacker / "unrelated").write_text("not an upstream descendant\n", encoding="utf-8")
    _git(attacker, "add", ".")
    _git(attacker, "commit", "-m", "unrelated advertised head")
    _git(attacker, "remote", "add", "origin", str(fixture["upstream"]))
    _git(attacker, "push", "--force", "origin", "HEAD:refs/heads/main")

    with pytest.raises(audit.AuditError, match="advertised upstream"):
        _audit(fixture)


def test_cli_emits_machine_readable_pass_only_for_compiled_authority(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    fixture = _fixture(tmp_path)
    monkeypatch.setattr(audit, "FORK_REPOSITORY", str(fixture["origin"]))
    monkeypatch.setattr(audit, "UPSTREAM_REPOSITORY", str(fixture["upstream"]))
    monkeypatch.setattr(audit, "FORK_SHA", str(fixture["fork"]))
    monkeypatch.setattr(audit, "UPSTREAM_BASE_SHA", str(fixture["base"]))
    monkeypatch.setattr(
        audit,
        "EXPECTED_ARTIFACT_SHA256",
        hashlib.sha256(Path(fixture["artifact"]).read_bytes()).hexdigest(),
    )
    monkeypatch.setattr(audit, "_validate_rebuild_recipe", lambda: None)
    exit_code = audit.main(
        [
            str(fixture["source"]),
            "--manifest-path",
            str(fixture["manifest"]),
            "--repository-path",
            str(fixture["repo"]),
            "--artifact-path",
            str(fixture["artifact"]),
            "--json",
        ]
    )

    assert exit_code == 0
    assert json.loads(capsys.readouterr().out)["status"] == "PASS"
