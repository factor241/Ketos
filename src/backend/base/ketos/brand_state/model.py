"""Immutable value objects for brand-state discovery and migration."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

try:
    from enum import StrEnum
except ImportError:  # pragma: no cover - Python 3.10 compatibility

    class StrEnum(str, Enum):
        """Python 3.10-compatible subset of :class:`enum.StrEnum`."""


class StateKind(StrEnum):
    CONFIG = "config"
    DATA = "data"
    CACHE = "cache"
    TEMP = "temp"
    SDK_ENV = "sdk_env"
    MCP = "mcp"
    UPLOAD = "upload"
    KNOWLEDGE_BASE = "knowledge_base"
    SQLITE_DB = "sqlite_db"
    SQLITE_SIDECAR = "sqlite_sidecar"
    SECRET = "secret"  # noqa: S105 -- classification label, never a credential
    EXTERNAL_DATABASE = "external_database"


class Sensitivity(StrEnum):
    PUBLIC = "public"
    SECRET = "secret"  # noqa: S105 -- classification label, never a credential


class StateOperation(StrEnum):
    COPY = "copy"
    SQLITE_BACKUP = "sqlite_backup"
    INVENTORY_ONLY = "inventory_only"
    EXTERNAL_REFERENCE = "external_reference"


class StateStatus(StrEnum):
    LEGACY_ONLY = "legacy_only"
    CANONICAL_ONLY = "canonical_only"
    EQUAL = "equal"
    UNEQUAL = "unequal"
    CONFLICT = "conflict"


@dataclass(frozen=True)
class BrandStateRoots:
    canonical_config: Path
    canonical_data: Path
    canonical_cache: Path
    canonical_temp: Path
    legacy_config: tuple[Path, ...]
    legacy_data: tuple[Path, ...]
    legacy_cache: tuple[Path, ...]
    legacy_temp: tuple[Path, ...]
    legacy_knowledge_bases: tuple[Path, ...]


@dataclass(frozen=True)
class BrandStateEntry:
    relative_id: str
    kind: StateKind
    sensitivity: Sensitivity
    status: StateStatus
    source: Path | None
    destination: Path | None
    size: int | None = None
    sha256: str | None = None
    destination_sha256: str | None = None
    reason: str | None = None
    operation: StateOperation = StateOperation.COPY


class MigrationPhase(StrEnum):
    DISCOVERED = "discovered"
    PLANNED = "planned"
    BACKED_UP = "backed_up"
    STAGED = "staged"
    VERIFIED = "verified"
    COMMITTING = "committing"
    COMMITTED = "committed"
    RECOVERY_REQUIRED = "recovery_required"
    ROLLING_BACK = "rolling_back"
    ROLLED_BACK = "rolled_back"


@dataclass(frozen=True)
class BrandStateDiscovery:
    roots: BrandStateRoots
    entries: tuple[BrandStateEntry, ...]

    @property
    def has_conflicts(self) -> bool:
        return any(entry.status in {StateStatus.UNEQUAL, StateStatus.CONFLICT} for entry in self.entries)


__all__ = [
    "BrandStateDiscovery",
    "BrandStateEntry",
    "BrandStateRoots",
    "MigrationPhase",
    "Sensitivity",
    "StateKind",
    "StateOperation",
    "StateStatus",
]
