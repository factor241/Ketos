from __future__ import annotations

import copy
from pathlib import Path

import pytest
from ketos.services.commands.flow_revision import mutate_flow_content_once
from ketos.services.database.models.flow.model import Flow


def _flow() -> Flow:
    return Flow(
        name="Original",
        description="Before",
        data={"nodes": [], "edges": []},
        revision=4,
    )


def test_content_mutation_bumps_revision_exactly_once() -> None:
    flow = _flow()

    changed = mutate_flow_content_once(
        flow,
        lambda target: (
            setattr(target, "name", "Updated"),
            setattr(target, "description", "After"),
            setattr(target, "data", {"nodes": [{"id": "n1"}], "edges": []}),
        ),
    )

    assert changed is True
    assert flow.revision == 5


def test_noop_and_metadata_only_mutations_do_not_bump_revision() -> None:
    flow = _flow()

    assert mutate_flow_content_once(flow, lambda target: setattr(target, "name", "Original")) is False
    assert mutate_flow_content_once(flow, lambda target: setattr(target, "icon", "bot")) is False
    assert flow.revision == 4
    assert flow.icon == "bot"


def test_failed_mutation_restores_all_content_and_revision() -> None:
    flow = _flow()
    before = copy.deepcopy(flow.model_dump())

    def fail(target: Flow) -> None:
        target.data = {"nodes": [{"id": "partial"}], "edges": []}
        target.revision = 99
        message = "writer_failed"
        raise RuntimeError(message)

    with pytest.raises(RuntimeError, match="writer_failed"):
        mutate_flow_content_once(flow, fail)

    assert flow.model_dump() == before


def test_known_persisted_flow_content_writers_use_central_revision_helper() -> None:
    backend = Path(__file__).parents[4] / "base" / "ketos"
    expected_calls = {
        "api/v1/flows_helpers.py": 1,
        "api/v1/flow_version.py": 1,
        "agentic/utils/assistant_runner.py": 1,
        "agentic/utils/flow_component.py": 1,
    }

    for relative_path, minimum_calls in expected_calls.items():
        source = (backend / relative_path).read_text(encoding="utf-8")
        assert source.count("mutate_flow_content_once(") >= minimum_calls, relative_path

    flow_update_sources = [
        path
        for path in backend.rglob("*.py")
        if "alembic/versions" not in path.as_posix() and "/tests/" not in path.as_posix()
    ]
    direct_writes: list[str] = []
    allowed = {
        "services/commands/flow_revision.py",
        "services/commands/apply_service.py",
        "services/commands/restore_service.py",
    }
    for path in flow_update_sources:
        relative = path.relative_to(backend).as_posix()
        if relative in allowed:
            continue
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            compact = line.strip()
            if any(token in compact for token in ("flow.data =", "db_flow.data =")):
                direct_writes.append(f"{relative}:{line_number}:{compact}")

    assert direct_writes == []
