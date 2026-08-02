from __future__ import annotations

from pathlib import Path

import pytest
from ketos.agentic.services.flow_command_policy import (
    FlowCommandPolicyError,
    assert_proposal_toolkit_safe,
    reject_flow_command_bypass,
)


@pytest.mark.parametrize(
    "payload",
    [
        {"auto_apply": True},
        {"nested": {"skipAll": True}},
        {"forwarded-props": {"command": {"resume": True}}},
        {"operations": [{"code": "print('unsafe')"}]},
        {"config": {"mcp": "attacker"}},
        {"config": {"provider": "browser-selected"}},
    ],
)
def test_nested_bypass_authority_is_denied(payload: dict) -> None:
    with pytest.raises(FlowCommandPolicyError, match="flow_command_bypass_denied"):
        reject_flow_command_bypass(payload)


def test_only_read_and_proposal_tool_names_are_allowed() -> None:
    assert_proposal_toolkit_safe(["SearchComponentTypes", "DescribeComponentType", "ProposeFlowChanges"])
    for forbidden in ("AddComponent", "RunFlow", "FileSystem", "GenerateComponent"):
        with pytest.raises(FlowCommandPolicyError, match="flow_command_toolkit_denied"):
            assert_proposal_toolkit_safe(["ProposeFlowChanges", forbidden])


def test_new_agentic_path_has_no_legacy_resume_or_direct_writer_imports() -> None:
    root = Path(__file__).parents[4] / "base" / "ketos" / "agentic"
    sources = "\n".join(
        path.read_text(encoding="utf-8")
        for path in (
            root / "flows" / "flow_builder_hitl.py",
            root / "services" / "flow_proposal_adapter.py",
            root / "tools" / "flow_proposal_tools.py",
        )
    )
    assert "forwarded_props.command.resume" not in sources
    assert "AssistantPanel" not in sources
    assert "execute_flow_file" not in sources
    assert "AddComponent" not in sources
    assert "RunFlow" not in sources
