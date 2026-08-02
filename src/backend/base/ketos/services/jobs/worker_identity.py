"""Process-scoped worker identity used as honest recovery evidence."""

from __future__ import annotations

import os
from threading import Lock
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

if TYPE_CHECKING:
    from collections.abc import Callable


class ProcessWorkerIdentity:
    """Return one random UUID per observed process ID.

    A post-fork child detects its changed PID and receives a new random identity.
    The value is evidence for later reconciliation, not a Stage 07 recovery lease.
    """

    def __init__(
        self,
        *,
        pid_provider: Callable[[], int] = os.getpid,
        uuid_provider: Callable[[], UUID] = uuid4,
    ) -> None:
        self._pid_provider = pid_provider
        self._uuid_provider = uuid_provider
        self._pid: int | None = None
        self._identity: UUID | None = None
        self._lock = Lock()
        os.register_at_fork(after_in_child=self._reset_after_fork)

    def _reset_after_fork(self) -> None:
        """Drop inherited lock and identity state in a forked child."""
        self._lock = Lock()
        self._pid = None
        self._identity = None

    def get(self) -> UUID:
        """Return the stable identity for the current process."""
        current_pid = self._pid_provider()
        if current_pid <= 0:
            msg = "Worker process ID must be positive"
            raise RuntimeError(msg)
        with self._lock:
            if self._pid != current_pid or self._identity is None:
                self._pid = current_pid
                self._identity = self._uuid_provider()
            return self._identity


_PROCESS_WORKER_IDENTITY = ProcessWorkerIdentity()


def get_worker_instance_id() -> UUID:
    """Return the module process's stable random worker identity."""
    return _PROCESS_WORKER_IDENTITY.get()
