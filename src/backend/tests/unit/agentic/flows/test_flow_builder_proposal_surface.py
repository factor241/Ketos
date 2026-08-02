from __future__ import annotations

from uuid import uuid4

import pytest
from ketos.agentic.flows.flow_builder_hitl import FlowBuilderToolContext, create_flow_proposal_tool
from pydantic import ValidationError


def test_flow_builder_exposes_only_the_proposal_mutation_tool() -> None:
    tool = create_flow_proposal_tool(
        FlowBuilderToolContext(
            actor_id=uuid4(),
            project_id=uuid4(),
            chat_run_id=uuid4(),
            thread_id=str(uuid4()),
            component_registry={},
        )
    )

    assert tool.name == "ProposeFlowChanges"
    assert "never changes a flow until" in tool.description
    assert set(tool.args_schema.model_fields) == {"target_flow_id", "operations"}


def test_flow_builder_tool_schema_rejects_server_owned_fields() -> None:
    tool = create_flow_proposal_tool(
        FlowBuilderToolContext(
            actor_id=uuid4(),
            project_id=uuid4(),
            chat_run_id=uuid4(),
            thread_id=str(uuid4()),
            component_registry={},
        )
    )

    with pytest.raises(ValidationError):
        tool.args_schema.model_validate(
            {
                "operations": [{"op": "create_flow"}],
                "actorId": str(uuid4()),
                "interruptId": "forged",
            }
        )
