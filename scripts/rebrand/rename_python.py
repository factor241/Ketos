#!/usr/bin/env python3
# ruff: noqa: EM101, EM102, TRY003
"""Token-aware Python namespace renames with a deterministic path plan."""

from __future__ import annotations

import argparse
import ast
import fnmatch
import hashlib
import io
import json
import re
import shutil
import sys
import tokenize
import unicodedata
from pathlib import Path
from typing import Any


class RenameToolError(RuntimeError):
    """Base error for safe rename failures."""


class UnsafePathError(RenameToolError):
    """A requested path is outside the codemod safety boundary."""


class CollisionError(RenameToolError):
    """Two paths would alias on a case-insensitive, NFC filesystem."""


def load_manifest(path: Path | str) -> dict[str, Any]:
    """Load the manifest, stored as JSON-compatible YAML for stdlib stability."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if data.get("version") != 1 or not isinstance(data.get("mappings"), dict):
        raise RenameToolError("unsupported rename manifest")

    def decode(value: Any) -> Any:
        if isinstance(value, dict):
            if set(value) == {"join"} and isinstance(value["join"], list):
                return "".join(value["join"])
            return {key: decode(item) for key, item in value.items()}
        if isinstance(value, list):
            return [decode(item) for item in value]
        return value

    data = decode(data)
    for category, records in data["mappings"].items():
        if not isinstance(records, list):
            raise RenameToolError(f"manifest mapping {category} must be encoded records")
        data["mappings"][category] = {"".join(record["from"]): "".join(record["to"]) for record in records}
    return data


def _relative(root: Path, path: Path) -> Path:
    root = root.resolve()
    candidate = path if path.is_absolute() else root / path
    try:
        return candidate.resolve(strict=False).relative_to(root)
    except ValueError as exc:
        raise UnsafePathError(f"outside repository root: {path}") from exc


def _matches(path: str, pattern: str) -> bool:
    return fnmatch.fnmatchcase(path, pattern) or (pattern.startswith("**/") and fnmatch.fnmatchcase(path, pattern[3:]))


def validate_path(root: Path | str, path: Path | str, manifest: dict[str, Any]) -> Path:
    root_path = Path(root).resolve()
    relative = _relative(root_path, Path(path))
    posix = relative.as_posix()
    parts = relative.parts
    refused = set(manifest.get("refused_roots", []))
    if any(part in refused for part in parts):
        dependency_parts = {"node_modules", "vendor", ".venv", "venv"}
        category = "dependency" if any(part in dependency_parts for part in parts) else "cache/dependency"
        raise UnsafePathError(f"refused {category} path: {posix}")
    if posix in set(manifest.get("immutable_legal_paths", [])):
        raise UnsafePathError(f"immutable legal path: {posix}")
    if any(_matches(posix, pattern) for pattern in manifest.get("generated_paths", [])):
        raise UnsafePathError(f"generated path: {posix}")
    return root_path / relative


def _path_key(value: str) -> str:
    return unicodedata.normalize("NFC", value).casefold()


def assert_no_path_collisions(
    root: Path | str,
    existing: list[Path],
    changes: list[dict[str, str]],
) -> None:
    root_path = Path(root).resolve()
    moved_from = {item["from"] for item in changes}
    targets = [
        _relative(root_path, item).as_posix()
        for item in existing
        if _relative(root_path, item).as_posix() not in moved_from
    ] + [item["to"] for item in changes]
    seen: dict[str, str] = {}
    for target in targets:
        key = _path_key(target)
        if key in seen:
            raise CollisionError(f"NFC/casefold target collision: {seen[key]!r} and {target!r}")
        seen[key] = target


def _replace_path_once(relative: str, mappings: dict[str, str]) -> str:
    for old in sorted(mappings, key=lambda item: (-len(item), item)):
        if relative == old or relative.startswith(old + "/"):
            return mappings[old] + relative[len(old) :]
    return relative


def plan_path_changes(
    root: Path | str,
    paths: list[Path],
    manifest: dict[str, Any],
) -> list[dict[str, str]]:
    root_path = Path(root).resolve()
    mappings = manifest["mappings"].get("paths", {})
    changes: list[dict[str, str]] = []
    for path in sorted(paths, key=lambda item: _relative(root_path, item).as_posix()):
        relative = _relative(root_path, path).as_posix()
        renamed = _replace_path_once(relative, mappings)
        if renamed != relative:
            changes.append({"from": relative, "to": renamed})
    all_existing = list(root_path.rglob("*"))
    assert_no_path_collisions(root_path, all_existing, changes)
    return changes


def _exact_scalars(manifest: dict[str, Any]) -> dict[str, str]:
    categories = (
        "products",
        "distributions",
        "urls",
        "queues",
        "extension_groups",
        "config_values",
    )
    result: dict[str, str] = {}
    for category in categories:
        result.update(manifest["mappings"].get(category, {}))
    return result


def scalar_mappings(manifest: dict[str, Any]) -> dict[str, str]:
    """Public exact scalar allowlist shared by structured-data tooling."""
    return _exact_scalars(manifest)


_STRING_RE = re.compile(r"(?is)^([rubf]*)(\"\"\"|'''|\"|')(.*)(\2)$")


def _rewrite_string_token(
    token: str,
    mappings: dict[str, str],
    prefix_mappings: dict[str, str] | None = None,
) -> str:
    match = _STRING_RE.match(token)
    if not match or "f" in match.group(1).lower():
        return token
    try:
        value = ast.literal_eval(token)
    except (SyntaxError, ValueError):
        return token
    if not isinstance(value, str):
        return token
    replacement = mappings.get(value)
    if replacement is None:
        for old, new in sorted((prefix_mappings or {}).items(), key=lambda item: -len(item[0])):
            if value.startswith(old):
                replacement = new + value[len(old) :]
                break
    if replacement is None:
        for old, new in sorted(mappings.items(), key=lambda item: -len(item[0])):
            if value.startswith((old + ".", old + "/")):
                replacement = new + value[len(old) :]
                break
    if replacement is None:
        return token
    prefix, quote = match.group(1), match.group(2)
    escaped = replacement.replace("\\", "\\\\").replace(quote, "\\" + quote)
    return f"{prefix}{quote}{escaped}{quote}"


def transform_python(source: str, manifest: dict[str, Any]) -> str:
    """Rewrite only Python NAME and exact STRING tokens; preserve all trivia."""
    names = dict(manifest["mappings"].get("imports", {}))
    names.update(manifest["mappings"].get("symbols", {}))
    strings = _exact_scalars(manifest)
    strings.update(manifest["mappings"].get("imports", {}))
    prefixes = dict(manifest["mappings"].get("env_keys", {}))
    prefixes.update(manifest["mappings"].get("headers", {}))
    protected = set(manifest.get("protected_names", []))
    tokens: list[tokenize.TokenInfo] = []
    try:
        stream = tokenize.generate_tokens(io.StringIO(source).readline)
        for item in stream:
            value = item.string
            if item.type == tokenize.NAME and value not in protected:
                value = names.get(value, value)
            elif item.type == tokenize.STRING:
                value = _rewrite_string_token(value, strings, prefixes)
            tokens.append(item._replace(string=value))
        transformed = tokenize.untokenize(tokens)
        ast.parse(transformed)
    except (IndentationError, SyntaxError, tokenize.TokenError) as exc:
        raise RenameToolError(f"invalid Python input or output: {exc}") from exc
    return transformed


def _content_change(root: Path, path: Path, manifest: dict[str, Any]) -> tuple[str, str] | None:
    validate_path(root, path, manifest)
    if path.suffix not in {".py", ".pyi"}:
        raise RenameToolError(f"Python renamer refuses non-Python file: {path}")
    before = path.read_text(encoding="utf-8")
    after = transform_python(before, manifest)
    return (before, after) if before != after else None


def run(
    root: Path,
    paths: list[Path],
    manifest: dict[str, Any],
    *,
    dry_run: bool,
) -> dict[str, Any]:
    root = root.resolve()
    validated = [validate_path(root, path, manifest) for path in paths]
    path_changes = plan_path_changes(root, validated, manifest)
    path_targets = {item["from"]: item["to"] for item in path_changes}
    content: dict[str, tuple[str, str]] = {}
    changes: list[dict[str, Any]] = []
    for path in sorted(validated, key=lambda item: _relative(root, item).as_posix()):
        relative = _relative(root, path).as_posix()
        edit = _content_change(root, path, manifest)
        target = path_targets.get(relative, relative)
        if edit is not None or target != relative:
            changes.append(
                {
                    "kind": "python",
                    "from": relative,
                    "to": target,
                    "content_changed": edit is not None,
                }
            )
        if edit is not None:
            content[relative] = edit
    report = {"version": 1, "dry_run": dry_run, "changes": changes}
    if dry_run:
        return report

    moving = [item for item in changes if item["from"] != item["to"]]
    staged_sources: dict[str, Path] = {}
    staging: Path | None = None
    if moving:
        digest = hashlib.sha256(json.dumps(moving, sort_keys=True).encode()).hexdigest()[:12]
        staging = root / f".ketos-rename-staging-{digest}"
        if staging.exists():
            raise CollisionError(f"rename staging path exists: {staging}")
        staging.mkdir()
        for index, item in enumerate(moving):
            source = root / item["from"]
            staged = staging / str(index)
            shutil.move(str(source), str(staged))
            staged_sources[item["from"]] = staged

    for item in changes:
        destination = root / item["to"]
        destination.parent.mkdir(parents=True, exist_ok=True)
        if item["content_changed"]:
            destination.write_text(content[item["from"]][1], encoding="utf-8")
            staged = staged_sources.get(item["from"])
            if staged is not None:
                staged.unlink()
        elif item["from"] != item["to"]:
            shutil.move(str(staged_sources[item["from"]]), str(destination))
    if staging is not None:
        staging.rmdir()
    return report


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--repo-root", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        report = run(args.repo_root, args.paths, load_manifest(args.manifest), dry_run=args.dry_run)
    except RenameToolError as exc:
        print(json.dumps({"error": str(exc)}, sort_keys=True), file=sys.stderr)
        return 2
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
