from __future__ import annotations

import ast
import json
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
BASE_ROOT = REPO_ROOT / "src/backend/base"
KFX_ROOT = REPO_ROOT / "src/kfx/src"
OLD_NAMESPACE = "lang" + "flow"


def _run_isolated(source: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["PYTHONPATH"] = os.pathsep.join((str(BASE_ROOT), str(KFX_ROOT)))
    return subprocess.run(  # noqa: S603 - fixed interpreter and in-repo test source
        [sys.executable, "-c", source],
        cwd=REPO_ROOT,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )


def test_ketos_base_is_the_only_backend_namespace_owner() -> None:
    assert (BASE_ROOT / "ketos/__init__.py").is_file()
    assert not (BASE_ROOT / OLD_NAMESPACE).exists()
    assert not (REPO_ROOT / f"src/backend/{OLD_NAMESPACE}").exists()
    assert not (REPO_ROOT / "src/backend/ketos").exists()


def test_base_manifest_owns_only_ketos_base_without_a_console_script() -> None:
    manifest = (BASE_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    assert 'name = "ketos-base"' in manifest
    assert 'packages = ["ketos"]' in manifest
    assert '"ketos/locales/*.json"' in manifest
    assert "[project.scripts]" not in manifest


def test_task7a_handoff_preserves_single_namespace_owner_and_staging_boundary() -> None:
    handoff = json.loads((BASE_ROOT / "TASK7A_HANDOFF.yaml").read_text(encoding="utf-8"))
    assert handoff["base_distribution"] == {
        "name": "ketos-base",
        "import_owner": "ketos",
        "source_root": "src/backend/base/ketos",
        "console_scripts": [],
    }
    root_wheel = handoff["root_metapackage"]["wheel"]
    assert root_wheel["bypass_selection"] is True
    assert root_wheel["packages"] == []
    assert "src/backend/base/ketos/frontend/**" in handoff["task4_staging"]["exclude"]
    assert handoff["task4_staging"]["excluded_owner"]["src/backend/base/ketos/frontend/**"] == (
        "T17-generated-artifacts"
    )


def test_import_does_not_mutate_meta_path_and_old_namespace_is_absent() -> None:
    source = f"""
import importlib.util
import json
import sys
before = [id(item) for item in sys.meta_path]
import ketos
after = [id(item) for item in sys.meta_path]
print(json.dumps({{"unchanged": before == after, "old": importlib.util.find_spec({OLD_NAMESPACE!r}) is not None}}))
"""
    result = _run_isolated(source)
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout.strip().splitlines()[-1])
    assert payload == {"unchanged": True, "old": False}


def test_canonical_facades_and_application_symbols_import() -> None:
    source = """
from ketos import custom, io, schema
from ketos.server import KetosApplication, KetosUvicornWorker
from ketos.services.authorization import KetosAuthorizationService
assert custom and io and schema
assert KetosApplication and KetosUvicornWorker and KetosAuthorizationService
"""
    result = _run_isolated(source)
    assert result.returncode == 0, result.stderr


def test_fastapi_application_uses_ketos_identity() -> None:
    source = """
from ketos.main import create_app
app = create_app()
assert app.title == "Ketos"
"""
    result = _run_isolated(source)
    assert result.returncode == 0, result.stderr


def test_alembic_revision_graph_is_well_formed() -> None:
    versions = BASE_ROOT / "ketos/alembic/versions"
    revisions: dict[str, str | tuple[str, ...] | None] = {}
    for path in versions.glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        values: dict[str, object] = {}
        for node in tree.body:
            if (
                isinstance(node, ast.Assign)
                and len(node.targets) == 1
                and isinstance(node.targets[0], ast.Name)
                and node.targets[0].id in {"revision", "down_revision"}
            ):
                values[node.targets[0].id] = ast.literal_eval(node.value)
            elif (
                isinstance(node, ast.AnnAssign)
                and isinstance(node.target, ast.Name)
                and node.target.id in {"revision", "down_revision"}
                and node.value is not None
            ):
                values[node.target.id] = ast.literal_eval(node.value)
        if "revision" in values:
            revision = values["revision"]
            assert isinstance(revision, str)
            assert revision not in revisions
            revisions[revision] = values.get("down_revision")  # type: ignore[assignment]
    assert len(revisions) == 85
    assert revisions["9a6e34f1c2d8"] == "bb693ad2fbab"
    assert revisions["b03dca5a0001"] == "9a6e34f1c2d8"
    assert revisions["c04d5e6f7a8b"] == "b03dca5a0001"
    assert revisions["505c0a700001"] == "c04d5e6f7a8b"
    assert revisions["505c0a700002"] == "505c0a700001"
    assert revisions["s08c0mmand01"] == "505c0a700002"
    for parent in revisions.values():
        parents = parent if isinstance(parent, tuple) else (parent,)
        assert all(item is None or item in revisions for item in parents)
