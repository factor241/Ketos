"""Install the built Stepflow artifact through a local Ketos wheelhouse."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
PACKAGE_ROOT = REPO_ROOT / "src" / "ketos-stepflow"
SIBLING_PROJECTS = (
    REPO_ROOT / "src" / "sdk",
    REPO_ROOT / "src" / "kfx",
    REPO_ROOT / "src" / "backend" / "base",
    PACKAGE_ROOT,
)


def _run(command: list[str], *, cwd: Path = REPO_ROOT) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["UV_LINK_MODE"] = "copy"
    return subprocess.run(command, cwd=cwd, env=env, check=True, capture_output=True, text=True)


def test_fresh_venv_resolves_local_ketos_artifacts_and_imports_worker(tmp_path: Path) -> None:
    wheelhouse = tmp_path / "wheelhouse"
    wheelhouse.mkdir()
    for project in SIBLING_PROJECTS:
        _run(["uv", "build", "--project", str(project), "--wheel", "--out-dir", str(wheelhouse)])

    venv = tmp_path / "venv"
    _run(["uv", "venv", str(venv), "--python", "3.13"])
    python = venv / "bin" / "python"
    local_wheels = [
        next(wheelhouse.glob("ketos_sdk-*.whl")),
        next(wheelhouse.glob("kfx-*.whl")),
        next(wheelhouse.glob("ketos_base-*.whl")),
        next(wheelhouse.glob("ketos_stepflow-*.whl")),
    ]
    _run(
        [
            "uv",
            "pip",
            "install",
            "--python",
            str(python),
            "--find-links",
            str(wheelhouse),
            *(str(wheel) for wheel in local_wheels),
        ]
    )

    smoke = _run(
        [
            str(python),
            "-c",
            (
                "from importlib.metadata import version; "
                "import ketos, kfx, ketos_sdk, ketos_stepflow; "
                "from ketos_stepflow import KetosConverter; "
                "from ketos_stepflow.worker.__main__ import server; "
                "assert version('kfx') == '1.10.2'; "
                "assert version('ketos-base') == '0.10.2'; "
                "assert KetosConverter.__name__ == 'KetosConverter'; "
                "assert server is not None"
            ),
        ]
    )
    assert smoke.returncode == 0

    worker_help = _run([str(python), "-m", "ketos_stepflow.worker", "--help"])
    assert "Ketos Stepflow Component Server" in worker_help.stdout
