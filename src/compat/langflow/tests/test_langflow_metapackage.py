from __future__ import annotations

import tomllib
from pathlib import Path


PROJECT = Path(__file__).parents[1]


def test_metapackage_is_code_free_and_delegates_legacy_cli() -> None:
    metadata = tomllib.loads((PROJECT / "pyproject.toml").read_text(encoding="utf-8"))

    assert metadata["project"]["name"] == "langflow"
    assert metadata["project"]["version"] == "1.10.2"
    assert metadata["project"]["dependencies"] == [
        "ketos==1.10.2",
        "langflow-base==0.10.2",
    ]
    assert metadata["project"]["scripts"] == {"langflow": "ketos.ketos_launcher:main"}
    assert (
        metadata["tool"]["hatch"]["build"]["targets"]["wheel"]["bypass-selection"]
        is True
    )
    assert not (PROJECT / "src").exists()
    assert not (PROJECT / "langflow").exists()
