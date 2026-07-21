from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import TYPE_CHECKING, TypedDict
from uuid import uuid4

from ketos.agentic.flows import flow_builder_hitl
from ketos.agentic.flows.flow_builder_hitl import FlowBuilderToolContext, create_flow_proposal_tool
from ketos.services.database.models.command_proposal.model import CommandProposalStatus
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command

if TYPE_CHECKING:
    import pytest


class _State(TypedDict, total=False):
    result: str


async def test_proposal_tool_binds_exact_langgraph_interrupt_then_resolves_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    actor_id, project_id, chat_run_id = (uuid4() for _ in range(3))
    proposal_id = uuid4()
    calls: dict[str, list] = {"propose": [], "bind": [], "resolve": []}
    proposal = SimpleNamespace(
        id=proposal_id,
        chat_run_id=chat_run_id,
        proposal_hash="a" * 64,
        preview={"risk": "low", "operationSummaries": []},
        status=CommandProposalStatus.AWAITING_CONFIRMATION,
    )

    @asynccontextmanager
    async def fake_session_scope():
        yield SimpleNamespace(commit=_async_noop)

    async def fake_propose(_session, **kwargs):
        calls["propose"].append(kwargs)
        return proposal

    async def fake_bind(_session, **kwargs):
        calls["bind"].append(kwargs)
        return proposal

    async def fake_resolve(_session, **kwargs):
        calls["resolve"].append(kwargs)
        proposal.status = CommandProposalStatus.APPLIED
        return proposal

    monkeypatch.setattr(flow_builder_hitl, "session_scope", fake_session_scope)
    monkeypatch.setattr(flow_builder_hitl, "propose_flow_changes", fake_propose)
    monkeypatch.setattr(flow_builder_hitl, "bind_interrupt", fake_bind)
    monkeypatch.setattr(flow_builder_hitl, "resolve_proposal", fake_resolve)
    tool = create_flow_proposal_tool(
        FlowBuilderToolContext(
            actor_id=actor_id,
            project_id=project_id,
            chat_run_id=chat_run_id,
            thread_id=str(uuid4()),
            component_registry={},
        )
    )

    async def node(_state: _State) -> _State:
        result = await tool.ainvoke(
            {
                "targetFlowId": None,
                "operations": [
                    {"op": "create_flow", "name": "Safe", "description": None, "nodes": [], "edges": []}
                ],
            }
        )
        return {"result": result}

    builder = StateGraph(_State)
    builder.add_node("proposal", node)
    builder.add_edge(START, "proposal")
    builder.add_edge("proposal", END)
    graph = builder.compile(checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": str(uuid4())}}

    await graph.ainvoke({}, config)
    interrupted = await graph.aget_state(config)
    assert len(interrupted.tasks) == 1
    actual_interrupt = interrupted.tasks[0].interrupts[0]
    payload = actual_interrupt.value
    assert calls["bind"][0]["interrupt_id"] == actual_interrupt.id
    assert payload["reason"] == "confirmation"
    assert payload["metadata"]["proposalId"] == str(proposal_id)
    assert calls["resolve"] == []

    final = await graph.ainvoke(Command(resume={"approved": True}), config)
    assert final["result"] == f'{{"proposalId":"{proposal_id}","status":"applied"}}'
    assert len(calls["resolve"]) == 1
    assert calls["resolve"][0]["approved"] is True
    assert calls["resolve"][0]["interrupt_id"] == actual_interrupt.id


async def _async_noop() -> None:
    return None


def test_flatten_component_registry_preserves_registered_names() -> None:
    assert flow_builder_hitl.flatten_component_registry(
        {"agents": {"Agent": {"template": {}}}, "metadata": "ignored"}
    ) == {"Agent": {"template": {}}}
