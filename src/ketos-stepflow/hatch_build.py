"""Hatch hook preventing inherited repository metadata from entering the sdist."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class KetosStepflowBuildHook(BuildHookInterface):
    """Remove Hatchling's forced VCS exclusion-file inclusion."""

    def initialize(self, version: str, build_data: dict[str, Any]) -> None:
        del version
        force_include = build_data.get("force_include", {})
        for source, destination in list(force_include.items()):
            if Path(destination).name == ".gitignore":
                del force_include[source]
