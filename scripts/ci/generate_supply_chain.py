"""Generate deterministic SPDX SBOM and SLSA provenance for release artifacts.

The producer deliberately accepts an explicit artifact list. It never discovers
inputs from a mutable worktree or an untracked evidence directory.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

PRODUCER_NAME = "ketos-supply-chain-producer"
PRODUCER_VERSION = "2"
SLSA_BUILD_TYPE = "https://git.ketos.test/ketos/ketos/supply-chain/v1"


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True, separators=(",", ": ")) + "\n").encode()


def _json_line_bytes(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _timestamp(epoch: int) -> str:
    return datetime.fromtimestamp(epoch, tz=UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _safe_artifact_path(raw_path: str) -> PurePosixPath:
    path = PurePosixPath(raw_path)
    if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        message = f"artifact path must be a normalized relative POSIX path: {raw_path!r}"
        raise ValueError(message)
    return path


def _artifact_records(root: Path, requested: list[str]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    seen: set[str] = set()
    root = root.resolve(strict=True)
    for raw_path in requested:
        relative = _safe_artifact_path(raw_path)
        normalized = relative.as_posix()
        if normalized in seen:
            message = f"duplicate artifact path: {normalized}"
            raise ValueError(message)
        seen.add(normalized)
        artifact = root.joinpath(*relative.parts).resolve(strict=True)
        if not artifact.is_file() or not artifact.is_relative_to(root):
            message = f"artifact must be a regular file below artifact root: {normalized}"
            raise ValueError(message)
        payload = artifact.read_bytes()
        records.append(
            {
                "kind": _artifact_kind(relative),
                "path": normalized,
                "sha1": hashlib.sha1(payload).hexdigest(),  # noqa: S324 - mandated by SPDX verification code
                "sha256": _sha256(payload),
                "size": len(payload),
            }
        )
    return sorted(records, key=lambda item: item["path"])


def _artifact_kind(path: PurePosixPath) -> str:
    normalized = path.as_posix()
    if "release-archives" in path.parts:
        return "release-archive"
    if normalized.endswith(".whl"):
        return "wheel"
    if normalized.endswith((".tar.gz", ".tar.bz2", ".tar.xz", ".zip")):
        return "sdist"
    return "release-artifact"


def _oci_records(requested: list[str]) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    seen: set[str] = set()
    for subject in requested:
        name, separator, digest = subject.rpartition("@sha256:")
        if not separator or not name or re.fullmatch(r"[0-9a-fA-F]{64}", digest) is None:
            message = f"OCI subject must be NAME@sha256:<64 hexadecimal characters>: {subject!r}"
            raise ValueError(message)
        normalized = f"{name}@sha256:{digest.lower()}"
        if normalized in seen:
            message = f"duplicate OCI subject: {normalized}"
            raise ValueError(message)
        seen.add(normalized)
        records.append({"kind": "oci-image", "name": normalized, "sha256": digest.lower()})
    return sorted(records, key=lambda item: item["name"])


def _subject_records(artifacts: list[dict[str, Any]], oci_subjects: list[dict[str, str]]) -> list[dict[str, Any]]:
    subjects = [{"kind": item["kind"], "name": item["path"], "sha256": item["sha256"]} for item in artifacts]
    subjects.extend(oci_subjects)
    return sorted(subjects, key=lambda item: item["name"])


def _spdx_id(prefix: str, value: str) -> str:
    digest = hashlib.sha256(value.encode()).hexdigest()[:24]
    return f"SPDXRef-{prefix}-{digest}"


def _spdx_package_purpose(kind: str) -> str:
    if kind == "oci-image":
        return "CONTAINER"
    if kind in {"sdist", "release-archive"}:
        return "SOURCE"
    if kind == "wheel":
        return "LIBRARY"
    return "OTHER"


def build_spdx(
    *,
    name: str,
    version: str,
    source_uri: str,
    created: str,
    artifacts: list[dict[str, Any]],
    oci_subjects: list[dict[str, str]],
) -> dict[str, Any]:
    package_id = _spdx_id("Package", f"{name}@{version}")
    subjects = _subject_records(artifacts, oci_subjects)
    namespace_seed = "\n".join(f"{item['name']}:{item['sha256']}" for item in subjects)
    namespace_digest = _sha256(namespace_seed.encode())
    files = [
        {
            "SPDXID": _spdx_id("File", item["path"]),
            "checksums": [
                {"algorithm": "SHA1", "checksumValue": item["sha1"]},
                {"algorithm": "SHA256", "checksumValue": item["sha256"]},
            ],
            "copyrightText": "NOASSERTION",
            "fileName": item["path"],
        }
        for item in artifacts
    ]
    component_packages = [
        {
            "SPDXID": _spdx_id("Component", item["name"]),
            "checksums": [{"algorithm": "SHA256", "checksumValue": item["sha256"]}],
            "comment": f"Ketos release component type: {item['kind']}",
            "copyrightText": "NOASSERTION",
            "downloadLocation": "NOASSERTION",
            "filesAnalyzed": False,
            "name": item["name"],
            "primaryPackagePurpose": _spdx_package_purpose(item["kind"]),
            "supplier": "Organization: Ketos Contributors",
            "versionInfo": version,
        }
        for item in subjects
    ]
    component_ids = {item["name"]: item["SPDXID"] for item in component_packages}
    file_ids = {item["fileName"]: item["SPDXID"] for item in files}
    relationships = [
        {
            "relatedSpdxElement": package_id,
            "relationshipType": "DESCRIBES",
            "spdxElementId": "SPDXRef-DOCUMENT",
        },
        *[
            {
                "relatedSpdxElement": component_ids[item["name"]],
                "relationshipType": "CONTAINS",
                "spdxElementId": package_id,
            }
            for item in subjects
        ],
        *[
            {
                "relatedSpdxElement": file_ids[item["path"]],
                "relationshipType": "CONTAINS",
                "spdxElementId": component_ids[item["path"]],
            }
            for item in artifacts
        ],
    ]
    verification_code = hashlib.sha1(  # noqa: S324 - SPDX 2.3 mandates SHA-1 here
        "".join(sorted(item["sha1"] for item in artifacts)).encode()
    ).hexdigest()
    return {
        "SPDXID": "SPDXRef-DOCUMENT",
        "creationInfo": {
            "created": created,
            "creators": [f"Tool: {PRODUCER_NAME}/{PRODUCER_VERSION}"],
        },
        "dataLicense": "CC0-1.0",
        "documentDescribes": [package_id],
        "documentNamespace": f"{source_uri.rstrip('/')}/sbom/{name}/{version}/{namespace_digest}",
        "files": files,
        "name": f"{name}-{version}-release-sbom",
        "packages": [
            {
                "SPDXID": package_id,
                "copyrightText": "NOASSERTION",
                "downloadLocation": "NOASSERTION",
                "filesAnalyzed": True,
                "name": name,
                "packageVerificationCode": {"packageVerificationCodeValue": verification_code},
                "supplier": "Organization: Ketos Contributors",
                "versionInfo": version,
            },
            *component_packages,
        ],
        "relationships": relationships,
        "spdxVersion": "SPDX-2.3",
    }


def build_provenance(
    *,
    name: str,
    version: str,
    source_uri: str,
    commit_sha: str,
    created: str,
    source_date_epoch: int,
    artifacts: list[dict[str, Any]],
    oci_subjects: list[dict[str, str]],
) -> dict[str, Any]:
    subjects = [
        {"digest": {"sha256": item["sha256"]}, "name": item["name"]}
        for item in _subject_records(artifacts, oci_subjects)
    ]
    invocation_seed = _json_bytes({"commit": commit_sha, "subject": subjects})
    git_uri = source_uri if source_uri.startswith("git+") else f"git+{source_uri}"
    return {
        "_type": "https://in-toto.io/Statement/v1",
        "predicate": {
            "buildDefinition": {
                "buildType": SLSA_BUILD_TYPE,
                "externalParameters": {
                    "name": name,
                    "source_date_epoch": source_date_epoch,
                    "version": version,
                },
                "internalParameters": {},
                "resolvedDependencies": [{"digest": {"gitCommit": commit_sha}, "uri": git_uri}],
            },
            "runDetails": {
                "builder": {"id": f"{source_uri.rstrip('/')}/builders/{PRODUCER_NAME}/v{PRODUCER_VERSION}"},
                "byproducts": [],
                "metadata": {
                    "finishedOn": created,
                    "invocationId": f"urn:sha256:{_sha256(invocation_seed)}",
                    "startedOn": created,
                },
            },
        },
        "predicateType": "https://slsa.dev/provenance/v1",
        "subject": subjects,
    }


def produce(args: argparse.Namespace) -> None:
    if not re.fullmatch(r"[A-Za-z0-9._-]+", args.name):
        message = "name may contain only letters, numbers, dot, underscore, and hyphen"
        raise ValueError(message)
    if not re.fullmatch(r"[0-9a-fA-F]{40}|[0-9a-fA-F]{64}", args.commit_sha):
        message = "commit SHA must be 40 or 64 hexadecimal characters"
        raise ValueError(message)
    artifacts = _artifact_records(args.artifact_root, args.artifact)
    oci_subjects = _oci_records(args.oci_subject)
    created = _timestamp(args.source_date_epoch)
    output_dir = args.output_dir.resolve()
    if ".artifacts" in output_dir.parts:
        message = "supply-chain outputs must not be written below .artifacts"
        raise ValueError(message)
    output_dir.mkdir(parents=True, exist_ok=True)

    sbom_name = f"{args.name}.spdx.json"
    provenance_name = f"{args.name}.intoto.jsonl"
    manifest_name = f"{args.name}.supply-chain-manifest.json"
    sbom_bytes = _json_bytes(
        build_spdx(
            name=args.name,
            version=args.version,
            source_uri=args.source_uri,
            created=created,
            artifacts=artifacts,
            oci_subjects=oci_subjects,
        )
    )
    provenance_bytes = _json_line_bytes(
        build_provenance(
            name=args.name,
            version=args.version,
            source_uri=args.source_uri,
            commit_sha=args.commit_sha.lower(),
            created=created,
            source_date_epoch=args.source_date_epoch,
            artifacts=artifacts,
            oci_subjects=oci_subjects,
        )
    )
    manifest_bytes = _json_bytes(
        {
            "artifacts": artifacts,
            "oci_subjects": oci_subjects,
            "documents": [
                {"path": sbom_name, "sha256": _sha256(sbom_bytes), "type": "spdx-2.3"},
                {"path": provenance_name, "sha256": _sha256(provenance_bytes), "type": "slsa-provenance-v1"},
            ],
            "producer": {"name": PRODUCER_NAME, "version": PRODUCER_VERSION},
            "schema_version": 2,
            "source": {"commit_sha": args.commit_sha.lower(), "uri": args.source_uri},
            "source_date_epoch": args.source_date_epoch,
        }
    )
    for filename, payload in (
        (sbom_name, sbom_bytes),
        (provenance_name, provenance_bytes),
        (manifest_name, manifest_bytes),
    ):
        (output_dir / filename).write_bytes(payload)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact-root", type=Path, required=True)
    parser.add_argument("--artifact", action="append", required=True, help="relative path below artifact root")
    parser.add_argument(
        "--oci-subject",
        action="append",
        default=[],
        help="immutable OCI subject in NAME@sha256:<digest> form",
    )
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--source-uri", required=True)
    parser.add_argument("--commit-sha", required=True)
    parser.add_argument("--source-date-epoch", type=int, required=True)
    parser.add_argument("--name", default="ketos")
    parser.add_argument("--version", required=True)
    return parser.parse_args()


if __name__ == "__main__":
    produce(parse_args())
