"""Tests for the cross-user-fetch capability flag."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from ketos.services.authorization.service import KetosAuthorizationService
from kfx.services.authorization.base import BaseAuthorizationService
from kfx.services.authorization.service import AuthorizationService as LfxDefaultService


def _settings(*, authz_enabled: bool = False) -> SimpleNamespace:
    return SimpleNamespace(
        auth_settings=SimpleNamespace(
            AUTHZ_ENABLED=authz_enabled,
            AUTHZ_SUPERUSER_BYPASS=True,
        )
    )


@pytest.mark.anyio
async def test_base_class_default_is_false():
    """The class-level constant defaults False so subclasses must opt in."""
    assert BaseAuthorizationService.SUPPORTS_CROSS_USER_FETCH is False


@pytest.mark.anyio
async def test_kfx_default_service_does_not_support_cross_user_fetch():
    """The kfx no-op service inherits the safe default."""
    service = LfxDefaultService()
    assert await service.supports_cross_user_fetch() is False


@pytest.mark.anyio
async def test_ketos_pass_through_does_not_support_cross_user_fetch():
    """OSS pass-through must NOT opt in — that is the strict-pass-through contract."""
    service = KetosAuthorizationService(_settings())
    assert await service.supports_cross_user_fetch() is False


@pytest.mark.anyio
async def test_subclass_can_opt_in():
    """Authorization plugins flip ``SUPPORTS_CROSS_USER_FETCH=True``; the base accepts it."""

    class _Plugin(KetosAuthorizationService):
        SUPPORTS_CROSS_USER_FETCH = True

    service = _Plugin(_settings())
    assert await service.supports_cross_user_fetch() is True
