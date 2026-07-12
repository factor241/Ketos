# ruff: noqa: S101 - bootstrap assertions deliberately provide RED test failures.

from conftest import BRAND_CONTRACT_PATH, LEGACY_CONTRACT_PATH, SCANNER_PATH, load_scanner


def test_stage0_scanner_and_contracts_exist_and_are_importable() -> None:
    # These assertions deliberately precede dynamic import. The first Stage 0
    # run must be an ordinary RED assertion, never a collection/import error.
    assert SCANNER_PATH.is_file(), f"Stage 0 scanner is missing: {SCANNER_PATH}"
    assert BRAND_CONTRACT_PATH.is_file(), f"Brand contract is missing: {BRAND_CONTRACT_PATH}"
    assert LEGACY_CONTRACT_PATH.is_file(), f"Legacy contract is missing: {LEGACY_CONTRACT_PATH}"
    module = load_scanner()
    assert callable(getattr(module, "validate_brand_contract", None))
    assert callable(getattr(module, "validate_legacy_contract", None))
    assert callable(getattr(module, "scan_repository", None))
