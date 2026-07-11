from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from langflow.services.auth.utils import get_current_active_user

router = APIRouter(prefix="/starter-projects", tags=["Flows"])


# Pydantic models for API schema compatibility
class ViewPort(BaseModel):
    x: float
    y: float
    zoom: float


class NodeData(BaseModel):
    # This is a simplified version - the actual NodeData has many more fields
    # but we only need the basic structure for the API schema
    model_config = {"extra": "allow"}  # Allow extra fields


class EdgeData(BaseModel):
    # This is a simplified version - the actual EdgeData has many more fields
    # but we only need the basic structure for the API schema
    model_config = {"extra": "allow"}  # Allow extra fields


class GraphData(BaseModel):
    nodes: list[dict[str, Any]]  # Use dict to be flexible with the complex NodeData structure
    edges: list[dict[str, Any]]  # Use dict to be flexible with the complex EdgeData structure
    viewport: ViewPort | None = None


class GraphDumpResponse(BaseModel):
    data: GraphData
    is_component: bool | None = None
    name: str | None = None
    description: str | None = None
    name_i18n_key: str | None = None
    description_i18n_key: str | None = None
    endpoint_name: str | None = None


@router.get("/", dependencies=[Depends(get_current_active_user)], status_code=200)
async def get_starter_projects(request: Request) -> list[GraphDumpResponse]:
    """Get a list of starter projects."""
    from langflow.initial_setup.load import get_starter_projects_dump
    from langflow.utils.i18n import translate, translate_flow_notes

    locale = getattr(request.state, "locale", "en")

    try:
        # Get the raw data from lfx GraphDump
        raw_data = get_starter_projects_dump()

        # Convert TypedDict GraphDump to Pydantic GraphDumpResponse
        results = []
        for item in raw_data:
            nodes = item.get("data", {}).get("nodes", [])
            translated_nodes = translate_flow_notes(nodes, locale)
            name = item.get("name")
            description = item.get("description")
            name_i18n_key = item.get("name_i18n_key")
            description_i18n_key = item.get("description_i18n_key")

            # Create GraphData
            graph_data = GraphData(
                nodes=translated_nodes,
                edges=item.get("data", {}).get("edges", []),
                viewport=item.get("data", {}).get("viewport"),
            )

            # Create GraphDumpResponse
            graph_dump = GraphDumpResponse(
                data=graph_data,
                is_component=item.get("is_component"),
                name=translate(name_i18n_key, locale, name) if name_i18n_key and name else name,
                description=(
                    translate(description_i18n_key, locale, description)
                    if description_i18n_key and description
                    else description
                ),
                name_i18n_key=name_i18n_key,
                description_i18n_key=description_i18n_key,
                endpoint_name=item.get("endpoint_name"),
            )
            results.append(graph_dump)

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return results
