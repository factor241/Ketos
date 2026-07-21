from __future__ import annotations

from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from langgraph.types import Interrupt

from ketos.services.commands.recovery import (
    CommandCheckpointInspector,
    CommandRecoveryProofError,
    recover_pending_command,
    resolve_recovered_command,
)
from ketos.services.database.models.command_proposal.model import CommandProposalStatus

THREAD_ID = str(uuid4())
PROPOSAL_ID = uuid4()
CHAT_RUN_ID = uuid4()
ACTOR_ID = uuid4()
PROPOSAL_HASH = "a" * 64
INTERRUPT_ID = "standard-interrupt-id"


def _interrupt(*, proposal_id: UUID = PROPOSAL_ID, proposal_hash: str = PROPOSAL_HASH) -> Interrupt:
    return Interrupt(
        value={
            "reason": "confirmation",
            "message": "Review the proposed flow changes before applying them.",
            "responseSchema": {
                "type": "object",
                "properties": {"approved": {"type": "boolean"}},
                "required": ["approved"],
                "additionalProperties": False,
            },
            "metadata": {
                "type": "ketos.flow-command-confirmation.v1",
                "proposalId": str(proposal_id),
                "proposalHash": proposal_hash,
                "preview": {"risk": "low"},
            },
        },
        id=INTERRUPT_ID,
    )


class FakeSaver:
    def __init__(self, writes, *, thread_id: str = THREAD_ID) -> None:
        self.tuple = SimpleNamespace(
            config={"configurable": {"thread_id": thread_id, "checkpoint_ns": ""}},
            checkpoint={"channel_values": {"state": {}}},
            pending_writes=writes,
        )

    async def aget_tuple(self, config):
        return self.tuple


def _proposal(**overrides):
    values = {
        "id": PROPOSAL_ID,
        "actor_id": ACTOR_ID,
        "chat_run_id": CHAT_RUN_ID,
        "thread_id": THREAD_ID,
        "interrupt_id": INTERRUPT_ID,
        "interrupt_bound_at": object(),
        "proposal_hash": PROPOSAL_HASH,
        "status": CommandProposalStatus.AWAITING_CONFIRMATION,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


async def test_inspector_proves_exact_single_standard_interrupt() -> None:
    saver = FakeSaver([("task", "__interrupt__", [_interrupt()])])

    proof = (await CommandCheckpointInspector().open_interrupts(saver, THREAD_ID))[0]

    assert proof.proposal_id == PROPOSAL_ID
    assert proof.proposal_hash == PROPOSAL_HASH
    assert proof.interrupt_id == INTERRUPT_ID
    assert proof.thread_id == THREAD_ID


@pytest.mark.parametrize(
    "writes",
    [
        [],
        [("task", "__interrupt__", [_interrupt(proposal_hash="b" * 64), _interrupt()])],
        [("task-a", "__interrupt__", [_interrupt()]), ("task-b", "__interrupt__", [_interrupt()])],
        [("task", "other", [_interrupt()])],
    ],
)
async def test_recovery_fails_closed_for_missing_or_ambiguous_interrupt(writes) -> None:
    service = SimpleNamespace(load_authorized_proposal=lambda *args, **kwargs: None)
    inspector = CommandCheckpointInspector()
    with pytest.raises(CommandRecoveryProofError):
        await inspector.require_exact(FakeSaver(writes), thread_id=THREAD_ID, proposal=_proposal())


async def test_recover_pending_checks_authorized_row_before_checkpoint() -> None:
    calls = []

    async def load_authorized_proposal(_session, *, proposal_id, actor_id):
        calls.append((proposal_id, actor_id))
        return _proposal()

    service = SimpleNamespace(load_authorized_proposal=load_authorized_proposal)
    pending = await recover_pending_command(
        session=object(),
        checkpointer=FakeSaver([("task", "__interrupt__", [_interrupt()])]),
        checkpoint_inspector=CommandCheckpointInspector(),
        command_service=service,
        actor_id=ACTOR_ID,
        chat_run_id=CHAT_RUN_ID,
        proposal_id=PROPOSAL_ID,
    )

    assert calls == [(PROPOSAL_ID, ACTOR_ID)]
    assert pending.proposal_id == PROPOSAL_ID
    assert pending.interrupt_id == INTERRUPT_ID


async def test_resolve_delegates_to_public_service_only_after_proof() -> None:
    resolutions = []

    async def load_authorized_proposal(_session, *, proposal_id, actor_id):
        return _proposal()

    async def resolve_proposal(_session, **kwargs):
        resolutions.append(kwargs)
        return "resolved"

    service = SimpleNamespace(
        load_authorized_proposal=load_authorized_proposal,
        resolve_proposal=resolve_proposal,
    )
    result = await resolve_recovered_command(
        session=object(),
        checkpointer=FakeSaver([("task", "__interrupt__", [_interrupt()])]),
        checkpoint_inspector=CommandCheckpointInspector(),
        command_service=service,
        actor_id=ACTOR_ID,
        chat_run_id=CHAT_RUN_ID,
        proposal_id=PROPOSAL_ID,
        approved=True,
        component_registry={"Agent": {}},
    )

    assert result == "resolved"
    assert len(resolutions) == 1
    assert resolutions[0]["interrupt_id"] == INTERRUPT_ID
    assert resolutions[0]["thread_id"] == THREAD_ID


@pytest.mark.parametrize(
    "proposal",
    [
        _proposal(status=CommandProposalStatus.APPLIED),
        _proposal(chat_run_id=uuid4()),
        _proposal(proposal_hash="b" * 64),
        _proposal(interrupt_id="different"),
        _proposal(interrupt_bound_at=None),
    ],
)
async def test_terminal_or_mismatched_proposal_never_resolves(proposal) -> None:
    async def load_authorized_proposal(_session, *, proposal_id, actor_id):
        return proposal

    service = SimpleNamespace(load_authorized_proposal=load_authorized_proposal)
    with pytest.raises(CommandRecoveryProofError):
        await recover_pending_command(
            session=object(),
            checkpointer=FakeSaver([("task", "__interrupt__", [_interrupt()])]),
            checkpoint_inspector=CommandCheckpointInspector(),
            command_service=service,
            actor_id=ACTOR_ID,
            chat_run_id=CHAT_RUN_ID,
            proposal_id=PROPOSAL_ID,
        )
