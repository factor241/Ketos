"""Fail-closed allowlist for the narrow Stage 07 Board execution slice."""

# The exception name and concise validation messages are frozen Stage 07 contracts.
# ruff: noqa: EM101, N818, TRY003

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final

from kfx.utils.flow_validation import (
    code_hash_matches_any_template,
    get_component_hash_lookups_for_validation,
    get_trusted_code_for_validation,
)

BOARD_RUN_POLICY_VERSION: Final = 1
BOARD_RUN_ALLOWED_COMPONENT_TYPES: Final = frozenset(
    {
        "ChatInput",
        "TextInput",
        "Prompt",
        "Pass",
        "TypeConverterComponent",
        "MessagetoData",
        "ParseData",
        "CreateData",
        "ChatOutput",
        "TextOutput",
    }
)
_MAX_NODES = 1000
_MAX_DEPTH = 32


class BoardRunPolicyViolation(ValueError):
    """A persisted Flow is outside the fixed safe Board execution policy."""


@dataclass(frozen=True, slots=True)
class _RegistrySnapshot:
    hashes_by_type: Mapping[str, frozenset[str]]


def _load_registry_snapshot() -> _RegistrySnapshot:
    lookups = get_component_hash_lookups_for_validation()
    if not lookups:
        raise BoardRunPolicyViolation("component template registry is unavailable")
    normalized = {
        component_type: frozenset(hashes)
        for component_type, hashes in lookups.items()
        if isinstance(component_type, str) and hashes
    }
    if not normalized:
        raise BoardRunPolicyViolation("component template registry is unavailable")
    return _RegistrySnapshot(hashes_by_type=normalized)


def _iter_inline_nodes(value: object, *, depth: int = 0):
    if depth > _MAX_DEPTH:
        raise BoardRunPolicyViolation("nested Flow depth exceeds Board policy")
    if isinstance(value, Mapping):
        for key, child in value.items():
            if key == "nodes":
                if not isinstance(child, list):
                    raise BoardRunPolicyViolation("nodes must be a list")
                for node in child:
                    if not isinstance(node, Mapping):
                        raise BoardRunPolicyViolation("every node must be an object")
                    yield node
                    yield from _iter_inline_nodes(node, depth=depth + 1)
            else:
                yield from _iter_inline_nodes(child, depth=depth + 1)
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        for child in value:
            yield from _iter_inline_nodes(child, depth=depth + 1)


def _validate_node(node: Mapping[str, Any], registry: _RegistrySnapshot) -> None:
    node_data = node.get("data")
    if not isinstance(node_data, Mapping):
        raise BoardRunPolicyViolation("node data is invalid")
    component_type = node_data.get("type")
    if not isinstance(component_type, str) or component_type not in BOARD_RUN_ALLOWED_COMPONENT_TYPES:
        raise BoardRunPolicyViolation("component type is not allowed for Board execution")
    expected_hashes = registry.hashes_by_type.get(component_type)
    if not expected_hashes:
        raise BoardRunPolicyViolation("component template is not present in the server registry")
    node_info = node_data.get("node")
    template = node_info.get("template") if isinstance(node_info, Mapping) else None
    code_field = template.get("code") if isinstance(template, Mapping) else None
    code = code_field.get("value") if isinstance(code_field, Mapping) else None
    if not isinstance(code, str) or not code:
        raise BoardRunPolicyViolation("component code is missing")
    if not code_hash_matches_any_template(code, set(expected_hashes)):
        raise BoardRunPolicyViolation("component template does not match the current registry")
    trusted_code = get_trusted_code_for_validation(code)
    if trusted_code is None or trusted_code != code:
        raise BoardRunPolicyViolation("component template is not server-trusted")


def validate_board_run_flow(flow_data: Mapping[str, Any]) -> None:
    """Validate only persisted Flow data against the current server registry."""
    if not isinstance(flow_data, Mapping):
        raise BoardRunPolicyViolation("Flow data must be an object")
    registry = _load_registry_snapshot()
    nodes = list(_iter_inline_nodes(flow_data))
    if not nodes:
        raise BoardRunPolicyViolation("Flow has no inline nodes")
    if len(nodes) > _MAX_NODES:
        raise BoardRunPolicyViolation("Flow node count exceeds Board policy")
    for node in nodes:
        _validate_node(node, registry)
