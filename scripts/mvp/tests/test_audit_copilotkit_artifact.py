from __future__ import annotations

# ruff: noqa: S101 - pytest assertions are intentional.
import base64
import hashlib
import importlib.util
import io
import json
import tarfile
from pathlib import Path, PurePosixPath

import pytest

SCRIPT = Path(__file__).parents[1] / "audit_copilotkit_artifact.py"
ROOT = Path(__file__).parents[3]
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
        "package/dist/v2/index.d.cts": b"export type { InterruptResolveFn } from './types.cjs';\n",
        "package/dist/v2/index.d.mts": b"export type { InterruptResolveFn } from './types.mjs';\n",
        "package/dist/v2/types.d.cts": DECLARATION,
        "package/dist/v2/types.d.mts": DECLARATION,
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


def _install_artifact(artifact: Path, package_root: Path) -> None:
    with tarfile.open(artifact, "r:gz") as archive:
        for member in archive:
            assert member.isfile()
            source = archive.extractfile(member)
            assert source is not None
            relative = Path(*PurePosixPath(member.name).parts[1:])
            destination = package_root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(source.read())


def _install_typescript_stub(runtime_root: Path, *, exit_code: int = 0) -> None:
    compiler = runtime_root / "node_modules/typescript/bin/tsc"
    compiler.parent.mkdir(parents=True, exist_ok=True)
    compiler.write_text(f"process.exit({exit_code});\n", encoding="utf-8")


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


def test_rejects_exact_signature_hidden_in_an_unreachable_declaration(tmp_path: Path) -> None:
    artifact = tmp_path / audit.EXPECTED_FILENAME
    widened = b"export type InterruptResolveFn<TResult = unknown> = (payload?: unknown) => Promise<void>;\n"
    files = {
        "package/package.json": _package_json(),
        "package/LICENSE": b"MIT license\n",
        "package/dist/index.d.cts": widened,
        "package/dist/index.d.mts": widened,
        "package/dist/unreachable.d.cts": DECLARATION,
        "package/dist/unreachable.d.mts": DECLARATION,
    }
    _write_tgz(artifact, files=files)

    with pytest.raises(audit.AuditError, match="typed InterruptResolveFn"):
        _audit(artifact)


def test_rejects_signature_fragments_hidden_in_a_reachable_comment(tmp_path: Path) -> None:
    artifact = tmp_path / audit.EXPECTED_FILENAME
    widened = (
        b"export type InterruptResolveFn<TResult = unknown> = (payload?: unknown) => Promise<void>;\n"
        b"/*\n" + DECLARATION + b"*/\n"
    )
    files = {
        "package/package.json": _package_json(),
        "package/LICENSE": b"MIT license\n",
        "package/dist/index.d.cts": widened,
        "package/dist/index.d.mts": widened,
    }
    _write_tgz(artifact, files=files)

    with pytest.raises(audit.AuditError, match="typed InterruptResolveFn"):
        _audit(artifact)


def test_rejects_v2_export_that_redirects_types_away_from_public_declarations(tmp_path: Path) -> None:
    artifact = tmp_path / audit.EXPECTED_FILENAME
    package = json.loads(_package_json())
    package["exports"]["./v2"] = {
        "types": "./dist/evil.d.mts",
        "import": "./dist/v2/index.mjs",
        "require": "./dist/v2/index.cjs",
    }
    files = {
        "package/package.json": json.dumps(package).encode(),
        "package/LICENSE": b"MIT license\n",
        "package/dist/v2/index.d.cts": DECLARATION,
        "package/dist/v2/index.d.mts": DECLARATION,
        "package/dist/evil.d.mts": b"export type InterruptResolveFn = (payload?: unknown) => Promise<void>;\n",
    }
    _write_tgz(artifact, files=files)

    with pytest.raises(audit.AuditError, match="v2 export"):
        _audit(artifact)


@pytest.mark.parametrize(
    "decoy_reference",
    [
        "// export type { InterruptResolveFn } from './hidden.cjs';",
        "/* export type { InterruptResolveFn } from './hidden.cjs'; */",
        "declare const decoy: \"export type { InterruptResolveFn } from './hidden.cjs'\";",
    ],
)
def test_rejects_commonjs_contract_reachable_only_through_non_code_text(tmp_path: Path, decoy_reference: str) -> None:
    artifact = tmp_path / audit.EXPECTED_FILENAME
    widened = "export type InterruptResolveFn<TResult = unknown> = (payload?: unknown) => Promise<void>;\n"
    files = {
        "package/package.json": _package_json(),
        "package/LICENSE": b"MIT license\n",
        "package/dist/v2/index.d.cts": (widened + decoy_reference).encode(),
        "package/dist/v2/index.d.mts": DECLARATION,
        "package/dist/v2/hidden.d.cts": DECLARATION,
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
    _install_artifact(artifact, first)
    _install_typescript_stub(runtime)
    second.parent.mkdir(parents=True)
    second.symlink_to(first, target_is_directory=True)

    with pytest.raises(audit.AuditError, match="exactly one runtime copy"):
        _audit(artifact, runtime_root=runtime)


def test_runtime_proof_binds_the_single_installed_version(tmp_path: Path) -> None:
    artifact = tmp_path / audit.EXPECTED_FILENAME
    _write_tgz(artifact)
    runtime = tmp_path / "frontend"
    package = runtime / "node_modules/@copilotkit/react-core"
    _install_artifact(artifact, package)
    _install_typescript_stub(runtime)

    evidence = _audit(artifact, runtime_root=runtime)

    assert evidence["runtime"] == {
        "checked": True,
        "copy_count": 1,
        "version": "1.63.1-ketos.1",
    }


def test_runtime_proof_rejects_tampered_installed_declarations(tmp_path: Path) -> None:
    artifact = tmp_path / audit.EXPECTED_FILENAME
    _write_tgz(artifact)
    runtime = tmp_path / "frontend"
    package = runtime / "node_modules/@copilotkit/react-core"
    _install_artifact(artifact, package)
    _install_typescript_stub(runtime)
    (package / "dist/v2/types.d.cts").write_text(
        "export type InterruptResolveFn = (payload?: unknown) => Promise<void>;\n"
    )

    with pytest.raises(audit.AuditError, match="runtime package contents"):
        _audit(artifact, runtime_root=runtime)


def test_runtime_proof_requires_executable_typescript_contract_to_pass(tmp_path: Path) -> None:
    artifact = tmp_path / audit.EXPECTED_FILENAME
    _write_tgz(artifact)
    runtime = tmp_path / "frontend"
    package = runtime / "node_modules/@copilotkit/react-core"
    _install_artifact(artifact, package)
    _install_typescript_stub(runtime, exit_code=1)

    with pytest.raises(audit.AuditError, match="TypeScript positive/negative contract failed"):
        _audit(artifact, runtime_root=runtime)


def test_checked_in_artifact_passes_real_installed_typescript_contract() -> None:
    artifact = ROOT / "vendor/stage01" / audit.EXPECTED_FILENAME

    evidence = audit.audit_artifact(
        artifact,
        expected_sha256="64711f7e9e94ab6126fef68fdb92f9ba80f400b88d64d3a72191ee1ed7da61aa",
        expected_integrity=(
            "sha512-ZHIeQdU9Iy+MoFKTfm5orw2Yy0aiG0FM3JIs4c1OtxfCG70TUpmUDqzt3lPx6GJkn3lrYwbSxFnIiSCv1CdVAQ=="
        ),
        expected_license_sha256="15a0e5343aea872c0573ad72feb6044b336f162d724cc1673c608e6b37ea071b",
        runtime_root=ROOT / "src/frontend",
    )

    assert evidence["runtime"]["checked"] is True
