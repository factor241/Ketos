# ruff: noqa: SLF001
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "bake_note_keys.py"
SPEC = importlib.util.spec_from_file_location("bake_note_keys", SCRIPT)
assert SPEC is not None
assert SPEC.loader is not None
baker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(baker)


def test_default_starter_path_is_canonical_ketos_tree() -> None:
    assert baker.STARTER_PROJECTS_DIR.as_posix().endswith("src/backend/base/ketos/initial_setup/starter_projects")


def test_bake_file_writes_a_stable_content_addressed_key(tmp_path: Path) -> None:
    path = tmp_path / "Flow.json"
    path.write_text(
        json.dumps(
            {
                "name": "Demo Flow",
                "data": {
                    "nodes": [
                        {"type": "noteNode", "data": {"node": {"description": "Remember this"}}},
                    ]
                },
            }
        ),
        encoding="utf-8",
    )

    assert baker._bake_file(path, dry_run=False) == 1
    first = path.read_bytes()
    assert baker._bake_file(path, dry_run=False) == 0
    assert path.read_bytes() == first
    assert json.loads(first)["data"]["nodes"][0]["data"]["node"]["i18n_key"].startswith("template_notes.demo_flow.")
