"""Application-lifetime assembly for the Stage 01 AG-UI MVP."""

from __future__ import annotations

import inspect
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from typing import TYPE_CHECKING, Any, Self

from kfx.components.models_and_agents.agent import AgentComponent
from kfx.services.settings.feature_flags import FEATURE_FLAGS
from langgraph.graph import END, START, MessagesState, StateGraph

from ketos.agentic.api.router import register_stage01_ag_ui, unregister_stage01_ag_ui
from ketos.agentic.services.ag_ui.assembly import assemble_langgraph_agent
from ketos.agentic.services.ag_ui.checkpoint import AsyncSqliteCheckpoint
from ketos.agentic.services.ag_ui.hitl_probe import build_hitl_probe_graph, initial_hitl_probe_state
from ketos.agentic.services.ag_ui.probe_state import (
    ConfirmationStatus,
    StageMarker,
    ToolStatus,
    prepare_probe_graph_builder,
)
from ketos.agentic.services.ag_ui.run_binding import BeforeDispatchHook, create_ag_ui_before_dispatch

if TYPE_CHECKING:
    from collections.abc import Callable

    from ag_ui_langgraph import LangGraphAgent
    from fastapi import FastAPI
    from langgraph.checkpoint.base import BaseCheckpointSaver
    from langgraph.graph.state import CompiledStateGraph


class Stage01GraphState(MessagesState, total=False):
    """Shared bounded state for the read-only probe and two confirmations."""

    stage: StageMarker
    tool_status: ToolStatus
    tool_result_count: int
    confirmation_status: ConfirmationStatus
    stage_marker: str
    effect_count: int
    confirmation_a: bool | None
    confirmation_b: bool | None
    final_decision: str


async def build_stage01_graph(*, checkpointer: BaseCheckpointSaver) -> CompiledStateGraph:
    """Compose the admitted A07 tool/state flow and A08 HITL flow once."""
    component = AgentComponent()
    # A07 is official-only and actor-isolated; A06's request config remains the
    # sole authority. This label is only a bounded factory input, never identity.
    probe_builder = await prepare_probe_graph_builder(ketos_actor_id="server-isolated-probe")
    probe_graph = probe_builder(component)
    hitl_graph = build_hitl_probe_graph(checkpointer=None)  # type: ignore[arg-type]

    builder = StateGraph(Stage01GraphState)
    builder.add_node("initialize_hitl", lambda _state: initial_hitl_probe_state())
    builder.add_node("read_only_kfx_probe", probe_graph)
    builder.add_node("human_confirmation", hitl_graph)
    builder.add_edge(START, "initialize_hitl")
    builder.add_edge("initialize_hitl", "read_only_kfx_probe")
    builder.add_edge("read_only_kfx_probe", "human_confirmation")
    builder.add_edge("human_confirmation", END)
    return builder.compile(checkpointer=checkpointer)


class Stage01AgUiRuntime:
    """Own exactly one checkpoint, graph, AG-UI agent, and binding hook."""

    def __init__(self, *, checkpoint: AsyncSqliteCheckpoint | None = None) -> None:
        self.checkpoint = checkpoint or AsyncSqliteCheckpoint()
        self.before_dispatch: BeforeDispatchHook = create_ag_ui_before_dispatch()
        self.agent: LangGraphAgent | None = None

    async def _build_agent(self, saver: BaseCheckpointSaver) -> LangGraphAgent:
        graph = await build_stage01_graph(checkpointer=saver)
        component = AgentComponent()
        return assemble_langgraph_agent(component, graph_builder=lambda _component: graph)

    async def __aenter__(self) -> Self:
        saver = await self.checkpoint.open()
        try:
            await saver.setup()
            built_agent: Any = self._build_agent(saver)
            if inspect.isawaitable(built_agent):
                built_agent = await built_agent
        except BaseException:
            await self.checkpoint.close()
            raise
        else:
            self.agent = built_agent
            return self

    async def __aexit__(self, *_exc_info: object) -> None:
        self.agent = None
        await self.checkpoint.close()


def compose_stage01_lifespan(
    base_lifespan: Callable[[FastAPI], AbstractAsyncContextManager[None]],
    runtime_factory: Callable[[], Stage01AgUiRuntime] = Stage01AgUiRuntime,
) -> Callable[[FastAPI], AbstractAsyncContextManager[None]]:
    """Open and register the Stage 01 runtime inside the normal app lifespan."""

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        async with base_lifespan(app):
            if not (FEATURE_FLAGS.mvp_workspace is True and FEATURE_FLAGS.mvp_chat is True):
                yield
                return
            async with runtime_factory() as runtime:
                registered = register_stage01_ag_ui(app, runtime)
                try:
                    yield
                finally:
                    if registered:
                        unregister_stage01_ag_ui(app)

    return lifespan


__all__ = [
    "Stage01AgUiRuntime",
    "Stage01GraphState",
    "build_stage01_graph",
    "compose_stage01_lifespan",
]
