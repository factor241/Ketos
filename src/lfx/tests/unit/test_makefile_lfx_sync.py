from pathlib import Path

ROOT = Path(__file__).parents[4]


def test_lfx_tests_reinstalls_typer_after_workspace_sync() -> None:
    makefile = (ROOT / "Makefile").read_text(encoding="utf-8")
    lfx_target = makefile.split("lfx_tests:", maxsplit=1)[1].split("integration_tests:", maxsplit=1)[0]

    assert "uv sync --dev --package lfx --reinstall-package typer" in lfx_target
