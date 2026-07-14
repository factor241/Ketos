import os
from pathlib import Path

from pydantic import BaseModel, field_validator, model_validator

from kfx.constants import BASE_COMPONENTS_PATH
from kfx.log.logger import logger
from kfx.services.settings.brand_env import _read_brand_env_without_warning


def _split_components_paths(value: str) -> list[str]:
    """Accept both the documented comma form and the platform path separator."""
    return [
        entry
        for comma_group in value.split(",")
        for raw_entry in comma_group.split(os.pathsep)
        if (entry := raw_entry.strip())
    ]


class ComponentsSettings(BaseModel):
    """Component discovery, indexing, and startup-load behavior."""

    components_path: list[str] = []
    """List of paths to custom components.

    Security: This setting defines an allow-list of custom components
    permitted to execute, even when KETOS_ALLOW_CUSTOM_COMPONENTS is False.
    """
    components_index_path: str | None = None
    """Path or URL to a prebuilt component index JSON file.

    If None, uses the built-in index at kfx/_assets/component_index.json.
    Set to a file path (e.g., '/path/to/index.json') or URL (e.g., 'https://example.com/index.json')
    to use a custom index.
    """

    load_flows_path: str | None = None
    load_flows_overwrite_on_name_match: bool = False
    """When a flow loaded from ``load_flows_path`` shares a name with an existing DB row but has
    a different id, overwrite the existing row's content from the file.

    Default ``False`` preserves user edits made in the UI on restart: name-matched rows are
    skipped with a warning instead of being silently overwritten when file UUIDs regenerate.
    (Pre-1.10.0 this case raised ``IntegrityError`` and crashed startup; the loader now boots
    successfully either way.) Set ``True`` to opt into "prepackaged flows are the source of
    truth on restart" semantics, typically for CI/CD pipelines.
    """
    bundle_urls: list[str] = []

    lazy_load_components: bool = False
    """If set to True, Ketos will only partially load components at startup and fully load them on demand.
    This significantly reduces startup time but may cause a slight delay when a component is first used."""

    # Starter Projects
    create_starter_projects: bool = True
    """If set to True, Ketos will create starter projects. If False, skips all starter project setup.
    Note that this doesn't check if the starter projects are already loaded in the db;
    this is intended to be used to skip all startup project logic."""
    update_starter_projects: bool = True
    """If set to True, Ketos will update starter projects."""

    # Extension reload (Mode A only)
    enable_extension_reload: bool = False
    """If True, registers ``POST /api/v1/extensions/{id}/bundles/{name}/reload``
    so authenticated users can hot-swap a Bundle's components in-process.

    This is a Mode A (local-dev / pip-installed) facility only.  In Mode B/C
    (Docker image with baked-in bundles) Bundle changes require an image
    rebuild and the in-process reload route would mask the real deploy
    pipeline.  Defaults to ``False`` so self-hosted / production deployments
    do not expose runtime imports through an HTTP endpoint without an
    explicit opt-in.  Set ``KETOS_ENABLE_EXTENSION_RELOAD=true`` in your
    local dev environment to turn it on."""

    @field_validator("components_path", mode="before")
    @classmethod
    def set_components_path(cls, value):
        """Processes and updates the components path list, incorporating environment variable overrides.

        If the `KETOS_COMPONENTS_PATH` environment variable is set and points to an existing path, it is
        appended to the provided list if not already present. If the input list is empty or missing, it is
        set to an empty list.
        """
        raw_values = value if isinstance(value, list) else [value] if value else []
        value = [entry for raw_value in raw_values for entry in _split_components_paths(str(raw_value))]

        env_value = _read_brand_env_without_warning("COMPONENTS_PATH", None)
        if env_value:
            logger.debug("Adding KETOS_COMPONENTS_PATH to components_path")
            # Split on os.pathsep so multi-entry env vars
            # ("/path/A:/path/B" on POSIX, "C:\\a;D:\\b" on Windows) are
            # parsed as multiple components paths instead of one literal
            # non-existent path. Empty segments (e.g. trailing pathsep) are
            # ignored.
            for entry in _split_components_paths(env_value):
                if not Path(entry).exists():
                    # Surface at warning so a typo in KETOS_COMPONENTS_PATH
                    # is visible in default log levels rather than silently
                    # producing zero components and zero diagnostics. The
                    # extension loader emits a typed ``inline-path-missing``
                    # warning at the same layer for events-pipeline consumers.
                    logger.warning(f"Skipping non-existent components path: {entry}")
                    continue
                if entry not in value:
                    value.append(entry)
                    logger.debug(f"Appending {entry} to components_path")

        if not value:
            value = [BASE_COMPONENTS_PATH]
        return value

    @model_validator(mode="after")
    def _enforce_components_paths_override(self):
        """Strip env-var-provided component paths when their bypass is disabled.

        When ``allow_custom_components`` is False the server only trusts components
        matching built-in templates. By default ``KETOS_COMPONENTS_PATH`` and
        ``KETOS_COMPONENTS_INDEX_PATH`` still contribute to that trust set (an
        admin-curated allow-list). Setting ``allow_components_paths_override=False``
        disables that bypass: here we remove the env-contributed entries so nothing
        downstream loads or trusts them.
        """
        if self.allow_custom_components or self.allow_components_paths_override:
            return self

        env_components_path = _read_brand_env_without_warning("COMPONENTS_PATH", None)
        if env_components_path:
            # The env var may be a comma-separated list; CustomSource splits it
            # before the field validator runs, so self.components_path contains
            # individual entries rather than the raw comma-joined string.
            # In-place removal avoids re-triggering ``set_components_path``, which
            # would re-read KETOS_COMPONENTS_PATH and append the paths again.
            env_paths = _split_components_paths(env_components_path)
            stripped_any = False
            for env_path in env_paths:
                while env_path in self.components_path:
                    self.components_path.remove(env_path)
                    stripped_any = True
            if stripped_any:
                logger.warning(
                    "Ignoring KETOS_COMPONENTS_PATH=%s: "
                    "KETOS_ALLOW_CUSTOM_COMPONENTS=False and "
                    "KETOS_ALLOW_COMPONENTS_PATHS_OVERRIDE=False.",
                    env_components_path,
                )

        # Only strip the index path when it came from the env var, mirroring the
        # components_path handling above. A value set via config/YAML is not part of
        # the env-var bypass this flag governs, so leave it untouched.
        env_components_index_path = _read_brand_env_without_warning("COMPONENTS_INDEX_PATH", None)
        if env_components_index_path and self.components_index_path == env_components_index_path:
            logger.warning(
                "Ignoring KETOS_COMPONENTS_INDEX_PATH=%s: "
                "KETOS_ALLOW_CUSTOM_COMPONENTS=False and "
                "KETOS_ALLOW_COMPONENTS_PATHS_OVERRIDE=False.",
                self.components_index_path,
            )
            self.components_index_path = None

        return self
