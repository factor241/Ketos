"""pytest plugin providing fixtures for integration-testing Ketos flows.

Install with the ``testing`` extra::

    pip install "ketos-sdk[testing]"

The plugin is auto-discovered by pytest via the ``pytest11`` entry point, so
no ``conftest.py`` changes are needed.  Simply pass connection details on the
command line or via environment variables::

    # Direct URL
    pytest --ketos-url http://localhost:7860 tests/

    # Named environment from ketos-environments.toml
    pytest --ketos-env staging tests/

    # Via environment variables (useful in CI)
    KETOS_URL=http://localhost:7860 pytest tests/

Usage inside a test file::

    def test_my_rag_flow(flow_runner):
        response = flow_runner("rag-endpoint", "What is Ketos?")
        assert "Ketos" in response.first_text_output()

    async def test_my_async_flow(async_flow_runner):
        response = await async_flow_runner("rag-endpoint", "Hello")
        assert response.first_text_output() is not None
"""

from __future__ import annotations

import contextlib
import os
from typing import TYPE_CHECKING, Any

try:
    import pytest
except ImportError as exc:
    msg = "pytest is required for ketos_sdk.testing. Install it with: pip install 'ketos-sdk[testing]'"
    raise ImportError(msg) from exc

if TYPE_CHECKING:
    from uuid import UUID

    from ketos_sdk._async_client import AsyncKetosClient
    from ketos_sdk.client import KetosClient
    from ketos_sdk.models import RunResponse


# ---------------------------------------------------------------------------
# CLI options
# ---------------------------------------------------------------------------


def pytest_addoption(parser: pytest.Parser) -> None:
    """Register Ketos-specific CLI options."""
    group = parser.getgroup("ketos", "Ketos integration testing options")
    options = {
        "--ketos-env": {
            "dest": "ketos_env",
            "default": None,
            "metavar": "NAME",
            "help": "Environment name from ketos-environments.toml to use for integration tests.",
        },
        "--ketos-url": {
            "dest": "ketos_url",
            "default": None,
            "metavar": "URL",
            "help": "Base URL of the Ketos instance (overrides --ketos-env).",
        },
        "--ketos-api-key": {
            "dest": "ketos_api_key",
            "default": None,
            "metavar": "KEY",
            "help": "API key for the Ketos instance (overrides environment config).",
        },
        "--ketos-environments-file": {
            "dest": "ketos_environments_file",
            "default": None,
            "metavar": "PATH",
            "help": "Path to ketos-environments.toml (overrides default discovery).",
        },
    }

    # Multiple integration plugins can coexist in the same environment.
    # Keep registration idempotent so repeated registration remains safe.
    for flag, kwargs in options.items():
        with contextlib.suppress(ValueError):
            group.addoption(flag, **kwargs)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _resolve_url_credentials(request: pytest.FixtureRequest) -> tuple[str, str | None] | None:
    """Extract (url, api_key) from CLI options / env vars, or return None."""
    url: str | None = request.config.getoption("ketos_url") or os.getenv("KETOS_URL")
    if not url:
        return None
    # pragma: allowlist secret
    api_key: str | None = request.config.getoption("ketos_api_key") or os.getenv("KETOS_API_KEY")
    return url, api_key


def _resolve_url_client(request: pytest.FixtureRequest) -> KetosClient | None:
    """Return a sync client from --ketos-url / KETOS_URL, or None."""
    from ketos_sdk.client import KetosClient

    creds = _resolve_url_credentials(request)
    return KetosClient(base_url=creds[0], api_key=creds[1]) if creds else None


def _resolve_async_url_client(request: pytest.FixtureRequest) -> AsyncKetosClient | None:
    """Return an async client from --ketos-url / KETOS_URL, or None."""
    from ketos_sdk._async_client import AsyncKetosClient

    creds = _resolve_url_credentials(request)
    return AsyncKetosClient(base_url=creds[0], api_key=creds[1]) if creds else None


def _env_name(request: pytest.FixtureRequest) -> str | None:
    return request.config.getoption("ketos_env") or os.getenv("KETOS_ENV")


def _env_file(request: pytest.FixtureRequest) -> str | None:
    return request.config.getoption("ketos_environments_file") or os.getenv("KETOS_ENVIRONMENTS_FILE")


_SKIP_MSG = "No Ketos connection configured. Pass --ketos-url <URL> or --ketos-env <NAME> to enable integration tests."


# ---------------------------------------------------------------------------
# Session-scoped fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def ketos_client(request: pytest.FixtureRequest) -> KetosClient:
    """Session-scoped fixture that returns a configured :class:`~ketos_sdk.KetosClient`.

    The fixture skips the test session automatically when no connection
    information is available.  Configure via CLI options or environment
    variables (in priority order):

    1. ``--ketos-url`` / ``KETOS_URL`` — direct base URL
    2. ``--ketos-api-key`` / ``KETOS_API_KEY`` — API key  # pragma: allowlist secret
    3. ``--ketos-env`` / ``KETOS_ENV`` — named environment from TOML file
    4. ``--ketos-environments-file`` / ``KETOS_ENVIRONMENTS_FILE`` — TOML path
    """
    client = _resolve_url_client(request)
    if not client:
        env = _env_name(request)
        if env:
            from pathlib import Path

            from ketos_sdk.environments import get_client

            env_file = _env_file(request)
            config_file = Path(env_file) if env_file else None
            client = get_client(env, config_file=config_file)
        else:
            pytest.skip(_SKIP_MSG)

    yield client
    client.close()


@pytest.fixture(scope="session")
async def async_ketos_client(request: pytest.FixtureRequest) -> AsyncKetosClient:
    """Session-scoped fixture returning a configured :class:`~ketos_sdk.AsyncKetosClient`.

    Same configuration resolution as :func:`ketos_client`.
    """
    client = _resolve_async_url_client(request)
    if not client:
        env = _env_name(request)
        if env:
            from pathlib import Path

            from ketos_sdk.environments import get_async_client

            env_file = _env_file(request)
            config_file = Path(env_file) if env_file else None
            client = get_async_client(env, config_file=config_file)
        else:
            pytest.skip(_SKIP_MSG)

    yield client
    await client.aclose()


# ---------------------------------------------------------------------------
# FlowRunner / AsyncFlowRunner callables
# ---------------------------------------------------------------------------


class FlowRunner:
    """Callable returned by the :func:`flow_runner` fixture.

    Call it like a function to execute a flow and receive a
    :class:`~ketos_sdk.RunResponse`::

        def test_greeting(flow_runner):
            response = flow_runner("my-endpoint", "Hello!")
            assert response.first_text_output() is not None

    Keyword-only arguments mirror the fields of
    :class:`~ketos_sdk.RunRequest`.
    """

    def __init__(self, client: KetosClient) -> None:
        self._client = client

    def __call__(
        self,
        flow_id_or_endpoint: UUID | str,
        input_value: str = "",
        *,
        input_type: str = "chat",
        output_type: str = "chat",
        tweaks: dict[str, Any] | None = None,
        stream: bool = False,
    ) -> RunResponse:
        """Run *flow_id_or_endpoint* and return the full :class:`~ketos_sdk.RunResponse`."""
        from ketos_sdk.models import RunRequest

        return self._client.run_flow(
            flow_id_or_endpoint,
            RunRequest(
                input_value=input_value,
                input_type=input_type,
                output_type=output_type,
                tweaks=tweaks,
                stream=stream,
            ),
        )


class AsyncFlowRunner:
    """Async callable returned by the :func:`async_flow_runner` fixture.

    Use with ``await`` inside an ``async def`` test::

        async def test_greeting(async_flow_runner):
            response = await async_flow_runner("my-endpoint", "Hello!")
            assert response.first_text_output() is not None
    """

    def __init__(self, client: AsyncKetosClient) -> None:
        self._client = client

    async def __call__(
        self,
        flow_id_or_endpoint: UUID | str,
        input_value: str = "",
        *,
        input_type: str = "chat",
        output_type: str = "chat",
        tweaks: dict[str, Any] | None = None,
        stream: bool = False,
    ) -> RunResponse:
        """Run *flow_id_or_endpoint* asynchronously and return the full response."""
        from ketos_sdk.models import RunRequest

        return await self._client.run_flow(
            flow_id_or_endpoint,
            RunRequest(
                input_value=input_value,
                input_type=input_type,
                output_type=output_type,
                tweaks=tweaks,
                stream=stream,
            ),
        )


# ---------------------------------------------------------------------------
# Function-scoped fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def flow_runner(ketos_client: KetosClient) -> FlowRunner:
    """Fixture that returns a :class:`FlowRunner` for running flows in tests.

    Depends on the session-scoped :func:`ketos_client` fixture, so the
    test is automatically skipped when no connection is configured.

    Example::

        def test_rag_flow(flow_runner):
            response = flow_runner("rag-endpoint", "What is Ketos?")
            assert "Ketos" in response.first_text_output()
    """
    return FlowRunner(ketos_client)


@pytest.fixture
def async_flow_runner(async_ketos_client: AsyncKetosClient) -> AsyncFlowRunner:
    """Fixture that returns an :class:`AsyncFlowRunner` for async tests.

    Example::

        async def test_rag_flow(async_flow_runner):
            response = await async_flow_runner("rag-endpoint", "What is Ketos?")
            assert "Ketos" in response.first_text_output()
    """
    return AsyncFlowRunner(async_ketos_client)
