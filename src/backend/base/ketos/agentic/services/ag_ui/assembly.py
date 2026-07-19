"""Assembly of the admitted AG-UI adapter over the persisted KFX agent."""

from ag_ui_langgraph import LangGraphAgent
from kfx.components.models_and_agents.agent import AgentComponent


def assemble_langgraph_agent(component: AgentComponent) -> LangGraphAgent:
    """Build the public AG-UI agent from an already configured KFX component."""
    graph = component.create_agent_runnable()
    return LangGraphAgent(name="ketos-mvp-probe", graph=graph)
