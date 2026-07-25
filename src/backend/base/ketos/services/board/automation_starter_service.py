import copy
import json
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ketos.api.v1.flows_helpers import _new_flow_uncommitted
from ketos.api.v1.schemas.board_commands import (
    BlankAutomationStarter,
    NonCleanStarter,
    SimpleAgentStarter,
    TemplateStarter,
    VectorStoreRagStarter,
)
from ketos.services.board.exceptions import BoardResourceNotFoundError
from ketos.services.database.models.flow.model import Flow, FlowCreate

_STARTER_DIRECTORY = Path(__file__).resolve().parents[2] / "initial_setup" / "starter_projects"
_NAMED_STARTER_FILES = {
    "simple_agent": "Simple Agent.json",
    "vector_store_rag": "Vector Store RAG.json",
}


class CanonicalStarterInvariantError(RuntimeError):
    """Raised when a bundled canonical starter violates its data contract."""


@dataclass(frozen=True, slots=True)
class PreparedAutomationStarter:
    name: str
    description: str | None
    data: dict
    icon: str | None = None
    icon_bg_color: str | None = None
    gradient: str | None = None
    tags: list[str] | None = None


def _load_named_starter(kind: str, *, name: str) -> PreparedAutomationStarter:
    path = _STARTER_DIRECTORY / _NAMED_STARTER_FILES[kind]
    payload = json.loads(path.read_text(encoding="utf-8"))
    data = payload.get("data")
    if not isinstance(data, dict) or not isinstance(data.get("nodes"), list) or not isinstance(data.get("edges"), list):
        msg = f"Canonical starter {kind} is invalid"
        raise CanonicalStarterInvariantError(msg)
    return PreparedAutomationStarter(
        name=name,
        description=payload.get("description") if isinstance(payload.get("description"), str) else None,
        data=copy.deepcopy(data),
        tags=copy.deepcopy(payload.get("tags")) if isinstance(payload.get("tags"), list) else None,
    )


async def prepare_automation_starter(
    session: AsyncSession,
    *,
    starter: NonCleanStarter,
    actor_id: UUID,
) -> PreparedAutomationStarter:
    if isinstance(starter, BlankAutomationStarter):
        return PreparedAutomationStarter(
            name=starter.name,
            description=None,
            data={"nodes": [], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 1}},
        )
    if isinstance(starter, SimpleAgentStarter):
        return _load_named_starter("simple_agent", name=starter.name)
    if isinstance(starter, VectorStoreRagStarter):
        return _load_named_starter("vector_store_rag", name=starter.name)
    if isinstance(starter, TemplateStarter):
        template = (
            await session.exec(
                select(Flow).where(
                    Flow.id == starter.template_id,
                    Flow.user_id == actor_id,
                    Flow.is_component == False,  # noqa: E712
                )
            )
        ).first()
        if template is None or template.data is None:
            raise BoardResourceNotFoundError(starter.template_id)
        return PreparedAutomationStarter(
            name=starter.name,
            description=template.description,
            data=copy.deepcopy(template.data),
            icon=template.icon,
            icon_bg_color=template.icon_bg_color,
            gradient=template.gradient,
            tags=copy.deepcopy(template.tags),
        )
    message = "unsupported automation starter"
    raise TypeError(message)


async def create_started_automation_uncommitted(
    session: AsyncSession,
    *,
    prepared: PreparedAutomationStarter,
    actor_id: UUID,
    project_id: UUID,
    flow_id: UUID,
) -> Flow:
    flow = FlowCreate(
        name=prepared.name,
        description=prepared.description,
        data=copy.deepcopy(prepared.data),
        folder_id=project_id,
        icon=prepared.icon,
        icon_bg_color=prepared.icon_bg_color,
        gradient=prepared.gradient,
        tags=copy.deepcopy(prepared.tags),
        is_component=False,
        endpoint_name=None,
        fs_path=None,
    )
    return await _new_flow_uncommitted(
        session=session,
        flow=flow,
        user_id=actor_id,
        flow_id=flow_id,
        validate_folder=False,
    )
