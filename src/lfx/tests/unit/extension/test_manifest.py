"""Schema round-trip + edge-case tests for the v0 ExtensionManifest."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

import pytest
from lfx.extension.manifest import (
    DEFERRED_FIELDS,
    EXTENSION_SCHEMA_URL,
    BundleRef,
    ExtensionManifest,
    LfxCompat,
    load_manifest,
)
from pydantic import ValidationError

if TYPE_CHECKING:
    from pathlib import Path

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

_VALID = {
    "$schema": EXTENSION_SCHEMA_URL,
    "id": "lfx-openai",
    "version": "1.2.3",
    "name": "OpenAI Bundle",
    "description": "OpenAI components",
    "lfx": {"compat": ["1"]},
    "bundles": [{"name": "openai", "path": "openai"}],
    "capabilities": {"requiresCredentials": True},
}


def _without(d: dict, *keys: str) -> dict:
    return {k: v for k, v in d.items() if k not in keys}


def _with(d: dict, **overrides: object) -> dict:
    out = dict(d)
    out.update(overrides)
    return out


# ---------------------------------------------------------------------------
# Round-trip
# ---------------------------------------------------------------------------


def test_round_trip_every_v0_field() -> None:
    manifest = ExtensionManifest.model_validate(_VALID)
    dumped = manifest.model_dump(by_alias=True, mode="json")
    # Defaults / Nones for deferred fields are added; strip those for parity.
    for k in DEFERRED_FIELDS:
        dumped.pop(k, None)
    # The schema_field/$schema alias should round-trip.
    assert dumped["$schema"] == EXTENSION_SCHEMA_URL
    # Required fields preserved exactly.
    assert dumped["id"] == _VALID["id"]
    assert dumped["version"] == _VALID["version"]
    # Optional bundle metadata (``display_name`` / ``icon``) defaults to None
    # when unset; strip those keys before comparing so adding new optional
    # fields stays backwards-compatible with manifests that omit them.
    normalised = [{k: v for k, v in b.items() if v is not None} for b in dumped["bundles"]]
    assert normalised == _VALID["bundles"]
    assert dumped["lfx"] == _VALID["lfx"]
    assert dumped["capabilities"] == _VALID["capabilities"]


def test_minimal_manifest_round_trip() -> None:
    minimal = {
        "id": "lfx-x",
        "version": "0.1.0",
        "name": "X",
        "lfx": {"compat": ["1"]},
        "bundles": [{"name": "xx", "path": "xx"}],
    }
    manifest = ExtensionManifest.model_validate(minimal)
    assert manifest.capabilities.requiresCredentials is False
    assert manifest.description is None


# ---------------------------------------------------------------------------
# Namespaced locale bundle
# ---------------------------------------------------------------------------


def test_manifest_without_locale_bundle_defaults_to_marked_ru_missing() -> None:
    manifest = ExtensionManifest.model_validate(_VALID)

    assert manifest.locale_bundle is None
    assert manifest.ru_missing_policy == "mark"
    assert manifest.ru_missing is True


def test_locale_bundle_round_trips_flat_component_catalogs() -> None:
    payload = _with(
        _VALID,
        locale_bundle={
            "namespace": "lfx-openai",
            "locales": {
                "en": {"components.widget.display_name": "Widget"},
                "ru": {"components.widget.display_name": "Виджет"},
            },
        },
    )

    manifest = ExtensionManifest.model_validate(payload)
    dumped = manifest.model_dump(by_alias=True, mode="json")

    assert manifest.locale_bundle is not None
    assert manifest.locale_bundle.namespace == manifest.id
    assert manifest.locale_bundle.locales["ru"]["components.widget.display_name"] == "Виджет"
    assert manifest.ru_missing_policy == "mark"
    assert manifest.ru_missing is False
    assert dumped["locale_bundle"] == payload["locale_bundle"]
    assert dumped["ru_missing_policy"] == "mark"


@pytest.mark.parametrize(
    "payload",
    [
        _VALID,
        _with(
            _VALID,
            locale_bundle={
                "namespace": "lfx-openai",
                "locales": {"en": {"components.widget.display_name": "Widget"}},
            },
        ),
    ],
)
def test_ru_missing_policy_fail_rejects_absent_ru(payload: dict) -> None:
    with pytest.raises(ValidationError, match=r"Russian locale.*required"):
        ExtensionManifest.model_validate(_with(payload, ru_missing_policy="fail"))


def test_ru_missing_policy_fail_accepts_ru_catalog() -> None:
    payload = _with(
        _VALID,
        ru_missing_policy="fail",
        locale_bundle={
            "namespace": "lfx-openai",
            "locales": {"ru": {"components.widget.display_name": "Виджет"}},
        },
    )

    manifest = ExtensionManifest.model_validate(payload)

    assert manifest.ru_missing is False
    assert manifest.ru_missing_policy == "fail"


@pytest.mark.parametrize("namespace", ["components", "lfx-other"])
def test_locale_bundle_namespace_must_equal_extension_id(namespace: str) -> None:
    payload = _with(
        _VALID,
        locale_bundle={
            "namespace": namespace,
            "locales": {"ru": {"components.widget.display_name": "Виджет"}},
        },
    )

    with pytest.raises(ValidationError, match=r"namespace.*extension id"):
        ExtensionManifest.model_validate(payload)


@pytest.mark.parametrize(
    "catalog_key",
    [
        "apiErrors.extensions.invalidManifest",
        "extensions.other.components.widget.display_name",
        "components",
        "core.components.widget.display_name",
    ],
)
def test_locale_bundle_rejects_non_component_relative_keys(catalog_key: str) -> None:
    payload = _with(
        _VALID,
        locale_bundle={
            "namespace": "lfx-openai",
            "locales": {"ru": {catalog_key: "Значение"}},
        },
    )

    with pytest.raises(ValidationError, match="components"):
        ExtensionManifest.model_validate(payload)


@pytest.mark.parametrize(
    "locales",
    [
        {},
        {"ru": {}},
        {"": {"components.widget.display_name": "Виджет"}},
        {"ru": {"components.widget.display_name": ""}},
        {"ru": {"components.widget.display_name": "   "}},
        {"ru": {"components.widget.display_name": {"nested": "value"}}},
    ],
)
def test_locale_bundle_rejects_non_flat_or_empty_locale_maps(locales: dict) -> None:
    payload = _with(
        _VALID,
        locale_bundle={"namespace": "lfx-openai", "locales": locales},
    )

    with pytest.raises(ValidationError):
        ExtensionManifest.model_validate(payload)


def test_locale_bundle_and_ru_policy_reject_unknown_values() -> None:
    bad_bundle = _with(
        _VALID,
        locale_bundle={
            "namespace": "lfx-openai",
            "locales": {"ru": {"components.widget.display_name": "Виджет"}},
            "unexpected": True,
        },
    )
    with pytest.raises(ValidationError):
        ExtensionManifest.model_validate(bad_bundle)

    with pytest.raises(ValidationError):
        ExtensionManifest.model_validate(_with(_VALID, ru_missing_policy="ignore"))


# ---------------------------------------------------------------------------
# v0 field validation -- malformed manifests
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("override_or_missing", "must_mention"),
    [
        # 10 distinct malformed manifests with distinct error paths.
        ({"id": "Bad_ID"}, "id"),
        ({"id": ""}, "id"),
        ({"version": "not-semver"}, "version"),
        ({"name": ""}, "name"),
        ({"lfx": {"compat": []}}, "compat"),
        ({"lfx": {"compat": ["0"]}}, "compat"),
        ({"bundles": []}, "bundles"),
        ({"bundles": [{"name": "Bad-Name", "path": "x"}]}, "name"),
        ({"bundles": [{"name": "x", "path": "/abs/path"}]}, "path"),
        ({"bundles": [{"name": "x", "path": "../escape"}]}, "path"),
    ],
)
def test_rejects_malformed_manifest(override_or_missing: dict, must_mention: str) -> None:
    bad = _with(_VALID, **override_or_missing)
    with pytest.raises(ValidationError) as exc_info:
        ExtensionManifest.model_validate(bad)
    rendered = str(exc_info.value).lower()
    assert must_mention.lower() in rendered


def test_extra_top_level_field_rejected() -> None:
    bad = _with(_VALID, mystery_field="surprise")
    with pytest.raises(ValidationError):
        ExtensionManifest.model_validate(bad)


def test_schema_version_field_is_dropped() -> None:
    """``schema_version`` is no longer accepted on the manifest.

    The version is pinned by ``$id`` / ``$schema``.  An author who copies a
    stale fixture with ``schema_version: 1`` in it must get a clear
    ``extra="forbid"`` rejection rather than silent acceptance.
    """
    bad = _with(_VALID, schema_version=1)
    with pytest.raises(ValidationError):
        ExtensionManifest.model_validate(bad)


def test_extra_capabilities_field_rejected() -> None:
    bad = _with(_VALID, capabilities={"requiresCredentials": True, "futurething": True})
    with pytest.raises(ValidationError):
        ExtensionManifest.model_validate(bad)


# ---------------------------------------------------------------------------
# Deferred fields -- must reject when set
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("field_name", DEFERRED_FIELDS)
def test_deferred_field_rejected_when_set(field_name: str) -> None:
    """A non-null deferred field MUST cause validation to fail."""
    bad = _with(_VALID, **{field_name: {"any": "value"}})
    with pytest.raises(ValidationError):
        ExtensionManifest.model_validate(bad)


@pytest.mark.parametrize("field_name", DEFERRED_FIELDS)
def test_deferred_field_accepted_when_omitted(field_name: str) -> None:
    """Absent deferred field validates fine."""
    manifest = ExtensionManifest.model_validate(_without(_VALID, field_name))
    # Default is always None for deferred fields.
    assert getattr(manifest, field_name, None) is None


# ---------------------------------------------------------------------------
# Multi-bundle deferred
# ---------------------------------------------------------------------------


def test_multi_bundle_rejected_at_model_level() -> None:
    """Pydantic rejects multi-bundle via the field-level ``max_length=1``.

    The dedicated ``multi-bundle-deferred-in-this-milestone`` discriminant is
    surfaced by the validator pipeline in ``lfx.extension.validate`` (covered by
    ``test_validate.py``); at the model level we only need to confirm the
    constraint is enforced on the ``bundles`` field, which also means it lands
    in the published JSON Schema.
    """
    bad = _with(
        _VALID,
        bundles=[
            {"name": "aa", "path": "aa"},
            {"name": "bb", "path": "bb"},
        ],
    )
    with pytest.raises(ValidationError) as exc_info:
        ExtensionManifest.model_validate(bad)
    error = exc_info.value.errors()[0]
    assert error["loc"] == ("bundles",)
    assert error["type"] == "too_long"


def test_duplicate_bundle_names_rejected() -> None:
    bad = _with(_VALID, bundles=[{"name": "xx", "path": "xx"}, {"name": "xx", "path": "yy"}])
    with pytest.raises(ValidationError):
        ExtensionManifest.model_validate(bad)


# ---------------------------------------------------------------------------
# load_manifest discovery
# ---------------------------------------------------------------------------


def test_load_manifest_extension_json(tmp_path: Path) -> None:
    (tmp_path / "extension.json").write_text(json.dumps(_VALID), encoding="utf-8")
    source = load_manifest(tmp_path)
    assert source.kind == "extension.json"
    assert source.path == (tmp_path / "extension.json").resolve()
    assert source.manifest.id == "lfx-openai"


def test_load_manifest_pyproject(tmp_path: Path) -> None:
    pyproject = """
[project]
name = "lfx-openai"

[tool.langflow.extension]
id = "lfx-openai"
version = "1.2.3"
name = "OpenAI Bundle"

[tool.langflow.extension.lfx]
compat = ["1"]

[[tool.langflow.extension.bundles]]
name = "openai"
path = "openai"
"""
    (tmp_path / "pyproject.toml").write_text(pyproject, encoding="utf-8")
    source = load_manifest(tmp_path)
    assert source.kind == "pyproject.toml"
    assert source.manifest.bundles[0].name == "openai"


def test_load_manifest_extension_json_wins_over_pyproject(tmp_path: Path) -> None:
    (tmp_path / "extension.json").write_text(json.dumps(_VALID), encoding="utf-8")
    (tmp_path / "pyproject.toml").write_text("[tool.langflow.extension]\nid='wrong'", encoding="utf-8")
    source = load_manifest(tmp_path)
    assert source.kind == "extension.json"


def test_load_manifest_missing_raises(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        load_manifest(tmp_path)


def test_load_manifest_bad_json_raises(tmp_path: Path) -> None:
    (tmp_path / "extension.json").write_text("{not json", encoding="utf-8")
    with pytest.raises(ValueError, match="not valid JSON"):
        load_manifest(tmp_path)


def test_load_manifest_pyproject_no_section(tmp_path: Path) -> None:
    (tmp_path / "pyproject.toml").write_text("[project]\nname = 'x'", encoding="utf-8")
    with pytest.raises(FileNotFoundError):
        load_manifest(tmp_path)


# ---------------------------------------------------------------------------
# Direct sub-model tests
# ---------------------------------------------------------------------------


def test_bundle_ref_path_safety_sufficient_for_static_use() -> None:
    BundleRef(name="ok", path="sub/dir")  # OK relative path.
    with pytest.raises(ValidationError):
        BundleRef(name="ok", path="../escape")
    with pytest.raises(ValidationError):
        BundleRef(name="ok", path="/abs")


def test_lfx_compat_rejects_invalid_versions() -> None:
    LfxCompat(compat=["1"])
    LfxCompat(compat=["1", "2"])
    with pytest.raises(ValidationError):
        LfxCompat(compat=[])
    with pytest.raises(ValidationError):
        LfxCompat(compat=["0"])  # version 0 is not valid
    with pytest.raises(ValidationError):
        LfxCompat(compat=["01"])  # leading zero rejected
    with pytest.raises(ValidationError):
        LfxCompat(compat=["v1"])  # non-numeric prefix rejected
    with pytest.raises(ValidationError):
        LfxCompat(compat=[""])  # empty string rejected
    with pytest.raises(ValidationError):
        LfxCompat(compat=[1])  # type: ignore[list-item] # int rejected by StrictStr
    with pytest.raises(ValidationError):
        LfxCompat(compat=["1", "1"])  # duplicate
