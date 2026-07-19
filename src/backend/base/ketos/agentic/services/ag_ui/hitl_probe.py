from __future__ import annotations

from typing import TYPE_CHECKING, Any, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

if TYPE_CHECKING:
    from langgraph.checkpoint.base import BaseCheckpointSaver
    from langgraph.graph.state import CompiledStateGraph

STAGE_MARKER = "stage-01-ag-ui-hitl"
APPROVAL_RESPONSE_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {"approved": {"type": "boolean"}},
    "required": ["approved"],
    "additionalProperties": False,
}


class HitlProbeState(TypedDict, total=False):
    stage_marker: str
    effect_count: int
    confirmation_a: bool | None
    confirmation_b: bool | None
    final_decision: str


def initial_hitl_probe_state() -> HitlProbeState:
    return {
        "stage_marker": STAGE_MARKER,
        "effect_count": 0,
        "confirmation_a": None,
        "confirmation_b": None,
        "final_decision": "pending",
    }


def _interrupt_payload(label: str) -> dict[str, object]:
    return {
        "reason": "confirmation",
        "message": f"Confirm deterministic Stage 01 decision {label}.",
        "responseSchema": APPROVAL_RESPONSE_SCHEMA,
    }


def _validated_approval(value: Any) -> bool:
    if not isinstance(value, dict) or set(value) != {"approved"}:
        message = "confirmation response must contain only approved"
        raise ValueError(message)
    approved = value["approved"]
    if type(approved) is not bool:
        message = "confirmation approved value must be a boolean"
        raise ValueError(message)
    return approved


def _confirmation_a(_state: HitlProbeState) -> HitlProbeState:
    decision = _validated_approval(interrupt(_interrupt_payload("A")))
    return {"confirmation_a": decision}


def _confirmation_b(_state: HitlProbeState) -> HitlProbeState:
    decision = _validated_approval(interrupt(_interrupt_payload("B")))
    return {"confirmation_b": decision}


def _apply_effect(state: HitlProbeState) -> HitlProbeState:
    if state.get("effect_count") != 0:
        message = "post-confirmation effect was already applied"
        raise RuntimeError(message)
    decisions = (state.get("confirmation_a"), state.get("confirmation_b"))
    if any(type(decision) is not bool for decision in decisions):
        message = "both confirmation decisions are required"
        raise RuntimeError(message)
    return {
        "effect_count": 1,
        "final_decision": "approved" if all(decisions) else "rejected",
    }


def build_hitl_probe_graph(*, checkpointer: BaseCheckpointSaver[str]) -> CompiledStateGraph:
    builder = StateGraph(HitlProbeState)
    builder.add_node("confirmation_a", _confirmation_a)
    builder.add_node("confirmation_b", _confirmation_b)
    builder.add_node("apply_effect", _apply_effect)
    builder.add_edge(START, "confirmation_a")
    builder.add_edge(START, "confirmation_b")
    builder.add_edge(["confirmation_a", "confirmation_b"], "apply_effect")
    builder.add_edge("apply_effect", END)
    return builder.compile(checkpointer=checkpointer)
