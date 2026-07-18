"""Locale negotiation and response-header contract tests."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from ketos.utils import i18n as i18n_utils

if TYPE_CHECKING:
    from httpx import AsyncClient


@pytest.mark.parametrize(
    ("accept_language", "expected"),
    [
        (None, "ru"),
        ("", "ru"),
        ("ru", "ru"),
        ("ru-RU", "ru"),
        ("RU-ru", "ru"),
        ("fr-FR,ru;q=0.9,en;q=0.8", "ru"),
        ("ru;q=1,en;q=0.5", "ru"),
        ("fr;q=0.2,ru;q=0.9", "ru"),
        ("unsupported;q=1,ru;q=0.9", "ru"),
        ("ru;q=0,en;q=0.5", "en"),
        ("ru;q=invalid,en;q=0.5", "en"),
        ("zh", "ru"),
        ("zh-CN", "ru"),
        ("zh-hans", "ru"),
        ("zh-TW", "ru"),
        ("zh-Hant", "ru"),
        ("*", "ru"),
        ("unsupported", "ru"),
    ],
)
def test_resolve_accept_language_uses_weights_aliases_and_safe_fallback(
    accept_language: str | None,
    expected: str,
) -> None:
    resolver = getattr(i18n_utils, "resolve_accept_language", None)

    assert callable(resolver), "resolve_accept_language must be part of the backend locale contract"
    assert resolver(accept_language) == expected


async def test_locale_middleware_sets_content_language_for_accept_language_matrix(client: AsyncClient) -> None:
    matrix = [
        ({"Accept-Language": "ru"}, "ru"),
        ({"Accept-Language": "ru-RU"}, "ru"),
        ({"Accept-Language": "RU-ru"}, "ru"),
        ({"Accept-Language": "fr-FR,ru;q=0.9,en;q=0.8"}, "ru"),
        ({"Accept-Language": "ru;q=1,en;q=0.5"}, "ru"),
        ({"Accept-Language": "unsupported"}, "ru"),
        ({}, "ru"),
    ]

    for headers, expected in matrix:
        response = await client.get("api/v1/config", headers=headers)

        assert response.status_code == 200
        assert response.headers.get("Content-Language") == expected
        vary = {token.strip().casefold() for token in response.headers.get("Vary", "").split(",") if token.strip()}
        assert "accept-language" in vary
