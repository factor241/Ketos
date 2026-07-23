from __future__ import annotations

# ruff: noqa: PLR2004, S101
import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts/mvp/run_live_ai_smoke.py"


def load_module():
    spec = importlib.util.spec_from_file_location("run_live_ai_smoke", SCRIPT)
    assert spec
    assert spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def hardened_secret(tmp_path: Path, contents: str = "COMETAPI_KEY=test-value\n") -> Path:
    parent = tmp_path / "secrets"
    parent.mkdir(mode=0o700)
    path = parent / "cometapi.env"
    path.write_text(contents, encoding="utf-8")
    path.chmod(0o600)
    return path


def test_secret_loader_accepts_only_one_canonical_assignment(tmp_path: Path) -> None:
    module = load_module()
    path = hardened_secret(tmp_path)

    assert module.load_hardened_secret(path) == "test-value"


@pytest.mark.parametrize(
    "contents",
    [
        "",
        "export COMETAPI_KEY=value\n",
        "COMETAPI_KEY=\n",
        "COMETAPI_KEY=value\nEXTRA=value\n",
        " COMETAPI_KEY=value\n",
        "OTHER_KEY=value\n",
    ],
)
def test_secret_loader_rejects_noncanonical_contents(
    tmp_path: Path,
    contents: str,
) -> None:
    module = load_module()
    path = hardened_secret(tmp_path, contents)

    with pytest.raises(ValueError, match="secret file contract"):
        module.load_hardened_secret(path)


def test_secret_loader_rejects_unsafe_modes_and_symlink(tmp_path: Path) -> None:
    module = load_module()
    path = hardened_secret(tmp_path)
    path.chmod(0o640)
    with pytest.raises(ValueError, match="mode 0600"):
        module.load_hardened_secret(path)

    path.chmod(0o600)
    link = path.parent / "linked.env"
    link.symlink_to(path)
    with pytest.raises(ValueError, match="symlink"):
        module.load_hardened_secret(link)


def test_flow_hash_is_canonical_and_ignores_transport_fields() -> None:
    module = load_module()
    left = {
        "id": "one",
        "revision": 3,
        "name": "Flow",
        "description": None,
        "data": {"edges": [], "nodes": [{"b": 2, "a": 1}]},
    }
    right = {
        "revision": 99,
        "name": "Flow",
        "data": {"nodes": [{"a": 1, "b": 2}], "edges": []},
        "description": None,
        "id": "two",
    }

    assert module.flow_hash(left) == module.flow_hash(right)
    assert len(module.flow_hash(left)) == 64


def test_sse_parser_requires_json_data_records() -> None:
    module = load_module()
    body = (
        'data: {"type":"RUN_STARTED","runId":"one"}\n\n'
        'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"ready"}\n\n'
    )

    assert [item["type"] for item in module.parse_sse_events(body)] == [
        "RUN_STARTED",
        "TEXT_MESSAGE_CONTENT",
    ]
    with pytest.raises(ValueError, match="malformed AG-UI SSE"):
        module.parse_sse_events("data: not-json\n\n")


def test_exact_proposal_payload_rejects_extra_operations() -> None:
    module = load_module()
    payload = {
        "targetFlowId": "11111111-1111-1111-1111-111111111111",
        "operations": [
            {
                "op": "set_parameter",
                "nodeId": "TextInput-stage10",
                "parameter": "input_value",
                "value": "safe",
            }
        ],
    }
    module.require_exact_proposal_payload(
        payload,
        flow_id="11111111-1111-1111-1111-111111111111",
        expected_value="safe",
    )
    payload["operations"].append(dict(payload["operations"][0]))
    with pytest.raises(ValueError, match="exactly one"):
        module.require_exact_proposal_payload(
            payload,
            flow_id="11111111-1111-1111-1111-111111111111",
            expected_value="safe",
        )


def test_evidence_writer_is_exclusive_mode_0600_and_redacted(
    tmp_path: Path,
) -> None:
    module = load_module()
    target = tmp_path / "live-ai-smoke.json"
    payload = {
        "schema": "ketos.stage10.live-ai-smoke.v1",
        "verdict": "PASS",
        "provider_adapter": "OpenAI",
    }

    module.write_json_exclusive(target, payload)
    assert json.loads(target.read_text(encoding="utf-8")) == payload
    assert target.stat().st_mode & 0o777 == 0o600
    with pytest.raises(FileExistsError):
        module.write_json_exclusive(target, payload)

    with pytest.raises(ValueError, match="forbidden evidence field"):
        module.assert_redacted_evidence({"raw_prompt": "not allowed"})
