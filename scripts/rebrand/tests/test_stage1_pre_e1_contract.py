from __future__ import annotations

# ruff: noqa: S101, S603, S607 - assertions and fixed local Git commands define the Stage 1 inventory contract.
import base64
import hashlib
import subprocess
from pathlib import Path

import yaml
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
ASSET_MANIFEST = ROOT / "brand/assets/manifest.yaml"
BRAND_CONTRACT = ROOT / "brand/ketos-brand-contract.yaml"
CONSUMER_MAP = ROOT / "brand/stage1/asset-consumer-map.yaml"
OCR_LEDGER = ROOT / "brand/stage1/docs-media-ocr-ledger.yaml"
E1_PACKET = ROOT / "brand/stage1/e1-visual-rights-decision-packet.yaml"

HISTORICAL_DOCS_COMMIT = "f08e7907a343a38a43fa99f48146dec6fe704d09"
HISTORICAL_MEDIA_EXTENSIONS = {".gif", ".ico", ".png", ".svg"}
HISTORICAL_PATHS_SHA256 = "e3e3bbb98fb91bad3e63be7179f7b18f4525168d7ec86996a96e2894c75a09a0"
EXPECTED_HISTORICAL_MEDIA_COUNT = 106


def load_yaml(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def historical_docs_media() -> list[str]:
    output = subprocess.run(
        ["git", "ls-tree", "-r", "--name-only", HISTORICAL_DOCS_COMMIT, "--", "docs"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return sorted(path for path in output.splitlines() if Path(path).suffix.lower() in HISTORICAL_MEDIA_EXTENSIONS)


def ledger_path(row: dict) -> str:
    if "path" in row:
        assert "path_base64" not in row
        return row["path"]
    assert set(row) >= {"path_base64", "path_encoding"}
    assert row["path_encoding"] == "utf-8-base64"
    return base64.b64decode(row["path_base64"], validate=True).decode("utf-8")


def newline_digest(paths: list[str]) -> str:
    payload = "".join(f"{path}\n" for path in paths).encode()
    return hashlib.sha256(payload).hexdigest()


def test_stage1_consumer_inventory_is_complete_deterministic_and_non_mutating() -> None:
    manifest = load_yaml(ASSET_MANIFEST)
    inventory = load_yaml(CONSUMER_MAP)
    manifest_outputs = sorted(f"brand/assets/{row['path']}" for row in manifest["outputs"])

    assert inventory["schema_version"] == 1
    assert inventory["mode"] == "pre-e1-inventory-only"
    assert inventory["consumer_switch_allowed"] is False
    assert inventory["asset_manifest_sha256"] == hashlib.sha256(ASSET_MANIFEST.read_bytes()).hexdigest()
    assert inventory["manifest_outputs"] == manifest_outputs

    copy_edges = inventory["copy_edges"]
    assert copy_edges == sorted(copy_edges, key=lambda row: (row["canonical_path"], row["consumer_path"]))
    consumed = {row["canonical_path"] for row in copy_edges}
    unused = inventory["unused_outputs"]
    assert unused == sorted(unused)
    assert not consumed.intersection(unused)
    assert consumed.union(unused) == set(manifest_outputs)

    for edge in copy_edges:
        canonical = ROOT / edge["canonical_path"]
        consumer = ROOT / edge["consumer_path"]
        assert edge["status"] == "CURRENT_BYTE_IDENTICAL_COPY"
        assert canonical.is_file()
        assert consumer.is_file()
        assert canonical.read_bytes() == consumer.read_bytes()

    runtime_edges = inventory["runtime_edges"]
    assert runtime_edges == sorted(runtime_edges, key=lambda row: (row["consumer_path"], row["locator"]))
    assert {row["consumer_path"] for row in runtime_edges} <= {row["consumer_path"] for row in copy_edges}
    for edge in runtime_edges:
        locator_path, marker = edge["locator"].split(":", 1)
        assert marker in (ROOT / locator_path).read_text(encoding="utf-8")

    assert inventory["unused_proof"] == {
        "method": "tracked-runtime-literal-search",
        "status": "PASS",
        "scope": ["docs", "src/frontend"],
        "excludes": ["tests", "stories", "binary-assets"],
    }
    tracked_runtime = subprocess.run(
        ["git", "ls-files", "-z", "docs", "src/frontend"],
        cwd=ROOT,
        check=True,
        capture_output=True,
    ).stdout.split(b"\0")
    searchable = []
    for raw_path in tracked_runtime:
        if not raw_path:
            continue
        path = raw_path.decode()
        if any(part in path for part in ("/tests/", "/__tests__/", ".test.", ".spec.", ".stories.")):
            continue
        absolute = ROOT / path
        if absolute.suffix.lower() in {".gif", ".ico", ".jpeg", ".jpg", ".png", ".svg", ".webp"}:
            continue
        searchable.append(absolute.read_bytes())
    for output in unused:
        basename = Path(output).name.encode()
        assert not any(basename in content for content in searchable), output
    assert inventory["verdicts"] == {
        "inventory": "PASS",
        "e1": "BLOCKED",
        "asset_matrix": "RED",
        "ocr_acceptance": "PENDING",
        "stage1": "BLOCKED",
    }


def test_historical_docs_media_ledger_is_exactly_106_pending_rows() -> None:
    ledger = load_yaml(OCR_LEDGER)
    expected = historical_docs_media()
    recorded = [ledger_path(row) for row in ledger["items"]]

    assert len(expected) == EXPECTED_HISTORICAL_MEDIA_COUNT
    assert newline_digest(expected) == HISTORICAL_PATHS_SHA256
    assert ledger["source_commit"] == HISTORICAL_DOCS_COMMIT
    assert ledger["selection"] == {
        "root": "docs",
        "extensions": sorted(HISTORICAL_MEDIA_EXTENSIONS),
        "order": "git-path-bytewise",
    }
    assert ledger["path_list_sha256"] == HISTORICAL_PATHS_SHA256
    assert recorded == expected
    assert len(recorded) == len(set(recorded)) == EXPECTED_HISTORICAL_MEDIA_COUNT
    assert all(row["status"] == "PENDING" for row in ledger["items"])
    assert all(
        row[field] == "PENDING" for row in ledger["items"] for field in ("disposition", "light", "dark", "retina")
    )
    assert all(row["reviewer"] is None and row["reviewed_at"] is None for row in ledger["items"])
    tree = subprocess.run(
        ["git", "ls-tree", "-r", HISTORICAL_DOCS_COMMIT, "--", "docs"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    expected_oids = {line.split("\t", 1)[1]: line.split()[2] for line in tree.splitlines()}
    assert all(
        row["historical_blob_oid"] == expected_oids[path] for row, path in zip(ledger["items"], recorded, strict=True)
    )
    assert ledger["verdicts"] == {
        "inventory": "PASS",
        "ocr": "PENDING",
        "independent_review": "PENDING",
        "acceptance": "BLOCKED",
    }


def test_stage1_readiness_remains_red_and_blocked_until_e1_and_matrix_completion() -> None:
    brand = load_yaml(BRAND_CONTRACT)
    manifest_paths = {row["path"] for row in load_yaml(ASSET_MANIFEST)["outputs"]}
    inventory = load_yaml(CONSUMER_MAP)

    assert brand["logo_rights_approved_by"] is None
    assert brand["logo_rights_approved_date"] is None
    assert brand["trademark_owner"] is None
    assert brand["wordmark_font_license"] is None
    assert inventory["blockers"] == [
        "E1_VISUAL_RIGHTS_APPROVAL_MISSING",
        "UI_18_PX_MISSING",
        "UI_22_PX_MISSING",
        "FAVICON_24_PX_FRAME_MISSING",
        "MCP_704X396_MISSING",
        "MCP_1408X792_MISSING",
        "SOCIAL_PREVIEW_1200X628_MISSING",
        "OCR_106_OF_106_PENDING",
    ]
    assert {
        "generated/ui/ketos-ui-18.png",
        "generated/ui/ketos-ui-22.png",
        "generated/mcp/ketos-mcp-704x396.png",
        "generated/mcp/ketos-mcp-1408x792.png",
        "generated/social/ketos-preview-1200x628.png",
    }.isdisjoint(manifest_paths)
    with Image.open(ROOT / "brand/assets/generated/favicon/ketos-favicon.ico") as image:
        assert (24, 24) not in image.ico.sizes()


def test_e1_packet_is_explicitly_blocked_and_contains_no_invented_identity() -> None:
    packet = load_yaml(E1_PACKET)

    assert packet["schema_version"] == 1
    assert packet["gate"] == "E1"
    assert packet["status"] == "BLOCKED"
    assert packet["exact_decision"] is None
    assert packet["owner"] is None
    assert packet["approver"] is None
    assert packet["approved_at"] is None
    assert packet["effective_sha"] is None
    assert set(packet["evidence"].values()) == {None}
    assert packet["release_effect"] == "asset_consumers_must_not_switch"
