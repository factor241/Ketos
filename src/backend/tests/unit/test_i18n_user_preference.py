"""Persisted user locale and public locale-registry contract tests."""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import uuid4

import pytest
from ketos.services.database.models.user.model import User, UserRead, UserUpdate
from ketos.utils import i18n as i18n_utils
from pydantic import ValidationError

if TYPE_CHECKING:
    from httpx import AsyncClient


def test_user_model_keeps_preference_nullable() -> None:
    user = User(username="locale-user", password="not-a-real-hash")  # noqa: S106

    assert hasattr(user, "preferred_locale")
    assert user.preferred_locale is None


def test_user_update_normalizes_supported_region_and_case() -> None:
    update = UserUpdate.model_validate({"preferred_locale": "RU-ru"})

    assert update.preferred_locale == "ru"


def test_user_update_rejects_unsupported_locale() -> None:
    with pytest.raises(ValidationError, match="preferred_locale"):
        UserUpdate.model_validate({"preferred_locale": "xx-ZZ"})


def test_user_read_safely_falls_back_for_invalid_stored_preference() -> None:
    user = User(username="legacy-locale-user", password="not-a-real-hash", preferred_locale="xx-ZZ")  # noqa: S106

    user_read = UserRead.model_validate(user, from_attributes=True)

    assert user_read.preferred_locale == "en"


async def test_whoami_exposes_nullable_preference(
    client: AsyncClient,
    logged_in_headers: dict[str, str],
) -> None:
    response = await client.get("api/v1/users/whoami", headers=logged_in_headers)

    assert response.status_code == 200
    assert "preferred_locale" in response.json()
    assert response.json()["preferred_locale"] is None


async def test_regular_user_persists_own_preference_and_new_login_restores_it(
    client: AsyncClient,
    active_user,
    logged_in_headers: dict[str, str],
) -> None:
    response = await client.patch(
        f"api/v1/users/{active_user.id}",
        json={"preferred_locale": "RU-ru"},
        headers=logged_in_headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["preferred_locale"] == "ru"

    login = await client.post(
        "api/v1/login",
        data={"username": active_user.username, "password": "testpassword"},
    )
    assert login.status_code == 200, login.text
    new_session_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    whoami = await client.get("api/v1/users/whoami", headers=new_session_headers)
    assert whoami.status_code == 200
    assert whoami.json()["preferred_locale"] == "ru"


async def test_regular_user_locale_sequence_is_last_write_wins(
    client: AsyncClient,
    active_user,
    logged_in_headers: dict[str, str],
) -> None:
    responses = []
    for locale in ("ru", "en", "ru"):
        response = await client.patch(
            f"api/v1/users/{active_user.id}",
            json={"preferred_locale": locale},
            headers=logged_in_headers,
        )
        responses.append(response)

    assert [response.status_code for response in responses] == [200, 200, 200]
    assert [response.json()["preferred_locale"] for response in responses] == ["ru", "en", "ru"]

    whoami = await client.get("api/v1/users/whoami", headers=logged_in_headers)
    assert whoami.status_code == 200
    assert whoami.json()["preferred_locale"] == "ru"


async def test_preferred_locale_null_explicitly_resets_to_default(
    client: AsyncClient,
    active_user,
    logged_in_headers: dict[str, str],
) -> None:
    set_russian = await client.patch(
        f"api/v1/users/{active_user.id}",
        json={"preferred_locale": "ru"},
        headers=logged_in_headers,
    )
    assert set_russian.status_code == 200

    reset = await client.patch(
        f"api/v1/users/{active_user.id}",
        json={"preferred_locale": None},
        headers=logged_in_headers,
    )

    assert reset.status_code == 200, reset.text
    assert reset.json()["preferred_locale"] is None

    whoami = await client.get("api/v1/users/whoami", headers=logged_in_headers)
    assert whoami.status_code == 200
    assert whoami.json()["preferred_locale"] is None
    effective_locale = (
        i18n_utils.normalize_supported_locale(whoami.json()["preferred_locale"]) or i18n_utils.DEFAULT_LOCALE
    )
    assert effective_locale == "en"


async def test_regular_user_cannot_change_another_users_preference(
    client: AsyncClient,
    logged_in_headers: dict[str, str],
) -> None:
    response = await client.patch(
        f"api/v1/users/{uuid4()}",
        json={"preferred_locale": "ru"},
        headers=logged_in_headers,
    )

    assert response.status_code == 403


@pytest.mark.parametrize(
    "privilege_update",
    [
        {"is_active": True},
        {"is_superuser": False},
        {"last_login_at": "2026-01-01T00:00:00Z"},
    ],
)
async def test_locale_update_cannot_smuggle_privilege_fields(
    client: AsyncClient,
    active_user,
    logged_in_headers: dict[str, str],
    privilege_update: dict[str, object],
) -> None:
    response = await client.patch(
        f"api/v1/users/{active_user.id}",
        json={"preferred_locale": "ru", **privilege_update},
        headers=logged_in_headers,
    )

    assert response.status_code == 403


async def test_locale_update_allows_null_privilege_placeholders(
    client: AsyncClient,
    active_user,
    logged_in_headers: dict[str, str],
) -> None:
    response = await client.patch(
        f"api/v1/users/{active_user.id}",
        json={
            "preferred_locale": "ru",
            "is_active": None,
            "is_superuser": None,
            "last_login_at": None,
        },
        headers=logged_in_headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["preferred_locale"] == "ru"


async def test_api_rejects_unsupported_preference(
    client: AsyncClient,
    active_user,
    logged_in_headers: dict[str, str],
) -> None:
    response = await client.patch(
        f"api/v1/users/{active_user.id}",
        json={"preferred_locale": "xx-ZZ"},
        headers=logged_in_headers,
    )

    assert response.status_code == 422


async def test_config_exposes_supported_and_default_locales_for_public_and_authenticated_clients(
    client: AsyncClient,
    logged_in_headers: dict[str, str],
) -> None:
    supported_locales = getattr(i18n_utils, "SUPPORTED_LOCALES", None)
    default_locale = getattr(i18n_utils, "DEFAULT_LOCALE", None)

    assert supported_locales is not None
    assert default_locale == "en"
    assert "ru" in supported_locales

    for headers in ({}, logged_in_headers):
        response = await client.get("api/v1/config", headers=headers)
        assert response.status_code == 200
        assert response.json()["supported_locales"] == list(supported_locales)
        assert response.json()["default_locale"] == default_locale
