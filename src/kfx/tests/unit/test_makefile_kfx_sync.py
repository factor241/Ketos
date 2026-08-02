from pathlib import Path

ROOT = Path(__file__).parents[4]


def test_kfx_tests_reinstalls_typer_after_workspace_sync() -> None:
    makefile = (ROOT / "Makefile").read_text(encoding="utf-8")
    kfx_target = makefile.split("kfx_tests:", maxsplit=1)[1].split("integration_tests:", maxsplit=1)[0]

    assert "uv sync --dev --package kfx --reinstall-package typer" in kfx_target
