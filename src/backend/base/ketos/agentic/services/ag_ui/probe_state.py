"""Strict bounded shared-state contract for the Stage 01 AG-UI probe."""

from __future__ import annotations

from typing import Literal

from langgraph.graph import MessagesState
from pydantic import BaseModel, ConfigDict, Field

from ketos.agentic.services.ag_ui.probe_tools import MAX_RESULTS

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
