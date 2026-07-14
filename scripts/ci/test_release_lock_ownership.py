from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
OWNERSHIP_MANIFEST = REPO_ROOT / "scripts" / "ci" / "release-lock-ownership.json"


def test_release_lock_ownership_is_explicit_and_complete() -> None:
    manifest = json.loads(OWNERSHIP_MANIFEST.read_text(encoding="utf-8"))
    locks = {entry["path"]: entry for entry in manifest["locks"]}

    assert manifest["version"] == 1
    assert len(locks) == len(manifest["locks"])
    assert set(locks) == {
        "uv.lock",
        "package-lock.json",
        "docs/package-lock.json",
        "src/frontend/package-lock.json",
        "src/frontend/pnpm-lock.yaml",
    }
    assert locks["uv.lock"]["producer"] == "uv lock --python 3.13"
    assert locks["uv.lock"]["role"] == "primary-python-install-lock"

    for path in (
        "package-lock.json",
        "docs/package-lock.json",
        "src/frontend/package-lock.json",
    ):
        assert locks[path]["producer"].startswith(
            "npx --yes --package=node@22.22.0 --package=npm@11.16.0 -- npm install"
        )
        assert locks[path]["role"] == "primary-npm-install-lock"

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
