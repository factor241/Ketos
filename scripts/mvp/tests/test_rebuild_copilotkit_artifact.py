from __future__ import annotations

# ruff: noqa: S101, SLF001, PLR2004, S108, ARG001, ARG002 - white-box security tests.
import hashlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tarfile
import time
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[1] / "rebuild_copilotkit_artifact.py"
SPEC = importlib.util.spec_from_file_location("rebuild_copilotkit_artifact", SCRIPT)
assert SPEC is not None
assert SPEC.loader is not None
rebuild = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(rebuild)


def _tar_bytes(name: str, content: bytes, *, mode: str = "w:gz") -> bytes:
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode=mode) as archive:
        member = tarfile.TarInfo(name)
        member.size = len(content)
        archive.addfile(member, io.BytesIO(content))
    return stream.getvalue()


def test_recipe_constants_are_exact_and_complete() -> None:
    assert rebuild.FORK_REPOSITORY == "https://github.com/factor241/CopilotKit"
    assert rebuild.FORK_SHA == "c853ac2b78cb57481cc2ca58eda4a865908c532b"
    assert rebuild.PACKAGE_NAME == "@copilotkit/react-core"
    assert rebuild.PACKAGE_VERSION == "1.63.1-ketos.1"
    assert rebuild.SOURCE_DATE_EPOCH == 1784227404
    assert rebuild.EXPECTED_ARTIFACT_SHA256 == ("64711f7e9e94ab6126fef68fdb92f9ba80f400b88d64d3a72191ee1ed7da61aa")
    assert rebuild.PNPM_SHA256 == "8e70ddc6649b18bc3d895cf3a908c0291ea4c38039ad8722c47e018daf1e9cfc"
    assert rebuild.PNPM_INTEGRITY == (
        "sha512-HGezs1my1AgRm6HtKJ80uPw8aHNBK+xv0mT73IJInlEPy+y5zp0i2ufzt2Jp2EQQRgFL3KU7mXnNelYa1jG4AA=="
    )
    assert rebuild.NODE_DISTRIBUTIONS == {
        ("darwin", "arm64"): (
            "https://nodejs.org/dist/v22.23.1/node-v22.23.1-darwin-arm64.tar.gz",
            "ef28d8fab2c0e4314522d4bb1b7173270aa3937e93b92cb7de79c112ac1fa953",
        ),
        ("darwin", "x64"): (
            "https://nodejs.org/dist/v22.23.1/node-v22.23.1-darwin-x64.tar.gz",
            "b8da981b8a0b1241b70249204916da76c63573ddf5814dbd2d1e41069105cb81",
        ),
        ("linux", "arm64"): (
            "https://nodejs.org/dist/v22.23.1/node-v22.23.1-linux-arm64.tar.xz",
            "0294e8b915ab75f92c7513d2fcb830ae06e10684e6c603e99a87dbf8835389c1",
        ),
        ("linux", "x64"): (
            "https://nodejs.org/dist/v22.23.1/node-v22.23.1-linux-x64.tar.xz",
            "9749e988f437343b7fa832c69ded82a312e41a03116d766797ac14f6f9eee578",
        ),
    }


def test_recipe_manifest_is_stable_json_safe_and_complete() -> None:
    recipe = rebuild.recipe_manifest()
    assert json.loads(json.dumps(recipe, sort_keys=True)) == recipe
    assert recipe["schema"] == "ketos.stage01.copilotkit-rebuild/v1"
    assert recipe["source"] == {"repository": rebuild.FORK_REPOSITORY, "sha": rebuild.FORK_SHA}
    assert recipe["package"] == {"name": rebuild.PACKAGE_NAME, "version": rebuild.PACKAGE_VERSION}
    assert recipe["toolchain"]["node"] == {
        "version": "22.23.1",
        "distributions": [
            {"system": system, "architecture": architecture, "url": url, "sha256": digest}
            for (system, architecture), (url, digest) in sorted(rebuild.NODE_DISTRIBUTIONS.items())
        ],
    }
    assert recipe["toolchain"]["pnpm"] == {
        "version": "10.33.4",
        "url": rebuild.PNPM_URL,
        "sha256": rebuild.PNPM_SHA256,
        "integrity": rebuild.PNPM_INTEGRITY,
    }
    assert recipe["toolchain"]["source_date_epoch"] == 1784227404


@pytest.mark.parametrize(
    ("system", "machine", "expected"),
    [
        ("Darwin", "arm64", ("darwin", "arm64")),
        ("Darwin", "x86_64", ("darwin", "x64")),
        ("Linux", "aarch64", ("linux", "arm64")),
        ("Linux", "amd64", ("linux", "x64")),
    ],
)
def test_supported_platform_matrix(system: str, machine: str, expected: tuple[str, str]) -> None:
    assert rebuild._platform_key(system, machine) == expected


@pytest.mark.parametrize(("system", "machine"), [("Windows", "AMD64"), ("Linux", "riscv64")])
def test_unsupported_platform_fails_closed(system: str, machine: str) -> None:
    with pytest.raises(rebuild.RebuildError, match="unsupported platform"):
        rebuild._platform_key(system, machine)


def test_download_rejects_spoofed_sha256_before_extraction(tmp_path: Path) -> None:
    content = b"not the admitted archive"
    destination = tmp_path / "download.tgz"

    with pytest.raises(rebuild.RebuildError, match="SHA-256"):
        rebuild._write_verified_download(content, destination, "0" * 64)
    assert not destination.exists()


def test_download_rejects_spoofed_pnpm_sha512(tmp_path: Path) -> None:
    content = b"pnpm archive"
    sha256 = hashlib.sha256(content).hexdigest()

    with pytest.raises(rebuild.RebuildError, match="SHA-512"):
        rebuild._write_verified_download(
            content,
            tmp_path / "pnpm.tgz",
            sha256,
            expected_integrity="sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
        )


def test_safe_extract_rejects_escape_and_gitlink_like_special_member(tmp_path: Path) -> None:
    archive = tmp_path / "unsafe.tgz"
    archive.write_bytes(_tar_bytes("../escape", b"owned"))
    with pytest.raises(rebuild.RebuildError, match="unsafe archive path"):
        rebuild._safe_extract(archive, tmp_path / "extract")

    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w:gz") as tar:
        member = tarfile.TarInfo("package/device")
        member.type = tarfile.FIFOTYPE
        tar.addfile(member)
    archive.write_bytes(stream.getvalue())
    with pytest.raises(rebuild.RebuildError, match="unsupported archive member"):
        rebuild._safe_extract(archive, tmp_path / "extract2")


def test_safe_extract_rejects_symlink_escape(tmp_path: Path) -> None:
    archive = tmp_path / "unsafe-link.tgz"
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w:gz") as tar:
        member = tarfile.TarInfo("package/escape")
        member.type = tarfile.SYMTYPE
        member.linkname = "../../outside"
        tar.addfile(member)
    archive.write_bytes(stream.getvalue())
    with pytest.raises(rebuild.RebuildError, match="unsafe archive link"):
        rebuild._safe_extract(archive, tmp_path / "extract-link")


def test_subprocess_receives_only_explicit_sanitized_environment(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    captured: dict[str, object] = {}

    class Process:
        returncode = 0
        pid = os.getpid()

        def __init__(self) -> None:
            stdout_read, stdout_write = os.pipe()
            stderr_read, stderr_write = os.pipe()
            os.close(stdout_write)
            os.close(stderr_write)
            self.stdout = os.fdopen(stdout_read, "rb")
            self.stderr = os.fdopen(stderr_read, "rb")

        def poll(self) -> int:
            return 0

        def wait(self, timeout: float) -> int:
            return 0

    def fake_popen(argv: list[str], **kwargs: object) -> Process:
        captured["argv"] = argv
        captured.update(kwargs)
        return Process()

    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    env = rebuild._git_environment(tmp_path)
    rebuild._run_bounded(["/usr/bin/git", "--version"], cwd=tmp_path, env=env)

    assert captured["env"] is env
    assert captured["cwd"] == tmp_path
    assert captured["start_new_session"] is True
    assert "SSH_AUTH_SOCK" not in env
    assert "HTTPS_PROXY" not in env
    assert env["HOME"].startswith(str(tmp_path))
    assert env["GIT_ATTR_NOSYSTEM"] == "1"
    assert env["GIT_CONFIG_NOSYSTEM"] == "1"
    assert env["GIT_CONFIG_GLOBAL"] == "/dev/null"
    assert env["GIT_CONFIG_COUNT"] == "0"
    assert env["SOURCE_DATE_EPOCH"] == "1784227404"
    assert env["PATH"] == "/usr/bin:/bin"
    hostile = {
        "HTTPS_PROXY",
        "HTTP_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "SSH_AUTH_SOCK",
        "GIT_SSH",
        "GIT_SSH_COMMAND",
        "GIT_ASKPASS",
        "AWS_SECRET_ACCESS_KEY",
        "NPM_TOKEN",
        "NODE_AUTH_TOKEN",
    }
    assert hostile.isdisjoint(env)


def test_tool_environment_uses_explicit_short_nx_socket_directory(tmp_path: Path) -> None:
    socket_dir = Path("/tmp/k-s01-nx-test")
    env = rebuild._tool_environment(tmp_path, tmp_path / "bin", socket_dir)
    assert env["NX_SOCKET_DIR"] == str(socket_dir)
    assert len(env["NX_SOCKET_DIR"].encode()) < 80


def test_subprocess_enforces_aggregate_stdout_stderr_limit(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(rebuild, "MAX_COMMAND_OUTPUT_BYTES", 64 * 1024)
    env = {"PATH": "/usr/bin:/bin", "LANG": "C"}
    program = "import os; os.write(1, b'a' * 40000); os.write(2, b'b' * 40000)"
    with pytest.raises(rebuild.RebuildError, match="aggregate output limit"):
        rebuild._run_bounded([sys.executable, "-c", program], cwd=tmp_path, env=env)


def test_timeout_kills_hanging_grandchild_process_group(tmp_path: Path) -> None:
    pid_path = tmp_path / "grandchild.pid"
    program = (
        "import pathlib, subprocess, sys, time; "
        "child=subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)']); "
        f"pathlib.Path({str(pid_path)!r}).write_text(str(child.pid)); "
        "time.sleep(60)"
    )
    with pytest.raises(rebuild.RebuildError, match="timed out"):
        rebuild._run_bounded(
            [sys.executable, "-c", program],
            cwd=tmp_path,
            env={"PATH": "/usr/bin:/bin", "LANG": "C"},
            timeout=0.3,
        )
    grandchild = int(pid_path.read_text())
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        try:
            os.kill(grandchild, 0)
        except ProcessLookupError:
            break
        time.sleep(0.05)
    else:
        pytest.fail("grandchild survived process-group timeout kill")


def test_clone_recipe_uses_literal_protocol_and_disables_credentials_and_hooks() -> None:
    argv = rebuild._clone_argv(Path("/tmp/repo"))
    assert argv[:9] == [
        "/usr/bin/git",
        "-c",
        "protocol.allow=never",
        "-c",
        "protocol.https.allow=always",
        "-c",
        "credential.helper=",
        "-c",
        "core.hooksPath=/dev/null",
    ]
    assert argv[9:] == [
        "clone",
        "--no-checkout",
        "https://github.com/factor241/CopilotKit",
        "/tmp/repo",
    ]


def test_pristine_guard_rejects_dirty_or_ignored_files(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    def fake_run(*args: object, **kwargs: object) -> rebuild.CommandResult:
        argv = tuple(str(value) for value in args[0])
        if "rev-parse" in argv:
            return rebuild.CommandResult(argv, 0, (rebuild.FORK_SHA + "\n").encode(), b"")
        if "status" in argv:
            return rebuild.CommandResult(argv, 0, b"!! node_modules/\n", b"")
        return rebuild.CommandResult(argv, 0, b"", b"")

    monkeypatch.setattr(rebuild, "_run_bounded", fake_run)
    with pytest.raises(rebuild.RebuildError, match="not pristine"):
        rebuild._assert_pristine_checkout(tmp_path, rebuild._git_environment(tmp_path))


def test_pristine_guard_rejects_gitlinks(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    def fake_run(argv: list[str], **kwargs: object) -> rebuild.CommandResult:
        if "ls-files" in argv:
            return rebuild.CommandResult(tuple(argv), 0, b"160000 deadbeef 0\tvendor/submodule\n", b"")
        return rebuild.CommandResult(tuple(argv), 0, b"", b"")

    monkeypatch.setattr(rebuild, "_run_bounded", fake_run)
    with pytest.raises(rebuild.RebuildError, match="gitlink"):
        rebuild._assert_no_gitlinks(tmp_path, rebuild._git_environment(tmp_path))


def test_pristine_guard_rejects_wrong_exact_head(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    def fake_run(argv: list[str], **kwargs: object) -> rebuild.CommandResult:
        return rebuild.CommandResult(tuple(argv), 0, ("0" * 40 + "\n").encode(), b"")

    monkeypatch.setattr(rebuild, "_run_bounded", fake_run)
    with pytest.raises(rebuild.RebuildError, match="HEAD is not the pinned"):
        rebuild._assert_pristine_checkout(tmp_path, rebuild._git_environment(tmp_path))


def test_post_build_guard_rejects_tracked_dirty_state(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    results = iter([1, 0])

    def fake_run(argv: list[str], **kwargs: object) -> rebuild.CommandResult:
        return rebuild.CommandResult(tuple(argv), next(results), b"", b"")

    monkeypatch.setattr(rebuild, "_run_bounded", fake_run)
    with pytest.raises(rebuild.RebuildError, match="modified tracked"):
        rebuild._assert_tracked_unchanged(tmp_path, rebuild._git_environment(tmp_path))


def test_json_pass_contains_exact_artifact_identity(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    artifact = tmp_path / rebuild.ARTIFACT_FILENAME
    artifact.write_bytes(b"artifact")
    evidence = rebuild._success_evidence(artifact, rebuild.EXPECTED_ARTIFACT_SHA256, ("darwin", "arm64"))
    rebuild._print_json(evidence)
    rendered = json.loads(capsys.readouterr().out)
    assert rendered["status"] == "PASS"
    assert rendered["fork_sha"] == rebuild.FORK_SHA
    assert rendered["artifact_sha256"] == rebuild.EXPECTED_ARTIFACT_SHA256
    assert rendered["node"] == "22.23.1"
    assert rendered["pnpm"] == "10.33.4"
