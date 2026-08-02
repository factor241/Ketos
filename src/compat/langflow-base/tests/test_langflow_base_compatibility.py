from __future__ import annotations

import json
import os
import subprocess
import sys
import tomllib
from pathlib import Path


PROJECT = Path(__file__).parents[1]
REPOSITORY = Path(__file__).parents[4]
FROZEN_BACKEND_COMMIT = "87a5206ae925b1fb88f8ecc6bc248316128b64ee"


def test_distribution_metadata_has_exact_compatibility_dependencies() -> None:
    metadata = tomllib.loads((PROJECT / "pyproject.toml").read_text(encoding="utf-8"))

    assert metadata["project"]["name"] == "langflow-base"
    assert metadata["project"]["version"] == "0.10.2"
    assert metadata["project"]["dependencies"] == ["ketos-base==0.10.2", "lfx==1.10.2"]
    assert metadata["tool"]["hatch"]["build"]["targets"]["wheel"]["packages"] == [
        "src/langflow",
        "src/langflow_compat",
    ]


def test_backend_deep_imports_and_renamed_exports_preserve_identity() -> None:
    source_roots = [
        PROJECT / "src",
        REPOSITORY / "src/backend/base",
        REPOSITORY / "src/kfx/src",
    ]
    env = os.environ.copy()
    env["PYTHONPATH"] = os.pathsep.join(
        [*(str(path) for path in source_roots), env.get("PYTHONPATH", "")]
    )
    script = r"""
import importlib
import json

legacy_root = importlib.import_module("langflow")
canonical_root = importlib.import_module("ketos")
legacy_server = importlib.import_module("langflow.server")
canonical_server = importlib.import_module("ketos.server")
legacy_launcher = importlib.import_module("langflow.langflow_launcher")
canonical_launcher = importlib.import_module("ketos.ketos_launcher")
legacy_auth = importlib.import_module("langflow.services.authorization.service")
canonical_auth = importlib.import_module("ketos.services.authorization.service")
legacy_runner = importlib.import_module("langflow.services.flow.flow_runner")
canonical_runner = importlib.import_module("ketos.services.flow.flow_runner")
legacy_component = importlib.import_module("langflow.components.files_and_knowledge.retrieval")
canonical_component = importlib.import_module("kfx.components.files_and_knowledge.retrieval")
legacy_kb = importlib.import_module("langflow.components.knowledge_bases.retrieval")

print(json.dumps({
    "root": legacy_root is canonical_root,
    "server": legacy_server is canonical_server,
    "launcher": legacy_launcher is canonical_launcher,
    "application": legacy_server.LangflowApplication is canonical_server.KetosApplication,
    "worker": legacy_server.LangflowUvicornWorker is canonical_server.KetosUvicornWorker,
    "authorization_module": legacy_auth is canonical_auth,
    "authorization": legacy_auth.LangflowAuthorizationService is canonical_auth.KetosAuthorizationService,
    "runner_module": legacy_runner is canonical_runner,
    "runner": legacy_runner.LangflowRunnerExperimental is canonical_runner.KetosRunnerExperimental,
    "component": legacy_component is canonical_component,
    "knowledge_bases": legacy_kb is canonical_component,
}))
"""
    result = subprocess.run(
        [sys.executable, "-c", script],
        check=True,
        capture_output=True,
        text=True,
        env=env,
        cwd=REPOSITORY,
    )

    assert json.loads(result.stdout.splitlines()[-1]) == {
        "root": True,
        "server": True,
        "launcher": True,
        "application": True,
        "worker": True,
        "authorization_module": True,
        "authorization": True,
        "runner_module": True,
        "runner": True,
        "component": True,
        "knowledge_bases": True,
    }


def test_alias_resolution_is_explicit_for_renames_and_canonical_otherwise() -> None:
    source_root = PROJECT / "src"
    sys.path.insert(0, str(source_root))
    try:
        from langflow_compat.aliases import resolve_legacy_module

        assert (
            resolve_legacy_module("langflow.langflow_launcher")
            == "ketos.ketos_launcher"
        )
        assert resolve_legacy_module("langflow.components") == "kfx.components"
        assert (
            resolve_legacy_module("langflow.components.knowledge_bases.retrieval")
            == "kfx.components.files_and_knowledge.retrieval"
        )
        assert (
            resolve_legacy_module("langflow.services.database.models")
            == "ketos.services.database.models"
        )
    finally:
        sys.path.remove(str(source_root))


def test_versioned_inventory_covers_the_frozen_backend_and_component_namespaces() -> (
    None
):
    inventory = json.loads(
        (PROJECT / "src/langflow_compat/module-map-v1.json").read_text(encoding="utf-8")
    )

    assert inventory["schema_version"] == 1
    assert inventory["source"]["backend_commit"] == FROZEN_BACKEND_COMMIT
    assert inventory["source"]["backend_module_count"] == 627
    assert inventory["source"]["component_module_count"] == 516
    modules = {
        f"{group['legacy_prefix']}{suffix}": f"{group['canonical_prefix']}{suffix}"
        for group in inventory["groups"]
        for suffix in group["suffixes"]
    }
    modules.update(inventory["exact"])
    assert len(modules) == inventory["source"]["mapped_module_count"]
    assert modules["langflow.base"] == "kfx.base"
    assert modules["langflow.inputs.inputs"] == "kfx.inputs.inputs"
    assert modules["langflow.schema.message"] == "kfx.schema.message"
    assert modules["langflow.template.field.base"] == "kfx.template.field.base"
    assert (
        modules["langflow.components.files_and_knowledge.retrieval"]
        == "kfx.components.files_and_knowledge.retrieval"
    )
    assert (
        modules["langflow.components.knowledge_bases.retrieval"]
        == "kfx.components.files_and_knowledge.retrieval"
    )


def test_resolution_rejects_uninventoried_legacy_modules() -> None:
    source_root = PROJECT / "src"
    sys.path.insert(0, str(source_root))
    try:
        from langflow_compat.aliases import resolve_legacy_module

        try:
            resolve_legacy_module("langflow.not_a_real_historical_module")
        except KeyError as exc:
            assert exc.args == ("langflow.not_a_real_historical_module",)
        else:
            raise AssertionError("unversioned legacy modules must not be guessed")
    finally:
        sys.path.remove(str(source_root))


def test_kfx_owned_and_backend_runtime_dotted_paths_preserve_module_identity() -> None:
    source_roots = [
        PROJECT / "src",
        REPOSITORY / "src/backend/base",
        REPOSITORY / "src/kfx/src",
    ]
    env = os.environ.copy()
    env["PYTHONPATH"] = os.pathsep.join(
        [*(str(path) for path in source_roots), env.get("PYTHONPATH", "")]
    )
    script = r"""
import importlib
import json

pairs = {
    "base": ("langflow.base", "kfx.base"),
    "inputs": ("langflow.inputs.inputs", "kfx.inputs.inputs"),
    "schema": ("langflow.schema.message", "kfx.schema.message"),
    "template": ("langflow.template.field.base", "kfx.template.field.base"),
    "component": (
        "langflow.components.files_and_knowledge.retrieval",
        "kfx.components.files_and_knowledge.retrieval",
    ),
    "settings_factory": (
        "langflow.services.settings.factory",
        "kfx.services.settings.factory",
    ),
    "auth_factory": (
        "langflow.services.authorization.factory",
        "ketos.services.authorization.factory",
    ),
    "gunicorn": ("langflow.server", "ketos.server"),
    "celery": ("langflow.core.celery_app", "ketos.core.celery_app"),
}
print(json.dumps({key: importlib.import_module(old) is importlib.import_module(new) for key, (old, new) in pairs.items()}))
"""
    result = subprocess.run(
        [sys.executable, "-c", script],
        check=True,
        capture_output=True,
        text=True,
        env=env,
        cwd=REPOSITORY,
    )

    assert json.loads(result.stdout.splitlines()[-1]) == dict.fromkeys(
        [
            "base",
            "inputs",
            "schema",
            "template",
            "component",
            "settings_factory",
            "auth_factory",
            "gunicorn",
            "celery",
        ],
        True,
    )


def test_all_frozen_renamed_backend_exports_preserve_object_identity() -> None:
    source_roots = [
        PROJECT / "src",
        REPOSITORY / "src/backend/base",
        REPOSITORY / "src/kfx/src",
    ]
    env = os.environ.copy()
    env["PYTHONPATH"] = os.pathsep.join(
        [*(str(path) for path in source_roots), env.get("PYTHONPATH", "")]
    )
    script = r"""
import importlib
import json

checks = {
    "version": ("langflow.api.utils.core", "check_langflow_version", "ketos.api.utils.core", "check_ketos_version"),
    "progress": ("langflow.cli.progress", "create_langflow_progress", "ketos.cli.progress", "create_ketos_progress"),
    "shutdown_progress": ("langflow.cli.progress", "create_langflow_shutdown_progress", "ketos.cli.progress", "create_ketos_shutdown_progress"),
    "flow_preparation": ("langflow.agentic.services.flow_preparation", "inject_lfx_components_path", "ketos.agentic.services.flow_preparation", "inject_kfx_components_path"),
    "wxo_requirement": ("langflow.services.adapters.deployment.watsonx_orchestrate.core.tools", "_resolve_lfx_requirement", "ketos.services.adapters.deployment.watsonx_orchestrate.core.tools", "_resolve_kfx_requirement"),
    "wxo_build": ("langflow.services.adapters.deployment.watsonx_orchestrate.core.tools", "build_langflow_artifact_bytes", "ketos.services.adapters.deployment.watsonx_orchestrate.core.tools", "build_ketos_artifact_bytes"),
    "wxo_ensure": ("langflow.services.adapters.deployment.watsonx_orchestrate.core.tools", "ensure_langflow_connections_binding", "ketos.services.adapters.deployment.watsonx_orchestrate.core.tools", "ensure_ketos_connections_binding"),
    "wxo_extract_artifact": ("langflow.services.adapters.deployment.watsonx_orchestrate.core.tools", "extract_langflow_artifact_from_zip", "ketos.services.adapters.deployment.watsonx_orchestrate.core.tools", "extract_ketos_artifact_from_zip"),
    "wxo_extract_binding": ("langflow.services.adapters.deployment.watsonx_orchestrate.core.tools", "extract_langflow_connections_binding", "ketos.services.adapters.deployment.watsonx_orchestrate.core.tools", "extract_ketos_connections_binding"),
    "wxo_verify": ("langflow.services.adapters.deployment.watsonx_orchestrate.core.tools", "verify_langflow_owned", "ketos.services.adapters.deployment.watsonx_orchestrate.core.tools", "verify_ketos_owned"),
    "wxo_resource": ("langflow.services.adapters.deployment.watsonx_orchestrate.payloads", "build_langflow_wxo_resource_name", "ketos.services.adapters.deployment.watsonx_orchestrate.payloads", "build_ketos_wxo_resource_name"),
}
result = {}
for key, (old_module, old_name, new_module, new_name) in checks.items():
    legacy = importlib.import_module(old_module)
    canonical = importlib.import_module(new_module)
    result[key] = getattr(legacy, old_name) is getattr(canonical, new_name)
print(json.dumps(result))
"""
    result = subprocess.run(
        [sys.executable, "-c", script],
        check=True,
        capture_output=True,
        text=True,
        env=env,
        cwd=REPOSITORY,
    )

    assert all(json.loads(result.stdout.splitlines()[-1]).values())
