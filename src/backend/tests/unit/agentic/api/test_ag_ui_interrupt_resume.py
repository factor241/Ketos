from __future__ import annotations

import asyncio
import importlib
import os
import stat
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
from ag_ui.core import (
    EventType,
    ResumeEntry,
    RunAgentInput,
    RunErrorEvent,
    RunFinishedEvent,
    StateSnapshotEvent,
)
from ketos.agentic.services.ag_ui.assembly import assemble_langgraph_agent

if TYPE_CHECKING:
    from collections.abc import Sequence

    from ag_ui_langgraph import LangGraphAgent

CHECKPOINT_MODULE = "ketos.agentic.services.ag_ui.checkpoint"
CHECKPOINT_SOURCE = Path(__file__).parents[4] / "base" / "ketos" / "agentic" / "services" / "ag_ui" / "checkpoint.py"
HITL_MODULE = "ketos.agentic.services.ag_ui.hitl_probe"
HITL_SOURCE = CHECKPOINT_SOURCE.with_name("hitl_probe.py")


def _run_input(
    thread_id: str,
    run_id: str,
    *,
    state: dict[str, object] | None = None,
    resume: list[ResumeEntry] | None = None,
    forwarded_props: dict[str, object] | None = None,
) -> RunAgentInput:
    return RunAgentInput(
        thread_id=thread_id,
        run_id=run_id,
        state={} if state is None else state,
        messages=[],
        tools=[],
        context=[],
        forwarded_props={} if forwarded_props is None else forwarded_props,
        resume=resume,
    )


async def _collect_events(
    template: LangGraphAgent,
    run_input: RunAgentInput,
) -> list[object]:
    request_agent = template.clone()
    return [event async for event in request_agent.run(run_input)]


def _interrupt_finish(events: Sequence[object]) -> RunFinishedEvent:
    finished = events[-1]
    assert isinstance(finished, RunFinishedEvent)
    assert finished.outcome is not None
    assert finished.outcome.type == "interrupt"
    return finished


def _resume_all(finished: RunFinishedEvent, *, approved: bool) -> list[ResumeEntry]:
    assert finished.outcome is not None
    assert finished.outcome.type == "interrupt"
    return [
        ResumeEntry(
            interrupt_id=interrupt.id,
            status="resolved",
            payload={"approved": approved},
        )
        for interrupt in finished.outcome.interrupts
    ]


def _resolved_entry(interrupt_id: str, *, approved: object = True) -> ResumeEntry:
    return ResumeEntry(
        interrupt_id=interrupt_id,
        status="resolved",
        payload={"approved": approved},
    )


@pytest.mark.asyncio
async def test_checkpoint_lifecycle_creates_file_backed_strict_saver(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LANGGRAPH_STRICT_MSGPACK", "true")
    checkpoint_path = tmp_path / "stage-01-checkpoints" / "hitl.sqlite3"

    assert CHECKPOINT_SOURCE.is_file(), "A08 checkpoint lifecycle is not implemented"
    checkpoint_module = importlib.import_module(CHECKPOINT_MODULE)
    lifecycle = checkpoint_module.AsyncSqliteCheckpoint(checkpoint_path)
    first_saver = await lifecycle.open()

    assert await lifecycle.open() is first_saver

    async with lifecycle as opened:
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

        assert opened is lifecycle
        assert lifecycle.saver is first_saver
        assert isinstance(lifecycle.saver, AsyncSqliteSaver)
        assert lifecycle.path == checkpoint_path
        assert checkpoint_path != Path(":memory:")
        await lifecycle.saver.setup()
        assert stat.S_IMODE(checkpoint_path.parent.stat().st_mode) == 0o700
        assert stat.S_ISREG(checkpoint_path.stat().st_mode)
        assert stat.S_IMODE(checkpoint_path.stat().st_mode) == 0o600
        assert lifecycle.saver.serde.pickle_fallback is False
        assert lifecycle.saver.serde._allowed_msgpack_modules is None

    with pytest.raises(RuntimeError, match="not open"):
        _ = lifecycle.saver
    reopened_saver = await lifecycle.open()
    assert reopened_saver is not first_saver
    await lifecycle.close()
    await lifecycle.close()


def test_a08_sources_do_not_own_resume_parsing_or_event_encoding() -> None:
    prohibited_tokens = {
        "Command(",
        "CustomEvent",
        "EventEncoder",
        "ResumeEntry",
        "RunAgentInput",
        "forwardedProps",
        "forwarded_props",
        "pickle.loads",
        "pickle_fallback=True",
        "text/event-stream",
        "_resume_claim_registry",
        "_thread_lock_registry",
    }

    for source_path in (CHECKPOINT_SOURCE, HITL_SOURCE):
        source = source_path.read_text(encoding="utf-8")
        assert prohibited_tokens.isdisjoint(source.split())
        for token in prohibited_tokens:
            assert token not in source


def test_checkpoint_path_is_local_dedicated_and_env_overridable(tmp_path: Path) -> None:
    checkpoint_module = importlib.import_module(CHECKPOINT_MODULE)
    configured = tmp_path / "explicit" / "checkpoint.sqlite3"
    default_data_dir = tmp_path / "data"

    assert (
        checkpoint_module.resolve_checkpoint_path(
            {checkpoint_module.CHECKPOINT_DB_ENV: str(configured)},
            default_data_dir=default_data_dir,
        )
        == configured
    )
    assert (
        checkpoint_module.resolve_checkpoint_path(
            {},
            default_data_dir=default_data_dir,
        )
        == default_data_dir / "ag-ui" / "checkpoints.sqlite3"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("strict_value", [None, "false", "TRUE", "1", " true "])
async def test_checkpoint_lifecycle_fails_closed_without_exact_strict_msgpack(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    strict_value: str | None,
) -> None:
    checkpoint_module = importlib.import_module(CHECKPOINT_MODULE)
    if strict_value is None:
        monkeypatch.delenv("LANGGRAPH_STRICT_MSGPACK", raising=False)
    else:
        monkeypatch.setenv("LANGGRAPH_STRICT_MSGPACK", strict_value)
    checkpoint_path = tmp_path / "strict" / "checkpoint.sqlite3"

    with pytest.raises(RuntimeError, match="LANGGRAPH_STRICT_MSGPACK=true"):
        await checkpoint_module.AsyncSqliteCheckpoint(checkpoint_path).open()
    assert not checkpoint_path.exists()


@pytest.mark.asyncio
async def test_checkpoint_lifecycle_rejects_memory_symlinks_and_binding_collision(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    checkpoint_module = importlib.import_module(CHECKPOINT_MODULE)
    monkeypatch.setenv("LANGGRAPH_STRICT_MSGPACK", "true")

    with pytest.raises(ValueError, match="real file"):
        await checkpoint_module.AsyncSqliteCheckpoint(":memory:").open()

    target = tmp_path / "target.sqlite3"
    target.touch()
    symlink = tmp_path / "checkpoint.sqlite3"
    symlink.symlink_to(target)
    with pytest.raises(ValueError, match="symlink"):
        await checkpoint_module.AsyncSqliteCheckpoint(symlink).open()

    binding_path = tmp_path / "shared.sqlite3"
    monkeypatch.setenv(checkpoint_module.BINDING_DB_ENV, str(binding_path))
    with pytest.raises(ValueError, match="separate files"):
        await checkpoint_module.AsyncSqliteCheckpoint(binding_path).open()


@pytest.mark.asyncio
async def test_checkpoint_refuses_insecure_existing_directory_without_changing_its_mode(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    checkpoint_module = importlib.import_module(CHECKPOINT_MODULE)
    monkeypatch.setenv("LANGGRAPH_STRICT_MSGPACK", "true")
    shared_directory = tmp_path / "shared"
    shared_directory.mkdir(mode=0o755)
    shared_directory.chmod(0o755)

    with pytest.raises(ValueError, match="permissions"):
        await checkpoint_module.AsyncSqliteCheckpoint(shared_directory / "hitl.sqlite3").open()

    assert stat.S_IMODE(shared_directory.stat().st_mode) == 0o755
    assert not (shared_directory / "hitl.sqlite3").exists()


@pytest.mark.asyncio
async def test_checkpoint_rejects_symlink_in_ancestor_chain(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    checkpoint_module = importlib.import_module(CHECKPOINT_MODULE)
    monkeypatch.setenv("LANGGRAPH_STRICT_MSGPACK", "true")
    real_root = tmp_path / "real-root"
    real_root.mkdir(mode=0o700)
    real_root.chmod(0o700)
    linked_root = tmp_path / "linked-root"
    linked_root.symlink_to(real_root, target_is_directory=True)
    checkpoint_path = linked_root / "nested" / "hitl.sqlite3"

    with pytest.raises(ValueError, match="symlink"):
        await checkpoint_module.AsyncSqliteCheckpoint(checkpoint_path).open()

    assert not (real_root / "nested").exists()


@pytest.mark.asyncio
async def test_checkpoint_rejects_controlled_directory_owner_mismatch(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    checkpoint_module = importlib.import_module(CHECKPOINT_MODULE)
    monkeypatch.setenv("LANGGRAPH_STRICT_MSGPACK", "true")
    parent = tmp_path / "checkpoint"
    parent.mkdir(mode=0o700)
    parent.chmod(0o700)
    monkeypatch.setattr(checkpoint_module.os, "geteuid", lambda: os.getuid() + 1)

    with pytest.raises(ValueError, match="effective user"):
        await checkpoint_module.AsyncSqliteCheckpoint(parent / "hitl.sqlite3").open()

    assert not (parent / "hitl.sqlite3").exists()


@pytest.mark.asyncio
async def test_checkpoint_rejects_permissive_preexisting_database_without_chmod(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    checkpoint_module = importlib.import_module(CHECKPOINT_MODULE)
    monkeypatch.setenv("LANGGRAPH_STRICT_MSGPACK", "true")
    parent = tmp_path / "checkpoint"
    parent.mkdir(mode=0o700)
    parent.chmod(0o700)
    checkpoint_path = parent / "hitl.sqlite3"
    checkpoint_path.write_bytes(b"")
    checkpoint_path.chmod(0o644)

    with pytest.raises(ValueError, match="0600"):
        await checkpoint_module.AsyncSqliteCheckpoint(checkpoint_path).open()

    assert stat.S_IMODE(checkpoint_path.stat().st_mode) == 0o644


@pytest.mark.asyncio
async def test_checkpoint_rejects_hardlink_alias_to_binding_database(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    checkpoint_module = importlib.import_module(CHECKPOINT_MODULE)
    monkeypatch.setenv("LANGGRAPH_STRICT_MSGPACK", "true")
    parent = tmp_path / "checkpoint"
    parent.mkdir(mode=0o700)
    parent.chmod(0o700)
    binding_path = parent / "binding.sqlite3"
    binding_path.write_bytes(b"")
    binding_path.chmod(0o600)
    checkpoint_path = parent / "hitl.sqlite3"
    os.link(binding_path, checkpoint_path)
    monkeypatch.setenv(checkpoint_module.BINDING_DB_ENV, str(binding_path))

    with pytest.raises(ValueError, match=r"binding|hard link"):
        await checkpoint_module.AsyncSqliteCheckpoint(checkpoint_path).open()

    assert binding_path.stat().st_ino == checkpoint_path.stat().st_ino


@pytest.mark.asyncio
async def test_checkpoint_rejects_inode_substitution_during_saver_open(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    checkpoint_module = importlib.import_module(CHECKPOINT_MODULE)
    monkeypatch.setenv("LANGGRAPH_STRICT_MSGPACK", "true")
    checkpoint_path = tmp_path / "checkpoint" / "hitl.sqlite3"
    real_from_conn_string = checkpoint_module.AsyncSqliteSaver.from_conn_string
    substituted = False

    def substituting_from_conn_string(_cls, connection_string: str):
        nonlocal substituted
        if not substituted:
            substituted = True
            checkpoint_path.unlink()
            descriptor = os.open(checkpoint_path, os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600)
            os.close(descriptor)
        return real_from_conn_string(connection_string)

    monkeypatch.setattr(
        checkpoint_module.AsyncSqliteSaver,
        "from_conn_string",
        classmethod(substituting_from_conn_string),
    )
    lifecycle = checkpoint_module.AsyncSqliteCheckpoint(checkpoint_path)

    with pytest.raises(ValueError, match="inode changed"):
        await lifecycle.open()

    assert substituted is True


@pytest.mark.asyncio
async def test_checkpoint_cleanup_is_exact_and_preserves_binding_database(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    checkpoint_module = importlib.import_module(CHECKPOINT_MODULE)
    monkeypatch.setenv("LANGGRAPH_STRICT_MSGPACK", "true")
    checkpoint_path = tmp_path / "checkpoint" / "hitl.sqlite3"
    binding_path = tmp_path / "binding" / "ownership.sqlite3"
    binding_path.parent.mkdir()
    binding_path.write_bytes(b"binding-authority")
    monkeypatch.setenv(checkpoint_module.BINDING_DB_ENV, str(binding_path))
    neighbor = checkpoint_path.parent / "keep.txt"

    lifecycle = checkpoint_module.AsyncSqliteCheckpoint(checkpoint_path)
    await lifecycle.open()
    with pytest.raises(RuntimeError, match=r"close.*before deletion"):
        await lifecycle.delete_files()
    await lifecycle.close()
    neighbor.write_text("keep", encoding="utf-8")
    wal_path = Path(f"{checkpoint_path}-wal")
    shm_path = Path(f"{checkpoint_path}-shm")
    wal_path.touch(mode=0o600)
    shm_path.touch(mode=0o600)

    deleted = await lifecycle.delete_files()

    assert set(deleted) == {checkpoint_path, wal_path, shm_path}
    assert binding_path.read_bytes() == b"binding-authority"
    assert neighbor.read_text(encoding="utf-8") == "keep"
    assert checkpoint_path.parent.is_dir()


@pytest.mark.asyncio
async def test_checkpoint_cleanup_rejects_sidecar_symlink_before_deleting_anything(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    checkpoint_module = importlib.import_module(CHECKPOINT_MODULE)
    monkeypatch.setenv("LANGGRAPH_STRICT_MSGPACK", "true")
    checkpoint_path = tmp_path / "checkpoint" / "hitl.sqlite3"
    lifecycle = checkpoint_module.AsyncSqliteCheckpoint(checkpoint_path)
    await lifecycle.open()
    await lifecycle.close()
    target = tmp_path / "target"
    target.write_text("outside", encoding="utf-8")
    wal_path = Path(f"{checkpoint_path}-wal")
    wal_path.symlink_to(target)

    with pytest.raises(ValueError, match="non-regular"):
        await lifecycle.delete_files()

    assert checkpoint_path.is_file()
    assert wal_path.is_symlink()
    assert target.read_text(encoding="utf-8") == "outside"


@pytest.mark.asyncio
@pytest.mark.parametrize("sidecar_case", ["hardlink", "permissive"])
async def test_checkpoint_cleanup_rejects_unsafe_sidecar_before_deleting_anything(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    sidecar_case: str,
) -> None:
    checkpoint_module = importlib.import_module(CHECKPOINT_MODULE)
    monkeypatch.setenv("LANGGRAPH_STRICT_MSGPACK", "true")
    checkpoint_path = tmp_path / "checkpoint" / "hitl.sqlite3"
    lifecycle = checkpoint_module.AsyncSqliteCheckpoint(checkpoint_path)
    await lifecycle.open()
    await lifecycle.close()
    wal_path = Path(f"{checkpoint_path}-wal")
    if sidecar_case == "hardlink":
        target = tmp_path / "target"
        target.write_bytes(b"outside")
        target.chmod(0o600)
        os.link(target, wal_path)
    else:
        wal_path.write_bytes(b"unsafe")
        wal_path.chmod(0o644)

    with pytest.raises(ValueError, match=r"hard link|0600"):
        await lifecycle.delete_files()

    assert checkpoint_path.is_file()
    assert wal_path.is_file()


@pytest.mark.asyncio
async def test_initial_run_emits_snapshot_before_exact_all_open_interrupts(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LANGGRAPH_STRICT_MSGPACK", "true")
    checkpoint_module = importlib.import_module(CHECKPOINT_MODULE)
    checkpoint_path = tmp_path / "checkpoint" / "hitl.sqlite3"

    assert HITL_SOURCE.is_file(), "A08 deterministic HITL graph is not implemented"
    hitl_module = importlib.import_module(HITL_MODULE)
    async with checkpoint_module.AsyncSqliteCheckpoint(checkpoint_path) as checkpoint:
        build_calls = 0

        def graph_builder(_component: object):
            nonlocal build_calls
            build_calls += 1
            return hitl_module.build_hitl_probe_graph(checkpointer=checkpoint.saver)

        template = assemble_langgraph_agent(object(), graph_builder=graph_builder)
        initial_state = hitl_module.initial_hitl_probe_state()
        events = await _collect_events(template, _run_input("thread-initial", "run-initial", state=initial_state))

    finished = _interrupt_finish(events)
    snapshots = [event for event in events if isinstance(event, StateSnapshotEvent)]
    assert build_calls == 1
    assert snapshots
    assert events.index(snapshots[-1]) < events.index(finished)
    assert len(finished.outcome.interrupts) == 2
    assert len({interrupt.id for interrupt in finished.outcome.interrupts}) == 2
    assert all(interrupt.reason == "confirmation" for interrupt in finished.outcome.interrupts)
    assert all(
        interrupt.response_schema == hitl_module.APPROVAL_RESPONSE_SCHEMA for interrupt in finished.outcome.interrupts
    )
    assert snapshots[-1].snapshot["effect_count"] == 0
    assert set(snapshots[-1].snapshot) <= {
        "confirmation_a",
        "confirmation_b",
        "effect_count",
        "final_decision",
        "stage_marker",
    }
    assert all(getattr(event, "type", None) != EventType.CUSTOM for event in events)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("approved", "expected_decision"),
    [(True, "approved"), (False, "rejected")],
)
async def test_exact_all_open_approve_and_reject_apply_one_effect(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    approved: object,
    expected_decision: str,
) -> None:
    assert type(approved) is bool
    monkeypatch.setenv("LANGGRAPH_STRICT_MSGPACK", "true")
    checkpoint_module = importlib.import_module(CHECKPOINT_MODULE)
    hitl_module = importlib.import_module(HITL_MODULE)
    checkpoint_path = tmp_path / f"checkpoint-{approved}" / "hitl.sqlite3"
    thread_id = f"thread-{approved}"

    async with checkpoint_module.AsyncSqliteCheckpoint(checkpoint_path) as checkpoint:
        template = assemble_langgraph_agent(
            object(),
            graph_builder=lambda _component: hitl_module.build_hitl_probe_graph(checkpointer=checkpoint.saver),
        )
        initial_events = await _collect_events(
            template,
            _run_input(thread_id, "run-initial", state=hitl_module.initial_hitl_probe_state()),
        )
        initial_finish = _interrupt_finish(initial_events)
        resume_events = await _collect_events(
            template,
            _run_input(
                thread_id,
                "run-resume",
                resume=_resume_all(initial_finish, approved=approved),
            ),
        )
        durable_state = await template.graph.aget_state({"configurable": {"thread_id": thread_id}})

    assert sum(getattr(event, "type", None) == EventType.RUN_STARTED for event in resume_events) == 1
    assert isinstance(resume_events[-1], RunFinishedEvent)
    assert not isinstance(resume_events[-1], RunErrorEvent)
    assert resume_events[-1].thread_id == thread_id
    assert resume_events[-1].run_id == "run-resume"
    assert durable_state.values["confirmation_a"] is approved
    assert durable_state.values["confirmation_b"] is approved
    assert durable_state.values["effect_count"] == 1
    assert durable_state.values["final_decision"] == expected_decision


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "resume_case",
    ["partial", "unknown", "duplicate", "empty", "invalid-status"],
)
async def test_non_exact_resume_sets_are_standard_run_error_with_zero_effect(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    resume_case: str,
) -> None:
    monkeypatch.setenv("LANGGRAPH_STRICT_MSGPACK", "true")
    checkpoint_module = importlib.import_module(CHECKPOINT_MODULE)
    hitl_module = importlib.import_module(HITL_MODULE)
    checkpoint_path = tmp_path / resume_case / "hitl.sqlite3"
    thread_id = f"thread-{resume_case}"

    async with checkpoint_module.AsyncSqliteCheckpoint(checkpoint_path) as checkpoint:
        template = assemble_langgraph_agent(
            object(),
            graph_builder=lambda _component: hitl_module.build_hitl_probe_graph(checkpointer=checkpoint.saver),
        )
        initial_events = await _collect_events(
            template,
            _run_input(thread_id, "run-initial", state=hitl_module.initial_hitl_probe_state()),
        )
        interrupted = _interrupt_finish(initial_events)
        assert interrupted.outcome is not None
        assert interrupted.outcome.type == "interrupt"
        first_id, second_id = (interrupt.id for interrupt in interrupted.outcome.interrupts)
        if resume_case == "partial":
            resume = [_resolved_entry(first_id)]
        elif resume_case == "unknown":
            resume = [_resolved_entry(first_id), _resolved_entry("unknown-interrupt")]
        elif resume_case == "duplicate":
            resume = [_resolved_entry(first_id), _resolved_entry(first_id), _resolved_entry(second_id)]
        elif resume_case == "invalid-status":
            resume = [
                _resolved_entry(first_id),
                ResumeEntry.model_construct(
                    interrupt_id=second_id,
                    status="invalid",
                    payload={"approved": True},
                ),
            ]
        else:
            resume = []
        denied_events = await _collect_events(template, _run_input(thread_id, "run-denied", resume=resume))
        durable_state = await template.graph.aget_state({"configurable": {"thread_id": thread_id}})

    assert len(denied_events) == 1
    assert isinstance(denied_events[0], RunErrorEvent)
    assert denied_events[0].type == EventType.RUN_ERROR
    assert durable_state.values["effect_count"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("mixed_with_standard", [False, True])
async def test_deprecated_forwarded_resume_is_standard_run_error(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    mixed_with_standard: object,
) -> None:
    assert type(mixed_with_standard) is bool
    monkeypatch.setenv("LANGGRAPH_STRICT_MSGPACK", "true")
    checkpoint_module = importlib.import_module(CHECKPOINT_MODULE)
    hitl_module = importlib.import_module(HITL_MODULE)
    checkpoint_path = tmp_path / f"legacy-{mixed_with_standard}" / "hitl.sqlite3"
    thread_id = f"thread-legacy-{mixed_with_standard}"

    async with checkpoint_module.AsyncSqliteCheckpoint(checkpoint_path) as checkpoint:
        template = assemble_langgraph_agent(
            object(),
            graph_builder=lambda _component: hitl_module.build_hitl_probe_graph(checkpointer=checkpoint.saver),
        )
        initial_events = await _collect_events(
            template,
            _run_input(thread_id, "run-initial", state=hitl_module.initial_hitl_probe_state()),
        )
        interrupted = _interrupt_finish(initial_events)
        standard_resume = _resume_all(interrupted, approved=True) if mixed_with_standard else None
        denied_events = await _collect_events(
            template,
            _run_input(
                thread_id,
                "run-legacy",
                resume=standard_resume,
                forwarded_props={"command": {"resume": {"approved": True}}},
            ),
        )
        durable_state = await template.graph.aget_state({"configurable": {"thread_id": thread_id}})

    assert len(denied_events) == 1
    assert isinstance(denied_events[0], RunErrorEvent)
    assert durable_state.values["effect_count"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("case_id", "payload"),
    [
        ("missing", {}),
        ("string", {"approved": "yes"}),
        ("integer", {"approved": 1}),
        ("authority-extra", {"approved": True, "role": "admin"}),
        ("model-extra", {"approved": False, "model": "override"}),
    ],
)
async def test_invalid_decision_payload_fails_graph_with_zero_effect(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    case_id: str,
    payload: dict[str, object],
) -> None:
    monkeypatch.setenv("LANGGRAPH_STRICT_MSGPACK", "true")
    checkpoint_module = importlib.import_module(CHECKPOINT_MODULE)
    hitl_module = importlib.import_module(HITL_MODULE)
    checkpoint_path = tmp_path / case_id / "hitl.sqlite3"
    thread_id = f"thread-payload-{case_id}"

    async with checkpoint_module.AsyncSqliteCheckpoint(checkpoint_path) as checkpoint:
        template = assemble_langgraph_agent(
            object(),
            graph_builder=lambda _component: hitl_module.build_hitl_probe_graph(checkpointer=checkpoint.saver),
        )
        initial_events = await _collect_events(
            template,
            _run_input(thread_id, "run-initial", state=hitl_module.initial_hitl_probe_state()),
        )
        interrupted = _interrupt_finish(initial_events)
        assert interrupted.outcome is not None
        assert interrupted.outcome.type == "interrupt"
        resume = [
            ResumeEntry(interrupt_id=item.id, status="resolved", payload=payload)
            for item in interrupted.outcome.interrupts
        ]
        with pytest.raises(ValueError, match="confirmation"):
            await _collect_events(template, _run_input(thread_id, "run-invalid", resume=resume))
        durable_state = await template.graph.aget_state({"configurable": {"thread_id": thread_id}})

    assert durable_state.values["effect_count"] == 0


@pytest.mark.asyncio
async def test_new_app_resumes_then_later_restart_denies_replay(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LANGGRAPH_STRICT_MSGPACK", "true")
    checkpoint_module = importlib.import_module(CHECKPOINT_MODULE)
    hitl_module = importlib.import_module(HITL_MODULE)
    checkpoint_path = tmp_path / "restart" / "hitl.sqlite3"
    thread_id = "thread-restart"

    first_lifecycle = checkpoint_module.AsyncSqliteCheckpoint(checkpoint_path)
    async with first_lifecycle as checkpoint:
        first_template = assemble_langgraph_agent(
            object(),
            graph_builder=lambda _component: hitl_module.build_hitl_probe_graph(checkpointer=checkpoint.saver),
        )
        initial_events = await _collect_events(
            first_template,
            _run_input(thread_id, "run-initial", state=hitl_module.initial_hitl_probe_state()),
        )
        interrupted = _interrupt_finish(initial_events)
        resume = _resume_all(interrupted, approved=True)

    second_lifecycle = checkpoint_module.AsyncSqliteCheckpoint(checkpoint_path)
    async with second_lifecycle as checkpoint:
        second_template = assemble_langgraph_agent(
            object(),
            graph_builder=lambda _component: hitl_module.build_hitl_probe_graph(checkpointer=checkpoint.saver),
        )
        resumed_events = await _collect_events(
            second_template,
            _run_input(thread_id, "run-after-restart", resume=resume),
        )
        resumed_state = await second_template.graph.aget_state({"configurable": {"thread_id": thread_id}})

    third_lifecycle = checkpoint_module.AsyncSqliteCheckpoint(checkpoint_path)
    async with third_lifecycle as checkpoint:
        third_template = assemble_langgraph_agent(
            object(),
            graph_builder=lambda _component: hitl_module.build_hitl_probe_graph(checkpointer=checkpoint.saver),
        )
        replay_events = await _collect_events(
            third_template,
            _run_input(thread_id, "run-replay", resume=resume),
        )
        replay_state = await third_template.graph.aget_state({"configurable": {"thread_id": thread_id}})

    assert first_lifecycle is not second_lifecycle is not third_lifecycle
    assert isinstance(resumed_events[-1], RunFinishedEvent)
    assert resumed_events[-1].run_id == "run-after-restart"
    assert resumed_state.values["effect_count"] == 1
    assert len(replay_events) == 1
    assert isinstance(replay_events[0], RunErrorEvent)
    assert replay_state.values["effect_count"] == 1


@pytest.mark.asyncio
async def test_concurrent_duplicate_resumes_allow_one_winner_and_one_effect(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LANGGRAPH_STRICT_MSGPACK", "true")
    checkpoint_module = importlib.import_module(CHECKPOINT_MODULE)
    hitl_module = importlib.import_module(HITL_MODULE)
    checkpoint_path = tmp_path / "concurrent" / "hitl.sqlite3"
    thread_id = "thread-concurrent"

    async with checkpoint_module.AsyncSqliteCheckpoint(checkpoint_path) as checkpoint:
        template = assemble_langgraph_agent(
            object(),
            graph_builder=lambda _component: hitl_module.build_hitl_probe_graph(checkpointer=checkpoint.saver),
        )
        initial_events = await _collect_events(
            template,
            _run_input(thread_id, "run-initial", state=hitl_module.initial_hitl_probe_state()),
        )
        resume = _resume_all(_interrupt_finish(initial_events), approved=True)
        first_events, second_events = await asyncio.gather(
            _collect_events(template, _run_input(thread_id, "run-concurrent-a", resume=resume)),
            _collect_events(template, _run_input(thread_id, "run-concurrent-b", resume=resume)),
        )
        durable_state = await template.graph.aget_state({"configurable": {"thread_id": thread_id}})

    terminal_events = (first_events[-1], second_events[-1])
    assert sum(isinstance(event, RunFinishedEvent) for event in terminal_events) == 1
    assert sum(isinstance(event, RunErrorEvent) for event in terminal_events) == 1
    winner_events = first_events if isinstance(first_events[-1], RunFinishedEvent) else second_events
    loser_events = first_events if isinstance(first_events[-1], RunErrorEvent) else second_events
    assert sum(getattr(event, "type", None) == EventType.RUN_STARTED for event in winner_events) == 1
    assert len(loser_events) == 1
    assert loser_events[0].type == EventType.RUN_ERROR
    assert durable_state.values["effect_count"] == 1


@pytest.mark.asyncio
async def test_disconnect_after_resume_dispatch_can_retry_without_second_effect(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LANGGRAPH_STRICT_MSGPACK", "true")
    checkpoint_module = importlib.import_module(CHECKPOINT_MODULE)
    hitl_module = importlib.import_module(HITL_MODULE)
    checkpoint_path = tmp_path / "disconnect" / "hitl.sqlite3"
    thread_id = "thread-disconnect"

    async with checkpoint_module.AsyncSqliteCheckpoint(checkpoint_path) as checkpoint:
        first_template = assemble_langgraph_agent(
            object(),
            graph_builder=lambda _component: hitl_module.build_hitl_probe_graph(checkpointer=checkpoint.saver),
        )
        initial_events = await _collect_events(
            first_template,
            _run_input(thread_id, "run-initial", state=hitl_module.initial_hitl_probe_state()),
        )
        resume = _resume_all(_interrupt_finish(initial_events), approved=True)
        interrupted_stream = first_template.clone().run(_run_input(thread_id, "run-disconnected", resume=resume))
        first_event = await anext(interrupted_stream)
        assert getattr(first_event, "type", None) == EventType.RUN_STARTED
        await interrupted_stream.aclose()
        state_after_disconnect = await first_template.graph.aget_state({"configurable": {"thread_id": thread_id}})

    async with checkpoint_module.AsyncSqliteCheckpoint(checkpoint_path) as checkpoint:
        restarted_template = assemble_langgraph_agent(
            object(),
            graph_builder=lambda _component: hitl_module.build_hitl_probe_graph(checkpointer=checkpoint.saver),
        )
        retry_events = await _collect_events(
            restarted_template,
            _run_input(thread_id, "run-retry", resume=resume),
        )
        final_state = await restarted_template.graph.aget_state({"configurable": {"thread_id": thread_id}})

    assert state_after_disconnect.values["effect_count"] == 0
    assert isinstance(retry_events[-1], RunFinishedEvent)
    assert final_state.values["effect_count"] == 1
