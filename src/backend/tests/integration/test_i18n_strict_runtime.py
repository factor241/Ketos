"""Strict i18n integration contracts through the real ASGI endpoint path."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from ketos.utils import i18n as i18n_utils


@pytest.mark.asyncio
async def test_strict_ru_missing_component_translation_fails_real_endpoint_deterministically(
    client: AsyncClient,
    logged_in_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def get_types(**_kwargs):
        return {
            "input_output": {
                "StrictProbe": {
                    "display_name": "Strict Probe",
                    "description": "Strict integration probe.",
                    "template": {},
                    "outputs": [],
                }
            }
        }

    monkeypatch.setattr(
        "ketos.interface.components.get_and_cache_all_types_dict",
        get_types,
    )
    monkeypatch.setattr(i18n_utils, "_translations", {"en": {}, "ru": {}})

    with i18n_utils.strict_translation_test_mode("ru"):
        response = await client.get(
            "/api/v1/all",
            headers={**logged_in_headers, "Accept-Language": "ru"},
        )

    assert response.status_code == 500
    assert response.json() == {
        "code": "components.update_failed",
        "detail": {
            "error": "MissingSystemTranslationError",
            "message": (
                "Strict ru translation is missing system-owned key "
                "'components.strictprobe.display_name.3a592cc0'; fallback=default"
            ),
        },
        "message": "Component could not be updated.",
        "params": {},
    }
