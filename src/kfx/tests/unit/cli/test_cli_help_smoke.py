"""Smoke tests: every kfx subcommand's --help must exit 0."""

from __future__ import annotations

import pytest
from kfx.__main__ import app
from typer.testing import CliRunner

runner = CliRunner()

ALL_SUBCOMMANDS = [
    "init",
    "login",
    "create",
    "requirements",
    "validate",
    "run",
    "serve",
    "status",
    "push",
    "pull",
    "export",
]


def test_root_help():
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "kfx" in result.output.lower()


@pytest.mark.parametrize("cmd", ALL_SUBCOMMANDS)
def test_subcommand_help(cmd: str):
    result = runner.invoke(app, [cmd, "--help"])
    assert result.exit_code == 0, f"`kfx {cmd} --help` failed: {result.output}"
