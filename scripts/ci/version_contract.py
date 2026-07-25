# ruff: noqa: EM101, EM102, TRY003
"""Validate and update the declared Ketos version family."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - exercised only on Python 3.10
    import tomli as tomllib


SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
SUPPORTED_FORMATS = {"toml-project", "package-json"}
SUPPORTED_RELATIONS = {"exact", "zero-major"}


class ContractError(RuntimeError):
    """A malformed or unsafe contract."""


@dataclass(frozen=True)
class Member:
    path: str
    format: str
    relation: str


@dataclass(frozen=True)
class Exclusion:
    path: str
    format: str
    expected: str
    reason: str


@dataclass(frozen=True)
class DependencyPin:
    path: str
    name: str
    operator: str
    relation: str


@dataclass(frozen=True)
class Contract:
    canonical: str
    members: tuple[Member, ...]
    exclusions: tuple[Exclusion, ...]
    dependency_pins: tuple[DependencyPin, ...]


@dataclass(frozen=True)
class Finding:
    file: str
    actual: str
    expected: str
    relation: str
    passed: bool

    def render(self) -> str:
        status = "PASS" if self.passed else "FAIL"
        return f"{status} file={self.file} actual={self.actual} expected={self.expected} relation={self.relation}"


def _error_finding(file: str, actual: str, expected: str, relation: str) -> ContractError:
    finding = Finding(file=file, actual=actual, expected=expected, relation=relation, passed=False)
    return ContractError(finding.render().removeprefix("FAIL "))


def _safe_path(root: Path, relative: str, *, require_file: bool = True) -> Path:
    pure = PurePosixPath(relative)
    if pure.is_absolute() or not pure.parts or ".." in pure.parts:
        raise _error_finding(relative, "<unsafe>", "<repository-relative>", "member-path")
    path = root.joinpath(*pure.parts)
    if path.is_symlink():
        raise _error_finding(relative, "<symlink>", "<regular-file>", "member-path")
    try:
        path.resolve(strict=False).relative_to(root.resolve())
    except ValueError as exc:
        raise _error_finding(relative, "<escape>", "<inside-root>", "member-path") from exc
    if require_file and not path.is_file():
        raise _error_finding(relative, "<missing>", "<present>", "member-path")
    return path


def _mapping(data: Any, *, label: str) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise ContractError(f"{label} must be a table")
    return data


def _sequence(data: Any, *, label: str) -> list[Any]:
    if not isinstance(data, list):
        raise ContractError(f"{label} must be an array")
    return data


def _required_string(data: dict[str, Any], key: str, *, label: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value:
        raise ContractError(f"{label}.{key} must be a non-empty string")
    return value


def load_contract(root: Path) -> Contract:
    root = root.resolve()
    root_pyproject = _safe_path(root, "pyproject.toml")
    try:
        document = tomllib.loads(root_pyproject.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise ContractError(f"cannot parse pyproject.toml: {exc}") from exc
    try:
        raw = document["tool"]["ketos"]["version-family"]
    except (KeyError, TypeError) as exc:
        raise ContractError("pyproject.toml is missing [tool.ketos.version-family]") from exc
    table = _mapping(raw, label="tool.ketos.version-family")
    canonical = _required_string(table, "canonical", label="version-family")

    members: list[Member] = []
    for index, raw_member in enumerate(_sequence(table.get("members"), label="version-family.members")):
        item = _mapping(raw_member, label=f"version-family.members[{index}]")
        member = Member(
            path=_required_string(item, "path", label=f"members[{index}]"),
            format=_required_string(item, "format", label=f"members[{index}]"),
            relation=_required_string(item, "relation", label=f"members[{index}]"),
        )
        if member.format not in SUPPORTED_FORMATS:
            raise ContractError(f"{member.path}: unsupported format {member.format!r}")
        if member.relation not in SUPPORTED_RELATIONS:
            raise ContractError(f"{member.path}: unsupported relation {member.relation!r}")
        members.append(member)

    exclusions: list[Exclusion] = []
    for index, raw_exclusion in enumerate(
        _sequence(table.get("private_exclusions"), label="version-family.private_exclusions")
    ):
        item = _mapping(raw_exclusion, label=f"version-family.private_exclusions[{index}]")
        exclusion = Exclusion(
            path=_required_string(item, "path", label=f"private_exclusions[{index}]"),
            format=_required_string(item, "format", label=f"private_exclusions[{index}]"),
            expected=_required_string(item, "expected", label=f"private_exclusions[{index}]"),
            reason=_required_string(item, "reason", label=f"private_exclusions[{index}]"),
        )
        if exclusion.format not in SUPPORTED_FORMATS:
            raise ContractError(f"{exclusion.path}: unsupported format {exclusion.format!r}")
        exclusions.append(exclusion)

    dependency_pins: list[DependencyPin] = []
    for index, raw_pin in enumerate(table.get("dependency_pins", [])):
        item = _mapping(raw_pin, label=f"version-family.dependency_pins[{index}]")
        pin = DependencyPin(
            path=_required_string(item, "path", label=f"dependency_pins[{index}]"),
            name=_required_string(item, "name", label=f"dependency_pins[{index}]"),
            operator=_required_string(item, "operator", label=f"dependency_pins[{index}]"),
            relation=_required_string(item, "relation", label=f"dependency_pins[{index}]"),
        )
        if pin.operator not in {"==", ">=", "~="}:
            raise ContractError(f"{pin.path}: unsupported dependency operator {pin.operator!r}")
        if pin.relation not in SUPPORTED_RELATIONS:
            raise ContractError(f"{pin.path}: unsupported dependency relation {pin.relation!r}")
        dependency_pins.append(pin)

    member_paths = [member.path for member in members]
    exclusion_paths = [exclusion.path for exclusion in exclusions]
    if len(set(member_paths)) != len(member_paths):
        raise ContractError("version-family members contain duplicate paths")
    if len(set(exclusion_paths)) != len(exclusion_paths):
        raise ContractError("version-family private exclusions contain duplicate paths")
    if set(member_paths) & set(exclusion_paths):
        raise ContractError("version-family members and private exclusions overlap")
    if canonical not in member_paths:
        raise ContractError("version-family canonical must identify one declared member")
    for relative in (*member_paths, *exclusion_paths):
        _safe_path(root, relative)
    for pin in dependency_pins:
        if pin.path not in member_paths:
            raise ContractError(f"{pin.path}: dependency pin must live in a version-owned member")

    return Contract(
        canonical=canonical,
        members=tuple(members),
        exclusions=tuple(exclusions),
        dependency_pins=tuple(dependency_pins),
    )


def _read_document(path: Path, file_format: str) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    try:
        if file_format == "toml-project":
            return _mapping(tomllib.loads(text), label=str(path))
        return _mapping(json.loads(text), label=str(path))
    except (json.JSONDecodeError, tomllib.TOMLDecodeError, OSError) as exc:
        raise ContractError(f"cannot parse {path}: {exc}") from exc


def _read_version(path: Path, file_format: str) -> str:
    document = _read_document(path, file_format)
    value = document.get("project", {}).get("version") if file_format == "toml-project" else document.get("version")
    if not isinstance(value, str) or not value:
        raise ContractError(f"{path}: version must be a non-empty string")
    return value


def _expected_version(product_version: str, relation: str) -> str:
    match = SEMVER.fullmatch(product_version)
    if match is None:
        raise _error_finding("pyproject.toml", product_version, "X.Y.Z", "canonical-semver")
    major, minor, patch = match.groups()
    if relation == "exact":
        return f"{major}.{minor}.{patch}"
    return f"0.{minor}.{patch}"


def _project_dependencies(path: Path) -> tuple[str, ...]:
    document = _read_document(path, "toml-project")
    dependencies = document.get("project", {}).get("dependencies", [])
    if not isinstance(dependencies, list) or not all(isinstance(value, str) for value in dependencies):
        raise ContractError(f"{path}: project.dependencies must be an array of strings")
    return tuple(dependencies)


def _actual_pin(path: Path, pin: DependencyPin) -> str:
    prefix = f"{pin.name}{pin.operator}"
    matches = [dependency for dependency in _project_dependencies(path) if dependency.startswith(prefix)]
    if len(matches) != 1:
        return "<missing>" if not matches else "<ambiguous>"
    return matches[0]


def evaluate_contract(root: Path) -> tuple[str, tuple[Finding, ...]]:
    root = root.resolve()
    contract = load_contract(root)
    canonical_member = next(member for member in contract.members if member.path == contract.canonical)
    canonical_path = _safe_path(root, canonical_member.path)
    canonical_version = _read_version(canonical_path, canonical_member.format)
    if SEMVER.fullmatch(canonical_version) is None:
        raise _error_finding(contract.canonical, canonical_version, "X.Y.Z", "canonical-semver")

    findings: list[Finding] = []
    for member in contract.members:
        path = _safe_path(root, member.path)
        actual = _read_version(path, member.format)
        if SEMVER.fullmatch(actual) is None:
            raise _error_finding(member.path, actual, "X.Y.Z", "member-semver")
        expected = _expected_version(canonical_version, member.relation)
        findings.append(
            Finding(
                file=member.path,
                actual=actual,
                expected=expected,
                relation=member.relation,
                passed=actual == expected,
            )
        )
    for exclusion in contract.exclusions:
        path = _safe_path(root, exclusion.path)
        actual = _read_version(path, exclusion.format)
        findings.append(
            Finding(
                file=exclusion.path,
                actual=actual,
                expected=exclusion.expected,
                relation=f"excluded:{exclusion.reason}",
                passed=actual == exclusion.expected,
            )
        )
    for pin in contract.dependency_pins:
        path = _safe_path(root, pin.path)
        expected = f"{pin.name}{pin.operator}{_expected_version(canonical_version, pin.relation)}"
        actual = _actual_pin(path, pin)
        findings.append(
            Finding(
                file=pin.path,
                actual=actual,
                expected=expected,
                relation=f"dependency:{pin.relation}",
                passed=actual == expected,
            )
        )
    return canonical_version, tuple(findings)


def check_contract(root: Path) -> tuple[Finding, ...]:
    _, findings = evaluate_contract(root)
    return tuple(finding for finding in findings if not finding.passed)


def canonical_version(root: Path) -> str:
    version, _ = evaluate_contract(root)
    return version


def _replace_project_version(text: str, old: str, new: str, *, file: str) -> str:
    section = re.search(r"(?m)^\[project\]\s*$", text)
    if section is None:
        raise ContractError(f"{file}: missing [project] table")
    next_section = re.search(r"(?m)^\[[^\]]+\]\s*$", text[section.end() :])
    end = section.end() + next_section.start() if next_section else len(text)
    body = text[section.end() : end]
    matches = list(re.finditer(r'(?m)^(\s*version\s*=\s*")([^"]+)(".*)$', body))
    if len(matches) != 1 or matches[0].group(2) != old:
        raise ContractError(f"{file}: expected one [project] version assignment for {old}")
    match = matches[0]
    replaced = body[: match.start(2)] + new + body[match.end(2) :]
    return text[: section.end()] + replaced + text[end:]


def _replace_package_version(text: str, old: str, new: str, *, file: str) -> str:
    matches = list(re.finditer(r'(?m)^(\s*"version"\s*:\s*")([^"]+)(")', text))
    matching = [match for match in matches if match.group(2) == old]
    if len(matches) != 1 or len(matching) != 1:
        raise ContractError(f"{file}: expected one top-level version field for {old}")
    match = matching[0]
    return text[: match.start(2)] + new + text[match.end(2) :]


def _replace_dependency(text: str, pin: DependencyPin, old_version: str, new_version: str) -> str:
    old = f"{pin.name}{pin.operator}{old_version}"
    new = f"{pin.name}{pin.operator}{new_version}"
    if text.count(old) != 1:
        raise ContractError(f"{pin.path}: expected one dependency pin {old!r}")
    return text.replace(old, new, 1)


def _write_replacement(path: Path, content: bytes, mode: int) -> None:
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.chmod(mode)
        temporary.replace(path)
    finally:
        if temporary.exists():
            temporary.unlink()


def _apply_with_rollback(edits: dict[Path, bytes]) -> None:
    originals = {path: path.read_bytes() for path in edits}
    modes = {path: path.stat().st_mode for path in edits}
    changed: list[Path] = []
    try:
        for path, content in edits.items():
            if content == originals[path]:
                continue
            _write_replacement(path, content, modes[path])
            changed.append(path)
    except Exception as original_error:
        rollback_errors: list[str] = []
        for path in reversed(changed):
            try:
                _write_replacement(path, originals[path], modes[path])
            except Exception as exc:  # noqa: BLE001
                rollback_errors.append(f"{path}: {exc}")
        if rollback_errors:
            raise ContractError(
                "version bump failed and rollback was incomplete: " + "; ".join(rollback_errors)
            ) from original_error
        raise


def bump(root: Path, target_version: str) -> None:
    root = root.resolve()
    if SEMVER.fullmatch(target_version) is None:
        raise ContractError(_error_finding("<target>", target_version, "X.Y.Z", "target-semver").args[0])
    current_version, findings = evaluate_contract(root)
    failures = [finding for finding in findings if not finding.passed]
    if failures:
        raise VersionDriftError(tuple(failures))
    contract = load_contract(root)

    text_by_path: dict[str, str] = {}
    for member in contract.members:
        path = _safe_path(root, member.path)
        text = path.read_text(encoding="utf-8")
        old = _expected_version(current_version, member.relation)
        new = _expected_version(target_version, member.relation)
        if member.format == "toml-project":
            text = _replace_project_version(text, old, new, file=member.path)
        else:
            text = _replace_package_version(text, old, new, file=member.path)
        text_by_path[member.path] = text

    for pin in contract.dependency_pins:
        old = _expected_version(current_version, pin.relation)
        new = _expected_version(target_version, pin.relation)
        text_by_path[pin.path] = _replace_dependency(text_by_path[pin.path], pin, old, new)

    edits = {_safe_path(root, relative): text.encode("utf-8") for relative, text in text_by_path.items()}
    originals = {path: path.read_bytes() for path in edits}
    _apply_with_rollback(edits)
    try:
        post_failures = check_contract(root)
    except Exception:
        _apply_with_rollback(originals)
        raise
    if post_failures:
        _apply_with_rollback(originals)
        message = "post-bump contract check failed: " + "; ".join(item.render() for item in post_failures)
        raise ContractError(message)


class VersionDriftError(RuntimeError):
    def __init__(self, findings: tuple[Finding, ...]) -> None:
        super().__init__("version family is inconsistent")
        self.findings = findings


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("check")
    bump_parser = subparsers.add_parser("bump")
    bump_parser.add_argument("--version", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    try:
        if arguments.command == "bump":
            bump(arguments.root, arguments.version)
        version, findings = evaluate_contract(arguments.root)
    except VersionDriftError as exc:
        for finding in exc.findings:
            print(finding.render(), file=sys.stderr)
        return 1
    except ContractError as exc:
        print(f"FAIL {exc}", file=sys.stderr)
        return 2

    for finding in findings:
        print(finding.render(), file=sys.stdout if finding.passed else sys.stderr)
    if any(not finding.passed for finding in findings):
        return 1
    print(f"PASS version-family product={version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
