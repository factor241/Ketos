#!/usr/bin/env python3
"""Fail-closed authorization for immutable external Ketos releases.

Local builds never need this gate. External publishing/deployment must execute
this program in GitHub Actions immediately before the mutating command.
"""

from __future__ import annotations

import os
import re
import sys


def reject(reason: str) -> int:
    print(f"external release denied: {reason}", file=sys.stderr)
    return 1


def main() -> int:
    event = os.environ.get("GITHUB_EVENT_NAME", "")
    ref_type = os.environ.get("GITHUB_REF_TYPE", "")
    sha = os.environ.get("GITHUB_SHA", "")
    approved_sha = os.environ.get("KETOS_RELEASE_COMMIT", "")
    authorization = os.environ.get("KETOS_EXTERNAL_RELEASE", "")

    if event != "workflow_dispatch":
        return reject("GITHUB_EVENT_NAME must be workflow_dispatch")
    if ref_type != "tag":
        return reject("GITHUB_REF_TYPE must be tag")
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        return reject("GITHUB_SHA must be a full lowercase commit SHA")
    if approved_sha != sha:
        return reject("KETOS_RELEASE_COMMIT must equal GITHUB_SHA")
    if authorization != f"publish:{sha}":
        return reject("KETOS_EXTERNAL_RELEASE must bind approval to GITHUB_SHA")

    print(f"external release authorized for immutable commit {sha}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
