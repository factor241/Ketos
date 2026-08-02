"""Validate and collect immutable OCI subjects emitted by release image builds."""

# ruff: noqa: EM101, EM102, TRY003

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

ARCHITECTURES = {"amd64", "arm64"}
IMAGE_NAMES = {
    "base": "registry.invalid/ketos/ketos",
    "main": "registry.invalid/ketos/ketos",
    "main-backend": "registry.invalid/ketos/ketos-backend",
    "main-frontend": "registry.invalid/ketos/ketos-frontend",
    "main-ep": "registry.invalid/ketos/ketos-ep",
    "main-all": "registry.invalid/ketos/ketos-all",
}
SUBJECT_PATTERN = re.compile(r"^(?P<name>[^@\s]+)@sha256:(?P<digest>[0-9a-f]{64})$")


class SubjectError(ValueError):
    """Raised when Docker build evidence does not match the selected release images."""


def _object(value: Any, path: Path) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SubjectError(f"{path}: record must be a JSON object")
    return value


def collect(input_dir: Path, expected_release_types: list[str]) -> list[str]:
    if len(expected_release_types) != len(set(expected_release_types)):
        raise SubjectError("expected release types must be unique")
    unknown = set(expected_release_types) - set(IMAGE_NAMES)
    if unknown:
        raise SubjectError(f"unknown expected release types: {sorted(unknown)}")

    expected_files = {
        f"oci-subject-{release_type}-{arch}.json": (release_type, arch)
        for release_type in expected_release_types
        for arch in ARCHITECTURES
    }
    actual_files = {path.name: path for path in input_dir.glob("oci-subject-*.json") if path.is_file()}
    if set(actual_files) != set(expected_files):
        missing = sorted(set(expected_files) - set(actual_files))
        extra = sorted(set(actual_files) - set(expected_files))
        raise SubjectError(f"OCI subject record set mismatch; missing={missing}; extra={extra}")

    subjects: list[str] = []
    for filename in sorted(expected_files):
        release_type, arch = expected_files[filename]
        path = actual_files[filename]
        try:
            payload = _object(json.loads(path.read_text(encoding="utf-8")), path)
        except json.JSONDecodeError as exc:
            raise SubjectError(f"{path}: invalid JSON: {exc}") from exc
        if set(payload) != {"arch", "release_type", "subject"}:
            raise SubjectError(f"{path}: record keys must be exactly arch, release_type, subject")
        if payload["arch"] != arch or payload["release_type"] != release_type:
            raise SubjectError(f"{path}: record identity does not match its artifact filename")
        subject = payload["subject"]
        match = SUBJECT_PATTERN.fullmatch(subject) if isinstance(subject, str) else None
        if match is None:
            raise SubjectError(f"{path}: subject must be NAME@sha256:<64 lowercase hex characters>")
        if match.group("name") != IMAGE_NAMES[release_type]:
            raise SubjectError(
                f"{path}: subject image {match.group('name')!r} does not match {IMAGE_NAMES[release_type]!r}"
            )
        subjects.append(subject)
    return sorted(subjects)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", required=True, type=Path)
    parser.add_argument("--expected-release-type", action="append", default=[])
    args = parser.parse_args()
    try:
        for subject in collect(args.input_dir, args.expected_release_type):
            print(subject)
    except (OSError, SubjectError) as exc:
        print(f"OCI SUBJECT COLLECTION FAIL: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
