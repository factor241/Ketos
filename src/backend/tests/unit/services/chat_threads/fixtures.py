"""Pure fixtures for committed chat-thread adapter tests."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import NAMESPACE_URL, UUID, uuid5

_OTHER_CHAT_ID = UUID("f0fd0a58-3d41-50a7-b0f8-88f7c1c4b3af")
_OTHER_RUN_ID = UUID("9c78c804-1518-5af6-9623-f747ccf6856d")
_MAX_FIXTURE_MESSAGES = 10
_MAX_MESSAGE_BODY_LENGTH = 10_000


@dataclass(frozen=True)
class CommittedMessageFixture:
    chat_id: UUID
    chat_run_id: UUID
    chat_sequence: int
    sender: str
    sender_name: str
    text: str
    is_output: bool


def committed_transcript(chat_id: UUID, run_id: UUID) -> tuple[CommittedMessageFixture, ...]:
    messages = (
        CommittedMessageFixture(
            chat_id=chat_id,
            chat_run_id=run_id,
            chat_sequence=1,
            sender="user",
            sender_name="User",
            text="Plan the board",
            is_output=False,
        ),
        CommittedMessageFixture(
            chat_id=chat_id,
            chat_run_id=run_id,
            chat_sequence=2,
            sender="assistant",
            sender_name="Assistant",
            text="I prepared a proposal.",
            is_output=True,
        ),
    )
    _assert_fixture_bounds(messages)
    return messages


def other_chat_transcript() -> tuple[UUID, UUID, tuple[CommittedMessageFixture, ...]]:
    return _OTHER_CHAT_ID, _OTHER_RUN_ID, committed_transcript(_OTHER_CHAT_ID, _OTHER_RUN_ID)


def partial_delta() -> dict[str, object]:
    return {"message_id": "streaming-message-1", "delta": "I prepared", "committed": False}


def messages_snapshot_fixture(chat_id: UUID, run_id: UUID) -> dict[str, object]:
    messages = committed_transcript(chat_id, run_id)
    snapshot = {
        "type": "MESSAGES_SNAPSHOT",
        "messages": [
            {
                "id": str(
                    uuid5(
                        NAMESPACE_URL,
                        f"ketos://chat/{message.chat_id}/run/{message.chat_run_id}/sequence/{message.chat_sequence}",
                    )
                ),
                "role": "assistant" if message.is_output else "user",
                "content": message.text,
            }
            for message in messages
        ],
    }
    _assert_fixture_bounds(messages)
    return snapshot


def expected_session_id(chat_id: UUID) -> str:
    return str(chat_id)


def _assert_fixture_bounds(messages: tuple[CommittedMessageFixture, ...]) -> None:
    assert len(messages) <= _MAX_FIXTURE_MESSAGES
    assert all(len(message.text) <= _MAX_MESSAGE_BODY_LENGTH for message in messages)
