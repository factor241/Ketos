"""Runtime proof that localized presentation metadata does not change the flow ABI."""

from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from langflow.utils.i18n import translate_component_node
from lfx.components.input_output import ChatInput, ChatOutput, TextInputComponent, TextOutputComponent
from lfx.components.models_and_agents import PromptComponent
from lfx.components.processing.regex import RegexExtractorComponent
from lfx.graph import Graph
from lfx.schema.message import Message

from tests.integration.utils import run_flow

if TYPE_CHECKING:
    from httpx import AsyncClient

_INPUT_ABI_KEYS = (
    "name",
    "type",
    "value",
    "options",
    "input_types",
    "required",
    "list",
    "is_list",
)
_OUTPUT_ABI_KEYS = (
    "name",
    "method",
    "types",
    "selected",
    "allows_loop",
)

_REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
_CORPUS_ROOT = _REPOSITORY_ROOT / "tests" / "fixtures" / "localization" / "flow-abi" / "v1"
_ARTIFACT_ROOT = _REPOSITORY_ROOT / ".artifacts" / "localization" / "ru" / "r9-flow-abi"


@dataclass
class RuntimeCorpusCase:
    name: str
    data: dict[str, Any]
    result_name: str
    expected_text: str
    reordered_node_id: str | None = None
    traits: frozenset[str] = frozenset()


def _add_stable_edge_ids(data: dict[str, Any]) -> None:
    for edge in data["edges"]:
        source_handle = edge["data"]["sourceHandle"]
        target_handle = edge["data"]["targetHandle"]
        edge["id"] = f"edge:{edge['source']}:{source_handle['name']}:{edge['target']}:{target_handle['fieldName']}"


def _build_text_regex_case(spec: dict[str, Any]) -> RuntimeCorpusCase:
    traits = frozenset(spec["traits"])
    input_id, regex_id, output_id = spec["stable_ids"]["nodes"]
    graph = Graph()
    input_id = graph.add_component(
        TextInputComponent(input_value=spec["input"]),
        input_id,
    )
    regex_id = graph.add_component(
        RegexExtractorComponent(pattern=r"\b\w+@\w+\.\w+\b"),
        regex_id,
    )
    output_id = graph.add_component(TextOutputComponent(), output_id)
    graph.add_component_edge(input_id, ("text", "input_text"), regex_id)
    graph.add_component_edge(regex_id, ("text", "input_value"), output_id)
    graph.prepare()
    data = graph.dump(name=f"{spec['case_id']} localization ABI corpus")["data"]
    _add_stable_edge_ids(data)

    nodes = {node["id"]: node["data"]["node"] for node in data["nodes"]}
    if "outdated" in traits:
        nodes[regex_id]["legacy"] = True
        nodes[regex_id]["replacement"] = ["RegexExtractorV2"]
    if "legacy" in traits:
        nodes[regex_id]["legacy"] = True
        nodes[regex_id]["replacement"] = ["RegexExtractorV2"]
        nodes[regex_id].setdefault("metadata", {})["removed_outputs"] = ["removed_legacy_output"]
    if "custom-label" in traits:
        overrides = spec["overrides"]
        nodes[regex_id]["display_name"] = overrides["component_label"]
        nodes[regex_id]["template"]["pattern"]["display_name"] = overrides["field_label"]
        regex_text_output = next(output for output in nodes[regex_id]["outputs"] if output["name"] == "text")
        regex_text_output["display_name"] = overrides["output_label"]

    return RuntimeCorpusCase(
        name=spec["case_id"],
        data=data,
        result_name=spec["expected_runtime"]["result_name"],
        expected_text=spec["expected_runtime"]["text"],
        reordered_node_id=regex_id if "output-reordered" in traits else None,
        traits=traits,
    )


def _build_prompt_case(spec: dict[str, Any]) -> RuntimeCorpusCase:
    input_id, prompt_id, output_id = spec["stable_ids"]["nodes"]
    graph = Graph()
    input_id = graph.add_component(
        ChatInput(input_value=spec["input"], should_store_message=False),
        input_id,
    )
    prompt_id = graph.add_component(
        PromptComponent(template="Original: {var1}", var1=""),
        prompt_id,
    )
    output_id = graph.add_component(
        ChatOutput(should_store_message=False),
        output_id,
    )
    graph.add_component_edge(input_id, ("message", "var1"), prompt_id)
    graph.add_component_edge(prompt_id, ("prompt", "input_value"), output_id)
    graph.prepare()
    data = graph.dump(name=f"{spec['case_id']} localization ABI corpus")["data"]
    _add_stable_edge_ids(data)

    nodes = {node["id"]: node["data"]["node"] for node in data["nodes"]}
    overrides = spec["overrides"]
    nodes[prompt_id]["display_name"] = overrides["component_label"]
    nodes[prompt_id]["template"]["template"]["display_name"] = overrides["field_label"]
    nodes[prompt_id]["template"]["template"]["value"] = overrides["prompt_template"]
    nodes[prompt_id].setdefault("metadata", {})["assistant_modified"] = True

    return RuntimeCorpusCase(
        name=spec["case_id"],
        data=data,
        result_name=spec["expected_runtime"]["result_name"],
        expected_text=spec["expected_runtime"]["text"],
        traits=frozenset(spec["traits"]),
    )


def _load_runtime_corpus() -> tuple[RuntimeCorpusCase, ...]:
    manifest = json.loads((_CORPUS_ROOT / "manifest.json").read_text(encoding="utf-8"))
    cases: list[RuntimeCorpusCase] = []
    for entry in manifest["cases"]:
        spec = json.loads((_CORPUS_ROOT / entry["fixture"]).read_text(encoding="utf-8"))
        if spec["topology"] == "text-regex-output":
            cases.append(_build_text_regex_case(spec))
        elif spec["topology"] == "chat-prompt-output":
            cases.append(_build_prompt_case(spec))
        else:  # pragma: no cover - guarded by the corpus contract test
            msg = f"Unsupported ABI corpus topology: {spec['topology']}"
            raise AssertionError(msg)
    return tuple(cases)


def _localized_data(case: RuntimeCorpusCase, locale: str) -> dict[str, Any]:
    data = copy.deepcopy(case.data)
    for node in data["nodes"]:
        node_data = node["data"]
        node_data["node"] = translate_component_node(node_data["type"], node_data["node"], locale)

    # Output order is presentation state. Reorder one legacy component in RU
    # to prove that execution still resolves the connected output by its name.
    if locale == "ru" and case.reordered_node_id:
        reordered = next(node for node in data["nodes"] if node["id"] == case.reordered_node_id)
        reordered["data"]["node"]["outputs"].reverse()
    return data


def _machine_projection(data: dict[str, Any]) -> dict[str, Any]:
    """Return only identifiers and execution-bearing fields, normalized by stable name."""
    nodes: list[dict[str, Any]] = []
    for raw_node in sorted(data["nodes"], key=lambda item: item["id"]):
        node_data = raw_node["data"]
        node = node_data["node"]
        inputs = {}
        for field_name, field in sorted(node.get("template", {}).items()):
            if isinstance(field, dict):
                inputs[field_name] = {key: copy.deepcopy(field[key]) for key in _INPUT_ABI_KEYS if key in field}
            else:
                inputs[field_name] = copy.deepcopy(field)

        outputs = {}
        for output in node.get("outputs", []):
            output_name = output.get("name")
            if output_name:
                outputs[output_name] = {key: copy.deepcopy(output[key]) for key in _OUTPUT_ABI_KEYS if key in output}

        nodes.append(
            {
                "id": raw_node["id"],
                "node_type": raw_node.get("type"),
                "component_type": node_data["type"],
                "legacy": node.get("legacy"),
                "replacement": copy.deepcopy(node.get("replacement")),
                "selected_output": node_data.get("selected_output"),
                "inputs": inputs,
                "outputs_by_name": outputs,
            }
        )

    edges = [
        {
            "id": edge["id"],
            "source": edge["source"],
            "target": edge["target"],
            "source_handle": copy.deepcopy(edge["data"]["sourceHandle"]),
            "target_handle": copy.deepcopy(edge["data"]["targetHandle"]),
        }
        for edge in sorted(data["edges"], key=lambda item: item["id"])
    ]
    return {"nodes": nodes, "edges": edges}


def _custom_override_projection(data: dict[str, Any]) -> dict[str, Any]:
    overrides: dict[str, Any] = {}
    for raw_node in data["nodes"]:
        node = raw_node["data"]["node"]
        node_overrides: dict[str, Any] = {}
        if str(node.get("display_name", "")).startswith("Customer "):
            node_overrides["display_name"] = node["display_name"]
        fields = {
            name: {
                key: field[key] for key in ("display_name", "info") if str(field.get(key, "")).startswith("Customer ")
            }
            for name, field in node.get("template", {}).items()
            if isinstance(field, dict)
        }
        node_overrides["fields"] = {name: values for name, values in fields.items() if values}
        node_overrides["outputs"] = {
            output["name"]: {
                key: output[key] for key in ("display_name", "info") if str(output.get(key, "")).startswith("Customer ")
            }
            for output in node.get("outputs", [])
            if output.get("name")
            and any(str(output.get(key, "")).startswith("Customer ") for key in ("display_name", "info"))
        }
        if any(node_overrides.values()):
            overrides[raw_node["id"]] = node_overrides
    return overrides


def _component_display_names(data: dict[str, Any]) -> dict[str, str]:
    return {node["id"]: node["data"]["node"]["display_name"] for node in data["nodes"]}


def _business_identifier_projection(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "nodes": {
            node["id"]: {
                "component_type": node["data"]["type"],
                "field_names": sorted(node["data"]["node"].get("template", {})),
                "option_values": {
                    name: copy.deepcopy(field.get("options", []))
                    for name, field in node["data"]["node"].get("template", {}).items()
                    if isinstance(field, dict) and field.get("options")
                },
                "outputs": {
                    output["name"]: output.get("method")
                    for output in node["data"]["node"].get("outputs", [])
                    if output.get("name")
                },
            }
            for node in data["nodes"]
        },
        "edges": {
            edge["id"]: {
                "source": edge["source"],
                "target": edge["target"],
                "source_output": edge["data"]["sourceHandle"]["name"],
                "target_field": edge["data"]["targetHandle"]["fieldName"],
            }
            for edge in data["edges"]
        },
    }


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _sha256(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode()).hexdigest()


def _write_case_artifacts(
    case: RuntimeCorpusCase,
    *,
    machine_before: dict[str, Any],
    machine_after: dict[str, Any],
    overrides_before: dict[str, Any],
    overrides_after: dict[str, Any],
    identifiers_before: dict[str, Any],
    identifiers_after: dict[str, Any],
    phase_results: list[str],
) -> None:
    case_root = _ARTIFACT_ROOT / case.name
    case_root.mkdir(parents=True, exist_ok=True)
    machine_equal = machine_after == machine_before
    overrides_equal = overrides_after == overrides_before
    identifiers_equal = identifiers_after == identifiers_before
    runtime_equal = phase_results == [case.expected_text, case.expected_text, case.expected_text]
    (case_root / "machine-diff.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "case_id": case.name,
                "transition": ["en", "ru", "en"],
                "status": "PASS" if machine_equal and overrides_equal and identifiers_equal else "FAIL",
                "machine": {
                    "before_sha256": _sha256(machine_before),
                    "after_sha256": _sha256(machine_after),
                    "changes": [] if machine_equal else ["normalized_machine_graph_changed"],
                },
                "user_overrides": {
                    "before_sha256": _sha256(overrides_before),
                    "after_sha256": _sha256(overrides_after),
                    "changes": [] if overrides_equal else ["user_override_changed"],
                },
                "business_identifiers": {
                    "before_sha256": _sha256(identifiers_before),
                    "after_sha256": _sha256(identifiers_after),
                    "changes": [] if identifiers_equal else ["business_identifier_changed"],
                },
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    (case_root / "runtime-result.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "case_id": case.name,
                "status": "PASS" if runtime_equal else "FAIL",
                "save_reload": "PASS",
                "build_run": "PASS" if runtime_equal else "FAIL",
                "expected": case.expected_text,
                "phases": [
                    {"locale": locale, "result": result}
                    for locale, result in zip(("en", "ru", "en"), phase_results, strict=True)
                ],
                "equivalent": runtime_equal,
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )


async def _execute(data: dict[str, Any], result_name: str) -> str:
    graph = Graph.from_payload(copy.deepcopy(data))
    outputs = await run_flow(graph)
    result = outputs[result_name]
    assert isinstance(result, Message)
    return result.text


async def test_en_ru_en_save_reload_preserves_flow_abi_and_runtime_result(
    client: AsyncClient,
    logged_in_headers: dict[str, str],
):
    cases = _load_runtime_corpus()

    for case in cases:
        english_data = _localized_data(case, "en")
        russian_data = _localized_data(case, "ru")
        machine_before = _machine_projection(english_data)
        overrides_before = _custom_override_projection(english_data)
        identifiers_before = _business_identifier_projection(english_data)
        assert _component_display_names(russian_data) != _component_display_names(english_data)
        assert _business_identifier_projection(russian_data) == identifiers_before
        assert "\u0420\u0443\u0441:" not in _canonical_json(identifiers_before)
        assert await _execute(english_data, case.result_name) == case.expected_text

        if case.reordered_node_id:
            english_outputs = next(node for node in english_data["nodes"] if node["id"] == case.reordered_node_id)[
                "data"
            ]["node"]["outputs"]
            russian_outputs = next(node for node in russian_data["nodes"] if node["id"] == case.reordered_node_id)[
                "data"
            ]["node"]["outputs"]
            assert [output["name"] for output in russian_outputs] == [
                output["name"] for output in reversed(english_outputs)
            ]

        headers_en = {**logged_in_headers, "Accept-Language": "en"}
        create_response = await client.post(
            "api/v1/flows/",
            json={
                "name": f"i18n-abi-{case.name}-{uuid4()}",
                "description": "Dependency-free localization runtime proof",
                "data": english_data,
                "is_component": False,
            },
            headers=headers_en,
        )
        assert create_response.status_code == 201
        assert create_response.headers["Content-Language"] == "en"
        flow_id = create_response.json()["id"]

        try:
            phase_results: list[str] = []
            persisted_data = english_data
            for locale, phase_data in (("en", english_data), ("ru", russian_data), ("en", english_data)):
                headers = {**logged_in_headers, "Accept-Language": locale}
                update_response = await client.patch(
                    f"api/v1/flows/{flow_id}",
                    json={"data": phase_data},
                    headers=headers,
                )
                assert update_response.status_code == 200
                assert update_response.headers["Content-Language"] == locale

                reload_response = await client.get(f"api/v1/flows/{flow_id}", headers=headers)
                assert reload_response.status_code == 200
                assert reload_response.headers["Content-Language"] == locale
                persisted_data = reload_response.json()["data"]

                phase_results.append(await _execute(persisted_data, case.result_name))

            machine_after = _machine_projection(persisted_data)
            overrides_after = _custom_override_projection(persisted_data)
            identifiers_after = _business_identifier_projection(persisted_data)
            _write_case_artifacts(
                case,
                machine_before=machine_before,
                machine_after=machine_after,
                overrides_before=overrides_before,
                overrides_after=overrides_after,
                identifiers_before=identifiers_before,
                identifiers_after=identifiers_after,
                phase_results=phase_results,
            )
            assert machine_after == machine_before
            assert overrides_after == overrides_before
            assert identifiers_after == identifiers_before
            assert phase_results == [case.expected_text, case.expected_text, case.expected_text]
        finally:
            delete_response = await client.delete(f"api/v1/flows/{flow_id}", headers=headers_en)
            assert delete_response.status_code == 200
