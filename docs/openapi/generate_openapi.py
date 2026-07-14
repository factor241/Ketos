#!/usr/bin/env python3
"""Generate the Ketos OpenAPI document from the local FastAPI application.

Run from the repository root:
    uv run python docs/openapi/generate_openapi.py

Generated JSON is owned by the generated-artifact stage. This module is the
only documentation input and never fetches an external specification.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from ketos.main import create_app


def _normalize(node: Any, collected: dict[str, Any]) -> None:
    if isinstance(node, dict):
        definitions = node.pop("$defs", None)
        if isinstance(definitions, dict):
            for name, schema in definitions.items():
                _normalize(schema, collected)
                collected.setdefault(name, schema)
        reference = node.get("$ref")
        if isinstance(reference, str) and reference.startswith("#/$defs/"):
            node["$ref"] = f"#/components/schemas/{reference.rsplit('/', 1)[-1]}"
        description = node.get("description")
        if isinstance(description, str):
            node["description"] = description.replace("\n", "<br>")
        for value in node.values():
            _normalize(value, collected)
    elif isinstance(node, list):
        for value in node:
            _normalize(value, collected)


def generate(output: Path) -> None:
    specification = create_app().openapi()
    collected: dict[str, Any] = {}
    _normalize(specification, collected)
    schemas = specification.setdefault("components", {}).setdefault("schemas", {})
    for name, schema in collected.items():
        schemas.setdefault(name, schema)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(specification, indent=2, sort_keys=True, ensure_ascii=False) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Ketos OpenAPI from local application code")
    parser.add_argument("--output", "-o", type=Path, default=Path(__file__).with_name("openapi.json"))
    generate(parser.parse_args().output)


if __name__ == "__main__":
    main()
