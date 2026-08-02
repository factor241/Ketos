# ruff: noqa: S101

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_playwright_canonicalizes_the_default_temporary_parent() -> None:
    source = (ROOT / "src/frontend/playwright.mvp.config.ts").read_text(encoding="utf-8")

    assert 'import { mkdirSync, realpathSync } from "node:fs"' in source
    assert "path.join(realpathSync(tmpdir())," in source
    assert "path.join(tmpdir()," not in source


def test_shell_harness_canonicalizes_tmpdir_before_mktemp() -> None:
    source = (ROOT / "scripts/mvp/chat_stack_smoke.sh").read_text(encoding="utf-8")

    canonicalize = 'TEMP_PARENT="$(cd "${TMPDIR:-/tmp}" && pwd -P)"'
    mktemp = 'RUN_ROOT="$(mktemp -d "${TEMP_PARENT%/}/ketos-stage01-chat.XXXXXX")"'
    assert canonicalize in source
    assert mktemp in source
    assert source.index(canonicalize) < source.index(mktemp)
