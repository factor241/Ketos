#!/usr/bin/env python3
# ruff: noqa: EM101, EM102, S314, TRY003
"""Exact-scalar renames for an explicit structured-data format allowlist."""

from __future__ import annotations

import argparse
import configparser
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import tomllib
import yaml

try:
    from scripts.rebrand.rename_python import RenameToolError, load_manifest, scalar_mappings, validate_path
except ModuleNotFoundError:  # direct execution from scripts/rebrand
    from rename_python import RenameToolError, load_manifest, scalar_mappings, validate_path


class UnsupportedStructuredDataError(RenameToolError):
    """The input is not a safe, supported structured-data document."""


_SUPPORTED = {".json", ".yaml", ".yml", ".toml", ".ini", ".xml", ".env"}


def _replace_tree(value: Any, mappings: dict[str, str]) -> tuple[Any, bool]:
    if isinstance(value, str):
        replacement = mappings.get(value, value)
        return replacement, replacement != value
    if isinstance(value, list):
        changed = False
        output = []
        for item in value:
            updated, item_changed = _replace_tree(item, mappings)
            output.append(updated)
            changed |= item_changed
        return output, changed
    if isinstance(value, dict):
        changed = False
        output = {}
        for key, item in value.items():
            updated, item_changed = _replace_tree(item, mappings)
            output[key] = updated
            changed |= item_changed
        return output, changed
    return value, False


def _replace_line_scalars(source: str, mappings: dict[str, str]) -> str:
    pattern = re.compile(r"^(?P<head>\s*(?:[^#;:=\s][^:=]*?)\s*(?:=|:)\s*)(?P<value>.*?)(?P<tail>\s*(?:[#;].*)?)$")
    output: list[str] = []
    for line in source.splitlines(keepends=True):
        newline = "\n" if line.endswith("\n") else ""
        body = line[:-1] if newline else line
        match = pattern.match(body)
        if not match:
            output.append(line)
            continue
        raw = match.group("value").strip()
        quote = raw[:1] if raw[:1] in {'"', "'"} and raw[-1:] == raw[:1] else ""
        value = raw[1:-1] if quote else raw
        replacement = mappings.get(value)
        if replacement is None:
            output.append(line)
            continue
        rendered = f"{quote}{replacement}{quote}" if quote else replacement
        output.append(f"{match.group('head')}{rendered}{match.group('tail')}{newline}")
    return "".join(output)


def _replace_env(source: str, mappings: dict[str, str], key_prefixes: dict[str, str]) -> str:
    output = _replace_line_scalars(source, mappings)
    for old, new in sorted(key_prefixes.items(), key=lambda item: -len(item[0])):
        output = re.sub(rf"(?m)^(?P<prefix>\s*(?:export\s+)?){re.escape(old)}", rf"\g<prefix>{new}", output)
    return output


def _transform_json(source: str, mappings: dict[str, str]) -> str:
    parsed = json.loads(source)
    updated, changed = _replace_tree(parsed, mappings)
    if not changed:
        return source
    newline = "\n" if source.endswith("\n") else ""
    return json.dumps(updated, indent=2, ensure_ascii=False, sort_keys=False) + newline


def _transform_toml(source: str, mappings: dict[str, str]) -> str:
    tomllib.loads(source)
    output = _replace_line_scalars(source, mappings)
    tomllib.loads(output)
    return output


def _transform_yaml(source: str, mappings: dict[str, str]) -> str:
    document = yaml.compose(source)
    edits: list[tuple[int, int, str]] = []
    seen_nodes: set[int] = set()

    def visit(node: yaml.Node | None) -> None:
        if node is None:
            return
        identity = id(node)
        if identity in seen_nodes:
            return
        seen_nodes.add(identity)
        if isinstance(node, yaml.MappingNode):
            for _key, value in node.value:
                visit(value)
            return
        if isinstance(node, yaml.SequenceNode):
            for value in node.value:
                visit(value)
            return
        if not isinstance(node, yaml.ScalarNode) or node.value not in mappings:
            return
        replacement = mappings[node.value]
        raw = source[node.start_mark.index : node.end_mark.index]
        if node.style == "'":
            quote_start = raw.find("'")
            rendered = raw[:quote_start] + "'" + replacement.replace("'", "''") + "'"
        elif node.style == '"':
            quote_start = raw.find('"')
            rendered = raw[:quote_start] + json.dumps(replacement, ensure_ascii=False)
        elif node.style is None:
            value_start = raw.rfind(node.value)
            rendered = raw[:value_start] + replacement + raw[value_start + len(node.value) :]
        else:
            return
        edits.append((node.start_mark.index, node.end_mark.index, rendered))

    visit(document)
    output = source
    for start, end, replacement in reversed(edits):
        output = output[:start] + replacement + output[end:]
    yaml.safe_load(output)
    return output


def _transform_ini(source: str, mappings: dict[str, str]) -> str:
    parser = configparser.ConfigParser()
    parser.read_string(source)
    output = _replace_line_scalars(source, mappings)
    parser.read_string(output)
    return output


def _transform_xml(source: str, mappings: dict[str, str]) -> str:
    ET.fromstring(source)

    attribute_pattern = re.compile(r"(?P<head>\s[\w:.-]+\s*=\s*)(?P<quote>['\"])(?P<value>.*?)(?P=quote)")

    def replace_attribute(match: re.Match[str]) -> str:
        replacement = mappings.get(match.group("value"))
        if replacement is None:
            return match.group(0)
        return f"{match.group('head')}{match.group('quote')}{replacement}{match.group('quote')}"

    text_pattern = re.compile(r">(?P<value>[^<]*)<")

    def replace_text(match: re.Match[str]) -> str:
        raw = match.group("value")
        stripped = raw.strip()
        replacement = mappings.get(stripped)
        if replacement is None:
            return match.group(0)
        start = raw.index(stripped)
        return ">" + raw[:start] + replacement + raw[start + len(stripped) :] + "<"

    protected_pattern = re.compile(r"(<!--.*?-->|<\?.*?\?>|<!\[CDATA\[.*?\]\]>)", re.DOTALL)
    parts = protected_pattern.split(source)
    for index in range(0, len(parts), 2):
        parts[index] = attribute_pattern.sub(replace_attribute, parts[index])
        parts[index] = text_pattern.sub(replace_text, parts[index])
    output = "".join(parts)
    ET.fromstring(output)
    return output


def transform_structured_data(source: str, suffix: str, manifest: dict[str, Any]) -> str:
    normalized = suffix.lower()
    if normalized not in _SUPPORTED:
        raise UnsupportedStructuredDataError(f"unsupported structured-data suffix: {suffix}")
    if "\x00" in source:
        raise UnsupportedStructuredDataError("binary structured-data input refused")
    mappings = scalar_mappings(manifest)
    try:
        if normalized == ".json":
            return _transform_json(source, mappings)
        if normalized == ".toml":
            return _transform_toml(source, mappings)
        if normalized in {".yaml", ".yml"}:
            return _transform_yaml(source, mappings)
        if normalized == ".ini":
            return _transform_ini(source, mappings)
        if normalized == ".xml":
            return _transform_xml(source, mappings)
        if normalized == ".env":
            return _replace_env(source, mappings, manifest["mappings"].get("env_keys", {}))
        return _replace_line_scalars(source, mappings)
    except (ValueError, ET.ParseError, configparser.Error, tomllib.TOMLDecodeError, yaml.YAMLError) as exc:
        raise UnsupportedStructuredDataError(f"invalid {normalized} document: {exc}") from exc


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--repo-root", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    manifest = load_manifest(args.manifest)
    changes: list[dict[str, Any]] = []
    outputs: list[tuple[Path, str]] = []
    try:
        for raw_path in sorted(args.paths, key=lambda item: item.as_posix()):
            path = validate_path(args.repo_root, raw_path, manifest)
            before = path.read_text(encoding="utf-8")
            after = transform_structured_data(before, path.suffix or path.name, manifest)
            if after != before:
                relative = path.relative_to(args.repo_root.resolve()).as_posix()
                changes.append({"kind": "structured-data", "path": relative, "content_changed": True})
                outputs.append((path, after))
        if not args.dry_run:
            for path, output in outputs:
                path.write_text(output, encoding="utf-8")
    except (RenameToolError, UnicodeDecodeError) as exc:
        print(json.dumps({"error": str(exc)}, sort_keys=True), file=sys.stderr)
        return 2
    print(json.dumps({"version": 1, "dry_run": args.dry_run, "changes": changes}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
