#!/usr/bin/env python3
"""Reconcile Stage 01 artifact-index hashes without indexing the index itself."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


BUNDLE = Path(__file__).resolve().parents[1]
INDEX = BUNDLE / "artifact-index.json"


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def record_for(relative: str) -> tuple[str | None, str | None]:
    if relative.startswith("records/") and relative.endswith(".json"):
        return relative, relative
    if relative.startswith("artifacts/") and relative.endswith((".stdout.log", ".stderr.log")):
        record_id = relative.removeprefix("artifacts/").rsplit(".", 2)[0]
        record = f"records/{record_id}.json"
        if (BUNDLE / record).is_file():
            return record, record
    support_record = None
    if relative.startswith(("architecture/", "provenance/")) or relative in {
        "compatibility/desktop-status.json",
        "compatibility/xyflow-dependency.json",
        "tools/asset_probe.py",
    }:
        support_record = "records/asset-baseline-probe.json"
    elif relative == "compatibility/lfx-baseline.json":
        support_record = "records/lfx-compatibility-baseline.json"
    elif relative.startswith(("frontend/", "telemetry/")) or relative == "tests/test_asset_provenance_artifacts.py":
        support_record = "records/asset-provenance-tests.json"
    if support_record and (BUNDLE / support_record).is_file():
        return support_record, support_record
    return None, None


existing_payload = json.loads(INDEX.read_text(encoding="utf-8"))
existing = {entry["relative_path"]: entry for entry in existing_payload["artifacts"]}
entries: list[dict[str, object]] = []
for path in sorted(BUNDLE.rglob("*")):
    if not path.is_file() or path == INDEX or "__pycache__" in path.parts or path.suffix == ".pyc":
        continue
    relative = path.relative_to(BUNDLE).as_posix()
    entry = dict(existing.get(relative, {}))
    record_link, record_path = record_for(relative)
    record = json.loads((BUNDLE / record_path).read_text(encoding="utf-8")) if record_path else None
    if not entry:
        if relative.startswith("backend/"):
            task_id = "S01-T05"
        elif relative.startswith("security/"):
            task_id = "S01-T06-T07"
        elif record:
            task_id = record["task_id"]
        else:
            task_id = "S01-T03"
        entry = {
            "evidence_record_link": record_link,
            "not_applicable_reason": (
                None
                if record_link
                else "not-applicable: bundle source, manifest, test, or human-readable policy artifact"
            ),
            "owner": "stage01-security-implementation",
            "relative_path": relative,
            "reviewer_status": "pending",
            "task_id": task_id,
        }
    entry["sha256"] = digest(path)
    entries.append(entry)

INDEX.write_text(json.dumps({"artifacts": entries}, indent=2, sort_keys=True) + "\n", encoding="utf-8")
print(json.dumps({"indexed_artifacts": len(entries), "index_excludes_itself": True}, sort_keys=True))
