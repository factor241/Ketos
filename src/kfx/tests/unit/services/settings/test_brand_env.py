"""Contract tests for canonical and legacy branded environment resolution."""

from __future__ import annotations

import importlib
import os
import warnings
from dataclasses import FrozenInstanceError

import pytest


def _brand_env_module():
    return importlib.import_module("kfx.services.settings.brand_env")


def _resolve(name: str, default, *, sensitivity=None, conflict_policy=None):
    try:
        policy = _brand_env_module().get_brand_env_policy(name)
    except _brand_env_module().UnclassifiedBrandEnvError:
        policy = _brand_env_module().BrandEnvPolicy(sensitivity="public", conflict_policy="warn")
    return _brand_env_module().resolve_brand_env(
        name,
        default,
        sensitivity=sensitivity or policy.sensitivity,
        conflict_policy=conflict_policy or policy.conflict_policy,
    )


def _clear(monkeypatch: pytest.MonkeyPatch, name: str) -> tuple[str, str]:
    canonical = f"KETOS_{name}"
    legacy = f"LANGFLOW_{name}"
    monkeypatch.delenv(canonical, raising=False)
    monkeypatch.delenv(legacy, raising=False)
    return canonical, legacy


def test_absent_variables_return_the_exact_default_object(monkeypatch):
    _clear(monkeypatch, "CONFIG_DIR")
    default = object()

    assert _resolve("CONFIG_DIR", default) is default


def test_canonical_variable_wins_without_warning(monkeypatch):
    canonical, _ = _clear(monkeypatch, "PORT")
    monkeypatch.setenv(canonical, "9000")

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        result = _resolve("PORT", 7860)

    assert result == "9000"
    assert isinstance(result, str), "type conversion is deliberately deferred to the caller"
    assert caught == []


def test_legacy_only_value_is_selected_with_deprecation_warning(monkeypatch):
    _, legacy = _clear(monkeypatch, "PORT")
    monkeypatch.setenv(legacy, "9000")
    module = _brand_env_module()

    with pytest.warns(module.BrandEnvLegacyWarning) as caught:
        result = _resolve("PORT", 7860)

    assert result == "9000"
    assert len(caught) == 1
    assert caught[0].message.event.selected == "legacy"


@pytest.mark.parametrize("value", ["same", ""])
def test_equal_dual_values_are_accepted_without_warning(monkeypatch, value):
    canonical, legacy = _clear(monkeypatch, "DATABASE_URL")
    monkeypatch.setenv(canonical, value)
    monkeypatch.setenv(legacy, value)

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        result = _resolve("DATABASE_URL", "default", conflict_policy="error")

    assert result == value
    assert caught == []


def test_unequal_dual_values_warn_and_select_canonical(monkeypatch):
    canonical, legacy = _clear(monkeypatch, "LOG_LEVEL")
    monkeypatch.setenv(canonical, "debug")
    monkeypatch.setenv(legacy, "info")
    module = _brand_env_module()

    with pytest.warns(module.BrandEnvConflictWarning) as caught:
        result = _resolve("LOG_LEVEL", "warning", conflict_policy="warn")

    assert result == "debug"
    assert len(caught) == 1
    assert caught[0].message.event.selected == "canonical"


def test_unequal_dual_values_raise_under_error_policy(monkeypatch):
    canonical, legacy = _clear(monkeypatch, "DATABASE_URL")
    monkeypatch.setenv(canonical, "canonical-db")
    monkeypatch.setenv(legacy, "legacy-db")
    module = _brand_env_module()

    with pytest.raises(module.BrandEnvConflictError) as caught:
        _resolve("DATABASE_URL", "default-db", conflict_policy="error")

    assert caught.value.event.selected == "canonical"


def test_empty_canonical_value_is_present_and_conflicts_with_nonempty_legacy(monkeypatch):
    canonical, legacy = _clear(monkeypatch, "API_KEY")
    monkeypatch.setenv(canonical, "")
    monkeypatch.setenv(legacy, "legacy")
    module = _brand_env_module()

    with pytest.raises(module.BrandEnvConflictError):
        _resolve("API_KEY", "default", sensitivity="secret", conflict_policy="error")


def test_secret_diagnostics_never_expose_values_or_default(monkeypatch):
    canonical, legacy = _clear(monkeypatch, "SECRET_KEY")
    secrets = ("canonical-super-secret", "legacy-super-secret", "default-super-secret")
    monkeypatch.setenv(canonical, secrets[0])
    monkeypatch.setenv(legacy, secrets[1])
    module = _brand_env_module()

    with pytest.raises(module.BrandEnvConflictError) as caught:
        _resolve("SECRET_KEY", secrets[2], sensitivity="secret", conflict_policy="error")

    diagnostic_text = " ".join(
        (
            str(caught.value),
            repr(caught.value),
            str(caught.value.event),
            repr(caught.value.event),
            repr(vars(caught.value)),
        )
    )
    for secret in secrets:
        assert secret not in diagnostic_text
        assert str(len(secret)) not in diagnostic_text
        assert str(hash(secret)) not in diagnostic_text


def test_secret_policy_cannot_be_weakened_by_caller(monkeypatch):
    canonical, legacy = _clear(monkeypatch, "API_KEY")
    secrets = ("canonical-warning-secret", "legacy-warning-secret", "default-warning-secret")
    monkeypatch.setenv(canonical, secrets[0])
    monkeypatch.setenv(legacy, secrets[1])
    with pytest.raises(ValueError, match="reviewed policy") as caught:
        _resolve("API_KEY", secrets[2], sensitivity="secret", conflict_policy="warn")

    diagnostic_text = " ".join(
        (
            str(caught.value),
            repr(caught.value),
            repr(vars(caught.value)),
        )
    )
    for secret in secrets:
        assert secret not in diagnostic_text


def test_events_and_diagnostic_event_references_are_immutable(monkeypatch):
    _, legacy = _clear(monkeypatch, "PORT")
    monkeypatch.setenv(legacy, "9000")
    module = _brand_env_module()

    with pytest.warns(module.BrandEnvLegacyWarning) as caught:
        _resolve("PORT", 7860)

    diagnostic = caught[0].message
    with pytest.raises(FrozenInstanceError):
        diagnostic.event.selected = "canonical"
    with pytest.raises(AttributeError):
        diagnostic.event = diagnostic.event


@pytest.mark.parametrize(
    "name",
    ["", "port", "Port", "_PORT", "9PORT", "PORT-NUMBER", "KETOS_PORT", "LANGFLOW_PORT"],
)
def test_name_must_be_an_uppercase_unprefixed_suffix(monkeypatch, name):
    _clear(monkeypatch, "PORT")

    with pytest.raises(ValueError, match="uppercase unprefixed suffix"):
        _resolve(name, "default")


@pytest.mark.parametrize(
    ("sensitivity", "conflict_policy"),
    [("private", "warn"), ("public", "ignore")],
)
def test_literal_options_are_validated_at_runtime(monkeypatch, sensitivity, conflict_policy):
    _clear(monkeypatch, "PORT")

    with pytest.raises(ValueError, match="Unsupported brand environment option"):
        _resolve("PORT", "default", sensitivity=sensitivity, conflict_policy=conflict_policy)


def test_resolution_does_not_mutate_the_environment(monkeypatch):
    canonical, legacy = _clear(monkeypatch, "PORT")
    monkeypatch.setenv(canonical, "9000")
    monkeypatch.setenv(legacy, "8000")
    before = dict(os.environ)

    with pytest.raises(_brand_env_module().BrandEnvConflictError):
        _resolve("PORT", "default")

    assert dict(os.environ) == before


def test_core_api_is_reexported_from_settings_package():
    module = _brand_env_module()
    package = importlib.import_module("kfx.services.settings")

    assert package.resolve_brand_env is module.resolve_brand_env
    assert package.BrandEnvConflictError is module.BrandEnvConflictError
    assert package.BrandEnvConflictWarning is module.BrandEnvConflictWarning
    assert package.BrandEnvLegacyWarning is module.BrandEnvLegacyWarning


def test_unclassified_suffix_is_rejected_before_environment_access(monkeypatch):
    _clear(monkeypatch, "NOT_REGISTERED")
    module = _brand_env_module()

    with pytest.raises(module.UnclassifiedBrandEnvError, match="NOT_REGISTERED"):
        _resolve("NOT_REGISTERED", "default")
