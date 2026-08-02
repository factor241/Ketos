from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
OWNERSHIP_MANIFEST = REPO_ROOT / "scripts" / "ci" / "release-lock-ownership.json"
RELEASE_LOCK_FILENAMES = {
    "Cargo.lock",
    "Pipfile.lock",
    "bun.lock",
    "bun.lockb",
    "package-lock.json",
    "pnpm-lock.yaml",
    "poetry.lock",
    "uv.lock",
    "yarn.lock",
}


def discover_tracked_release_locks() -> set[str]:
    git = shutil.which("git")
    if git is None:
        message = "git executable is required by the release-lock ownership test"
        raise RuntimeError(message)
    result = subprocess.run(  # noqa: S603 - fixed Git command with an absolute executable.
        [git, "ls-files", "-z"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
    )
    return {
        path for path in result.stdout.decode("utf-8").split("\0") if path and Path(path).name in RELEASE_LOCK_FILENAMES
    }


def test_release_lock_ownership_is_explicit_and_complete() -> None:
    manifest = json.loads(OWNERSHIP_MANIFEST.read_text(encoding="utf-8"))
    locks = {entry["path"]: entry for entry in manifest["locks"]}

    assert manifest["version"] == 1
    assert len(locks) == len(manifest["locks"])
    assert set(locks) == discover_tracked_release_locks()
    assert locks["uv.lock"]["producer"] == "uv lock --python 3.13"
    assert locks["uv.lock"]["role"] == "primary-python-install-lock"

    for path in (
        "package-lock.json",
        "docs/package-lock.json",
        "src/copilot-runtime/package-lock.json",
        "src/frontend/package-lock.json",
    ):
        assert locks[path]["producer"].startswith(
            "npx --yes --package=node@22.22.0 --package=npm@11.16.0 -- npm install"
        )
        assert locks[path]["role"] == "primary-npm-install-lock"

    assert locks["src/copilot-runtime/package-lock.json"] == {
        "path": "src/copilot-runtime/package-lock.json",
        "producer": (
            "npx --yes --package=node@22.22.0 --package=npm@11.16.0 -- npm install --package-lock-only --ignore-scripts"
        ),
        "role": "primary-npm-install-lock",
        "runtime_consumer": "npm",
        "cwd": "src/copilot-runtime",
        "owner": "S01-A03",
        "ownership_transition": "S01-A01 -> S01-A03",
    }

    pnpm = locks["src/frontend/pnpm-lock.yaml"]
    assert pnpm == {
        "path": "src/frontend/pnpm-lock.yaml",
        "producer": (
            "npx --yes --package=node@22.22.0 --package=pnpm@11.8.0 -- pnpm install --lockfile-only --ignore-scripts"
        ),
        "role": "verification-only-cross-solver-attestation",
        "runtime_consumer": None,
        "cwd": "src/frontend",
        "primary_lock": "src/frontend/package-lock.json",
    }
