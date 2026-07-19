"""FastAPI subrouter for the admitted AG-UI LangGraph endpoint."""

from ag_ui_langgraph import LangGraphAgent
from ag_ui_langgraph.endpoint import BeforeDispatch
from fastapi import APIRouter, Depends, FastAPI

from ketos.agentic.services.ag_ui.adapter import register_langgraph_endpoint
from ketos.services.auth.utils import get_current_active_user


def create_ag_ui_router(
    agent: LangGraphAgent,
    *,
    before_dispatch: BeforeDispatch | None = None,
) -> APIRouter:
    """Build a prefix-free router for the existing ``/agentic`` parent."""
    private_app = FastAPI(
        openapi_url=None,
        docs_url=None,
        redoc_url=None,
    )
    register_langgraph_endpoint(
        private_app,
        agent,
        path="/ag-ui",
        dependencies=(Depends(get_current_active_user),),
        before_dispatch=before_dispatch,
    )

    router = APIRouter()
    router.include_router(private_app.router)
    return router
