"""Download translated strings from GP and save as locale JSON files.

Usage:
    python download.py --target frontend [--output path/to/locales/]
    python download.py --target backend [--output path/to/locales/]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import requests
from gp_client import BASE_URL, GP_INSTANCE, TARGET_LANGS, get_headers, get_strings, get_tls_verify

DEFAULT_FRONTEND_OUTPUT = Path(__file__).parent.parent.parent / "src/frontend/src/locales"
DEFAULT_BACKEND_OUTPUT = Path(__file__).parent.parent.parent / "src/backend/base/langflow/locales"
DEFAULT_FRONTEND_SOURCE = DEFAULT_FRONTEND_OUTPUT / "en.json"
DEFAULT_BACKEND_SOURCE = DEFAULT_BACKEND_OUTPUT / "en.json"
GP_BACKEND_BUNDLE = os.getenv("GP_BACKEND_BUNDLE", "langflow-ui-backend-v2")
REQUEST_TIMEOUT = 30
SENSITIVE_ENV_NAMES = ("GP_ADMIN_USER_ID", "GP_ADMIN_PASSWORD")
MIN_SENSITIVE_VALUE_LENGTH = 8


class CatalogValidationError(ValueError):
    """Raised when a GP response is unsafe or incomplete."""


def _extract_strings(result: dict) -> dict[str, str]:
    resource_strings = result.get("resourceStrings", {}) if isinstance(result, dict) else {}
    if not isinstance(resource_strings, dict):
        return {}
    return {
        key: entry.get("value", "") if isinstance(entry, dict) else entry for key, entry in resource_strings.items()
    }


def _validate_catalog(lang: str, source: dict[str, str], strings: dict[str, str]) -> None:
    source_keys = set(source)
    target_keys = set(strings)
    missing = source_keys - target_keys
    blank = {key for key, value in strings.items() if not isinstance(value, str) or not value.strip()}
    serialized = json.dumps(strings, ensure_ascii=False)
    contains_credential = any(
        value and len(value) >= MIN_SENSITIVE_VALUE_LENGTH and value in serialized
        for name in SENSITIVE_ENV_NAMES
        if (value := os.getenv(name))
    )
    if missing or blank or contains_credential:
        msg = (
            f"invalid catalog for {lang}: missing={len(missing)}, blank={len(blank)}, "
            f"credential_match={int(contains_credential)}"
        )
        raise CatalogValidationError(msg)


def get_backend_strings(lang: str) -> dict:
    url = f"{BASE_URL}/{GP_INSTANCE}/v2/bundles/{GP_BACKEND_BUNDLE}/{lang}"
    response = requests.get(
        url,
        headers=get_headers(url, "GET"),
        verify=get_tls_verify(),
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    return response.json()


def main() -> None:
    parser = argparse.ArgumentParser(description="Download translations from GP")
    parser.add_argument(
        "--target", required=True, choices=["frontend", "backend"], help="Which bundle to download from"
    )
    parser.add_argument("--output", help="Directory to save translated JSON files")
    parser.add_argument("--source", help="English source catalog used for exact key-set validation")
    parser.add_argument("--lang", choices=TARGET_LANGS, help="Download one target language (for example, ru)")
    args = parser.parse_args()

    default_source = DEFAULT_FRONTEND_SOURCE if args.target == "frontend" else DEFAULT_BACKEND_SOURCE
    source_path = Path(args.source) if args.source else default_source
    if not source_path.exists():
        print(f"ERROR: source catalog not found: {source_path}")
        raise SystemExit(1)
    source = json.loads(source_path.read_text(encoding="utf-8"))
    if not isinstance(source, dict) or not source:
        print("ERROR: source catalog must be a non-empty JSON object.")
        raise SystemExit(1)
    target_langs = [args.lang] if args.lang else TARGET_LANGS

    if args.target == "frontend":
        output_dir = Path(args.output) if args.output else DEFAULT_FRONTEND_OUTPUT
        output_dir.mkdir(parents=True, exist_ok=True)

        failed = []
        downloaded: dict[str, dict[str, str]] = {}
        for lang in target_langs:
            print(f"Downloading '{lang}' translations...")
            try:
                result = get_strings(lang)
                strings = _extract_strings(result)
                _validate_catalog(lang, source, strings)
                downloaded[lang] = strings
                print(f"  Downloaded {len(strings)} strings")
            except Exception as error:  # noqa: BLE001
                print(f"  Error downloading '{lang}': {type(error).__name__}")
                failed.append(lang)

        if failed:
            print(f"\nFAILED languages: {failed}")
            sys.exit(1)

        for lang, strings in downloaded.items():
            output_file = output_dir / f"{lang}.json"
            output_file.write_text(json.dumps(strings, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"Saved {len(strings)} strings to {output_file}")

    else:  # backend
        output_dir = Path(args.output) if args.output else DEFAULT_BACKEND_OUTPUT
        output_dir.mkdir(parents=True, exist_ok=True)
        failed = []
        downloaded: dict[str, dict[str, str]] = {}

        print(f"Downloading from GP bundle '{GP_BACKEND_BUNDLE}'...")
        for lang in target_langs:
            print(f"Downloading '{lang}' translations...")
            try:
                result = get_backend_strings(lang)
                strings = _extract_strings(result)
                _validate_catalog(lang, source, strings)
                downloaded[lang] = strings
                print(f"  Downloaded {len(strings)} strings")
            except Exception as error:  # noqa: BLE001
                print(f"  Error downloading '{lang}': {type(error).__name__}")
                failed.append(lang)

        if failed:
            print(f"\nFAILED languages: {failed}")
            sys.exit(1)

        for lang, strings in downloaded.items():
            output_file = output_dir / f"{lang}.json"
            output_file.write_text(json.dumps(strings, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"Saved {len(strings)} strings to {output_file}")

    print("\nDone.")


if __name__ == "__main__":
    main()
