"""Aggregate Stage 07 execution-domain contract checks."""

# ruff: noqa: INP001

from uuid import UUID, uuid4

from ketos.services.database.models.jobs.model import Job, JobStatus, JobType
from ketos.services.database.models.placement.model import PlacementTargetKind
from ketos.services.jobs.board_claim import derive_board_job_id
from ketos.services.jobs.board_contracts import BoardExecutionRead


def test_board_execution_reuses_job_identity_and_job_result_target() -> None:
    actor_id, board_id, flow_id = uuid4(), uuid4(), uuid4()

    first = derive_board_job_id(
        actor_id=actor_id,
        board_id=board_id,
        flow_id=flow_id,
        idempotency_key="browser-intent-1",
    )
    replay = derive_board_job_id(
        actor_id=actor_id,
        board_id=board_id,
        flow_id=flow_id,
        idempotency_key="browser-intent-1",
    )

    assert isinstance(first, UUID)
    assert first == replay
    assert Job.model_fields["job_id"].annotation == UUID
    assert JobType.WORKFLOW.value == "workflow"
    assert PlacementTargetKind.JOB_RESULT.value == "job_result"


def test_public_contract_has_only_authoritative_persisted_statuses() -> None:
    status_schema = BoardExecutionRead.model_json_schema()["properties"]["status"]

    assert set(status_schema["enum"]) == {
        "queued",
        "running",
        "succeeded",
        "failed",
        "cancelled",
    }
    assert "unknown" not in status_schema["enum"]
    assert JobStatus.COMPLETED.value == "completed"
