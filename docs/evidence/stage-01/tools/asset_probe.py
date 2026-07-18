#!/usr/bin/env python3
"""Emit deterministic static/provenance facts used by Stage 01 asset records."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
ROOT_CHECKOUT = Path("/Volumes/Projects/ketos_canvas_mod_main")
OPENSWARM = Path("/Volumes/Projects/OpenSwarm")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git(*args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(OPENSWARM), *args],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


graph = json.loads((ROOT_CHECKOUT / "graphify-out/graph.json").read_text(encoding="utf-8"))
node_ids = {node["id"] for node in graph["nodes"]}
missing_endpoints = sum(link["source"] not in node_ids or link["target"] not in node_ids for link in graph["links"])
self_loops = sum(link["source"] == link["target"] for link in graph["links"])

frontend_source = REPO / "src/frontend/src"
source_files = [
    path for path in frontend_source.rglob("*") if path.suffix in {".ts", ".tsx", ".js", ".jsx"} and path.is_file()
]
xyflow = re.compile(r"(?:from\s+|require\()[\"']@xyflow/react")
reactflow = re.compile(r"(?:from\s+|require\()[\"']reactflow")

manifest_path = REPO / "src/compat/lfx/src/lfx_compat/module-map-v1.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
payload = {
    "source_baseline_sha": subprocess.run(
        ["git", "-C", str(REPO), "rev-parse", "80878261d07c21ad257de017d98069f211ada2c2"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip(),
    "graphify": {
        "built_at_commit": graph["built_at_commit"],
        "nodes": len(graph["nodes"]),
        "links": len(graph["links"]),
        "missing_link_endpoints": missing_endpoints,
        "self_loops": self_loops,
    },
    "lfx": {
        "source_commit": manifest["source_commit"],
        "source_python_files": manifest["source_python_files"],
        "logical_modules": manifest["logical_modules"],
        "legacy_modules_sha256": manifest["legacy_modules_sha256"],
        "manifest_file_sha256": sha256(manifest_path),
    },
    "frontend_dependencies": {
        "xyflow_import_files": sum(bool(xyflow.search(path.read_text(encoding="utf-8"))) for path in source_files),
        "legacy_reactflow_import_files": sum(
            bool(reactflow.search(path.read_text(encoding="utf-8"))) for path in source_files
        ),
    },
    "openswarm": {
        "commit": git("rev-parse", "HEAD"),
        "tree": git("rev-parse", "HEAD^{tree}"),
        "origin": git("remote", "get-url", "origin"),
        "license_sha256": sha256(OPENSWARM / "LICENSE"),
        "dirty_paths": git("status", "--short").splitlines(),
    },
}
print(json.dumps(payload, indent=2, sort_keys=True))
