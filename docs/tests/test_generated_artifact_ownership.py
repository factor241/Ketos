from __future__ import annotations

# ruff: noqa: INP001, S101
import copy
import importlib.util
import json
import sys
import types
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
OWNERSHIP_MANIFEST = REPO_ROOT / "docs" / "artifact-ownership.json"
CANONICAL_OPENAPI = "docs/openapi/openapi.json"
REMOVED_ARTIFACTS = {
    "docs/openapi/langflow-workflows-openapi.json",
    "docs/static/llms.txt",
    "docs/static/llms-full.txt",
    "docs/static/files/AssemblyAI_Flow.json",
    "docs/static/files/Conversational_Notion_Agent.json",
    "docs/static/files/Meeting_Notes_Agent.json",
    "docs/static/files/eval_and_remediate_cleanlab.json",
}


def _load_generator(monkeypatch):
    fake_ketos = types.ModuleType("ketos")
    fake_main = types.ModuleType("ketos.main")
    fake_main.create_app = lambda: None
    monkeypatch.setitem(sys.modules, "ketos", fake_ketos)
    monkeypatch.setitem(sys.modules, "ketos.main", fake_main)

    generator_path = REPO_ROOT / "docs" / "openapi" / "generate_openapi.py"
    spec = importlib.util.spec_from_file_location("ketos_docs_openapi_generator", generator_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_docs_artifact_ownership_is_explicit_and_current():
    manifest = json.loads(OWNERSHIP_MANIFEST.read_text(encoding="utf-8"))
    artifact_entries = manifest["artifacts"]
    artifacts = {entry["path"]: entry for entry in artifact_entries}

    assert len(artifacts) == len(artifact_entries), "artifact paths must be unique"
    assert set(artifacts) == {CANONICAL_OPENAPI, *REMOVED_ARTIFACTS}
    canonical = artifacts[CANONICAL_OPENAPI]
    assert canonical == {
        "path": CANONICAL_OPENAPI,
        "disposition": "generated",
        "producer": "docs/openapi/generate_openapi.py",
        "command": "uv run python docs/openapi/generate_openapi.py",
    }
    assert (REPO_ROOT / canonical["producer"]).is_file()

    for relative_path in REMOVED_ARTIFACTS:
        assert artifacts[relative_path]["disposition"] == "deleted"
        assert artifacts[relative_path]["reason"]
        assert not (REPO_ROOT / relative_path).exists()


def test_openapi_generator_is_deterministic_for_temporary_outputs(tmp_path, monkeypatch):
    generator = _load_generator(monkeypatch)
    source = {
        "paths": {"/z": {"get": {"description": "line one\nline two"}}},
        "components": {"schemas": {"Existing": {"type": "string"}}},
        "$defs": {"Embedded": {"type": "object", "properties": {"z": {"type": "integer"}}}},
        "info": {"version": "1", "title": "Ketos"},
        "openapi": "3.1.0",
    }

    class FakeApp:
        def openapi(self):
            return copy.deepcopy(source)

    monkeypatch.setattr(generator, "create_app", lambda: FakeApp())
    first = tmp_path / "first" / "openapi.json"
    second = tmp_path / "second" / "openapi.json"

    generator.generate(first)
    generator.generate(second)

    assert first.read_bytes() == second.read_bytes()
    assert first.read_bytes().endswith(b"\n")
    generated = json.loads(first.read_text(encoding="utf-8"))
    assert generated["paths"]["/z"]["get"]["description"] == "line one<br>line two"
    assert generated["components"]["schemas"]["Embedded"]["type"] == "object"
    assert "$defs" not in generated
