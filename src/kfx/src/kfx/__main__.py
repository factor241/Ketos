"""KFX CLI entry point."""

from importlib.metadata import version as _pkg_version

import typer

from kfx.cli._authoring_commands import register as _register_authoring
from kfx.cli._extension_commands import register as _register_extension
from kfx.cli._remote_commands import register as _register_remote
from kfx.cli._running_commands import register as _register_running
from kfx.cli._setup_commands import register as _register_setup
from kfx.cli._upgrade_commands import register as _register_upgrade


def _version_callback(value: bool) -> None:
    if value:
        typer.echo(f"kfx {_pkg_version('kfx')}")
        raise typer.Exit(0)


app = typer.Typer(
    name="kfx",
    help="kfx - Ketos Flow Executor",
    add_completion=False,
)


@app.callback()
def _app_callback(
    version: bool = typer.Option(
        False,
        "--version",
        "-V",
        help="Show the kfx version and exit.",
        is_eager=True,
        callback=_version_callback,
    ),
) -> None:
    """KFX - Ketos Flow Executor."""


# Register command groups (order determines help-panel ordering)
_register_setup(app)
_register_authoring(app)
_register_upgrade(app)
_register_extension(app)
_register_running(app)
_register_remote(app)


def main():
    """Main entry point for the KFX CLI."""
    app()


if __name__ == "__main__":
    main()
