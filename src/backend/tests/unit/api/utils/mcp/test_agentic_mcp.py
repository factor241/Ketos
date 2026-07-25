from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from ketos.api.utils.mcp import agentic_mcp
from kfx.services.settings.constants import AGENTIC_VARIABLES


@pytest.mark.asyncio
async def test_initialize_agentic_user_variables_awaits_debug_logging(monkeypatch) -> None:
    debug = AsyncMock()
    variable_service = SimpleNamespace(
        list_variables=AsyncMock(return_value=dict.fromkeys(AGENTIC_VARIABLES, "")),
        create_variable=AsyncMock(),
    )
    monkeypatch.setattr(
        agentic_mcp,
        "get_settings_service",
        lambda: SimpleNamespace(settings=SimpleNamespace(agentic_experience=True)),
    )
    monkeypatch.setattr(agentic_mcp, "get_variable_service", lambda: variable_service)
    monkeypatch.setattr(agentic_mcp.logger, "adebug", debug)

    await agentic_mcp.initialize_agentic_user_variables("user-id", AsyncMock())

    assert debug.await_count >= 3
    assert any("Checking if agentic variable" in str(call.args[0]) for call in debug.await_args_list)
    variable_service.create_variable.assert_not_awaited()
