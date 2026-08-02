from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from enum import Enum
from uuid import UUID

import pytest
from ketos.services.commands.canonical import (
    CanonicalizationError,
    ProposalHashMaterial,
    canonical_json_bytes,
    flow_content_hash,
    proposal_hash,
)


class ExampleEnum(str, Enum):
    VALUE = "value"


def test_canonical_json_has_versioned_exact_wire_form() -> None:
    value = {
        "z": ExampleEnum.VALUE,
        "uuid": UUID("12345678-1234-5678-1234-567812345678"),
        "timestamp": datetime(2026, 7, 21, 1, 2, 3, 456000, tzinfo=timezone.utc),
        "unicode": "Кетос",
        "nested": [True, None, 1],
    }

    assert canonical_json_bytes(value) == (
        b'{"nested":[true,null,1],"timestamp":"2026-07-21T01:02:03.456000Z",'
        b'"unicode":"\xd0\x9a\xd0\xb5\xd1\x82\xd0\xbe\xd1\x81",'
        b'"uuid":"12345678-1234-5678-1234-567812345678","z":"value"}'
    )


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_canonical_json_rejects_non_finite_numbers(value: float) -> None:
    with pytest.raises(CanonicalizationError, match="finite"):
        canonical_json_bytes({"value": value})


def test_flow_content_hash_uses_exact_name_description_data_projection() -> None:
    flow = {
        "id": "ignored-row-id",
        "revision": 77,
        "name": "Flow",
        "description": None,
        "data": {"nodes": [], "edges": []},
    }
    expected = hashlib.sha256(b'{"data":{"edges":[],"nodes":[]},"description":null,"name":"Flow"}').hexdigest()

    assert flow_content_hash(flow) == expected
    assert flow_content_hash({**flow, "revision": 78}) == expected
    assert flow_content_hash({**flow, "name": "Renamed"}) != expected
    assert flow_content_hash({**flow, "description": "Changed"}) != expected


def test_proposal_hash_binds_correlation_scope_phase_and_redacted_preview() -> None:
    base = ProposalHashMaterial(
        source_kind="ai_run",
        chat_run_id=UUID("10000000-0000-0000-0000-000000000001"),
        thread_id="20000000-0000-0000-0000-000000000002",
        interrupt_id=None,
        interrupt_bound=False,
        source_proposal_id=None,
        sequence=1,
        actor_id=UUID("30000000-0000-0000-0000-000000000003"),
        project_id=UUID("40000000-0000-0000-0000-000000000004"),
        flow_id=UUID("50000000-0000-0000-0000-000000000005"),
        command_type="set_parameter",
        canonical_payload={"schemaVersion": 1, "operations": []},
        base_flow_revision=9,
        base_flow_hash="a" * 64,
        result_flow_hash="b" * 64,
        redacted_preview_summary={"risk": "low"},
    )
    pre_hash = proposal_hash(base)
    bound = base.model_copy(update={"interrupt_id": "actual-interrupt", "interrupt_bound": True})

    assert len(pre_hash) == 64
    assert set(pre_hash) <= set("0123456789abcdef")
    assert proposal_hash(bound) != pre_hash
    assert proposal_hash(bound) == proposal_hash(bound.model_copy(deep=True))
    assert proposal_hash(bound.model_copy(update={"actor_id": UUID(int=6)})) != proposal_hash(bound)
    assert proposal_hash(bound.model_copy(update={"redacted_preview_summary": {"risk": "high"}})) != proposal_hash(
        bound
    )


def test_proposal_hash_rejects_half_bound_interrupt_phase() -> None:
    material = ProposalHashMaterial(
        source_kind="ai_run",
        chat_run_id=UUID(int=1),
        thread_id=str(UUID(int=2)),
        interrupt_id="actual",
        interrupt_bound=False,
        source_proposal_id=None,
        sequence=1,
        actor_id=UUID(int=3),
        project_id=UUID(int=4),
        flow_id=UUID(int=5),
        command_type="create_flow",
        canonical_payload={"schemaVersion": 1, "operations": []},
        base_flow_revision=None,
        base_flow_hash=None,
        result_flow_hash="b" * 64,
        redacted_preview_summary={},
    )

    with pytest.raises(ValueError, match="interrupt"):
        proposal_hash(material)
