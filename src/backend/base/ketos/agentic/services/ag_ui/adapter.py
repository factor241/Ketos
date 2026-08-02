"""Thin registration seam over the admitted AG-UI LangGraph adapter."""

from collections.abc import Sequence

from ag_ui_langgraph import LangGraphAgent, add_langgraph_fastapi_endpoint
from ag_ui_langgraph.endpoint import BeforeDispatch
from fastapi import FastAPI
from fastapi.params import Depends as DependsParameter


def register_langgraph_endpoint(
    app: FastAPI,
    agent: LangGraphAgent,
    *,
    path: str,
    dependencies: Sequence[DependsParameter] = (),
    before_dispatch: BeforeDispatch | None = None,
) -> None:
    """Register the upstream endpoint without adding a Ketos protocol layer."""
    add_langgraph_fastapi_endpoint(
        app,
        agent,
        path,
        dependencies=dependencies,
        before_dispatch=before_dispatch,
    )
