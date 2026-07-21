"""Bounded and inert Stage 07 Board result projection tests."""

# ruff: noqa: INP001

from __future__ import annotations

import json
from math import nan
from uuid import uuid4

import pytest
from ketos.services.database.models.jobs.model import Job, JobStatus, JobType
from ketos.services.jobs import board_results
from ketos.services.jobs.board_claim import build_board_request_fingerprint
from ketos.services.jobs.board_contracts import BoardExecutionResult
from ketos.services.jobs.board_results import (
    BoardResultMetadataError,
    board_execution_from_job,
    bound_board_execution_result,
    sanitize_board_detail,
    sanitize_board_result,
    sanitize_board_value,
)
from kfx.graph.schema import ResultData, RunOutputs
from kfx.utils.schemas import ChatOutputResponse
from pydantic import BaseModel, ValidationError, field_serializer


def _run_output(component_id: str, *, results=None, message=None) -> RunOutputs:
    messages = []
    if message is not None:
        messages = [ChatOutputResponse(message=message, component_id=component_id, type="text")]
    return RunOutputs(outputs=[ResultData(component_id=component_id, results=results, messages=messages)])


def _valid_job(*, status: JobStatus, reason=None, result=None) -> Job:
    board_id, flow_id, job_id, actor_id = uuid4(), uuid4(), uuid4(), uuid4()
    outcome = {
        JobStatus.QUEUED: "queued",
        JobStatus.IN_PROGRESS: "running",
        JobStatus.COMPLETED: "succeeded",
        JobStatus.FAILED: "failed",
        JobStatus.TIMED_OUT: "failed",
        JobStatus.CANCELLED: "cancelled",
    }[status]
    return Job(
        job_id=job_id,
        flow_id=flow_id,
        user_id=actor_id,
        type=JobType.WORKFLOW,
        status=status,
        job_metadata={
            "mvp": {
                "schema_version": 1,
                "kind": "board_automation_run",
                "board_id": str(board_id),
                "flow_id": str(flow_id),
                "flow_hash": "a" * 64,
                "request_fingerprint": build_board_request_fingerprint(
                    actor_id=actor_id,
                    board_id=board_id,
                    flow_id=flow_id,
                    flow_hash="a" * 64,
                    schema_version=1,
                ),
                "policy_version": 1,
                "origin_pid": 123,
                "worker_instance_id": str(uuid4()),
                "reason": reason,
                "detail": None,
                "result": result,
                "audit": {"request_id": str(job_id), "sequence": 2, "duration_ms": 5, "outcome": outcome},
            }
        },
    )


def test_terminal_selection_follows_terminal_node_order_and_prefers_message_text() -> None:
    outputs = [
        _run_output("second", results={"ignored": True}),
        _run_output("first", results={"also": "ignored"}, message="<script>alert(1)</script>"),
    ]

    result = sanitize_board_result(outputs, terminal_node_ids=("first", "second"))

    assert result == BoardExecutionResult(kind="text", value="<script>alert(1)</script>", truncated=False)


def test_json_projection_redacts_secrets_and_applies_all_structural_caps() -> None:
    value = {
        "authorization": "Bearer secret",
        "a_long": "ж" * 9000,
        "b_nested": {"password": "pw", "safe": [{"token": "t"}] * 120},
        **{f"zz-key-{index:03}": index for index in range(120)},
    }

    projected, truncated = sanitize_board_value(value)

    assert truncated is True
    assert projected["authorization"] == "[REDACTED]"
    assert projected["b_nested"]["password"] == "[REDACTED]"  # noqa: S105
    assert len(projected) <= 100
    assert len(projected["a_long"]) <= 8192
    assert len(projected["b_nested"]["safe"]) <= 100


def test_compound_secret_keys_are_redacted_case_insensitively() -> None:
    secrets = {
        "access_token": "access-value",
        "Refresh-Token": "refresh-value",
        "client_secret": "client-value",
        "db_password": "database-value",
        "Set-Cookie": "cookie-value",
        "X-API-Key": "api-value",
    }

    projected, truncated = sanitize_board_value({"nested": secrets})

    encoded = json.dumps(projected, sort_keys=True)
    assert truncated is True
    assert all(secret not in encoded for secret in secrets.values())
    assert set(projected["nested"].values()) == {"[REDACTED]"}


def test_camel_case_secret_keys_are_redacted() -> None:
    secrets = {
        "accessToken": "access-camel",
        "clientSecret": "client-camel",
        "dbPassword": "password-camel",
        "setCookie": "cookie-camel",
        "privateKey": "private-camel",
    }

    projected, truncated = sanitize_board_value({"nested": secrets})

    encoded = json.dumps(projected, sort_keys=True)
    assert truncated is True
    assert all(secret not in encoded for secret in secrets.values())
    assert set(projected["nested"].values()) == {"[REDACTED]"}


def test_large_input_mapping_is_fully_traversed_only_once(monkeypatch: pytest.MonkeyPatch) -> None:
    value = {f"key-{index:05}": "x" * 8192 for index in range(10_000, 0, -1)}
    submitted = BoardExecutionResult(kind="json", value=value)
    submitted_value = submitted.value
    original = board_results.sanitize_board_value
    original_identity_visits = 0

    def counting_sanitize(candidate, **kwargs):
        nonlocal original_identity_visits
        if candidate is submitted_value:
            original_identity_visits += 1
        return original(candidate, **kwargs)

    monkeypatch.setattr(board_results, "sanitize_board_value", counting_sanitize)

    result = bound_board_execution_result(submitted)

    assert result.truncated is True
    assert original_identity_visits == 1


def test_pydantic_projection_does_not_invoke_custom_serializers_before_caps() -> None:
    serializer_calls: list[bool] = []

    class UnsafeProjection(BaseModel):
        payload: dict[str, str]

        @field_serializer("payload")
        def serialize_payload(self, value: dict[str, str]) -> dict[str, str]:
            serializer_calls.append(True)
            return value

    value = UnsafeProjection(payload={f"key-{index:05}": "x" * 9000 for index in range(1000)})

    projected, truncated = sanitize_board_value(value)

    assert serializer_calls == []
    assert truncated is True
    assert len(projected["payload"]) <= 100
    assert max(map(len, projected["payload"].values())) <= 8192


@pytest.mark.parametrize("value", [{"x": 1}, [1], 1])
def test_text_result_rejects_non_string_values(value: object) -> None:
    with pytest.raises(ValidationError):
        BoardExecutionResult(kind="text", value=value)


def test_depth_nonfinite_and_unsupported_values_are_total_and_deterministic() -> None:
    deep = current = {}
    for _ in range(12):
        current["child"] = {}
        current = current["child"]
    value = {"deep": deep, "nan": nan, "unsupported": object()}

    first = sanitize_board_value(value)
    second = sanitize_board_value(value)

    assert first == second
    encoded = json.dumps(first[0], sort_keys=True, separators=(",", ":"))
    assert "unsupported_type" in encoded
    assert "max_depth" in encoded
    assert "NaN" not in encoded
    assert first[1] is True


@pytest.mark.parametrize("byte_limit", [32767, 32768, 32769])
def test_utf8_budget_never_splits_a_codepoint(byte_limit: int) -> None:
    result = sanitize_board_result(
        [_run_output("terminal", results={"payload": "🙂" * 20000})],
        terminal_node_ids=("terminal",),
        max_bytes=byte_limit,
    )

    assert result is not None
    encoded = json.dumps(
        result.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    assert len(encoded) <= byte_limit
    encoded.decode("utf-8")
    assert result.truncated is True


def test_detail_is_allowlisted_and_never_persists_raw_exception_text() -> None:
    raw = "Authorization=Bearer top-secret; password=hunter2"

    detail = sanitize_board_detail("execution_failed", raw)

    assert detail == "Flow execution failed."
    assert "top-secret" not in detail
    assert len(detail.encode("utf-8")) <= 2048


@pytest.mark.parametrize(
    ("status", "reason", "expected_status", "expected_reason"),
    [
        (JobStatus.QUEUED, None, "queued", None),
        (JobStatus.IN_PROGRESS, None, "running", None),
        (JobStatus.COMPLETED, None, "succeeded", None),
        (JobStatus.FAILED, "enqueue_failed", "failed", "enqueue_failed"),
        (JobStatus.TIMED_OUT, "execution_failed", "failed", "timed_out"),
        (JobStatus.CANCELLED, "user_cancelled", "cancelled", "user_cancelled"),
        (JobStatus.FAILED, "backend_restarted", "failed", "backend_restarted"),
    ],
)
def test_storage_to_public_projection_is_exhaustive_and_accepts_reserved_reason(
    status: JobStatus,
    reason: str | None,
    expected_status: str,
    expected_reason: str | None,
) -> None:
    result = {"kind": "text", "value": "done", "truncated": False} if status is JobStatus.COMPLETED else None
    job = _valid_job(status=status, reason=reason, result=result)

    dto = board_execution_from_job(job)

    assert dto.status == expected_status
    assert dto.reason == expected_reason
    assert dto.result is not None if status is JobStatus.COMPLETED else dto.result is None
    assert "origin_pid" not in dto.model_dump()
    assert "worker_instance_id" not in dto.model_dump()


def test_unknown_or_legacy_metadata_is_rejected_without_mutation() -> None:
    job = _valid_job(status=JobStatus.IN_PROGRESS)
    assert job.job_metadata is not None
    before = json.dumps(job.job_metadata, sort_keys=True)
    del job.job_metadata["mvp"]["worker_instance_id"]
    legacy = json.dumps(job.job_metadata, sort_keys=True)

    with pytest.raises(BoardResultMetadataError):
        board_execution_from_job(job)

    assert before != legacy
    assert json.dumps(job.job_metadata, sort_keys=True) == legacy


def test_metadata_flow_id_must_match_the_authoritative_job_flow() -> None:
    job = _valid_job(status=JobStatus.IN_PROGRESS)
    assert job.job_metadata is not None
    job.job_metadata["mvp"]["flow_id"] = str(uuid4())

    with pytest.raises(BoardResultMetadataError):
        board_execution_from_job(job)


@pytest.mark.parametrize("field", ["board_id", "flow_hash", "request_fingerprint"])
def test_claim_fingerprint_binds_owner_board_flow_and_hash(field: str) -> None:
    job = _valid_job(status=JobStatus.IN_PROGRESS)
    assert job.job_metadata is not None
    job.job_metadata["mvp"][field] = str(uuid4()) if field == "board_id" else "f" * 64

    with pytest.raises(BoardResultMetadataError):
        board_execution_from_job(job)
