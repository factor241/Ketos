from __future__ import annotations

# ruff: noqa: S101, SLF001, PLR2004
import importlib.util
import io
import sys
import tarfile
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[1] / "rebuild_ag_ui_artifact.py"
BUILD_LOCK = Path(__file__).parents[1] / "ag_ui_build_requirements.lock"
SPEC = importlib.util.spec_from_file_location("rebuild_ag_ui_artifact", SCRIPT)
assert SPEC is not None
assert SPEC.loader is not None
rebuild = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(rebuild)


def test_recipe_is_exact_and_does_not_accept_ambient_checkout_or_tool_paths(tmp_path: Path) -> None:
    assert rebuild.FORK_REPOSITORY == "https://github.com/factor241/ag-ui"
    assert rebuild.FORK_SHA == "85b94807e464c9b38f591938a41559923a712dbb"
    assert rebuild.UV_VERSION == "0.11.21"
    assert rebuild.PYTHON_VERSION == "3.13.14"
    assert rebuild.SOURCE_DATE_EPOCH == 1765974360
    assert rebuild.EXPECTED_ARTIFACT_SHA256 == (
        "5ae33b1bab5a9e0adfb1425c5e279476a7ba35a385019d71be2f3ee79e8913cc"
    )
    parsed = rebuild._parse_args(["--output-dir", str(tmp_path), "--json"])
    assert vars(parsed) == {"output_dir": tmp_path, "run_tests": False, "json": True}
    with pytest.raises(SystemExit):
        rebuild._parse_args(["--output-dir", str(tmp_path), "--repository", "/ambient"])


def test_uv_downloads_are_pinned_for_supported_platforms() -> None:
    assert rebuild.UV_DISTRIBUTIONS == {
        ("darwin", "arm64"): (
            "https://github.com/astral-sh/uv/releases/download/0.11.21/uv-aarch64-apple-darwin.tar.gz",
            "1f921d491ba5ffeea774eb04d6681ecee379101341cbb1500394993b541bf3f4",
        ),
        ("darwin", "x64"): (
            "https://github.com/astral-sh/uv/releases/download/0.11.21/uv-x86_64-apple-darwin.tar.gz",
            "f3c8e5708a84b920c18b691214d54d2b0da6b984789caae95d47c95120cb7765",
        ),
        ("linux", "arm64"): (
            "https://github.com/astral-sh/uv/releases/download/0.11.21/uv-aarch64-unknown-linux-gnu.tar.gz",
            "88e800834007cc5efd4675f166eb2a51e7e3ad19876d85fa8805a6fb5c922397",
        ),
        ("linux", "x64"): (
            "https://github.com/astral-sh/uv/releases/download/0.11.21/uv-x86_64-unknown-linux-gnu.tar.gz",
            "8c88519b0ef0af9801fcdee419bbb12116bd9e6b18e162ae093c932d8b264050",
        ),
    }


def test_subprocess_environment_is_fixed_and_drops_host_authority(tmp_path: Path) -> None:
    env = rebuild._sanitized_environment(tmp_path, tmp_path / "toolchain" / "uv")
    assert env["HOME"].startswith(str(tmp_path))
    assert env["PATH"] == str(tmp_path / "toolchain")
    assert env["SOURCE_DATE_EPOCH"] == "1765974360"
    assert env["UV_PYTHON_INSTALL_DIR"].startswith(str(tmp_path))
    assert env["GIT_CONFIG_NOSYSTEM"] == "1"
    assert env["GIT_CONFIG_GLOBAL"] == "/dev/null"
    assert env["GIT_CONFIG_COUNT"] == "0"
    assert env["GIT_ASKPASS"] == "/bin/false"
    assert {
        "SSH_AUTH_SOCK",
        "GIT_SSH",
        "HTTPS_PROXY",
        "HTTP_PROXY",
        "ALL_PROXY",
        "PYTHONPATH",
        "VIRTUAL_ENV",
        "UV_INDEX_URL",
        "UV_EXTRA_INDEX_URL",
        "PIP_INDEX_URL",
        "AWS_SECRET_ACCESS_KEY",
    }.isdisjoint(env)


def test_clone_uses_fixed_git_exact_sha_detached_and_pristine(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    commands: list[list[str]] = []

    def fake_run(argv: list[str], **_kwargs: object) -> rebuild.CommandResult:
        commands.append(argv)
        output = b""
        if argv[-2:] == ["rev-parse", "HEAD"]:
            output = (rebuild.FORK_SHA + "\n").encode()
        return rebuild.CommandResult(tuple(argv), 0, output, b"")

    monkeypatch.setattr(rebuild, "_run_bounded", fake_run)
    repository = tmp_path / "fresh"
    repository.mkdir()
    rebuild._clone_exact_source(repository, {"PATH": "/fixed"})

    assert commands[0][:4] == ["/usr/bin/git", "init", "--initial-branch", "ketos-build"]
    assert ["/usr/bin/git", "fetch", "--no-tags", "--depth=1", rebuild.FORK_REPOSITORY, rebuild.FORK_SHA] in commands
    assert ["/usr/bin/git", "checkout", "--detach", rebuild.FORK_SHA] in commands
    assert commands[-1][-3:] == ["status", "--porcelain=v1", "--untracked-files=all"]


def test_pristine_check_fails_closed_on_any_checkout_change(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(
        rebuild,
        "_run_bounded",
        lambda *_args, **_kwargs: rebuild.CommandResult(("git",), 0, b"?? payload\n", b""),
    )
    with pytest.raises(rebuild.RebuildError, match="pristine"):
        rebuild._assert_pristine(tmp_path, {"PATH": "/fixed"})


def test_uv_archive_extraction_rejects_path_escape(tmp_path: Path) -> None:
    archive_path = tmp_path / "uv.tgz"
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w:gz") as archive:
        member = tarfile.TarInfo("../uv")
        member.mode = 0o755
        member.size = 1
        archive.addfile(member, io.BytesIO(b"x"))
    archive_path.write_bytes(stream.getvalue())
    with pytest.raises(rebuild.RebuildError, match="unsafe archive path"):
        rebuild._extract_uv(archive_path, tmp_path / "toolchain")


def test_subprocess_output_is_bounded(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rebuild, "MAX_COMMAND_OUTPUT_BYTES", 32 * 1024)
    with pytest.raises(rebuild.RebuildError, match="aggregate output limit"):
        rebuild._run_bounded(
            [sys.executable, "-c", "import os; os.write(1,b'x'*40000)"],
            cwd=tmp_path,
            env={"PATH": "/usr/bin:/bin", "LANG": "C"},
        )


def test_quality_gate_and_build_use_only_pinned_uv_and_python(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    commands: list[list[str]] = []

    def fake_run(argv: list[str], **_kwargs: object) -> rebuild.CommandResult:
        commands.append(argv)
        stdout = b"uv 0.11.21 (5aa65dd7a pinned-build)\n" if argv[-1:] == ["--version"] else b""
        return rebuild.CommandResult(tuple(argv), 0, stdout, b"")

    monkeypatch.setattr(rebuild, "_run_bounded", fake_run)
    uv = tmp_path / "toolchain" / "uv"
    output = tmp_path / "dist"
    output.mkdir()
    pristine_calls: list[Path] = []
    monkeypatch.setattr(rebuild, "_assert_pristine", lambda path, _env: pristine_calls.append(path))
    rebuild._run_build(tmp_path, uv, output, {"PATH": str(uv.parent)}, run_tests=True)

    assert commands[0][:4] == [str(uv), "python", "install", "3.13.14"]
    assert [
        str(uv),
        "run",
        "--python",
        "3.13.14",
        "--frozen",
        "--project",
        "integrations/langgraph/python",
        "pytest",
        "-q",
        "-p",
        "no:cacheprovider",
        "integrations/langgraph/python/tests",
    ] in commands
    assert any("--require-hashes" in command and str(BUILD_LOCK) in command for command in commands)
    assert commands[-1] == [
        str(uv),
        "build",
        "--python",
        str(tmp_path / "build-env" / "bin" / "python"),
        "--wheel",
        "--no-build-isolation",
        "--offline",
        "integrations/langgraph/python",
        "--out-dir",
        str(output),
    ]
    assert pristine_calls == [tmp_path, tmp_path]


def test_build_backend_lock_is_complete_hash_pinned_and_checked_in() -> None:
    lock = BUILD_LOCK.read_text(encoding="utf-8")
    assert lock.count("==") == 5
    for package in (
        "hatchling==1.31.0",
        "packaging==26.2",
        "pathspec==1.1.1",
        "pluggy==1.6.0",
        "trove-classifiers==2026.6.1.19",
    ):
        assert package in lock
    assert lock.count("--hash=sha256:") == 10


def test_rebuild_source_requires_frozen_tests_and_offline_isolated_build() -> None:
    source = SCRIPT.read_text(encoding="utf-8")
    assert '"--frozen"' in source
    assert '"--require-hashes"' in source
    assert '"--no-build-isolation"' in source
    assert '"--offline"' in source
    assert source.count("_assert_pristine(repository, env)") >= 3


def test_no_shell_or_ambient_python_subprocess_execution_in_rebuild_source() -> None:
    source = SCRIPT.read_text(encoding="utf-8")
    assert "shell=True" not in source
    assert "shutil.which" not in source
    assert "sys.executable" not in source
    assert "os.environ.copy" not in source
    assert "subprocess.run" not in source
