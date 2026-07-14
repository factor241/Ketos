"""pytest plugin hooks, fixtures, and marker registration for kfx.testing."""

from __future__ import annotations

import contextlib
import os
from pathlib import Path
from typing import Any

try:
    import pytest
except ImportError as exc:
    msg = "pytest is required for kfx.testing. Install it with: pip install pytest  (or pip install 'kfx[dev]')"
    raise ImportError(msg) from exc

from kfx.testing.runners import (
    AsyncLocalFlowRunner,
    AsyncRemoteFlowRunner,
    LocalFlowRunner,
    RemoteFlowRunner,
)

# ---------------------------------------------------------------------------
# pytest plugin hooks
# ---------------------------------------------------------------------------


def pytest_addoption(parser: pytest.Parser) -> None:
    """Register canonical KFX/Ketos and legacy LFX/Langflow options once."""
    group = parser.getgroup("kfx", "kfx local flow execution options")
    local_options = {
        "--kfx-env-file": {
            "dest": "kfx_env_file",
            "default": None,
            "metavar": "PATH",
            "help": "Path to a .env file loaded before each flow execution.",
        },
        "--kfx-timeout": {
            "dest": "kfx_timeout",
            "default": None,
            "type": float,
            "metavar": "SECONDS",
            "help": "Default timeout in seconds for flow execution (0 = no limit).",
        },
        "--kfx-flow-dir": {
            "dest": "kfx_flow_dir",
            "default": None,
            "metavar": "DIR",
            "help": "Base directory for resolving relative flow paths (default: cwd).",
        },
        "--lfx-env-file": {
            "dest": "lfx_env_file",
            "default": None,
            "metavar": "PATH",
            "help": "Compatibility alias for --kfx-env-file.",
        },
        "--lfx-timeout": {
            "dest": "lfx_timeout",
            "default": None,
            "type": float,
            "metavar": "SECONDS",
            "help": "Compatibility alias for --kfx-timeout.",
        },
        "--lfx-flow-dir": {
            "dest": "lfx_flow_dir",
            "default": None,
            "metavar": "DIR",
            "help": "Compatibility alias for --kfx-flow-dir.",
        },
    }
    for flag, kwargs in local_options.items():
        with contextlib.suppress(ValueError):
            group.addoption(flag, **kwargs)

    # Guard against duplicate registration when ketos-sdk[testing] is also installed.
    # Both plugins expose the same --ketos-* options; only register them once.
    remote = parser.getgroup("ketos", "Ketos remote integration testing options")
    remote_options = {
        "--ketos-env": {
            "dest": "ketos_env",
            "default": None,
            "metavar": "NAME",
            "help": (
                "Named environment from KETOS_CONFIG_DIR/environments.yaml or ketos-environments.toml. "
                "When set, flow_runner targets the remote instance instead of running locally."
            ),
        },
        "--ketos-url": {
            "dest": "ketos_url",
            "default": None,
            "metavar": "URL",
            "help": "Base URL of the remote Ketos instance (overrides --ketos-env).",
        },
        "--ketos-api-key": {
            "dest": "ketos_api_key",
            "default": None,
            "metavar": "KEY",
            "help": "API key for the remote Ketos instance.",
        },
        "--ketos-environments-file": {
            "dest": "ketos_environments_file",
            "default": None,
            "metavar": "PATH",
            "help": "Path to environments config file (.yaml or .toml; overrides default lookup).",
        },
        "--langflow-env": {
            "dest": "langflow_env",
            "default": None,
            "metavar": "NAME",
            "help": "Compatibility alias for --ketos-env.",
        },
        "--langflow-url": {
            "dest": "langflow_url",
            "default": None,
            "metavar": "URL",
            "help": "Compatibility alias for --ketos-url.",
        },
        "--langflow-api-key": {
            "dest": "langflow_api_key",
            "default": None,
            "metavar": "KEY",
            "help": "Compatibility alias for --ketos-api-key.",
        },
        "--langflow-environments-file": {
            "dest": "langflow_environments_file",
            "default": None,
            "metavar": "PATH",
            "help": "Compatibility alias for --ketos-environments-file.",
        },
    }
    for flag, kwargs in remote_options.items():
        with contextlib.suppress(ValueError):
            remote.addoption(flag, **kwargs)


def pytest_configure(config: pytest.Config) -> None:
    """Register custom markers so pytest --strict-markers does not reject them."""
    config.addinivalue_line(
        "markers",
        "kfx_env_file(path): path to a .env file loaded before this test's flow execution",
    )
    config.addinivalue_line(
        "markers",
        "kfx_timeout(seconds): timeout in seconds for this test's flow execution",
    )
    config.addinivalue_line(
        "markers",
        "lfx_env_file(path): compatibility alias for kfx_env_file(path)",
    )
    config.addinivalue_line(
        "markers",
        "lfx_timeout(seconds): compatibility alias for kfx_timeout(seconds)",
    )
    config.addinivalue_line(
        "markers",
        "integration: integration test that requires a live Ketos instance",
    )


_SKIP_NO_REMOTE = (
    "No remote Ketos connection configured. "
    "Pass --ketos-url <URL> or --ketos-env <NAME> to run against a live instance."
)


def _first_configured(*values: Any) -> Any:
    """Return the first configured value while preserving numeric zero."""
    return next((value for value in values if value is not None and value != ""), None)


def _brand_option(
    request: pytest.FixtureRequest,
    canonical_option: str,
    canonical_env: str,
    legacy_option: str,
    legacy_env: str,
) -> Any:
    """Resolve a dual-brand option with the canonical family taking precedence."""
    return _first_configured(
        request.config.getoption(canonical_option, default=None),
        os.environ.get(canonical_env),
        request.config.getoption(legacy_option, default=None),
        os.environ.get(legacy_env),
    )


def _resolve_remote_client(request: pytest.FixtureRequest) -> Any | None:
    """Return a sync SDK client if remote options are configured, else ``None``.

    Priority:
    1. ``--ketos-url`` / ``KETOS_URL`` -- direct URL (with optional ``--ketos-api-key``)
    2. ``--ketos-env`` / ``KETOS_ENV`` -- named environment from TOML/YAML file
    """
    url: str | None = _brand_option(request, "ketos_url", "KETOS_URL", "langflow_url", "LANGFLOW_URL")
    env_name: str | None = _brand_option(request, "ketos_env", "KETOS_ENV", "langflow_env", "LANGFLOW_ENV")

    if not url and not env_name:
        return None

    try:
        import ketos_sdk  # type: ignore[import-untyped]
    except ImportError:
        pytest.skip("ketos-sdk is required for remote testing. Install: pip install ketos-sdk")

    if url:
        api_key: str | None = _brand_option(
            request,
            "ketos_api_key",
            "KETOS_API_KEY",
            "langflow_api_key",
            "LANGFLOW_API_KEY",
        )
        return ketos_sdk.KetosClient(base_url=url, api_key=api_key)

    # Named environment
    env_file: str | None = _brand_option(
        request,
        "ketos_environments_file",
        "KETOS_ENVIRONMENTS_FILE",
        "langflow_environments_file",
        "LANGFLOW_ENVIRONMENTS_FILE",
    )
    try:
        from pathlib import Path as _Path

        from ketos_sdk.environments import get_client  # type: ignore[import-untyped]

        return get_client(env_name, config_file=_Path(env_file) if env_file else None)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Could not configure Ketos environment {env_name!r}: {exc}")


def _resolve_async_remote_client(request: pytest.FixtureRequest) -> Any | None:
    """Return an async SDK client if remote options are configured, else ``None``."""
    url: str | None = _brand_option(request, "ketos_url", "KETOS_URL", "langflow_url", "LANGFLOW_URL")
    env_name: str | None = _brand_option(request, "ketos_env", "KETOS_ENV", "langflow_env", "LANGFLOW_ENV")

    if not url and not env_name:
        return None

    try:
        import ketos_sdk  # type: ignore[import-untyped]
    except ImportError:
        pytest.skip("ketos-sdk is required for remote testing. Install: pip install ketos-sdk")

    if url:
        api_key: str | None = _brand_option(
            request,
            "ketos_api_key",
            "KETOS_API_KEY",
            "langflow_api_key",
            "LANGFLOW_API_KEY",
        )
        return ketos_sdk.AsyncKetosClient(base_url=url, api_key=api_key)

    env_file: str | None = _brand_option(
        request,
        "ketos_environments_file",
        "KETOS_ENVIRONMENTS_FILE",
        "langflow_environments_file",
        "LANGFLOW_ENVIRONMENTS_FILE",
    )
    try:
        from pathlib import Path as _Path

        from ketos_sdk.environments import get_async_client  # type: ignore[import-untyped]

        return get_async_client(env_name, config_file=_Path(env_file) if env_file else None)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Could not configure Ketos environment {env_name!r}: {exc}")


def _get_marker_arg(request: pytest.FixtureRequest, name: str) -> Any:
    """Return the first positional argument of marker *name*, or ``None``."""
    marker = request.node.get_closest_marker(name)
    return marker.args[0] if marker and marker.args else None


def _resolve_runner_config(
    request: pytest.FixtureRequest,
) -> tuple[str | None, float | None, Path | None]:
    """Resolve local settings with canonical brand precedence and legacy fallback."""
    env_file: str | None = _first_configured(
        _get_marker_arg(request, "kfx_env_file"),
        request.config.getoption("kfx_env_file", default=None),
        os.environ.get("KFX_ENV_FILE"),
        _get_marker_arg(request, "lfx_env_file"),
        request.config.getoption("lfx_env_file", default=None),
        os.environ.get("LFX_ENV_FILE"),
    )

    timeout: float | None = None
    raw_timeout = _first_configured(
        _get_marker_arg(request, "kfx_timeout"),
        request.config.getoption("kfx_timeout", default=None),
        os.environ.get("KFX_TIMEOUT"),
        _get_marker_arg(request, "lfx_timeout"),
        request.config.getoption("lfx_timeout", default=None),
        os.environ.get("LFX_TIMEOUT"),
    )
    if raw_timeout is not None:
        with contextlib.suppress(TypeError, ValueError):
            timeout = float(raw_timeout)

    dir_str: str | None = _first_configured(
        request.config.getoption("kfx_flow_dir", default=None),
        os.environ.get("KFX_FLOW_DIR"),
        request.config.getoption("lfx_flow_dir", default=None),
        os.environ.get("LFX_FLOW_DIR"),
    )
    base_dir: Path | None = Path(dir_str) if dir_str else None

    return env_file, timeout, base_dir


@pytest.fixture
def flow_runner(
    request: pytest.FixtureRequest,
) -> LocalFlowRunner | RemoteFlowRunner:
    """Fixture providing a sync flow runner -- local or remote depending on CLI options.

    **Local mode** (default)
        Runs the flow in-process.  Configure with:

        * ``@pytest.mark.kfx_env_file(path)`` / ``@pytest.mark.kfx_timeout(seconds)``
        * ``--kfx-env-file`` / ``--kfx-timeout`` / ``--kfx-flow-dir``
        * ``KFX_ENV_FILE`` / ``KFX_TIMEOUT`` / ``KFX_FLOW_DIR``

    **Remote mode** (when ``--ketos-env`` or ``--ketos-url`` is supplied)
        Calls the live Ketos API.  Requires ``ketos-sdk``.

        * ``--ketos-env <NAME>`` -- named environment from ``KETOS_CONFIG_DIR/environments.yaml``
        * ``--ketos-url <URL>`` -- direct URL
        * ``--ketos-api-key <KEY>`` / ``KETOS_API_KEY``
        * ``--ketos-environments-file <PATH>`` / ``KETOS_ENVIRONMENTS_FILE``
        * ``KETOS_ENV`` / ``KETOS_URL``

    Example (local)::

        def test_greeting(flow_runner):
            result = flow_runner("flows/greeting.json", input_value="Hello")
            assert result.ok

    Example (remote -- run with ``pytest --ketos-env staging``)::

        @pytest.mark.integration
        def test_greeting(flow_runner):
            result = flow_runner("greeting-endpoint", "Hello!")
            assert result.first_text_output() is not None
    """
    client = _resolve_remote_client(request)
    if client is not None:
        return RemoteFlowRunner(client)

    env_file, timeout, base_dir = _resolve_runner_config(request)
    return LocalFlowRunner(
        default_env_file=env_file,
        default_timeout=timeout,
        base_dir=base_dir,
    )


@pytest.fixture
def async_flow_runner(
    request: pytest.FixtureRequest,
) -> AsyncLocalFlowRunner | AsyncRemoteFlowRunner:
    """Fixture providing an async flow runner -- local or remote depending on CLI options.

    Same mode-selection logic as :func:`flow_runner`.

    Example (local)::

        async def test_greeting(async_flow_runner):
            result = await async_flow_runner("flows/greeting.json", input_value="Hi")
            assert result.ok

    Example (remote)::

        @pytest.mark.integration
        async def test_greeting(async_flow_runner):
            result = await async_flow_runner("greeting-endpoint", "Hi!")
            assert result.first_text_output() is not None
    """
    client = _resolve_async_remote_client(request)
    if client is not None:
        return AsyncRemoteFlowRunner(client)

    env_file, timeout, base_dir = _resolve_runner_config(request)
    return AsyncLocalFlowRunner(
        default_env_file=env_file,
        default_timeout=timeout,
        base_dir=base_dir,
    )
