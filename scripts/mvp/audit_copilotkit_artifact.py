#!/usr/bin/env python3
"""Fail-closed audit for the exact Stage 01 CopilotKit package artifact.

The tarball is untrusted input.  This probe never extracts it: it validates a
small publish-path allowlist, resource ceilings, package identity, integrity,
license bytes, and the installed declaration contract in place.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import json
import os
import posixpath
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any, NoReturn

EXPECTED_FILENAME = "copilotkit-react-core-1.63.1-ketos.1.tgz"
EXPECTED_PACKAGE = "@copilotkit/react-core"
EXPECTED_VERSION = "1.63.1-ketos.1"
EXPECTED_LICENSE = "MIT"
DEFAULT_MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
DEFAULT_MAX_MEMBERS = 5_000
DEFAULT_MAX_MEMBER_BYTES = 32 * 1024 * 1024
DEFAULT_MAX_UNCOMPRESSED_BYTES = 128 * 1024 * 1024
JSON_MAX_BYTES = 1024 * 1024
DECLARATION_MAX_BYTES = 8 * 1024 * 1024
PUBLISH_PATH_MIN_PARTS = 3
ROOT_FILES = frozenset(
    {
        "package/LICENSE",
        "package/README.md",
        "package/package.json",
    }
)


class AuditError(ValueError):
    """The candidate artifact does not satisfy the Stage 01 contract."""


def _fail(message: str) -> NoReturn:
    raise AuditError(message)


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _expected_hex_digest(value: str, description: str) -> str:
    if re.fullmatch(r"[0-9a-f]{64}", value) is None:
        _fail(f"{description} must be an exact lowercase SHA-256")
    return value


def _expected_sha512_integrity(value: str) -> str:
    if not value.startswith("sha512-"):
        _fail("npm integrity must use sha512")
    try:
        decoded = base64.b64decode(value.removeprefix("sha512-"), validate=True)
    except (binascii.Error, ValueError):
        _fail("npm integrity is not valid base64")
    if len(decoded) != hashlib.sha512().digest_size:
        _fail("npm integrity must contain one complete SHA-512 digest")
    return value


def _strict_json(content: bytes, description: str) -> dict[str, Any]:
    if len(content) > JSON_MAX_BYTES:
        _fail(f"{description} exceeds JSON resource limit")

    def object_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                _fail(f"{description} contains duplicate key {key!r}")
            result[key] = value
        return result

    try:
        value = json.loads(content, object_pairs_hook=object_pairs)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        _fail(f"{description} is not valid JSON: {exc}")
    if not isinstance(value, dict):
        _fail(f"{description} must contain a JSON object")
    return value


def _normalized_member_path(raw: str) -> PurePosixPath:
    if not raw or "\\" in raw:
        _fail(f"archive member path is not normalized: {raw!r}")
    path = PurePosixPath(raw)
    if path.is_absolute() or raw != path.as_posix() or any(part in {"", ".", ".."} for part in path.parts):
        _fail(f"archive member path is not normalized: {raw!r}")
    return path


def _allowed_member(path: PurePosixPath) -> bool:
    raw = path.as_posix()
    if raw in ROOT_FILES:
        return True
    return raw.startswith(("package/dist/", "package/skills/")) and len(path.parts) >= PUBLISH_PATH_MIN_PARTS


def _read_member(
    archive: tarfile.TarFile,
    members: dict[str, tarfile.TarInfo],
    name: str,
    *,
    limit: int,
) -> bytes:
    member = members.get(name)
    if member is None:
        _fail(f"required archive member is missing: {name}")
    if member.size > limit:
        _fail(f"required archive member exceeds read limit: {name}")
    stream = archive.extractfile(member)
    if stream is None:
        _fail(f"required archive member is unreadable: {name}")
    content = stream.read(limit + 1)
    if len(content) != member.size or len(content) > limit:
        _fail(f"required archive member has an invalid size: {name}")
    return content


def _declaration_has_contract(content: bytes) -> bool:
    if len(content) > DECLARATION_MAX_BYTES:
        return False
    try:
        source = content.decode("utf-8")
    except UnicodeDecodeError:
        return False
    source = re.sub(
        r"/\*.*?\*/|//[^\r\n]*|\"(?:\\.|[^\"\\])*\"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`",
        " ",
        source,
        flags=re.DOTALL,
    )
    compact = re.sub(r"\s+", "", source)
    exact_payload = (
        "typeExactInterruptPayload<TResult,TPayloadextendsTResult>="
        "TResultextendsunknown?TPayloadextendsTResult?"
        "TPayload&Record<Exclude<keyofTPayload,keyofTResult>,never>:never:never;"
    )
    typed_resolver = (
        "typeTypedInterruptResolveFn<TResult>=<TPayloadextendsTResult>("
        "payload:ExactInterruptPayload<TResult,TPayload>,interruptId?:string)"
        "=>Promise<RunAgentResult|void>;"
    )
    public_resolver = (
        "typeInterruptResolveFn<TResult=unknown>=unknownextendsTResult?"
        "(payload?:TResult,interruptId?:string)=>Promise<RunAgentResult|void>:"
        "TypedInterruptResolveFn<TResult>;"
    )
    exported = "exporttypeInterruptResolveFn" in compact or ("export{" in compact and "InterruptResolveFn" in compact)
    return all(fragment in compact for fragment in (exact_payload, typed_resolver, public_resolver)) and exported


def _module_specifiers(source: str) -> tuple[str, ...]:
    """Return import/from string literals while ignoring comments and strings."""
    references: list[str] = []
    index = 0
    length = len(source)
    while index < length:
        if source.startswith("//", index):
            newline = source.find("\n", index + 2)
            index = length if newline < 0 else newline + 1
            continue
        if source.startswith("/*", index):
            closing = source.find("*/", index + 2)
            index = length if closing < 0 else closing + 2
            continue
        character = source[index]
        if character in {'"', "'", "`"}:
            quote = character
            index += 1
            while index < length:
                if source[index] == "\\":
                    index += 2
                elif source[index] == quote:
                    index += 1
                    break
                else:
                    index += 1
            continue
        if character.isalpha() or character in {"_", "$"}:
            end = index + 1
            while end < length and (source[end].isalnum() or source[end] in {"_", "$"}):
                end += 1
            keyword = source[index:end]
            index = end
            if keyword not in {"from", "import"}:
                continue
            cursor = index
            while cursor < length and source[cursor].isspace():
                cursor += 1
            if keyword == "import" and cursor < length and source[cursor] == "(":
                cursor += 1
                while cursor < length and source[cursor].isspace():
                    cursor += 1
            if cursor >= length or source[cursor] not in {'"', "'"}:
                continue
            quote = source[cursor]
            cursor += 1
            start = cursor
            while cursor < length and source[cursor] != quote:
                if source[cursor] == "\\":
                    cursor += 2
                else:
                    cursor += 1
            if cursor < length:
                references.append(source[start:cursor])
                index = cursor + 1
            continue
        index += 1
    return tuple(references)


def _declaration_references(name: str, content: bytes) -> tuple[str, ...]:
    try:
        source = content.decode("utf-8")
    except UnicodeDecodeError:
        return ()
    parent = PurePosixPath(name).parent
    resolved: list[str] = []
    for reference in _module_specifiers(source):
        if not reference.startswith(("./", "../")):
            continue
        relative = posixpath.normpath(f"{parent.as_posix()}/{reference}")
        if not relative.startswith("package/dist/"):
            continue
        if relative.endswith(".cjs"):
            resolved.append(relative.removesuffix(".cjs") + ".d.cts")
        elif relative.endswith(".mjs"):
            resolved.append(relative.removesuffix(".mjs") + ".d.mts")
        elif relative.endswith(".js"):
            resolved.append(relative.removesuffix(".js") + ".d.ts")
        else:
            resolved.extend((relative + ".d.cts", relative + ".d.mts", relative + ".d.ts"))
    return tuple(resolved)


def _reachable_declarations(entry: str, declarations: dict[str, bytes]) -> tuple[bytes, ...]:
    pending = [entry]
    visited: set[str] = set()
    reachable: list[bytes] = []
    while pending:
        name = pending.pop()
        if name in visited:
            continue
        visited.add(name)
        content = declarations.get(name)
        if content is None:
            continue
        reachable.append(content)
        pending.extend(_declaration_references(name, content))
    return tuple(reachable)


def _runtime_inventory(package_root: Path) -> dict[str, str]:
    inventory: dict[str, str] = {}
    resolved_root = package_root.resolve(strict=True)
    for directory, directory_names, file_names in os.walk(resolved_root, followlinks=False):
        directory_names[:] = [name for name in directory_names if name != "node_modules"]
        for name in directory_names:
            if Path(directory, name).is_symlink():
                _fail("runtime package contents contain a symlink")
        for name in file_names:
            path = Path(directory, name)
            if path.is_symlink() or not path.is_file():
                _fail("runtime package contents must be regular files")
            relative = path.relative_to(resolved_root).as_posix()
            inventory[f"package/{relative}"] = _sha256(path.read_bytes())
    return inventory


def _typescript_contract_source() -> str:
    return """\
import type { InterruptResolveFn } from "@copilotkit/react-core/v2";
type ApprovalDecision = Readonly<{ approved: boolean }>;
declare const resolve: InterruptResolveFn<ApprovalDecision>;
resolve({ approved: true }, "approve");
resolve({ approved: false }, "reject");
// @ts-expect-error typed payload is mandatory
resolve();
// @ts-expect-error approved must be boolean
resolve({ approved: "yes" }, "wrong");
// @ts-expect-error fresh literals cannot contain extra fields
resolve({ approved: true, extra: true }, "extra-literal");
const extraVariable = { approved: true, extra: true } as const;
// @ts-expect-error variables cannot contain extra fields
resolve(extraVariable, "extra-variable");
"""


def _run_typescript_contract(runtime_root: Path) -> None:
    node = shutil.which("node")
    compiler = runtime_root / "node_modules/typescript/bin/tsc"
    if node is None or not compiler.is_file():
        _fail("runtime TypeScript compiler is unavailable for executable type-test")
    with tempfile.TemporaryDirectory(prefix=".ketos-copilotkit-type-audit-", dir=runtime_root) as directory:
        project = Path(directory)
        for filename in ("contract.mts", "contract.cts"):
            (project / filename).write_text(_typescript_contract_source(), encoding="utf-8")
        (project / "tsconfig.json").write_text(
            json.dumps(
                {
                    "compilerOptions": {
                        "module": "NodeNext",
                        "moduleResolution": "NodeNext",
                        "noEmit": True,
                        "skipLibCheck": True,
                        "strict": True,
                        "target": "ES2022",
                    },
                    "files": ["contract.mts", "contract.cts"],
                }
            ),
            encoding="utf-8",
        )
        try:
            result = subprocess.run(  # noqa: S603 - exact local node and pinned compiler paths
                [node, str(compiler), "--project", str(project / "tsconfig.json"), "--pretty", "false"],
                cwd=project,
                capture_output=True,
                check=False,
                timeout=30,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            _fail(f"runtime TypeScript contract check could not complete: {exc}")
        output = (result.stdout + result.stderr)[: 1024 * 1024].decode("utf-8", errors="replace")
        if result.returncode != 0:
            _fail(f"runtime TypeScript positive/negative contract failed: {output}")


def _runtime_evidence(
    runtime_root: Path | None,
    expected_inventory: dict[str, str],
) -> dict[str, object]:
    if runtime_root is None:
        return {"checked": False, "copy_count": None, "version": None}
    root = runtime_root.resolve(strict=True)
    copies: list[Path] = []
    for directory, directory_names, _file_names in os.walk(root, followlinks=False):
        candidate = Path(directory) / "node_modules/@copilotkit/react-core/package.json"
        if candidate.exists():
            copies.append(candidate)
        directory_names[:] = [name for name in directory_names if not Path(directory, name).is_symlink()]
    if len(copies) != 1:
        _fail(f"expected exactly one runtime copy of {EXPECTED_PACKAGE}, found {len(copies)}")
    package_path = copies[0]
    mode = package_path.lstat().st_mode
    if not stat.S_ISREG(mode) or package_path.is_symlink():
        _fail("runtime package.json must be a regular file")
    manifest = _strict_json(package_path.read_bytes(), "runtime package.json")
    if manifest.get("name") != EXPECTED_PACKAGE:
        _fail("runtime package name does not match the admitted artifact")
    if manifest.get("version") != EXPECTED_VERSION:
        _fail("runtime package version does not match the admitted artifact")
    package_root = package_path.parent
    if _runtime_inventory(package_root) != expected_inventory:
        _fail("runtime package contents do not match the admitted artifact inventory")
    _run_typescript_contract(root)
    return {"checked": True, "copy_count": 1, "version": EXPECTED_VERSION}


def audit_artifact(
    artifact_path: Path,
    *,
    expected_sha256: str,
    expected_integrity: str,
    expected_license_sha256: str,
    runtime_root: Path | None = None,
    max_archive_bytes: int = DEFAULT_MAX_ARCHIVE_BYTES,
    max_members: int = DEFAULT_MAX_MEMBERS,
    max_member_bytes: int = DEFAULT_MAX_MEMBER_BYTES,
    max_uncompressed_bytes: int = DEFAULT_MAX_UNCOMPRESSED_BYTES,
) -> dict[str, object]:
    """Audit one immutable tarball and return machine-readable evidence."""
    path = Path(artifact_path)
    if path.name != EXPECTED_FILENAME:
        _fail(f"artifact filename must be exactly {EXPECTED_FILENAME}")
    try:
        mode = path.lstat().st_mode
    except OSError as exc:
        _fail(f"artifact is unavailable: {exc}")
    if not stat.S_ISREG(mode) or path.is_symlink():
        _fail("artifact must be a regular file")
    if path.stat().st_size > max_archive_bytes:
        _fail("artifact exceeds compressed resource limit")
    content = path.read_bytes()
    expected_sha256 = _expected_hex_digest(expected_sha256, "artifact SHA-256")
    expected_license_sha256 = _expected_hex_digest(expected_license_sha256, "license SHA-256")
    expected_integrity = _expected_sha512_integrity(expected_integrity)
    actual_sha256 = _sha256(content)
    actual_integrity = "sha512-" + base64.b64encode(hashlib.sha512(content).digest()).decode("ascii")
    if actual_sha256 != expected_sha256:
        _fail("artifact SHA-256 does not match")
    if actual_integrity != expected_integrity:
        _fail("npm integrity does not match artifact SHA-512")

    try:
        with tarfile.open(path, mode="r:gz") as archive:
            members: dict[str, tarfile.TarInfo] = {}
            uncompressed_bytes = 0
            for member in archive:
                if len(members) >= max_members:
                    _fail("archive member count exceeds resource limit")
                normalized = _normalized_member_path(member.name)
                if member.name in members:
                    _fail(f"duplicate archive member: {member.name}")
                if not member.isreg():
                    _fail(f"archive member must be a regular file: {member.name}")
                if not _allowed_member(normalized):
                    _fail(f"archive member is outside publish allowlist: {member.name}")
                if member.size < 0 or member.size > max_member_bytes:
                    _fail(f"archive member exceeds resource limit: {member.name}")
                uncompressed_bytes += member.size
                if uncompressed_bytes > max_uncompressed_bytes:
                    _fail("archive uncompressed size exceeds resource limit")
                members[member.name] = member

            archive_inventory = {
                name: _sha256(_read_member(archive, members, name, limit=max_member_bytes)) for name in members
            }

            package = _strict_json(
                _read_member(archive, members, "package/package.json", limit=JSON_MAX_BYTES),
                "package.json",
            )
            license_content = _read_member(archive, members, "package/LICENSE", limit=max_member_bytes)
            declarations: dict[str, bytes] = {}
            for name, member in members.items():
                is_declaration = name.endswith((".d.cts", ".d.mts", ".d.ts"))
                if not is_declaration or member.size > DECLARATION_MAX_BYTES:
                    continue
                declarations[name] = _read_member(archive, members, name, limit=DECLARATION_MAX_BYTES)
    except (tarfile.TarError, OSError, EOFError) as exc:
        _fail(f"artifact is not a valid bounded tgz: {exc}")

    if package.get("name") != EXPECTED_PACKAGE:
        _fail("package name does not match @copilotkit/react-core")
    if package.get("version") != EXPECTED_VERSION:
        _fail("package version does not match the pinned fork version")
    if package.get("license") != EXPECTED_LICENSE:
        _fail("package license must be MIT")
    exports = package.get("exports")
    v2_export = exports.get("./v2") if isinstance(exports, dict) else None
    if v2_export != {
        "import": "./dist/v2/index.mjs",
        "require": "./dist/v2/index.cjs",
    }:
        _fail("package v2 export must resolve only to the audited public entrypoints")
    if _sha256(license_content) != expected_license_sha256:
        _fail("license SHA-256 does not match")
    types_entry = package.get("types")
    if not isinstance(types_entry, str) or not types_entry.startswith("./dist/"):
        _fail("package types entry must be a relative dist declaration")
    cts_entry = "package/dist/v2/index.d.cts"
    mts_entry = "package/dist/v2/index.d.mts"
    declaration_contracts = {
        "cts": any(_declaration_has_contract(content) for content in _reachable_declarations(cts_entry, declarations)),
        "mts": any(_declaration_has_contract(content) for content in _reachable_declarations(mts_entry, declarations)),
    }
    if not all(declaration_contracts.values()):
        _fail("typed InterruptResolveFn contract is missing or widened")

    return {
        "admitted": True,
        "artifact": {
            "filename": path.name,
            "sha256": actual_sha256,
            "integrity": actual_integrity,
            "license_sha256": _sha256(license_content),
        },
        "package": {
            "name": package["name"],
            "version": package["version"],
            "license": package["license"],
        },
        "archive": {
            "member_count": len(members),
            "uncompressed_bytes": uncompressed_bytes,
            "all_members_regular": True,
            "allowlist": True,
        },
        "contracts": {
            "typed_interrupt_resolver": True,
            "commonjs_declaration": declaration_contracts["cts"],
            "module_declaration": declaration_contracts["mts"],
        },
        "runtime": _runtime_evidence(runtime_root, archive_inventory),
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact", type=Path)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--integrity", required=True)
    parser.add_argument("--license-sha256", required=True)
    parser.add_argument("--runtime-root", type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    try:
        evidence = audit_artifact(
            arguments.artifact,
            expected_sha256=arguments.sha256,
            expected_integrity=arguments.integrity,
            expected_license_sha256=arguments.license_sha256,
            runtime_root=arguments.runtime_root,
        )
    except AuditError as exc:
        print(json.dumps({"admitted": False, "error": str(exc)}, sort_keys=True), file=sys.stderr)
        return 1
    print(json.dumps(evidence, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
