from __future__ import annotations

import copy
from typing import TYPE_CHECKING, Protocol

from .canonical import flow_content_hash

if TYPE_CHECKING:
    from ketos.services.database.models.flow.model import Flow


class FlowContentMutation(Protocol):
    def __call__(self, flow: Flow) -> object: ...


def _content_state(flow: Flow) -> dict[str, object]:
    name = getattr(flow, "name", None)
    description = getattr(flow, "description", None)
    data = getattr(flow, "data", None)
    return {
        "name": name if isinstance(name, str) else None,
        "description": description if isinstance(description, str) or description is None else None,
        "data": data if isinstance(data, dict) or data is None else None,
    }


def mutate_flow_content_once(flow: Flow, mutation: FlowContentMutation) -> bool:
    """Apply one writer mutation and bump revision iff persisted content changed."""
    before = copy.deepcopy(_content_state(flow))
    raw_revision = getattr(flow, "revision", 0)
    before_revision = raw_revision if isinstance(raw_revision, int) else 0
    before_hash = flow_content_hash(before)

    try:
        mutation(flow)
        changed = flow_content_hash(_content_state(flow)) != before_hash
    except Exception:
        flow.name = before["name"]  # type: ignore[assignment]
        flow.description = before["description"]  # type: ignore[assignment]
        flow.data = before["data"]  # type: ignore[assignment]
        flow.revision = before_revision
        raise

    flow.revision = before_revision + 1 if changed else before_revision
    return changed
