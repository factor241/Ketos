"""Assembly of the admitted AG-UI adapter over the persisted KFX agent."""

from collections.abc import Callable
from typing import TypeAlias

from ag_ui_langgraph import LangGraphAgent
from kfx.components.models_and_agents.agent import AgentComponent
from langchain_core.runnables import RunnableConfig
from langgraph.graph.state import CompiledStateGraph

GraphBuilder: TypeAlias = Callable[[AgentComponent], CompiledStateGraph]


def _build_component_graph(component: AgentComponent) -> CompiledStateGraph:
    return component.create_agent_runnable()


def assemble_langgraph_agent(
    component: AgentComponent,
    *,
    graph_builder: GraphBuilder | None = None,
    config: RunnableConfig | None = None,
) -> LangGraphAgent:
    """Build the public AG-UI agent from an already configured KFX component."""
    builder = _build_component_graph if graph_builder is None else graph_builder
    graph = builder(component)
    if config is not None:
        return LangGraphAgent(name="ketos-mvp-probe", graph=graph, config=config)
    return LangGraphAgent(name="ketos-mvp-probe", graph=graph)
