from __future__ import annotations

import warnings

import pytest
from kfx.brand_env import BrandEnvConflictError, BrandEnvLegacyWarning
from kfx.services.settings.feature_flags import FeatureFlags


@pytest.mark.parametrize(
    ("field_name", "suffix"),
    [("wxo_deployments", "WXO_DEPLOYMENTS"), ("mvp_components", "MVP_COMPONENTS")],
)
def test_feature_flags_accept_legacy_only(monkeypatch, field_name: str, suffix: str) -> None:
    monkeypatch.delenv(f"KETOS_FEATURE_{suffix}", raising=False)
    monkeypatch.setenv(f"LANGFLOW_FEATURE_{suffix}", "true")

    with pytest.warns(BrandEnvLegacyWarning):
        flags = FeatureFlags()

    assert getattr(flags, field_name) is True


def test_feature_flags_accept_equal_dual_without_conflict(monkeypatch) -> None:
    monkeypatch.setenv("KETOS_FEATURE_WXO_DEPLOYMENTS", "true")
    monkeypatch.setenv("LANGFLOW_FEATURE_WXO_DEPLOYMENTS", "true")

    with warnings.catch_warnings():
        warnings.simplefilter("error")
        flags = FeatureFlags()

    assert flags.wxo_deployments is True


def test_feature_flags_reject_unequal_dual(monkeypatch) -> None:
    monkeypatch.setenv("KETOS_FEATURE_WXO_DEPLOYMENTS", "true")
    monkeypatch.setenv("LANGFLOW_FEATURE_WXO_DEPLOYMENTS", "false")

    with pytest.raises(BrandEnvConflictError):
        FeatureFlags()
