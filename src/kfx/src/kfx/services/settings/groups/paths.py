from pathlib import Path
from typing import Any

from pydantic import BaseModel, field_validator

from kfx.config.paths import ketos_config_dir, ketos_data_dir, ketos_temp_dir


class PathSettings(BaseModel):
    """Filesystem paths Ketos reads from and writes to."""

    config_dir: str | None = None
    """Ketos configuration directory."""

    data_dir: str | None = None
    """Durable Ketos application data directory."""

    temp_dir: str | None = None
    """Ketos temporary-file directory."""

    knowledge_bases_dir: str | None = None
    """The directory to store knowledge bases."""

    kb_allowed_folder_roots: list[str] = []
    """Allow-list of directories the folder-ingestion endpoint may read from.

    Comma-separated when set via env (``KETOS_KB_ALLOWED_FOLDER_ROOTS``),
    e.g. ``/srv/docs,/data/shared``. Empty by default — operators must opt in.
    ``POST /api/v1/knowledge_bases/{kb_name}/ingest/folder`` refuses to walk any
    directory that is not equal to or inside one of these roots; symlink escapes
    are blocked because the path is resolved before the containment check. Leave
    empty in multi-tenant cloud deployments to refuse arbitrary-path access."""

    directory_component_allowed_roots: list[str] = []
    """Additional directories the legacy Directory component may read from.

    The component always allows paths equal to or inside the process working
    directory. Operators can set ``KETOS_DIRECTORY_COMPONENT_ALLOWED_ROOTS``
    as a comma-separated list for other trusted read-only content roots. Parent
    traversal and symlink escapes are still blocked after canonicalization."""

    @field_validator("config_dir", mode="before")
    @classmethod
    def set_ketos_dir(cls, value: Any) -> str:
        if not value:
            value = ketos_config_dir(create=True)

        if isinstance(value, str):
            value = Path(value)
        value = value.resolve()
        if not value.exists():
            value.mkdir(parents=True, exist_ok=True)

        return str(value)

    @field_validator("data_dir", mode="before")
    @classmethod
    def set_data_dir(cls, value: Any) -> str:
        return cls._ensure_dir(value or ketos_data_dir(create=True))

    @field_validator("temp_dir", mode="before")
    @classmethod
    def set_temp_dir(cls, value: Any) -> str:
        return cls._ensure_dir(value or ketos_temp_dir(create=True))

    @field_validator("knowledge_bases_dir", mode="before")
    @classmethod
    def set_knowledge_bases_dir(cls, value: Any, info) -> str:
        root = Path(info.data.get("data_dir") or ketos_data_dir(create=True))
        return cls._ensure_dir(value or root / "knowledge_bases")

    @staticmethod
    def _ensure_dir(value: Any) -> str:
        path = Path(value).expanduser().resolve()
        path.mkdir(parents=True, exist_ok=True)
        return str(path)
