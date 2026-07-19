"""Bounded binding for the single read-only KFX Stage 01 probe tool."""

from __future__ import annotations

import json
from collections.abc import Mapping
from contextvars import copy_context
from typing import TYPE_CHECKING, Any

from kfx.mcp.flow_builder_tools.read_tools import SearchComponentTypes
from kfx.mcp.tool_cache import reset_tool_cache
from kfx.schema import Data

from ketos.agentic.services.user_components_context import set_current_user_id

if TYPE_CHECKING:
    from langchain_core.tools import BaseTool

APPROVED_COMPONENT = SearchComponentTypes
MAX_QUERY_LENGTH = 64
MAX_RESULTS = 5
MAX_RESULT_BYTES = 4096
MAX_ACTOR_ID_LENGTH = 128
_RESULT_KEYS = ("type", "category", "display_name", "description")
_MAX_FIELD_LENGTH = 256


def _validated_actor_id(actor_id: str) -> str:
    if not isinstance(actor_id, str):
        message = "actor_id must be a string"
        raise TypeError(message)
    normalized = actor_id.strip()
    if not normalized or len(normalized) > MAX_ACTOR_ID_LENGTH:
        message = f"actor_id must contain 1..{MAX_ACTOR_ID_LENGTH} characters"
        raise ValueError(message)
    return normalized


def _validated_query(query: str) -> str:
    if not isinstance(query, str):
        message = "query must be a string"
        raise TypeError(message)
    normalized = query.strip()
    if not normalized or len(normalized) > MAX_QUERY_LENGTH:
        message = f"query must contain 1..{MAX_QUERY_LENGTH} characters"
        raise ValueError(message)
    return normalized


def _bounded_result(result: object) -> Data:
    raw_data = result if isinstance(result, Mapping) else getattr(result, "data", {})
    raw_results = raw_data.get("results", []) if isinstance(raw_data, Mapping) else []
    bounded: list[dict[str, str]] = []
    if isinstance(raw_results, list):
        for raw_item in raw_results[:MAX_RESULTS]:
            if not isinstance(raw_item, Mapping):
                continue
            item = {
                key: str(raw_item[key])[:_MAX_FIELD_LENGTH]
                for key in _RESULT_KEYS
                if key in raw_item and raw_item[key] is not None
            }
            bounded.append(item)

    original_count = raw_data.get("count", len(raw_results)) if isinstance(raw_data, Mapping) else 0
    try:
        original_count = max(0, int(original_count))
    except (TypeError, ValueError):
        original_count = len(raw_results) if isinstance(raw_results, list) else 0

    payload: dict[str, Any] = {
        "results": bounded,
        "count": len(bounded),
        "truncated": original_count > len(bounded),
    }
    while bounded and len(json.dumps(payload, ensure_ascii=False).encode()) > MAX_RESULT_BYTES:
        bounded.pop()
        payload["count"] = len(bounded)
        payload["truncated"] = True
    return Data(data=payload)


async def build_probe_tools(*, ketos_actor_id: str) -> list[BaseTool]:
    """Convert exactly one approved KFX component into an official-only probe tool."""
    _validated_actor_id(ketos_actor_id)
    tools = await APPROVED_COMPONENT().to_toolkit()
    if len(tools) != 1:
        message = "approved KFX component must expose exactly one tool"
        raise RuntimeError(message)

    tool = tools[0]
    original_func = getattr(tool, "func", None)
    if not callable(original_func):
        message = "approved KFX component did not expose a synchronous tool function"
        raise TypeError(message)

    def bounded_search(*, query: str) -> Data:
        query = _validated_query(query)
        probe_context = copy_context()

        def invoke_official_only() -> Data:
            # SearchComponentTypes is user-aware by default. The isolated
            # context keeps the caller's actor/cache intact while making
            # persisted custom component code unreachable to the real tool.
            reset_tool_cache()
            set_current_user_id(None)
            try:
                return _bounded_result(original_func(query=query))
            finally:
                reset_tool_cache()

        return probe_context.run(invoke_official_only)

    tool.func = bounded_search
    return [tool]
