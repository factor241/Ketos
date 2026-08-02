"""Regression tests for ``update_ketos_base_dependency``.

The nightly bump pins base's ``kfx`` dependency to the exact ``==X.Y.0.devN`` so the dev
release resolves down the tree. Base also carries ``kfx[extra]`` references (the relocated
cassio/toolguard features) that are pulled by ``ketos-base[complete]``. If those keep a
``~=X.Y.0`` floor while the bare ``kfx`` dep is pinned to the dev version, the floor
(``>=X.Y.0``) excludes ``X.Y.0.devN`` (PEP 440 dev releases sort *below* the final) and the
resolve becomes unsatisfiable. These tests lock in that all ``kfx`` forms -- bare and with
extras -- get the same exact dev pin.
"""

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import update_ketos_base_dependency as mod


@pytest.fixture
def pyproject(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A throwaway pyproject whose kfx refs mirror src/backend/base/pyproject.toml."""
    content = (
        "[project]\n"
        "dependencies = [\n"
        '    "kfx~=1.11.0",\n'
        "]\n"
        "\n"
        "[project.optional-dependencies]\n"
        'cassandra = ["kfx[cassandra]~=1.11.0"]\n'
        "toolguard = [\"kfx[toolguard]~=1.11.0; python_version < '3.14'\"]\n"
        'beautifulsoup = ["kfx~=1.11.0"]\n'
    )
    path = tmp_path / "pyproject.toml"
    path.write_text(content, encoding="utf-8")
    # The script resolves paths relative to BASE_DIR; point it at tmp_path.
    monkeypatch.setattr(mod, "BASE_DIR", tmp_path)
    return path


def test_pins_bare_and_extras_kfx_to_exact_dev(pyproject: Path) -> None:
    mod.update_kfx_dep_in_base(pyproject.name, "1.11.0.dev26")
    result = pyproject.read_text(encoding="utf-8")

    # Every kfx reference -- bare and with extras -- is pinned to the exact dev version.
    assert '"kfx==1.11.0.dev26"' in result
    assert '"kfx[cassandra]==1.11.0.dev26"' in result
    assert "\"kfx[toolguard]==1.11.0.dev26; python_version < '3.14'\"" in result

    # No `~=` floor survives -- a surviving floor is exactly what makes the nightly
    # resolve unsatisfiable.
    assert "~=" not in result
    # Extras are preserved, never dropped.
    assert "[cassandra]" in result
    assert "[toolguard]" in result


def test_idempotent_on_already_pinned(pyproject: Path) -> None:
    mod.update_kfx_dep_in_base(pyproject.name, "1.11.0.dev26")
    once = pyproject.read_text(encoding="utf-8")
    mod.update_kfx_dep_in_base(pyproject.name, "1.11.0.dev26")
    twice = pyproject.read_text(encoding="utf-8")
    assert once == twice


def test_raises_when_no_kfx_dependency(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "pyproject.toml"
    path.write_text('[project]\ndependencies = ["ketos-base~=1.11.0"]\n', encoding="utf-8")
    monkeypatch.setattr(mod, "BASE_DIR", tmp_path)
    with pytest.raises(ValueError, match="KFX dependency not found"):
        mod.update_kfx_dep_in_base(path.name, "1.11.0.dev26")


def test_pattern_skips_unrelated_packages(pyproject: Path) -> None:
    """Sibling packages whose names merely start with ``kfx`` must not be repinned."""
    extra = '    "kfx-bundles~=1.11.0",\n    "kfxthing~=1.11.0",\n'
    pyproject.write_text(pyproject.read_text(encoding="utf-8") + extra, encoding="utf-8")
    mod.update_kfx_dep_in_base(pyproject.name, "1.11.0.dev26")
    result = pyproject.read_text(encoding="utf-8")
    # The dedicated `kfx` distribution and its extras are repinned...
    assert '"kfx==1.11.0.dev26"' in result
    # ...but `kfx-bundles` / `kfxthing` keep their own floors untouched.
    assert re.search(r'"kfx-bundles~=1\.11\.0"', result)
    assert re.search(r'"kfxthing~=1\.11\.0"', result)
