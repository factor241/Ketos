"""Tests for ``scripts/ci/sync_bundle_kfx_pin.py``.

The ``make patch`` target calls this script to keep every ``src/bundles/*``
package's ``kfx`` runtime-dependency floor in step with the Ketos/KFX
``major.minor`` line. These tests exercise the real script module so a
regression in the floor format or the dependency regex is caught without
running ``make``.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[4]
_SCRIPT = REPO_ROOT / "scripts" / "ci" / "sync_bundle_kfx_pin.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("sync_bundle_kfx_pin", _SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["sync_bundle_kfx_pin"] = module
    spec.loader.exec_module(module)
    return module


mod = _load_module()


# ---------------------------------------------------------------------------
# kfx_floor_spec
# ---------------------------------------------------------------------------


class TestKfxFloorSpec:
    # The .dev0 floor is load-bearing: nightlies are canonical X.Y.0.devN
    # pre-releases, which PEP 440 sorts BELOW X.Y.0, so a plain >=X.Y.0
    # floor makes the branch's own nightly kfx unresolvable.
    @pytest.mark.parametrize(
        ("version", "expected"),
        [
            ("1.10.0", "kfx>=1.10.0.dev0,<2.0.0"),
            ("1.10.3", "kfx>=1.10.0.dev0,<2.0.0"),  # patch within a minor -> same floor
            ("1.11.0", "kfx>=1.11.0.dev0,<2.0.0"),
            ("2.0.0", "kfx>=2.0.0.dev0,<3.0.0"),
            ("v1.10.0", "kfx>=1.10.0.dev0,<2.0.0"),  # leading v tolerated
            ("10.4.2", "kfx>=10.4.0.dev0,<11.0.0"),  # multi-digit major
        ],
    )
    def test_floor(self, version, expected):
        assert mod.kfx_floor_spec(version) == expected

    @pytest.mark.parametrize("bad", ["", "1.10", "abc", "1", "x.y.z"])
    def test_rejects_unparseable(self, bad):
        with pytest.raises(ValueError, match="Unparseable version"):
            mod.kfx_floor_spec(bad)


# ---------------------------------------------------------------------------
# rewrite_kfx_dep
# ---------------------------------------------------------------------------


class TestRewriteKfxDep:
    FLOOR = "kfx>=1.10.0.dev0,<2.0.0"

    def test_rewrites_bare_floor(self):
        assert mod.rewrite_kfx_dep('    "kfx>=0.5.0",', self.FLOOR) == f'    "{self.FLOOR}",'

    def test_rewrites_existing_range(self):
        assert mod.rewrite_kfx_dep('    "kfx>=1.9.0,<2.0.0",', self.FLOOR) == f'    "{self.FLOOR}",'

    def test_rewrites_compatible_release_and_equality(self):
        assert mod.rewrite_kfx_dep('"kfx~=0.5.0"', self.FLOOR) == f'"{self.FLOOR}"'
        assert mod.rewrite_kfx_dep('"kfx==0.5.0"', self.FLOOR) == f'"{self.FLOOR}"'

    def test_idempotent(self):
        once = mod.rewrite_kfx_dep('"kfx>=0.5.0"', self.FLOOR)
        assert mod.rewrite_kfx_dep(once, self.FLOOR) == once

    def test_leaves_self_reference_untouched(self):
        # docling's optional-deps self-ref must NOT be treated as the kfx dep.
        for self_ref in ('"kfx-docling[local]"', '"kfx-docling[local,chunking,image-description]"'):
            assert mod.rewrite_kfx_dep(self_ref, self.FLOOR) == self_ref

    def test_leaves_nightly_form_untouched(self):
        # update_bundle_versions.py rewrites to this; sync must not clobber it.
        assert mod.rewrite_kfx_dep('"kfx-nightly==1.10.0.dev38"', self.FLOOR) == '"kfx-nightly==1.10.0.dev38"'

    def test_only_rewrites_runtime_dep_in_full_block(self):
        content = (
            "dependencies = [\n"
            '    "kfx>=0.5.0",\n'
            '    "langchain-community>=0.4.1,<1.0.0",\n'
            "]\n"
            "[project.optional-dependencies]\n"
            "all = [\n"
            '    "kfx-docling[local,chunking,image-description]",\n'
            "]\n"
        )
        out = mod.rewrite_kfx_dep(content, self.FLOOR)
        assert f'    "{self.FLOOR}",' in out
        assert '    "langchain-community>=0.4.1,<1.0.0",' in out  # untouched
        assert '    "kfx-docling[local,chunking,image-description]",' in out  # untouched


# ---------------------------------------------------------------------------
# sync_bundles (filesystem-level, on a temp tree)
# ---------------------------------------------------------------------------


class TestSyncBundles:
    def _make_bundle(self, bundles_dir: Path, name: str, kfx_line: str) -> Path:
        d = bundles_dir / name
        d.mkdir(parents=True)
        pyproject = d / "pyproject.toml"
        content = f'[project]\nname = "kfx-{name}"\ndependencies = [\n    "{kfx_line}",\n]\n'
        pyproject.write_text(content, encoding="utf-8")
        return pyproject

    def test_sync_updates_and_reports(self, tmp_path):
        bundles = tmp_path / "bundles"
        self._make_bundle(bundles, "arxiv", "kfx>=0.5.0")
        self._make_bundle(bundles, "ibm", "kfx>=1.10.0.dev0,<2.0.0")  # already correct

        results = dict(mod.sync_bundles("1.10.0", bundles))
        assert results == {"arxiv": True, "ibm": False}  # arxiv changed, ibm no-op
        assert '"kfx>=1.10.0.dev0,<2.0.0"' in (bundles / "arxiv" / "pyproject.toml").read_text()

    def test_sync_idempotent(self, tmp_path):
        bundles = tmp_path / "bundles"
        self._make_bundle(bundles, "arxiv", "kfx>=0.5.0")
        mod.sync_bundles("1.10.0", bundles)
        second = dict(mod.sync_bundles("1.10.0", bundles))
        assert second == {"arxiv": False}
