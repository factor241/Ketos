from __future__ import annotations

import pytest
from ketos.agentic.flows.flow_builder_hitl import (
    FLOW_COMMAND_METADATA_TYPE,
    FLOW_CONFIRMATION_RESPONSE_SCHEMA,
    _validated_decision,
)


def test_flow_confirmation_uses_standard_strict_boolean_resume_schema() -> None:
    assert FLOW_COMMAND_METADATA_TYPE == "ketos.flow-command-confirmation.v1"
    assert FLOW_CONFIRMATION_RESPONSE_SCHEMA == {
        "type": "object",
        "properties": {"approved": {"type": "boolean"}},
        "required": ["approved"],
        "additionalProperties": False,
    }
    assert _validated_decision({"approved": True}) is True
    assert _validated_decision({"approved": False}) is False


@pytest.mark.parametrize(
    "payload",
    [None, True, {}, {"approved": 1}, {"approved": True, "patch": {}}, {"status": "approved"}],
)
def test_flow_confirmation_rejects_partial_or_patch_bearing_resume(payload: object) -> None:
    with pytest.raises(ValueError, match="only boolean approved"):
        _validated_decision(payload)
