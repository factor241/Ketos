# Stable machine-readable error codes are intentionally raised as literals.
# ruff: noqa: EM101

from __future__ import annotations

import copy
import json
import re
from typing import Annotated, Any, Literal
from uuid import UUID

from kfx.graph.flow_builder.component import add_component, configure_component
from kfx.graph.flow_builder.connect import add_connection
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from .canonical import CanonicalizationError, canonical_json_bytes, flow_content_hash

MAX_OPERATIONS = 128
MAX_PAYLOAD_BYTES = 1_048_576
MAX_PREVIEW_BYTES = 65_536
MAX_STRING_BYTES = 16_384

_IDENTIFIER_RE = re.compile(r"[A-Za-z0-9_.:-]{1,128}\Z")
_FORBIDDEN_FIELD_RE = re.compile(
    r"(?:^|[_-])(code|python|filesystem|mcp|provider|model|secret|auth|token|password|key|credential)(?:$|[_-])",
    re.IGNORECASE,
)


class FlowChangeError(ValueError):
    def __init__(self, code: str, *, operation_index: int | None = None) -> None:
        self.code = code
        self.operation_index = operation_index
        super().__init__(code)


def _flow_error(code: str, *, operation_index: int | None = None) -> FlowChangeError:
    return FlowChangeError(code, operation_index=operation_index)


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class CreateFlowOperation(_StrictModel):
    op: Literal["create_flow"]
    name: str
    description: str | None = None
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]


class AddNodeOperation(_StrictModel):
    op: Literal["add_node"]
    node_id: str = Field(alias="nodeId")
    component_type: str = Field(alias="componentType")
    parameters: dict[str, Any] = Field(default_factory=dict)


class RemoveNodeOperation(_StrictModel):
    op: Literal["remove_node"]
    node_id: str = Field(alias="nodeId")


class SetParameterOperation(_StrictModel):
    op: Literal["set_parameter"]
    node_id: str = Field(alias="nodeId")
    parameter: str
    value: Any


class ConnectNodesOperation(_StrictModel):
    op: Literal["connect_nodes"]
    source_node_id: str = Field(alias="sourceNodeId")
    source_output: str = Field(alias="sourceOutput")
    target_node_id: str = Field(alias="targetNodeId")
    target_input: str = Field(alias="targetInput")


class DisconnectNodesOperation(ConnectNodesOperation):
    op: Literal["disconnect_nodes"]


class ReplaceFlowOperation(_StrictModel):
    op: Literal["replace_flow"]
    name: str
    description: str | None = None
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]


FlowOperation = Annotated[
    CreateFlowOperation
    | AddNodeOperation
    | RemoveNodeOperation
    | SetParameterOperation
    | ConnectNodesOperation
    | DisconnectNodesOperation
    | ReplaceFlowOperation,
    Field(discriminator="op"),
]


class FlowChangeSetV1(_StrictModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    target_project_id: UUID = Field(alias="targetProjectId")
    target_flow_id: UUID = Field(alias="targetFlowId")
    operations: list[FlowOperation]

    @field_validator("operations")
    @classmethod
    def validate_operation_count(cls, value: list[FlowOperation]) -> list[FlowOperation]:
        if not value:
            raise _flow_error("invalid_operation_count")
        if len(value) > MAX_OPERATIONS:
            raise _flow_error("too_many_operations")
        if any(isinstance(item, CreateFlowOperation) for item in value) and not (
            len(value) == 1 and isinstance(value[0], CreateFlowOperation)
        ):
            raise _flow_error("create_flow_must_be_sole_operation")
        return value


class FlowSnapshot(_StrictModel):
    revision: int | None
    hash: str | None
    node_count: int
    edge_count: int


class OperationSummary(_StrictModel):
    index: int
    op: str
    status: Literal["applied", "noop"]
    summary: str
    affected_node_ids: list[str] = Field(default_factory=list, alias="affectedNodeIds")
    affected_edges: list[str] = Field(default_factory=list, alias="affectedEdges")


class FlowChangePreview(_StrictModel):
    before: FlowSnapshot
    after: FlowSnapshot
    operation_summaries: list[OperationSummary] = Field(alias="operationSummaries")
    warnings: list[str]
    risk: Literal["low", "medium", "high"]
    can_restore: bool = Field(alias="canRestore")


class FlowChangeResult(_StrictModel):
    project_id: UUID
    flow_id: UUID
    flow: dict[str, Any]
    command_type: str
    result_flow_hash: str
    preview: FlowChangePreview
    ready: bool
    noop: bool


def _reject_non_finite(_: str) -> None:
    raise _flow_error("non_finite_number")


def _walk_strings(value: Any, *, operation_index: int | None = None) -> None:
    if isinstance(value, str):
        if len(value.encode("utf-8")) > MAX_STRING_BYTES:
            raise _flow_error("string_too_long", operation_index=operation_index)
        return
    if isinstance(value, list):
        for item in value:
            _walk_strings(item, operation_index=operation_index)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            _walk_strings(key, operation_index=operation_index)
            _walk_strings(item, operation_index=operation_index)


def _validation_error_code(exc: ValidationError) -> tuple[str, int | None]:
    error = exc.errors(include_url=False)[0]
    location = error.get("loc", ())
    operation_index = location[1] if len(location) > 1 and location[0] == "operations" else None
    message = str(error.get("msg", ""))
    if "too_many_operations" in message:
        return "too_many_operations", operation_index
    if "invalid_operation_count" in message:
        return "invalid_operation_count", operation_index
    if "create_flow_must_be_sole_operation" in message:
        return "create_flow_must_be_sole_operation", operation_index
    if error.get("type") == "extra_forbidden":
        return ("unknown_operation_field" if operation_index is not None else "unknown_request_field"), operation_index
    if error.get("type") == "union_tag_invalid":
        return "unknown_operation", operation_index
    return "invalid_change_set", operation_index


def parse_flow_change_set(raw_body: bytes) -> FlowChangeSetV1:
    if len(raw_body) > MAX_PAYLOAD_BYTES:
        raise _flow_error("payload_too_large")
    try:
        decoded = json.loads(raw_body, parse_constant=_reject_non_finite)
    except UnicodeDecodeError as exc:
        raise _flow_error("invalid_json") from exc
    except json.JSONDecodeError as exc:
        raise _flow_error("invalid_json") from exc
    if not isinstance(decoded, dict):
        raise _flow_error("invalid_change_set")
    operations = decoded.get("operations")
    if isinstance(operations, list):
        if len(operations) > MAX_OPERATIONS:
            raise _flow_error("too_many_operations")
        for index, operation in enumerate(operations):
            _walk_strings(operation, operation_index=index)
    _walk_strings({key: value for key, value in decoded.items() if key != "operations"})
    try:
        return FlowChangeSetV1.model_validate(decoded)
    except ValidationError as exc:
        code, operation_index = _validation_error_code(exc)
        raise _flow_error(code, operation_index=operation_index) from exc


def _identifier(value: Any, *, operation_index: int | None = None) -> str:
    if not isinstance(value, str) or _IDENTIFIER_RE.fullmatch(value) is None:
        raise _flow_error("invalid_identifier", operation_index=operation_index)
    return value


def _node_id(node: dict[str, Any], *, operation_index: int | None = None) -> str:
    root_id = node.get("id")
    data_id = node.get("data", {}).get("id") if isinstance(node.get("data"), dict) else None
    if root_id != data_id:
        raise _flow_error("invalid_node_shape", operation_index=operation_index)
    return _identifier(root_id, operation_index=operation_index)


def _component_type(node: dict[str, Any], *, operation_index: int | None = None) -> str:
    data = node.get("data")
    if not isinstance(data, dict):
        raise _flow_error("invalid_node_shape", operation_index=operation_index)
    return _identifier(data.get("type"), operation_index=operation_index)


def _forbidden_field(field_name: str) -> bool:
    normalized = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", field_name)
    lowered = normalized.lower().replace("-", "_")
    compact = lowered.replace("_", "")
    return (
        _FORBIDDEN_FIELD_RE.search(f"_{lowered}_") is not None
        or compact in {"apikey", "authorization"}
        or any(part.startswith("auth") for part in lowered.split("_") if part)
    )


def _contains_forbidden_config_key(value: Any) -> bool:
    if isinstance(value, dict):
        return any(
            (isinstance(key, str) and _forbidden_field(key)) or _contains_forbidden_config_key(item)
            for key, item in value.items()
        )
    if isinstance(value, list):
        return any(_contains_forbidden_config_key(item) for item in value)
    return False


def _structural_edge(edge: dict[str, Any], *, operation_index: int | None = None) -> tuple[str, str, str, str]:
    try:
        source = _identifier(edge["source"], operation_index=operation_index)
        target = _identifier(edge["target"], operation_index=operation_index)
        source_output = _identifier(edge["data"]["sourceHandle"]["name"], operation_index=operation_index)
        target_input = _identifier(edge["data"]["targetHandle"]["fieldName"], operation_index=operation_index)
    except (KeyError, TypeError) as exc:
        raise _flow_error("invalid_edge_shape", operation_index=operation_index) from exc
    return source, source_output, target, target_input


def _map_kfx_error(exc: ValueError, *, operation_index: int | None) -> FlowChangeError:
    message = str(exc).lower()
    if "unknown component" in message:
        code = "unknown_component"
    elif "component not found" in message:
        code = "node_not_found"
    elif "unknown parameter" in message:
        code = "unknown_field"
    elif "not found on component" in message or "type mismatch" in message:
        code = "unknown_port"
    else:
        code = "invalid_flow_change"
    return FlowChangeError(code, operation_index=operation_index)


def _validate_and_sanitize_flow(
    *,
    name: str,
    description: str | None,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    component_registry: dict[str, dict[str, Any]],
    operation_index: int | None,
    allow_duplicate_edges: bool = False,
) -> dict[str, Any]:
    sanitized = {"name": name, "description": description, "data": {"nodes": [], "edges": []}}
    seen_nodes: set[str] = set()
    for incoming_node in nodes:
        if not isinstance(incoming_node, dict):
            raise _flow_error("invalid_node_shape", operation_index=operation_index)
        node_id = _node_id(incoming_node, operation_index=operation_index)
        if node_id in seen_nodes:
            raise _flow_error("duplicate_node_id", operation_index=operation_index)
        seen_nodes.add(node_id)
        component_type = _component_type(incoming_node, operation_index=operation_index)
        if component_type not in component_registry:
            raise _flow_error("unknown_component", operation_index=operation_index)
        try:
            add_component(sanitized, component_type, component_registry, component_id=node_id)
        except ValueError as exc:
            raise _map_kfx_error(exc, operation_index=operation_index) from exc

        incoming_template = incoming_node.get("data", {}).get("node", {}).get("template", {})
        registry_template = component_registry[component_type].get("template", {})
        if not isinstance(incoming_template, dict) or not isinstance(registry_template, dict):
            raise _flow_error("invalid_node_shape", operation_index=operation_index)
        if not set(incoming_template).issubset(registry_template):
            raise _flow_error("unknown_field", operation_index=operation_index)
        parameters: dict[str, Any] = {}
        for field_name, incoming_field in incoming_template.items():
            trusted_field = registry_template[field_name]
            if not isinstance(incoming_field, dict) or not isinstance(trusted_field, dict):
                if incoming_field != trusted_field:
                    raise _flow_error("unknown_field", operation_index=operation_index)
                continue
            incoming_value = incoming_field.get("value")
            trusted_value = trusted_field.get("value")
            if _forbidden_field(field_name) or _contains_forbidden_config_key(incoming_value):
                if incoming_value != trusted_value:
                    raise _flow_error("forbidden_field", operation_index=operation_index)
                continue
            parameters[field_name] = copy.deepcopy(incoming_value)
        try:
            configure_component(sanitized, node_id, parameters)
        except ValueError as exc:
            raise _map_kfx_error(exc, operation_index=operation_index) from exc
        position = incoming_node.get("position")
        if isinstance(position, dict) and set(position) >= {"x", "y"}:
            canonical_json_bytes(position)
            sanitized["data"]["nodes"][-1]["position"] = {"x": position["x"], "y": position["y"]}

    seen_edges: set[tuple[str, str, str, str]] = set()
    for incoming_edge in edges:
        if not isinstance(incoming_edge, dict):
            raise _flow_error("invalid_edge_shape", operation_index=operation_index)
        identity = _structural_edge(incoming_edge, operation_index=operation_index)
        if identity in seen_edges:
            if allow_duplicate_edges:
                continue
            raise _flow_error("duplicate_edge", operation_index=operation_index)
        seen_edges.add(identity)
        if identity[0] not in seen_nodes or identity[2] not in seen_nodes:
            raise _flow_error("dangling_edge", operation_index=operation_index)
        try:
            add_connection(sanitized, identity[0], identity[1], identity[2], identity[3])
        except ValueError as exc:
            raise _map_kfx_error(exc, operation_index=operation_index) from exc
    return sanitized


def _safe_label(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.:-]", "?", value)[:128]


def _snapshot(flow: dict[str, Any] | None, revision: int | None) -> FlowSnapshot:
    if flow is None:
        return FlowSnapshot(revision=None, hash=None, node_count=0, edge_count=0)
    data = flow.get("data") if isinstance(flow, dict) else None
    nodes = data.get("nodes", []) if isinstance(data, dict) else []
    edges = data.get("edges", []) if isinstance(data, dict) else []
    return FlowSnapshot(
        revision=revision,
        hash=flow_content_hash(flow),
        node_count=len(nodes) if isinstance(nodes, list) else 0,
        edge_count=len(edges) if isinstance(edges, list) else 0,
    )


def _edge_label(identity: tuple[str, str, str, str]) -> str:
    return (
        f"{_safe_label(identity[0])}.{_safe_label(identity[1])}->{_safe_label(identity[2])}.{_safe_label(identity[3])}"
    )


def apply_flow_changes(
    change_set: FlowChangeSetV1,
    *,
    target_flow: dict[str, Any] | None,
    target_revision: int | None,
    component_registry: dict[str, dict[str, Any]],
) -> FlowChangeResult:
    if target_flow is not None:
        try:
            canonical_json_bytes(target_flow)
        except CanonicalizationError as exc:
            code = "non_finite_number" if "finite" in str(exc) else "invalid_flow_shape"
            raise _flow_error(code) from exc
        target_data = target_flow.get("data", {})
        if not isinstance(target_data, dict):
            raise _flow_error("invalid_flow_shape")
        _validate_and_sanitize_flow(
            name=target_flow.get("name"),
            description=target_flow.get("description"),
            nodes=target_data.get("nodes", []),
            edges=target_data.get("edges", []),
            component_registry=component_registry,
            operation_index=None,
            allow_duplicate_edges=True,
        )

    before = copy.deepcopy(target_flow)
    working = copy.deepcopy(target_flow)
    summaries: list[OperationSummary] = []
    changed = False

    for index, operation in enumerate(change_set.operations):
        try:
            if isinstance(operation, CreateFlowOperation):
                if working is not None:
                    raise _flow_error("create_flow_requires_empty_target", operation_index=index)
                working = _validate_and_sanitize_flow(
                    name=operation.name,
                    description=operation.description,
                    nodes=operation.nodes,
                    edges=operation.edges,
                    component_registry=component_registry,
                    operation_index=index,
                )
                changed = True
                summaries.append(
                    OperationSummary(index=index, op=operation.op, status="applied", summary="Create flow")
                )
                continue

            if working is None:
                raise _flow_error("edit_requires_existing_target", operation_index=index)

            operation_changed = False
            affected_nodes: list[str] = []
            affected_edges: list[str] = []
            if isinstance(operation, AddNodeOperation):
                node_id = _identifier(operation.node_id, operation_index=index)
                component_type = _identifier(operation.component_type, operation_index=index)
                if any(_node_id(node) == node_id for node in working["data"]["nodes"]):
                    raise _flow_error("duplicate_node_id", operation_index=index)
                for field_name in operation.parameters:
                    if _forbidden_field(field_name):
                        raise _flow_error("forbidden_field", operation_index=index)
                if _contains_forbidden_config_key(operation.parameters):
                    raise _flow_error("forbidden_field", operation_index=index)
                try:
                    add_component(working, component_type, component_registry, component_id=node_id)
                    configure_component(working, node_id, copy.deepcopy(operation.parameters))
                except ValueError as exc:
                    raise _map_kfx_error(exc, operation_index=index) from exc
                operation_changed = True
                affected_nodes.append(node_id)
                summary = f"Add node {_safe_label(node_id)}"
            elif isinstance(operation, RemoveNodeOperation):
                node_id = _identifier(operation.node_id, operation_index=index)
                matching = [node for node in working["data"]["nodes"] if _node_id(node) == node_id]
                if len(matching) != 1:
                    raise _flow_error("node_not_found", operation_index=index)
                incident = [
                    _structural_edge(edge)
                    for edge in working["data"]["edges"]
                    if edge.get("source") == node_id or edge.get("target") == node_id
                ]
                working["data"]["nodes"] = [node for node in working["data"]["nodes"] if _node_id(node) != node_id]
                working["data"]["edges"] = [
                    edge
                    for edge in working["data"]["edges"]
                    if edge.get("source") != node_id and edge.get("target") != node_id
                ]
                operation_changed = True
                affected_nodes.append(node_id)
                affected_edges.extend(_edge_label(item) for item in sorted(incident))
                summary = f"Remove node {_safe_label(node_id)}"
            elif isinstance(operation, SetParameterOperation):
                node_id = _identifier(operation.node_id, operation_index=index)
                parameter = _identifier(operation.parameter, operation_index=index)
                if _forbidden_field(parameter):
                    raise _flow_error("forbidden_field", operation_index=index)
                if _contains_forbidden_config_key(operation.value):
                    raise _flow_error("forbidden_field", operation_index=index)
                node = next((node for node in working["data"]["nodes"] if _node_id(node) == node_id), None)
                if node is None:
                    raise _flow_error("node_not_found", operation_index=index)
                template = node.get("data", {}).get("node", {}).get("template", {})
                if parameter not in template or not isinstance(template[parameter], dict):
                    raise _flow_error("unknown_field", operation_index=index)
                previous = copy.deepcopy(template[parameter].get("value"))
                if previous != operation.value:
                    try:
                        configure_component(working, node_id, {parameter: copy.deepcopy(operation.value)})
                    except ValueError as exc:
                        raise _map_kfx_error(exc, operation_index=index) from exc
                    operation_changed = True
                affected_nodes.append(node_id)
                summary = f"Set {_safe_label(node_id)}.{_safe_label(parameter)}"
            elif isinstance(operation, ConnectNodesOperation) and not isinstance(operation, DisconnectNodesOperation):
                identity = (
                    _identifier(operation.source_node_id, operation_index=index),
                    _identifier(operation.source_output, operation_index=index),
                    _identifier(operation.target_node_id, operation_index=index),
                    _identifier(operation.target_input, operation_index=index),
                )
                before_count = len(working["data"]["edges"])
                try:
                    add_connection(working, identity[0], identity[1], identity[2], identity[3])
                except ValueError as exc:
                    raise _map_kfx_error(exc, operation_index=index) from exc
                operation_changed = len(working["data"]["edges"]) > before_count
                affected_edges.append(_edge_label(identity))
                summary = f"Connect {_edge_label(identity)}"
            elif isinstance(operation, DisconnectNodesOperation):
                identity = (
                    _identifier(operation.source_node_id, operation_index=index),
                    _identifier(operation.source_output, operation_index=index),
                    _identifier(operation.target_node_id, operation_index=index),
                    _identifier(operation.target_input, operation_index=index),
                )
                matches = [edge for edge in working["data"]["edges"] if _structural_edge(edge) == identity]
                if not matches:
                    raise _flow_error("edge_not_found", operation_index=index)
                if len(matches) != 1:
                    raise _flow_error("ambiguous_edge_match", operation_index=index)
                working["data"]["edges"].remove(matches[0])
                operation_changed = True
                affected_edges.append(_edge_label(identity))
                summary = f"Disconnect {_edge_label(identity)}"
            elif isinstance(operation, ReplaceFlowOperation):
                candidate = _validate_and_sanitize_flow(
                    name=operation.name,
                    description=operation.description,
                    nodes=operation.nodes,
                    edges=operation.edges,
                    component_registry=component_registry,
                    operation_index=index,
                )
                if before is not None and flow_content_hash(candidate) == flow_content_hash(before):
                    candidate = copy.deepcopy(before)
                operation_changed = flow_content_hash(candidate) != flow_content_hash(working)
                working = candidate
                summary = "Replace flow"
            else:  # pragma: no cover - discriminated union is exhaustive
                raise _flow_error("unknown_operation", operation_index=index)

            changed = changed or operation_changed
            summaries.append(
                OperationSummary(
                    index=index,
                    op=operation.op,
                    status="applied" if operation_changed else "noop",
                    summary=summary,
                    affectedNodeIds=[_safe_label(item) for item in affected_nodes],
                    affectedEdges=affected_edges,
                )
            )
        except FlowChangeError as exc:
            if exc.operation_index is None:
                exc.operation_index = index
            raise

    if working is None:  # pragma: no cover - guarded by operation rules
        raise _flow_error("empty_result")
    result_hash = flow_content_hash(working)
    after_revision = (
        1 if before is None else (target_revision + 1 if changed and target_revision is not None else target_revision)
    )
    command_types = {operation.op for operation in change_set.operations}
    command_type = next(iter(command_types)) if len(command_types) == 1 else "replace_flow"
    risk: Literal["low", "medium", "high"]
    if any(isinstance(item, ReplaceFlowOperation) for item in change_set.operations):
        risk = "high"
    elif any(isinstance(item, (RemoveNodeOperation, DisconnectNodesOperation)) for item in change_set.operations):
        risk = "medium"
    else:
        risk = "low"
    preview = FlowChangePreview(
        before=_snapshot(before, target_revision),
        after=_snapshot(working, after_revision),
        operationSummaries=summaries,
        warnings=[] if changed else ["No changes detected"],
        risk=risk,
        canRestore=before is not None,
    )
    if len(canonical_json_bytes(preview)) > MAX_PREVIEW_BYTES:
        raise _flow_error("preview_too_large")
    return FlowChangeResult(
        project_id=change_set.target_project_id,
        flow_id=change_set.target_flow_id,
        flow=working,
        command_type=command_type,
        result_flow_hash=result_hash,
        preview=preview,
        ready=changed,
        noop=not changed,
    )
