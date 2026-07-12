from __future__ import annotations

# ruff: noqa: S101 - assertions are the behavior under test.
from copy import deepcopy
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

import pytest
from conftest import load_scanner, write_yaml

BRAND_FIELDS = (
    "product_name",
    "product_slug",
    "executor_name",
    "executor_distribution",
    "python_distribution",
    "python_base_distribution",
    "sdk_distribution",
    "stepflow_distribution",
    "python_namespace",
    "sdk_namespace",
    "stepflow_namespace",
    "env_prefix",
    "site_url",
    "docs_url",
    "repository_url",
    "issues_url",
    "support_url",
    "container_registry_namespace",
    "package_publisher_identity",
    "social_links",
    "telemetry_url",
    "store_url",
    "schema_base_url",
    "legal_entity",
    "copyright_holder",
    "trademark_owner",
    "security_contact",
    "vulnerability_report_url",
    "moderation_contact",
    "privacy_policy_url",
    "data_controller",
    "analytics_owner",
    "analytics_properties",
    "search_owner",
    "chat_widget_owner",
    "signing_identity",
    "logo_source_sha256",
    "logo_rights_approved_by",
    "logo_rights_approved_date",
    "wordmark_font_license",
)


def validate(tmp_path: Path, contract: dict) -> list[str]:
    scanner = load_scanner()
    path = write_yaml(tmp_path / "brand.yaml", contract)
    result = scanner.validate_brand_contract(path)
    assert isinstance(result, list), "validator must return a deterministic list of errors"
    return result


def test_brand_contract_schema_is_exact(tmp_path: Path, valid_brand_contract: dict) -> None:
    scanner = load_scanner()
    assert tuple(scanner.BRAND_CONTRACT_FIELDS) == BRAND_FIELDS
    assert validate(tmp_path, valid_brand_contract) == []


@pytest.mark.parametrize("field", BRAND_FIELDS)
def test_brand_contract_rejects_every_missing_field(tmp_path: Path, valid_brand_contract: dict, field: str) -> None:
    contract = deepcopy(valid_brand_contract)
    contract.pop(field)
    errors = validate(tmp_path, contract)
    assert any(field in error and "missing" in error.lower() for error in errors)


def test_brand_contract_rejects_unknown_fields(tmp_path: Path, valid_brand_contract: dict) -> None:
    contract = deepcopy(valid_brand_contract)
    contract["future_unapproved_brand_field"] = "surprise"
    errors = validate(tmp_path, contract)
    assert any("future_unapproved_brand_field" in error and "unknown" in error.lower() for error in errors)


@pytest.mark.parametrize(
    "field",
    [
        "site_url",
        "docs_url",
        "repository_url",
        "issues_url",
        "support_url",
        "telemetry_url",
        "store_url",
        "schema_base_url",
        "vulnerability_report_url",
        "privacy_policy_url",
    ],
)
def test_null_url_means_feature_disabled_and_is_valid(tmp_path: Path, valid_brand_contract: dict, field: str) -> None:
    contract = deepcopy(valid_brand_contract)
    contract[field] = None
    assert validate(tmp_path, contract) == []


@pytest.mark.parametrize("url", ["", "ketos.example", "http://placeholder.invalid", "https://example.com/tbd"])
def test_url_must_be_real_https_or_null(tmp_path: Path, valid_brand_contract: dict, url: str) -> None:
    contract = deepcopy(valid_brand_contract)
    contract["docs_url"] = url
    errors = validate(tmp_path, contract)
    assert any("docs_url" in error for error in errors)


def test_approved_https_url_is_valid(tmp_path: Path, valid_brand_contract: dict) -> None:
    contract = deepcopy(valid_brand_contract)
    contract["docs_url"] = "https://docs.ketos.dev/guide"
    assert validate(tmp_path, contract) == []
