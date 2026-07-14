"""Deterministic contracts for ``scripts/build_component_index.py``."""

from __future__ import annotations

import hashlib
import importlib.util
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import orjson
import pytest

SCRIPT = Path(__file__).resolve().parents[4] / "scripts" / "build_component_index.py"


@pytest.fixture
def build_module():
    spec = importlib.util.spec_from_file_location("build_component_index", SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _components(*, reverse: bool = False) -> dict:
    categories = [
        (
            "Zeta",
            {
                "Later": {
                    "display_name": "Later",
                    "metadata": {"timestamp": "runtime", "stable": True},
                    "template": {},
                }
            },
        ),
        (
            "Alpha",
            {
                "Second": {"display_name": "Second", "template": {}},
                "First": {"display_name": "First", "template": {}},
            },
        ),
    ]
    if reverse:
        categories.reverse()
    return {category: dict(reversed(list(items.items()))) if reverse else items for category, items in categories}


def test_imports_ketos_components_and_uses_kfx_version(build_module) -> None:
    importer = AsyncMock(return_value={"components": _components()})

    with (
        patch("kfx.interface.components.import_ketos_components", importer),
        patch("importlib.metadata.version", return_value="1.10.2") as version,
    ):
        index = build_module.build_component_index()

    importer.assert_awaited_once_with()
    version.assert_called_once_with("kfx")
    assert index["version"] == "1.10.2"
    assert index["metadata"] == {"num_components": 3, "num_modules": 2}


def test_temp_outputs_are_byte_identical_for_different_discovery_order(build_module, tmp_path: Path) -> None:
    first = tmp_path / "first.json"
    second = tmp_path / "second.json"

    with (
        patch.object(
            build_module,
            "_import_components",
            side_effect=[(_components(), 3), (_components(reverse=True), 3)],
        ),
        patch.object(build_module, "_get_kfx_version", return_value="1.10.2"),
    ):
        build_module.write_component_index(first)
        build_module.write_component_index(second)

    assert first.read_bytes() == second.read_bytes()
    payload = orjson.loads(first.read_bytes())
    assert [entry[0] for entry in payload["entries"]] == ["Alpha", "Zeta"]
    assert list(payload["entries"][0][1]) == ["First", "Second"]
    assert "timestamp" not in payload["entries"][1][1]["Later"]["metadata"]


def test_sha256_covers_every_field_except_sha256(build_module) -> None:
    with (
        patch.object(build_module, "_import_components", return_value=(_components(), 3)),
        patch.object(build_module, "_get_kfx_version", return_value="1.10.2"),
    ):
        index = build_module.build_component_index()

    unhashed = dict(index)
    actual = unhashed.pop("sha256")
    expected = hashlib.sha256(orjson.dumps(unhashed, option=orjson.OPT_SORT_KEYS)).hexdigest()
    assert actual == expected


def test_default_output_is_the_kfx_asset(build_module) -> None:
    expected = SCRIPT.parents[1] / "src" / "kfx" / "src" / "kfx" / "_assets" / "component_index.json"
    assert expected == build_module.COMPONENT_INDEX_PATH


def test_component_import_errors_fail_closed(build_module) -> None:
    with (
        patch("kfx.interface.components.import_ketos_components", AsyncMock(side_effect=ImportError("broken"))),
        pytest.raises(RuntimeError, match="Failed to import components: broken"),
    ):
        build_module.build_component_index()
