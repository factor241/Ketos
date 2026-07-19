from __future__ import annotations

import warnings

import pytest
from kfx.brand_env import BrandEnvConflictError, BrandEnvLegacyWarning
from kfx.services.settings.feature_flags import FeatureFlags


@pytest.mark.parametrize(
    ("field_name", "suffix"),
    [
        ("wxo_deployments", "WXO_DEPLOYMENTS"),
        ("mvp_components", "MVP_COMPONENTS"),
        ("mvp_workspace", "MVP_WORKSPACE"),
        ("mvp_chat", "MVP_CHAT"),
    ],
)
def test_feature_flags_accept_legacy_only(monkeypatch, field_name: str, suffix: str) -> None:
    monkeypatch.delenv(f"KETOS_FEATURE_{suffix}", raising=False)
    monkeypatch.setenv(f"LANGFLOW_FEATURE_{suffix}", "true")

    with pytest.warns(BrandEnvLegacyWarning):
        flags = FeatureFlags()

    assert getattr(flags, field_name) is True


def test_mvp_workspace_and_chat_default_off(monkeypatch) -> None:
    for suffix in ("MVP_WORKSPACE", "MVP_CHAT"):
        monkeypatch.delenv(f"KETOS_FEATURE_{suffix}", raising=False)
        monkeypatch.delenv(f"LANGFLOW_FEATURE_{suffix}", raising=False)

    flags = FeatureFlags()

    assert flags.mvp_workspace is False
    assert flags.mvp_chat is False


@pytest.mark.parametrize(("field_name", "suffix"), [("mvp_workspace", "MVP_WORKSPACE"), ("mvp_chat", "MVP_CHAT")])
@pytest.mark.parametrize(("raw_value", "expected_value"), [("true", True), ("false", False)])
def test_mvp_flags_accept_canonical_boolean(
    monkeypatch, field_name: str, suffix: str, raw_value: str, expected_value
) -> None:
    monkeypatch.setenv(f"KETOS_FEATURE_{suffix}", raw_value)
    monkeypatch.delenv(f"LANGFLOW_FEATURE_{suffix}", raising=False)

    flags = FeatureFlags()

    assert getattr(flags, field_name) is expected_value


@pytest.mark.parametrize(("suffix", "field_name"), [("MVP_WORKSPACE", "mvp_workspace"), ("MVP_CHAT", "mvp_chat")])
def test_feature_flags_accept_equal_dual_without_conflict(monkeypatch, suffix: str, field_name: str) -> None:
    monkeypatch.setenv(f"KETOS_FEATURE_{suffix}", "true")
    monkeypatch.setenv(f"LANGFLOW_FEATURE_{suffix}", "true")

    with warnings.catch_warnings():
        warnings.simplefilter("error")
        flags = FeatureFlags()

    assert getattr(flags, field_name) is True


@pytest.mark.parametrize("suffix", ["MVP_WORKSPACE", "MVP_CHAT"])
def test_feature_flags_reject_unequal_dual(monkeypatch, suffix: str) -> None:
    monkeypatch.setenv(f"KETOS_FEATURE_{suffix}", "true")
    monkeypatch.setenv(f"LANGFLOW_FEATURE_{suffix}", "false")

    with pytest.raises(BrandEnvConflictError):
        FeatureFlags()
