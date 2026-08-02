"""Strict bounded shared-state contract for the Stage 01 AG-UI probe."""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import TYPE_CHECKING, Literal

from kfx.schema import Data
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode
from pydantic import BaseModel, ConfigDict, Field

from ketos.agentic.services.ag_ui.probe_tools import MAX_RESULTS, build_probe_tools

if TYPE_CHECKING:
    from collections.abc import Callable

    from kfx.components.models_and_agents.agent import AgentComponent
    from langgraph.checkpoint.base import BaseCheckpointSaver
    from langgraph.graph.state import CompiledStateGraph

StageMarker = Literal["stage-01"]
ToolStatus = Literal["idle", "running", "completed", "error"]
ConfirmationStatus = Literal["not_requested", "pending", "approved", "rejected"]


class ProbeSharedState(BaseModel):
    """Only fields that may be emitted in AG-UI shared-state snapshots."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    stage: StageMarker = "stage-01"
    tool_status: ToolStatus = "idle"
    tool_result_count: int = Field(default=0, ge=0, le=MAX_RESULTS)
    confirmation_status: ConfirmationStatus = "not_requested"


class ProbeGraphState(MessagesState):
    """LangGraph state: protocol messages plus the bounded shared projection."""

    stage: StageMarker
    tool_status: ToolStatus
    tool_result_count: int
    confirmation_status: ConfirmationStatus


def validate_probe_state(state: object) -> dict[str, object]:
    """Validate and return the JSON-safe shared-state projection."""
    return ProbeSharedState.model_validate(state).model_dump(mode="json")


def initial_probe_state() -> dict[str, object]:
    return ProbeSharedState().model_dump(mode="json")


def running_probe_state() -> dict[str, object]:
    return ProbeSharedState(tool_status="running").model_dump(mode="json")


def completed_probe_state(*, result_count: int) -> dict[str, object]:
    return ProbeSharedState(tool_status="completed", tool_result_count=result_count).model_dump(mode="json")


def error_probe_state() -> dict[str, object]:
    return ProbeSharedState(tool_status="error").model_dump(mode="json")


def _validated_tool_result_count(
    state: ProbeGraphState,
    *,
    expected_tool_name: str,
) -> int:
    messages = state.get("messages")
    if not isinstance(messages, list) or not messages:
        message = "probe tool result message is missing"
        raise ValueError(message)

    tool_result = messages[-1]
    if (
        not isinstance(tool_result, ToolMessage)
        or tool_result.name != expected_tool_name
        or tool_result.status != "success"
    ):
        message = "probe tool result message is invalid"
        raise ValueError(message)

    artifact = tool_result.artifact
    if isinstance(artifact, Data):
        payload = artifact.data
    elif isinstance(artifact, Mapping):
        payload = artifact
    else:
        if not isinstance(tool_result.content, str):
            message = "probe tool result content must be JSON text"
            raise TypeError(message)
        try:
            payload = json.loads(tool_result.content)
        except (TypeError, json.JSONDecodeError) as exc:
            message = "probe tool result content is malformed"
            raise ValueError(message) from exc

    if not isinstance(payload, Mapping):
        message = "probe tool result payload must be an object"
        raise TypeError(message)
    count = payload.get("count")
    results = payload.get("results")
    truncated = payload.get("truncated")
    if (
        isinstance(count, bool)
        or not isinstance(count, int)
        or not 0 <= count <= MAX_RESULTS
        or not isinstance(results, list)
        or len(results) != count
        or not isinstance(truncated, bool)
    ):
        message = "probe tool result payload violates the bounded contract"
        raise ValueError(message)
    return count


async def prepare_probe_graph_builder(
    *,
    ketos_actor_id: str,
    checkpointer: BaseCheckpointSaver | None = None,
) -> Callable[[AgentComponent], CompiledStateGraph]:
    """Prepare the real KFX tool, then return A02's synchronous builder seam."""
    tool = (await build_probe_tools(ketos_actor_id=ketos_actor_id))[0]

    def graph_builder(_component: AgentComponent) -> CompiledStateGraph:
        async def request_tool(_state: ProbeGraphState) -> dict[str, object]:
            return {
                "messages": [
                    AIMessage(
                        content="",
                        tool_calls=[
                            {
                                "name": tool.name,
                                "args": {"query": "chat"},
                                "id": "call-a07",
                            }
                        ],
                    )
                ],
                **running_probe_state(),
            }

        async def finish_probe(_state: ProbeGraphState) -> dict[str, object]:
            try:
                result_count = _validated_tool_result_count(
                    _state,
                    expected_tool_name=tool.name,
                )
            except (TypeError, ValueError):
                return {
                    "messages": [AIMessage(content="Read-only KFX probe result rejected.")],
                    **error_probe_state(),
                }
            return {
                "messages": [AIMessage(content="Read-only KFX probe complete.")],
                **completed_probe_state(result_count=result_count),
            }

        builder = StateGraph(ProbeGraphState, output_schema=ProbeSharedState)
        builder.add_node("request_tool", request_tool)
        builder.add_node("tools", ToolNode([tool]))
        builder.add_node("finish_probe", finish_probe)
        builder.add_edge(START, "request_tool")
        builder.add_edge("request_tool", "tools")
        builder.add_edge("tools", "finish_probe")
        builder.add_edge("finish_probe", END)
        return builder.compile(checkpointer=checkpointer)

    return graph_builder
