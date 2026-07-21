from __future__ import annotations

import os
from pathlib import Path
from uuid import uuid4

import pytest

from ketos.agentic.persistence.checkpointer import (
    AgenticCheckpointer,
    chat_thread_id,
    checkpoint_path,
    open_mvp_checkpointer,
    production_checkpointer,
)


@pytest.fixture(autouse=True)
def strict_msgpack(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LANGGRAPH_STRICT_MSGPACK", "true")


def test_chat_thread_id_is_stable_for_same_uuid() -> None:
    chat_id = uuid4()

    assert chat_thread_id(chat_id) == str(chat_id)
    assert chat_thread_id(chat_id) == chat_thread_id(chat_id)


def test_checkpoint_path_uses_frozen_mvp_location(tmp_path: Path) -> None:
    assert checkpoint_path(tmp_path) == (tmp_path / "mvp" / "langgraph-checkpoints.sqlite3").resolve()


def test_explicit_path_requires_a_root(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="explicit data_dir root"):
        AgenticCheckpointer(path=tmp_path / "checkpoints.sqlite3")


def test_rejects_in_memory_database(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="in-memory"):
        AgenticCheckpointer(data_dir=tmp_path, path=Path(":memory:"))


def test_rejects_in_memory_database_from_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("KETOS_AG_UI_CHECKPOINT_DB", ":memory:")

    with pytest.raises(ValueError, match="in-memory"):
        AgenticCheckpointer(data_dir=tmp_path)


def test_rejects_path_escaping_explicit_root(tmp_path: Path) -> None:
    root = tmp_path / "checkpoint-root"
    root.mkdir(mode=0o700)

    with pytest.raises(ValueError, match="escapes configured data_dir"):
        AgenticCheckpointer(
            data_dir=root,
            path=root.parent / "outside.sqlite3",
        )


@pytest.mark.anyio
async def test_sequential_production_savers_read_the_same_file(
    tmp_path: Path,
) -> None:
    data_dir = tmp_path / "data"
    data_dir.mkdir(mode=0o700)
    thread_id = chat_thread_id(uuid4())
    checkpoint_id = str(uuid4())
    checkpoint = {
        "v": 4,
        "id": checkpoint_id,
        "ts": "2026-01-01T00:00:00+00:00",
        "channel_values": {"message": "persisted"},
        "channel_versions": {},
        "versions_seen": {},
        "pending_sends": [],
    }
    config = {
        "configurable": {
            "thread_id": thread_id,
            "checkpoint_ns": "",
        }
    }

    async with open_mvp_checkpointer(data_dir) as first_saver:
        await first_saver.aput(
            config,
            checkpoint,
            {
                "source": "input",
                "step": 0,
                "writes": {},
                "parents": {},
            },
            {},
        )

    async with production_checkpointer(data_dir=data_dir) as second_saver:
        restored = await second_saver.aget_tuple(config)

    assert restored is not None
    assert restored.checkpoint["id"] == checkpoint_id
    assert restored.checkpoint["channel_values"]["message"] == "persisted"

    database = data_dir / "mvp" / "langgraph-checkpoints.sqlite3"
    assert database.is_file()
    assert os.stat(database).st_mode & 0o777 == 0o600
