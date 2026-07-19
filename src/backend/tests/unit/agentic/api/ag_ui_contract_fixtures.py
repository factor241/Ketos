"""Official AG-UI event decoding helpers for Stage 01 contract tests only."""

from __future__ import annotations

from ag_ui.core import Event
from pydantic import TypeAdapter

_EVENT_ADAPTER = TypeAdapter(Event)


def decode_ag_ui_sse(body: str) -> list[Event]:
    """Validate SSE data payloads through the official discriminated event union."""
    return [
        _EVENT_ADAPTER.validate_json(line.removeprefix("data: "))
        for line in body.splitlines()
        if line.startswith("data: ")
    ]
