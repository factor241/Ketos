#!/usr/bin/env python3
# ruff: noqa: EM101, EM102, S603, S607, TRY003
"""TypeScript/TSX renames validated by the repository TypeScript Compiler API."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

try:
    from scripts.rebrand.rename_python import RenameToolError, load_manifest, scalar_mappings, validate_path
except ModuleNotFoundError:  # direct execution from scripts/rebrand
    from rename_python import RenameToolError, load_manifest, scalar_mappings, validate_path


class TypeScriptParseError(RenameToolError):
    """Compiler API rejected the input or transformed source."""


_NODE_TRANSFORM = r"""
const fs = require('fs');
const ts = require(process.argv[1]);
const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
function parse(text) {
  const kind = payload.filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(payload.filename, text, ts.ScriptTarget.Latest, true, kind);
  if (file.parseDiagnostics.length) {
    throw new Error(ts.flattenDiagnosticMessageText(file.parseDiagnostics[0].messageText, '\n'));
  }
  return file;
}
function scalarReplacement(text) {
  let value = text;
  if (!(value in payload.strings)) {
    const protocolPrefix = Object.keys(payload.prefixes)
      .sort((a, b) => b.length - a.length)
      .find((item) => value.startsWith(item));
    if (protocolPrefix) {
      return payload.prefixes[protocolPrefix] + value.slice(protocolPrefix.length);
    }
    const prefixes = Object.keys(payload.strings).sort((a, b) => b.length - a.length);
    const old = prefixes.find((item) => value.startsWith(item + '/') || value.startsWith(item + '.'));
    if (!old) return null;
    return payload.strings[old] + value.slice(old.length);
  }
  return payload.strings[value];
}
function quotedReplacement(raw, text) {
  const value = scalarReplacement(text);
  if (value === null) return null;
  const quote = raw[0];
  return quote + value.replaceAll('\\', '\\\\').replaceAll(quote, '\\' + quote) + quote;
}
const file = parse(payload.source);
const edits = [];
function add(node, replacement) {
  edits.push([node.getStart(file), node.getEnd(), replacement]);
}
function visit(node) {
  if (ts.isIdentifier(node) && payload.names[node.text] && !payload.protected.includes(node.text)) {
    add(node, payload.names[node.text]);
  } else if (ts.isStringLiteral(node)) {
    const replacement = quotedReplacement(node.getText(file), node.text);
    if (replacement !== null) add(node, replacement);
  } else if (ts.isNoSubstitutionTemplateLiteral(node)) {
    const replacement = scalarReplacement(node.text);
    if (replacement !== null) add(node, '`' + replacement.replaceAll('`', '\\`') + '`');
  } else if (node.kind === ts.SyntaxKind.JsxText) {
    const raw = node.getText(file);
    const trimmed = raw.trim();
    const replacement = scalarReplacement(trimmed);
    if (replacement !== null) {
      add(node, raw.slice(0, raw.indexOf(trimmed)) + replacement + raw.slice(raw.indexOf(trimmed) + trimmed.length));
    }
  }
  ts.forEachChild(node, visit);
}
visit(file);
let output = payload.source;
for (const [start, end, replacement] of edits.reverse()) {
  output = output.slice(0, start) + replacement + output.slice(end);
}
parse(output);
process.stdout.write(output);
"""


def _typescript_module(repo_root: Path) -> Path:
    candidates = (
        repo_root / "src/frontend/node_modules/typescript/lib/typescript.js",
        repo_root / "node_modules/typescript/lib/typescript.js",
    )
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise RenameToolError("TypeScript Compiler API not found; install frontend dependencies")


def transform_typescript(
    source: str,
    manifest: dict[str, Any],
    *,
    filename: str = "input.ts",
    repo_root: Path | None = None,
) -> str:
    root = (repo_root or Path(__file__).resolve().parents[2]).resolve()
    names = dict(manifest["mappings"].get("imports", {}))
    names.update(manifest["mappings"].get("symbols", {}))
    strings = scalar_mappings(manifest)
    strings.update(manifest["mappings"].get("imports", {}))
    prefixes = dict(manifest["mappings"].get("env_keys", {}))
    prefixes.update(manifest["mappings"].get("headers", {}))
    payload = {
        "filename": filename,
        "source": source,
        "names": names,
        "strings": strings,
        "prefixes": prefixes,
        "protected": manifest.get("protected_names", []),
    }
    result = subprocess.run(
        ["node", "-e", _NODE_TRANSFORM, str(_typescript_module(root))],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        message = result.stderr.strip().splitlines()[-1] if result.stderr.strip() else "parse failed"
        raise TypeScriptParseError(message)
    return result.stdout


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
            if path.suffix not in {".ts", ".tsx", ".mts", ".cts"}:
                raise RenameToolError(f"TypeScript renamer refuses non-TypeScript file: {path}")
            before = path.read_text(encoding="utf-8")
            after = transform_typescript(before, manifest, filename=path.name, repo_root=args.repo_root)
            if after != before:
                relative = path.relative_to(args.repo_root.resolve()).as_posix()
                changes.append({"kind": "typescript", "path": relative, "content_changed": True})
                outputs.append((path, after))
        if not args.dry_run:
            for path, output in outputs:
                path.write_text(output, encoding="utf-8")
    except RenameToolError as exc:
        print(json.dumps({"error": str(exc)}, sort_keys=True), file=sys.stderr)
        return 2
    print(json.dumps({"version": 1, "dry_run": args.dry_run, "changes": changes}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
