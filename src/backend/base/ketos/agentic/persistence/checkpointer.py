"""Production LangGraph checkpoint persistence facade.

SQLite lifecycle, file permissions, strict serialization and inode checks stay
owned by the hardened AG-UI checkpointer admitted in Stage 01.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Self
from uuid import UUID

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from ketos.agentic.services.ag_ui.checkpoint import AsyncSqliteCheckpoint, resolve_checkpoint_path

_MVP_CHECKPOINT_RELATIVE_PATH = Path("mvp/langgraph-checkpoints.sqlite3")


def chat_thread_id(chat_id: UUID) -> str:
    """Return the one stable LangGraph thread identifier for a Chat row."""
    if not isinstance(chat_id, UUID):
        raise TypeError("chat_id must be a UUID")
    return str(chat_id)


def checkpoint_path(data_dir: str | Path) -> Path:
    """Return the frozen Stage 09 checkpoint path below an explicit data root."""
    root = Path(data_dir).expanduser().resolve(strict=False)
    candidate = (root / _MVP_CHECKPOINT_RELATIVE_PATH).resolve(strict=False)
    if not candidate.is_relative_to(root):
        raise ValueError("checkpoint path escapes configured data_dir")
    return candidate


def _resolve_path(*, data_dir: Path | None, path: Path | None) -> Path:
    if path is not None and str(path).strip() == ":memory:":
        raise ValueError("in-memory checkpoints are not supported")
    if path is not None and data_dir is None:
        raise ValueError("a checkpoint path requires an explicit data_dir root")
    if data_dir is None:
        resolved = resolve_checkpoint_path()
        if str(resolved).strip() == ":memory:":
            raise ValueError("in-memory checkpoints are not supported")
        return resolved

    root = Path(data_dir).expanduser().resolve(strict=False)
    candidate = resolve_checkpoint_path(default_data_dir=root) if path is None else Path(path).expanduser()
    if str(candidate).strip() == ":memory:":
        raise ValueError("in-memory checkpoints are not supported")
    if not candidate.is_absolute():
        candidate = root / candidate
    candidate = candidate.resolve(strict=False)
    if not candidate.is_relative_to(root):
        raise ValueError(f"checkpoint path {candidate} escapes configured data_dir {root}")
    return candidate


class AgenticCheckpointer:
    """Thin app-lifetime facade over the canonical hardened checkpointer."""

    def __init__(self, *, data_dir: Path | None = None, path: Path | None = None) -> None:
        self.path = _resolve_path(data_dir=data_dir, path=path)
        self._checkpoint = AsyncSqliteCheckpoint(self.path)

    @property
    def saver(self) -> AsyncSqliteSaver:
        return self._checkpoint.saver

    async def open(self) -> AsyncSqliteSaver:
        return await self._checkpoint.open()

    async def close(self) -> None:
        await self._checkpoint.close()

    async def __aenter__(self) -> Self:
        await self.open()
        return self

    async def __aexit__(self, *_exc_info: object) -> None:
        await self.close()


@asynccontextmanager
async def production_checkpointer(
    *, data_dir: Path | None = None, path: Path | None = None
) -> AsyncIterator[AsyncSqliteSaver]:
    """Yield one setup, file-backed saver and close it on app shutdown."""
    if data_dir is not None and path is None:
        path = checkpoint_path(data_dir)
    async with AgenticCheckpointer(data_dir=data_dir, path=path) as checkpointer:
        saver = checkpointer.saver
        await saver.setup()
        yield saver


@asynccontextmanager
async def open_mvp_checkpointer(data_dir: str | Path) -> AsyncIterator[AsyncSqliteSaver]:
    """Open and close the exact frozen Stage 09 file-backed saver."""
    async with production_checkpointer(data_dir=Path(data_dir)) as saver:
        yield saver
