from __future__ import annotations

# ruff: noqa: S101 - pytest assertions are intentional.
import base64
import hashlib
import importlib.util
import io
import json
import tarfile
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[1] / "audit_copilotkit_artifact.py"
SPEC = importlib.util.spec_from_file_location("audit_copilotkit_artifact", SCRIPT)
assert SPEC is not None
assert SPEC.loader is not None
audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)


DECLARATION = b"""
type ExactInterruptPayload<TResult, TPayload extends TResult> =
  TResult extends unknown
    ? TPayload extends TResult
      ? TPayload & Record<Exclude<keyof TPayload, keyof TResult>, never>
      : never
    : never;
type TypedInterruptResolveFn<TResult> = <TPayload extends TResult>(
  payload: ExactInterruptPayload<TResult, TPayload>,
  interruptId?: string
) => Promise<RunAgentResult | void>;
export type InterruptResolveFn<TResult = unknown> = unknown extends TResult
  ? (payload?: TResult, interruptId?: string) => Promise<RunAgentResult | void>
  : TypedInterruptResolveFn<TResult>;
"""


def _package_json(*, name: str = "@copilotkit/react-core", version: str = "1.63.1-ketos.1") -> bytes:
    return json.dumps(
        {
            "name": name,
            "version": version,
            "license": "MIT",
            "types": "./dist/index.d.cts",
            "exports": {
                "./v2": {
                    "import": "./dist/v2/index.mjs",
                    "require": "./dist/v2/index.cjs",
                }
            },
        }
    ).encode()


def _write_tgz(
    path: Path,
    *,
    files: dict[str, bytes] | None = None,
    special: tuple[str, bytes, bytes] | None = None,
) -> None:
    members = files or {
        "package/package.json": _package_json(),
        "package/LICENSE": b"MIT license\n",
        "package/README.md": b"CopilotKit\n",
        "package/dist/index.d.cts": b"export type { InterruptResolveFn } from './types.cjs';\n",
        "package/dist/index.d.mts": b"export type { InterruptResolveFn } from './types.mjs';\n",
        "package/dist/types.d.cts": DECLARATION,
        "package/dist/types.d.mts": DECLARATION,
        "package/dist/index.cjs": b"module.exports = {};\n",
        "package/dist/index.mjs": b"export {};\n",
        "package/skills/react-core/SKILL.md": b"# data only\n",
    }
    with tarfile.open(path, "w:gz") as archive:
        for name, content in members.items():
            member = tarfile.TarInfo(name)
            member.size = len(content)
            member.mode = 0o644
            archive.addfile(member, io.BytesIO(content))
        if special is not None:
            name, kind, target = special
            member = tarfile.TarInfo(name)
            member.type = kind
            member.linkname = target.decode()
            archive.addfile(member)


def _digests(path: Path) -> tuple[str, str, str]:
    content = path.read_bytes()
    sha256 = hashlib.sha256(content).hexdigest()
    integrity = "sha512-" + base64.b64encode(hashlib.sha512(content).digest()).decode()
    license_sha256 = hashlib.sha256(b"MIT license\n").hexdigest()
    return sha256, integrity, license_sha256


def _audit(path: Path, **kwargs: object) -> dict[str, object]:
    sha256, integrity, license_sha256 = _digests(path)
    return audit.audit_artifact(
        path,
        expected_sha256=sha256,
        expected_integrity=integrity,
        expected_license_sha256=license_sha256,
        **kwargs,
    )


def test_accepts_exact_vendored_package_and_declaration_contract(tmp_path: Path) -> None:
    artifact = tmp_path / audit.EXPECTED_FILENAME
    _write_tgz(artifact)

    evidence = _audit(artifact)

    assert evidence["admitted"] is True
    assert evidence["package"] == {
        "name": "@copilotkit/react-core",
        "version": "1.63.1-ketos.1",
        "license": "MIT",
    }
    assert evidence["contracts"]["typed_interrupt_resolver"] is True
    assert evidence["archive"]["all_members_regular"] is True


@pytest.mark.parametrize("field", ["expected_sha256", "expected_integrity", "expected_license_sha256"])
def test_rejects_every_integrity_mismatch(tmp_path: Path, field: str) -> None:
    artifact = tmp_path / audit.EXPECTED_FILENAME
    _write_tgz(artifact)
    sha256, integrity, license_sha256 = _digests(artifact)
    arguments = {
        "expected_sha256": sha256,
        "expected_integrity": integrity,
        "expected_license_sha256": license_sha256,
    }
    arguments[field] = "sha512-AAAA" if field == "expected_integrity" else "0" * 64

    with pytest.raises(audit.AuditError, match=r"integrity|SHA"):
        audit.audit_artifact(artifact, **arguments)


@pytest.mark.parametrize(
    ("name", "version", "error"),
    [
        ("@copilotkit/react-ui", "1.63.1-ketos.1", "package name"),
        ("@copilotkit/react-core", "1.63.1", "package version"),
    ],
)
def test_rejects_wrong_package_identity(tmp_path: Path, name: str, version: str, error: str) -> None:
    artifact = tmp_path / audit.EXPECTED_FILENAME
    _write_tgz(
        artifact,
        files={
            "package/package.json": _package_json(name=name, version=version),
            "package/LICENSE": b"MIT license\n",
            "package/dist/index.d.cts": DECLARATION,
            "package/dist/index.d.mts": DECLARATION,
        },
    )

    with pytest.raises(audit.AuditError, match=error):
        _audit(artifact)


@pytest.mark.parametrize(
    "special",
    [
        ("package/dist/escape", tarfile.SYMTYPE, b"../../outside"),
        ("package/dist/alias", tarfile.LNKTYPE, b"package/LICENSE"),
    ],
)
def test_rejects_non_regular_archive_members(tmp_path: Path, special: tuple[str, bytes, bytes]) -> None:
    artifact = tmp_path / audit.EXPECTED_FILENAME
    _write_tgz(artifact, special=special)

    with pytest.raises(audit.AuditError, match="regular file"):
        _audit(artifact)


@pytest.mark.parametrize("path", ["../escape", "package/src/private.ts", "package/dist/../../escape"])
def test_rejects_paths_outside_the_publish_allowlist(tmp_path: Path, path: str) -> None:
    artifact = tmp_path / audit.EXPECTED_FILENAME
    files = {
        "package/package.json": _package_json(),
        "package/LICENSE": b"MIT license\n",
        "package/dist/index.d.cts": DECLARATION,
        "package/dist/index.d.mts": DECLARATION,
        path: b"unexpected\n",
    }
    _write_tgz(artifact, files=files)

    with pytest.raises(audit.AuditError, match=r"allowlist|normalized"):
        _audit(artifact)


def test_rejects_resource_limit_overflow_before_member_read(tmp_path: Path) -> None:
    artifact = tmp_path / audit.EXPECTED_FILENAME
    _write_tgz(artifact)

    with pytest.raises(audit.AuditError, match="member count"):
        _audit(artifact, max_members=2)


def test_rejects_declaration_that_widens_typed_payload_to_unknown(tmp_path: Path) -> None:
    artifact = tmp_path / audit.EXPECTED_FILENAME
    widened = DECLARATION.replace(b"payload: ExactInterruptPayload<TResult, TPayload>", b"payload?: unknown")
    files = {
        "package/package.json": _package_json(),
        "package/LICENSE": b"MIT license\n",
        "package/dist/index.d.cts": widened,
        "package/dist/index.d.mts": widened,
    }
    _write_tgz(artifact, files=files)

    with pytest.raises(audit.AuditError, match="typed InterruptResolveFn"):
        _audit(artifact)


def test_runtime_proof_rejects_a_nested_second_package_copy(tmp_path: Path) -> None:
    artifact = tmp_path / audit.EXPECTED_FILENAME
    _write_tgz(artifact)
    runtime = tmp_path / "frontend"
    first = runtime / "node_modules/@copilotkit/react-core"
    second = runtime / "node_modules/other/node_modules/@copilotkit/react-core"
    for package in (first, second):
        package.mkdir(parents=True)
        (package / "package.json").write_bytes(_package_json())

    with pytest.raises(audit.AuditError, match="exactly one runtime copy"):
        _audit(artifact, runtime_root=runtime)


def test_runtime_proof_binds_the_single_installed_version(tmp_path: Path) -> None:
    artifact = tmp_path / audit.EXPECTED_FILENAME
    _write_tgz(artifact)
    runtime = tmp_path / "frontend"
    package = runtime / "node_modules/@copilotkit/react-core"
    package.mkdir(parents=True)
    (package / "package.json").write_bytes(_package_json())

    evidence = _audit(artifact, runtime_root=runtime)

    assert evidence["runtime"] == {
        "checked": True,
        "copy_count": 1,
        "version": "1.63.1-ketos.1",
    }
