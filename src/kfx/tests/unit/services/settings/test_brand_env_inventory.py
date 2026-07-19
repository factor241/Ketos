"""Static completeness checks for the embedded Stage 5 environment policy."""

from __future__ import annotations

import ast
import hashlib
import importlib
from pathlib import Path
from types import MappingProxyType

import pytest
import yaml
from kfx.services.settings.auth import AuthSettings
from kfx.services.settings.base import Settings

EXPECTED_DIRECT_ONLY_SUFFIXES = frozenset(
    {
        "AG_UI_BINDING_DB",
        "AG_UI_CHECKPOINT_DB",
        "API_KEY",
        "ASSISTANT_VERIFY_FLOWS",
        "DEBUG_FORK_GHOSTS",
        "DESKTOP",
        "DEV_EXTENSIONS_DIR",
        "ENV",
        "ENVIRONMENT",
        "ENVIRONMENTS_FILE",
        "FEATURE_MVP_COMPONENTS",
        "FEATURE_MVP_CHAT",
        "FEATURE_MVP_WORKSPACE",
        "FEATURE_WXO_DEPLOYMENTS",
        "FS_TOOL_BASE_DIR",
        "GUNICORN_PRELOAD",
        "LOG_ENV",
        "LOG_FORMAT",
        "LOG_LEVELS",
        "LOG_REDACT_KEYS",
        "LOG_RETRIEVER_BUFFER_SIZE",
        "LOG_TRACE_LOCALS",
        "MIGRATION_LOCK_TIMEOUT_S",
        "MODELS_DEV_REFRESH",
        "NATIVE_TRACING",
        "PRETTY_LOGS",
        "REQUEST_VARIABLES",
        "SEED_DIR",
        "SERVER_URL",
        "SERVICE_NAME",
        "SUPERUSER_TOKEN",
        "URL",
        "VERSION",
    }
)

ASSIGNED_VALIDATOR_FILES = ("database.py", "components.py", "variables.py")


def _module():
    return importlib.import_module("kfx.services.settings.brand_env")


def _attribute_chain(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return f"{_attribute_chain(node.value)}.{node.attr}"
    return ""


def test_registry_exactly_covers_models_and_reviewed_direct_suffixes():
    registry = _module().BRAND_ENV_POLICIES
    model_suffixes = {name.upper() for name in Settings.model_fields} | {
        name.upper() for name in AuthSettings.model_fields
    }

    assert "PWD_CONTEXT" not in model_suffixes
    assert len(Settings.model_fields) == 149
    assert len(AuthSettings.model_fields) == 32
    assert len(model_suffixes) == 180
    assert set(registry) == model_suffixes | EXPECTED_DIRECT_ONLY_SUFFIXES
    assert len(registry) == 213


def test_registry_has_reviewed_policy_counts_and_is_immutable():
    registry = _module().BRAND_ENV_POLICIES
    assert isinstance(registry, MappingProxyType)
    assert sum(policy.conflict_policy == "error" for policy in registry.values()) == 165
    assert sum(policy.conflict_policy == "warn" for policy in registry.values()) == 48
    assert sum(policy.sensitivity == "secret" for policy in registry.values()) == 13
    assert sum(policy.sensitivity == "public" for policy in registry.values()) == 200
    for suffix in ("AG_UI_BINDING_DB", "AG_UI_CHECKPOINT_DB"):
        assert registry[suffix].sensitivity == "public"
        assert registry[suffix].conflict_policy == "error"

    with pytest.raises(TypeError):
        registry["NEW_SUFFIX"] = next(iter(registry.values()))


def test_versioned_env_contract_exactly_matches_frozen_registry():
    contract_path = Path(__file__).parents[6] / "brand" / "compatibility" / "stage5-env-contract-v1.yaml"
    contract = yaml.safe_load(contract_path.read_text(encoding="utf-8"))
    groups = contract["policy_groups"]
    grouped = {
        suffix: (sensitivity, conflict_policy)
        for group_name, suffixes in groups.items()
        for suffix in suffixes
        for sensitivity, conflict_policy in (
            ("secret", "error") if group_name == "secret_error" else ("public", group_name.split("_")[1]),
        )
    }
    registry = _module().BRAND_ENV_POLICIES
    reviewed_direct_only_suffixes = frozenset(contract["direct_reads"]["reviewed_direct_only_suffixes"])
    feature_flags_path = "src/kfx/src/kfx/services/settings/feature_flags.py"

    assert contract["schema"] == "ketos.brand-environment-contract"
    assert contract["version"] == 1
    assert contract["status"] in {"candidate", "frozen-local"}
    assert len(grouped) == sum(len(suffixes) for suffixes in groups.values()) == 213
    assert grouped == {suffix: (policy.sensitivity, policy.conflict_policy) for suffix, policy in registry.items()}
    assert reviewed_direct_only_suffixes == EXPECTED_DIRECT_ONLY_SUFFIXES
    assert contract["inventory"]["reviewed_direct_only_suffixes"] == len(EXPECTED_DIRECT_ONLY_SUFFIXES) == 33
    assert {
        "AG_UI_BINDING_DB",
        "AG_UI_CHECKPOINT_DB",
        "FEATURE_MVP_WORKSPACE",
        "FEATURE_MVP_CHAT",
    } <= reviewed_direct_only_suffixes
    assert contract["inventory"]["unresolved_direct_read_exceptions"] in {0, 34}
    assert contract["inventory"]["unresolved_ambiguities"] == 0
    assert feature_flags_path in contract["source"]["files"]

    source_digest = hashlib.sha256()
    for relative_path in contract["source"]["files"]:
        source_digest.update(relative_path.encode())
        source_digest.update(b"\0")
        source_digest.update((Path(__file__).parents[6] / relative_path).read_bytes())
        source_digest.update(b"\0")
    assert source_digest.hexdigest() == contract["source"]["tree_sha256"]


def test_unknown_suffix_policy_lookup_fails_closed():
    module = _module()
    with pytest.raises(module.UnclassifiedBrandEnvError, match="NOT_REVIEWED"):
        module.get_brand_env_policy("NOT_REVIEWED")


def test_no_validation_alias_creates_an_unprefixed_precedence_tier():
    for field in (*Settings.model_fields.values(), *AuthSettings.model_fields.values()):
        alias = field.validation_alias
        assert alias is None, f"unreviewed validation alias remains: {alias!r}"


@pytest.mark.parametrize("filename", ASSIGNED_VALIDATOR_FILES)
def test_assigned_validators_have_no_direct_branded_os_reads(filename):
    path = Path(__file__).parents[6] / "src" / "kfx" / "src" / "kfx" / "services" / "settings" / "groups" / filename
    tree = ast.parse(path.read_text(encoding="utf-8"))

    bypasses = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        chain = _attribute_chain(node.func)
        if chain in {"os.getenv", "os.environ.get"}:
            bypasses.append((node.lineno, chain))

    assert bypasses == []


def test_only_components_uses_silent_origin_lookup():
    groups = Path(__file__).parents[6] / "src" / "kfx" / "src" / "kfx" / "services" / "settings" / "groups"
    resolved = {}
    for filename in ASSIGNED_VALIDATOR_FILES:
        tree = ast.parse((groups / filename).read_text(encoding="utf-8"))
        resolved[filename] = {
            node.args[0].value
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and _attribute_chain(node.func).endswith("read_brand_env_without_warning")
            and node.args
            and isinstance(node.args[0], ast.Constant)
            and isinstance(node.args[0].value, str)
        }

    assert resolved == {
        "database.py": set(),
        "components.py": {"COMPONENTS_PATH", "COMPONENTS_INDEX_PATH"},
        "variables.py": set(),
    }


def test_runtime_sources_have_no_literal_or_constant_branded_os_reads():
    """Prevent unreviewed fixed branded variables from bypassing the frozen resolver."""
    repository = Path(__file__).parents[6]
    roots = (
        repository / "src" / "kfx" / "src" / "kfx",
        repository / "src" / "backend" / "base" / "ketos",
    )
    allowed = {
        repository / "src" / "kfx" / "src" / "kfx" / "brand_env.py",
        repository / "src" / "backend" / "base" / "ketos" / "brand_state" / "discovery.py",
    }
    bypasses: list[str] = []
    observed_direct_suffixes: set[str] = set()

    def fixed_name(node: ast.AST, constants: dict[str, str]) -> str | None:
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return node.value
        if isinstance(node, ast.Name):
            return constants.get(node.id)
        return None

    for path in (candidate for root in roots for candidate in root.rglob("*.py") if candidate not in allowed):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        constants = {
            target.id: node.value.value
            for node in tree.body
            if isinstance(node, (ast.Assign, ast.AnnAssign))
            and isinstance(node.value, ast.Constant)
            and isinstance(node.value.value, str)
            for target in (node.targets if isinstance(node, ast.Assign) else (node.target,))
            if isinstance(target, ast.Name)
        }
        os_aliases = {"os"}
        getenv_aliases: set[str] = set()
        environ_aliases: set[str] = set()
        for node in tree.body:
            if isinstance(node, ast.Import):
                os_aliases.update(alias.asname or alias.name for alias in node.names if alias.name == "os")
            elif isinstance(node, ast.ImportFrom) and node.module == "os":
                for alias in node.names:
                    if alias.name == "getenv":
                        getenv_aliases.add(alias.asname or alias.name)
                    elif alias.name == "environ":
                        environ_aliases.add(alias.asname or alias.name)

        for node in ast.walk(tree):
            candidate: str | None = None
            if isinstance(node, ast.Call) and node.args:
                is_env_reader = (
                    (isinstance(node.func, ast.Name) and node.func.id in getenv_aliases)
                    or (
                        isinstance(node.func, ast.Attribute)
                        and node.func.attr == "getenv"
                        and isinstance(node.func.value, ast.Name)
                        and node.func.value.id in os_aliases
                    )
                    or (
                        isinstance(node.func, ast.Attribute)
                        and node.func.attr == "get"
                        and isinstance(node.func.value, ast.Attribute)
                        and node.func.value.attr == "environ"
                        and isinstance(node.func.value.value, ast.Name)
                        and node.func.value.value.id in os_aliases
                    )
                    or (
                        isinstance(node.func, ast.Attribute)
                        and node.func.attr == "get"
                        and isinstance(node.func.value, ast.Name)
                        and node.func.value.id in environ_aliases
                    )
                )
                if is_env_reader:
                    candidate = fixed_name(node.args[0], constants)
            elif (
                isinstance(node, ast.Subscript)
                and isinstance(node.ctx, ast.Load)
                and (
                    (
                        isinstance(node.value, ast.Attribute)
                        and node.value.attr == "environ"
                        and isinstance(node.value.value, ast.Name)
                        and node.value.value.id in os_aliases
                    )
                    or (isinstance(node.value, ast.Name) and node.value.id in environ_aliases)
                )
            ):
                candidate = fixed_name(node.slice, constants)
            if candidate is not None and candidate.startswith(("KETOS_", "LANGFLOW_")):
                suffix = candidate.split("_", maxsplit=1)[1]
                observed_direct_suffixes.add(suffix)
                if suffix not in EXPECTED_DIRECT_ONLY_SUFFIXES:
                    bypasses.append(f"{path.relative_to(repository)}:{node.lineno}:{candidate}")

    assert bypasses == []
    assert "AG_UI_BINDING_DB" in observed_direct_suffixes
