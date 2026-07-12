# ruff: noqa: S101, S506 - pytest assertions and scalar-only BaseLoader are intentional.
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = REPO_ROOT / ".github/workflows/brand-contract.yml"


def test_brand_contract_workflow_runs_for_every_change() -> None:
    assert WORKFLOW.is_file(), "Stage 0 scanner must be enforced by CI"
    document = yaml.load(WORKFLOW.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)
    triggers = document["on"]
    assert "pull_request" in triggers
    assert "push" in triggers
    assert "paths" not in triggers["pull_request"]
    assert "paths-ignore" not in triggers["pull_request"]


def test_brand_contract_workflow_runs_tests_and_stage0_profile() -> None:
    assert WORKFLOW.is_file(), "Stage 0 scanner must be enforced by CI"
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "uv run pytest scripts/rebrand/tests -q" in text
    assert "scripts/rebrand/check_brand.py --profile stage0" in text
    assert "fetch-depth: 0" in text
