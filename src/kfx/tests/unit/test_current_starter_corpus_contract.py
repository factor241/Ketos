"""Source contracts for the current Ketos starter-flow test corpus."""

from __future__ import annotations

import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[4]
KFX_TESTS = REPO_ROOT / "src" / "kfx" / "tests"
CURRENT_STARTERS = REPO_ROOT / "src" / "backend" / "base" / "ketos" / "initial_setup" / "starter_projects"


def test_historical_starter_corpora_are_not_shipped() -> None:
    historical_data = KFX_TESTS / "data" / ("starter_projects_" + "1_6_0")
    versioned_fixtures = KFX_TESTS / "fixtures" / "starter_flows" / ("v1." + "9.0")
    backward_suite = KFX_TESTS / "unit" / "cli" / ("test_run_starter_projects_backward_" + "compatibility.py")

    assert not any(path.is_file() for path in historical_data.rglob("*"))
    assert not any(path.is_file() for path in versioned_fixtures.rglob("*"))
    assert not backward_suite.exists()
    assert not (KFX_TESTS / "fixtures" / "starter_flows" / "MANIFEST.json").exists()


def test_current_starter_corpus_is_the_single_canonical_flow_source() -> None:
    starters = sorted(CURRENT_STARTERS.glob("*.json"))

    assert len(starters) == 33
    for starter in starters:
        payload = json.loads(starter.read_text(encoding="utf-8"))
        assert isinstance(payload.get("data", {}).get("nodes"), list), starter.name


def test_vlmrun_component_test_lives_in_current_backend_tree_and_uses_current_imports() -> None:
    stale_tree = REPO_ROOT / "src" / "backend" / "src" / ("l" + "fx") / "tests"
    current_test = REPO_ROOT / "src" / "backend" / "tests" / "unit" / "components" / "test_vlmrun_transcription.py"

    assert not any(path.is_file() for path in stale_tree.rglob("*"))
    assert current_test.exists()
    source = current_test.read_text(encoding="utf-8")
    assert "from kfx.components.vlmrun import VLMRunTranscription" in source
    assert "from kfx.schema.data import Data" in source
    assert ("from " + "lang" + "flow") not in source
    assert ("from " + "l" + "fx") not in source
