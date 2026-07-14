"""Build the flat backend Russian catalog from reviewed translation chunks."""
# ruff: noqa: EM101, EM102, TRY003

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ENGLISH = ROOT / "src/backend/base/ketos/locales/en.json"
DEFAULT_MEMORY = ROOT / ".superpowers/sdd/task-13-translation-memory.json"
DEFAULT_CHUNKS = ROOT / ".superpowers/sdd/task-13-translation-chunks"
DEFAULT_OUTPUT = ROOT / "src/backend/base/ketos/locales/ru.json"

TOKEN_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("interpolation", re.compile(r"{{\s*[A-Za-z_][\w.:-]*\s*}}")),
    ("placeholder", re.compile(r"(?<!{){[A-Za-z_][\w.:-]*(?:![rsa])?(?::[^{}]+)?}(?!})")),
    ("numeric_tag", re.compile(r"</?\d+>")),
    ("inline_code", re.compile(r"(?<!`)(`+)(?!`)([^\n]*?)(?<!`)\1(?!`)")),
    ("url", re.compile(r"https?://[^\s)\]}>\"']+")),
    ("environment", re.compile(r"\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b")),
    ("snake_identifier", re.compile(r"\b[a-z][a-z0-9]*_[a-z0-9_]+\b")),
    ("printf", re.compile(r"%(?:\([^)]+\))?[#0\- +]?\d*(?:\.\d+)?[diouxXeEfFgGcrs%]")),
)


class TranslationBuildError(ValueError):
    """Raised when reviewed chunks cannot produce a safe exact catalog."""


def _load_object(path: Path, *, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise TranslationBuildError(f"{label} is not valid JSON: {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise TranslationBuildError(f"{label} must be a JSON object: {path}")
    return value


def _string_mapping(value: dict[str, Any], *, label: str) -> dict[str, str]:
    if any(not isinstance(key, str) or not isinstance(target, str) for key, target in value.items()):
        raise TranslationBuildError(f"{label} must map strings to strings")
    return value  # type: ignore[return-value]


def protected_tokens(value: str) -> Counter[tuple[str, str]]:
    """Return tokens whose byte identity is part of the localization contract."""
    tokens: Counter[tuple[str, str]] = Counter()
    for label, pattern in TOKEN_PATTERNS:
        tokens.update((label, match.group(0)) for match in pattern.finditer(value))
    return tokens


def validate_translation(source: str, target: str) -> None:
    if not target.strip():
        raise TranslationBuildError(f"empty translation for source {source!r}")
    source_tokens = protected_tokens(source)
    target_tokens = protected_tokens(target)
    if source_tokens != target_tokens:
        missing = list((source_tokens - target_tokens).elements())
        added = list((target_tokens - source_tokens).elements())
        raise TranslationBuildError(
            f"protected token drift for source {source!r}: missing={missing!r}, added={added!r}"
        )


def build_catalog(
    english: dict[str, str],
    memory: dict[str, str],
    chunk_translations: list[dict[str, str]],
) -> dict[str, str]:
    """Resolve every English catalog value through one exact reviewed translation."""
    if any(not isinstance(key, str) or not isinstance(value, str) for key, value in english.items()):
        raise TranslationBuildError("English catalog must be a flat string mapping")

    source_values = set(english.values())
    translations: dict[str, str] = {}
    for mapping in (memory, *chunk_translations):
        for source, target in mapping.items():
            if source not in source_values:
                raise TranslationBuildError(f"unknown source translation {source!r}")
            previous = translations.get(source)
            if previous is not None and previous != target:
                raise TranslationBuildError(f"conflicting translations for source {source!r}")
            validate_translation(source, target)
            translations[source] = target

    missing = sorted(source_values - set(translations))
    if missing:
        raise TranslationBuildError(f"missing source translation for {len(missing)} value(s); first={missing[0]!r}")

    return {key: translations[source] for key, source in english.items()}


def load_chunk_translations(chunks_dir: Path) -> list[dict[str, str]]:
    source_paths = sorted(chunks_dir.glob("chunk-*-source.json"))
    if not source_paths:
        raise TranslationBuildError(f"no translation chunk sources found in {chunks_dir}")

    chunks: list[dict[str, str]] = []
    for source_path in source_paths:
        output_path = source_path.with_name(source_path.name.replace("-source.json", "-ru.json"))
        try:
            source_payload = json.loads(source_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise TranslationBuildError(f"invalid source chunk {source_path}: {exc}") from exc
        if not isinstance(source_payload, list) or any(
            not isinstance(entry, dict) or not isinstance(entry.get("source"), str) for entry in source_payload
        ):
            raise TranslationBuildError(f"source chunk must be an array of source/context objects: {source_path}")
        expected = {entry["source"] for entry in source_payload}
        translated = _string_mapping(_load_object(output_path, label="translation chunk"), label="translation chunk")
        missing = expected - set(translated)
        extra = set(translated) - expected
        if missing or extra:
            raise TranslationBuildError(
                f"translation chunk identities differ for {output_path}: missing={len(missing)}, extra={len(extra)}"
            )
        chunks.append(translated)
    return chunks


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--english", type=Path, default=DEFAULT_ENGLISH)
    parser.add_argument("--memory", type=Path, default=DEFAULT_MEMORY)
    parser.add_argument("--chunks-dir", type=Path, default=DEFAULT_CHUNKS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true", help="Fail if output differs instead of writing it")
    args = parser.parse_args()

    try:
        english = _string_mapping(_load_object(args.english, label="English catalog"), label="English catalog")
        memory = _string_mapping(_load_object(args.memory, label="translation memory"), label="translation memory")
        catalog = build_catalog(english, memory, load_chunk_translations(args.chunks_dir))
    except TranslationBuildError as exc:
        print(f"FAIL: {exc}")
        return 1

    content = json.dumps(catalog, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not args.output.exists() or args.output.read_text(encoding="utf-8") != content:
            print(f"FAIL: {args.output} is not the exact built Russian catalog")
            return 1
        print(f"PASS: {args.output} matches {len(catalog)} built keys")
        return 0

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(content, encoding="utf-8")
    print(f"Wrote {len(catalog)} Russian catalog keys to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
