from __future__ import annotations

# ruff: noqa: S101, S603
import ast
import copy
import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from scripts.rebrand import rename_python, rename_structured_data, rename_typescript  # noqa: E402

MANIFEST_PATH = REPO_ROOT / "scripts/rebrand/rename_manifest.yaml"
OLD_SLUG = "lang" + "flow"
OLD_PRODUCT = "Lang" + "flow"
OLD_ENV = "LANG" + "FLOW"
OLD_EXECUTOR = "l" + "fx"


@pytest.fixture
def manifest() -> dict:
    return rename_python.load_manifest(MANIFEST_PATH)


def test_manifest_freezes_canonical_names_and_ownership(manifest: dict) -> None:
    assert manifest["version"] == 1
    assert manifest["mappings"]["imports"][OLD_SLUG] == "ketos"
    assert manifest["mappings"]["imports"][OLD_EXECUTOR] == "kfx"
    assert manifest["mappings"]["extension_groups"][OLD_EXECUTOR + ".components"] == "ketos.extensions"
    assert {"LangChain", "LangSmith", "LangWatch"} <= set(manifest["protected_names"])
    assert "LICENSE" in manifest["immutable_legal_paths"]
    assert manifest["owners"]["root_workspace"]["owner"] == "integration"
    assert manifest["owners"]["executor_bundles"]["owner"] == "task5_executor"
    assert "src/bundles/*/src/" + OLD_EXECUTOR + "_*" in manifest["owners"]["executor_bundles"]["paths"]
    assert manifest["handoffs"]["task5_to_integration"]["root_metapackage"] == "kfx"
    schema = "https://schemas.ketos.test/extension/v1.json"
    assert schema in manifest["mappings"]["urls"].values()
    assert manifest["owners"]["extensions"]["owner"] == "task12_extensions"
    assert manifest["owners"]["extensions"]["semantics"] == [
        "discovery",
        "schema",
        "runtime",
    ]


def test_python_transform_is_token_aware_and_syntax_preserving(manifest: dict) -> None:
    source = (
        f"# {OLD_SLUG} LangChain must remain in comments\n"
        f"from {OLD_SLUG}.api import {OLD_PRODUCT}\n"
        f"import {OLD_EXECUTOR}.services\n\n"
        f'product = "{OLD_PRODUCT}"\n'
        'protected = "LangChain"\n'
        f'prose = "{OLD_PRODUCT} is mentioned in arbitrary prose"\n'
    )

    transformed = rename_python.transform_python(source, manifest)

    ast.parse(transformed)
    assert "from ketos.api import Ketos" in transformed
    assert "import kfx.services" in transformed
    assert 'product = "Ketos"' in transformed
    assert 'protected = "LangChain"' in transformed
    assert f'prose = "{OLD_PRODUCT} is mentioned in arbitrary prose"' in transformed
    assert f"# {OLD_SLUG} LangChain must remain in comments" in transformed
    assert rename_python.transform_python(transformed, manifest) == transformed


def test_python_transform_rewrites_only_explicit_protocol_prefixes(manifest: dict) -> None:
    source = f'env = "{OLD_ENV}_DATABASE_URL"\nheader = "x-{OLD_SLUG}-api-key"\nsimilar = "MY_{OLD_ENV}_DATABASE_URL"\n'
    transformed = rename_python.transform_python(source, manifest)
    assert 'env = "KETOS_DATABASE_URL"' in transformed
    assert 'header = "x-ketos-api-key"' in transformed
    assert f'similar = "MY_{OLD_ENV}_DATABASE_URL"' in transformed


def test_path_planner_is_single_pass_longest_prefix_and_detects_collisions(tmp_path: Path, manifest: dict) -> None:
    old_relative = f"src/{OLD_EXECUTOR}/src/{OLD_EXECUTOR}/core.py"
    old = tmp_path / old_relative
    old.parent.mkdir(parents=True)
    old.write_text("", encoding="utf-8")

    planned = rename_python.plan_path_changes(tmp_path, [old], manifest)
    assert planned == [
        {
            "from": old_relative,
            "to": "src/kfx/src/kfx/core.py",
        }
    ]

    first = tmp_path / "A.py"
    second = tmp_path / "a.py"
    first.write_text("", encoding="utf-8")
    second.write_text("", encoding="utf-8")
    with pytest.raises(rename_python.CollisionError, match="casefold"):
        rename_python.assert_no_path_collisions(tmp_path, [first, second], [])


def test_apply_handles_case_only_path_rename_via_temporary_path(tmp_path: Path, manifest: dict) -> None:
    local_manifest = copy.deepcopy(manifest)
    local_manifest["mappings"]["paths"] = {"Module.py": "module.py"}
    source = tmp_path / "Module.py"
    source.write_text("value = 1\n", encoding="utf-8")

    report = rename_python.run(tmp_path, [source], local_manifest, dry_run=False)

    assert report["changes"][0]["to"] == "module.py"
    assert (tmp_path / "module.py").read_text(encoding="utf-8") == "value = 1\n"
    assert not list(tmp_path.glob(".ketos-rename-*"))


def test_path_planner_refuses_duplicate_target_and_existing_target(tmp_path: Path, manifest: dict) -> None:
    first = tmp_path / "one.py"
    second = tmp_path / "two.py"
    target = tmp_path / "target.py"
    for path in (first, second, target):
        path.write_text("value = 1\n", encoding="utf-8")

    duplicate_manifest = copy.deepcopy(manifest)
    duplicate_manifest["mappings"]["paths"] = {
        "one.py": "target.py",
        "two.py": "target.py",
    }
    with pytest.raises(rename_python.CollisionError, match=r"target[.]py"):
        rename_python.plan_path_changes(tmp_path, [first, second], duplicate_manifest)

    occupied_manifest = copy.deepcopy(manifest)
    occupied_manifest["mappings"]["paths"] = {"one.py": "target.py"}
    with pytest.raises(rename_python.CollisionError, match=r"target[.]py"):
        rename_python.plan_path_changes(tmp_path, [first], occupied_manifest)

    target.unlink()
    target.mkdir()
    with pytest.raises(rename_python.CollisionError, match=r"target[.]py"):
        rename_python.plan_path_changes(tmp_path, [first], occupied_manifest)


def test_apply_stages_valid_move_graph_without_overwrite(tmp_path: Path, manifest: dict) -> None:
    first = tmp_path / "one.py"
    second = tmp_path / "two.py"
    first.write_text("value = 'one'\n", encoding="utf-8")
    second.write_text("value = 'two'\n", encoding="utf-8")
    graph_manifest = copy.deepcopy(manifest)
    graph_manifest["mappings"]["paths"] = {
        "one.py": "two.py",
        "two.py": "three.py",
    }

    rename_python.run(tmp_path, [first, second], graph_manifest, dry_run=False)

    assert (tmp_path / "two.py").read_text(encoding="utf-8") == "value = 'one'\n"
    assert (tmp_path / "three.py").read_text(encoding="utf-8") == "value = 'two'\n"


def test_safety_refuses_external_dependency_cache_generated_and_legal_paths(tmp_path: Path, manifest: dict) -> None:
    generated = tmp_path / "openapi.json"
    generated.write_text("{}", encoding="utf-8")
    dependency = tmp_path / "node_modules/pkg/file.ts"
    dependency.parent.mkdir(parents=True)
    dependency.write_text("", encoding="utf-8")
    legal = tmp_path / "LICENSE"
    legal.write_text(OLD_PRODUCT, encoding="utf-8")

    for path, expected in [
        (generated, "generated"),
        (dependency, "dependency"),
        (legal, "immutable legal"),
        (tmp_path.parent / "outside.py", "outside repository root"),
    ]:
        with pytest.raises(rename_python.UnsafePathError, match=expected):
            rename_python.validate_path(tmp_path, path, manifest)


def test_typescript_transform_uses_parser_and_ignores_comments_and_prose(manifest: dict) -> None:
    source = (
        f"// {OLD_SLUG} LangWatch\n"
        f'import {{ {OLD_PRODUCT} }} from "{OLD_SLUG}/client";\n'
        f'const product = "{OLD_PRODUCT}";\n'
        f'const prose = "{OLD_PRODUCT} remains inside prose";\n'
        f"export const value = {OLD_PRODUCT};\n"
    )
    transformed = rename_typescript.transform_typescript(source, manifest, filename="sample.tsx")

    assert 'import { Ketos } from "ketos/client";' in transformed
    assert 'const product = "Ketos";' in transformed
    assert f'const prose = "{OLD_PRODUCT} remains inside prose";' in transformed
    assert f"// {OLD_SLUG} LangWatch" in transformed
    assert "export const value = Ketos;" in transformed
    assert rename_typescript.transform_typescript(transformed, manifest, filename="sample.tsx") == transformed

    with pytest.raises(rename_typescript.TypeScriptParseError):
        rename_typescript.transform_typescript("const broken = ;", manifest, filename="broken.ts")


def test_typescript_ast_contexts_regex_templates_and_jsx(manifest: dict) -> None:
    source = (
        f"const regex = /{OLD_PRODUCT}/gi;\n"
        f"const exact = `{OLD_PRODUCT}`;\n"
        f"const interpolated = `{OLD_PRODUCT} ${{value}}`;\n"
        f'const view = <{OLD_PRODUCT} title="{OLD_PRODUCT}" '
        f'prose="{OLD_PRODUCT} application">{OLD_PRODUCT}</{OLD_PRODUCT}>;\n'
    )

    transformed = rename_typescript.transform_typescript(source, manifest, filename="sample.tsx")

    assert f"/{OLD_PRODUCT}/gi" in transformed
    assert "const exact = `Ketos`;" in transformed
    assert f"const interpolated = `{OLD_PRODUCT} ${{value}}`;" in transformed
    assert '<Ketos title="Ketos" ' in transformed
    assert f'prose="{OLD_PRODUCT} application">Ketos</Ketos>' in transformed


@pytest.mark.parametrize(
    ("suffix", "source", "expected"),
    [
        (".json", f'{{"package": "{OLD_SLUG}", "prose": "{OLD_PRODUCT} project"}}\n', '"package": "ketos"'),
        (".yaml", f"package: {OLD_SLUG}\nprose: {OLD_PRODUCT} project\n", "package: ketos"),
        (".toml", f'package = "{OLD_SLUG}"\nprose = "{OLD_PRODUCT} project"\n', 'package = "ketos"'),
        (".ini", f"[app]\npackage = {OLD_SLUG}\nprose = {OLD_PRODUCT} project\n", "package = ketos"),
        (
            ".xml",
            f'<root package="{OLD_SLUG}"><name>{OLD_PRODUCT}</name><prose>{OLD_PRODUCT} project</prose></root>',
            'package="ketos"',
        ),
        (".env", f"PACKAGE={OLD_SLUG}\nPROSE={OLD_PRODUCT} project\n", "PACKAGE=ketos"),
    ],
)
def test_structured_data_only_rewrites_exact_scalars(suffix: str, source: str, expected: str, manifest: dict) -> None:
    transformed = rename_structured_data.transform_structured_data(source, suffix, manifest)
    assert expected in transformed
    assert OLD_PRODUCT + " project" in transformed
    assert rename_structured_data.transform_structured_data(transformed, suffix, manifest) == transformed


def test_env_rewrites_explicit_key_prefix_but_not_similar_keys(manifest: dict) -> None:
    source = f"{OLD_ENV}_PORT=7860\nMY_{OLD_ENV}_PORT=keep\n"
    transformed = rename_structured_data.transform_structured_data(source, ".env", manifest)
    assert "KETOS_PORT=7860" in transformed
    assert f"MY_{OLD_ENV}_PORT=keep" in transformed


def test_yaml_validates_and_preserves_comments_quotes_and_layout(manifest: dict) -> None:
    source = (
        f"# keep comment\npackage: '{OLD_SLUG}'  # inline\n"
        f"items:\n  - {OLD_SLUG}  # sequence\nprose: {OLD_PRODUCT} project\n"
    )
    transformed = rename_structured_data.transform_structured_data(source, ".yaml", manifest)
    assert transformed == (
        f"# keep comment\npackage: 'ketos'  # inline\nitems:\n  - ketos  # sequence\nprose: {OLD_PRODUCT} project\n"
    )
    with pytest.raises(rename_structured_data.UnsupportedStructuredDataError, match="invalid"):
        rename_structured_data.transform_structured_data("broken: [\n", ".yaml", manifest)


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        (
            f"base: &brand {OLD_PRODUCT}\nalias: *brand\n",
            "base: &brand Ketos\nalias: *brand\n",
        ),
        (
            f"values: [&brand {OLD_PRODUCT}, *brand]\n",
            "values: [&brand Ketos, *brand]\n",
        ),
    ],
)
def test_yaml_preserves_anchors_and_aliases_without_duplicate_edits(source: str, expected: str, manifest: dict) -> None:
    transformed = rename_structured_data.transform_structured_data(source, ".yaml", manifest)
    assert transformed == expected
    assert rename_structured_data.transform_structured_data(transformed, ".yaml", manifest) == transformed


def test_xml_preserves_declaration_comments_quotes_and_layout(manifest: dict) -> None:
    source = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f"<!-- keep {OLD_PRODUCT} comment; package='{OLD_SLUG}' -->\n"
        f"<root package='{OLD_SLUG}'><name> {OLD_PRODUCT} </name></root>\n"
    )
    transformed = rename_structured_data.transform_structured_data(source, ".xml", manifest)
    assert transformed == (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f"<!-- keep {OLD_PRODUCT} comment; package='{OLD_SLUG}' -->\n"
        "<root package='ketos'><name> Ketos </name></root>\n"
    )


def test_structured_data_refuses_markdown_unknown_and_binary(manifest: dict) -> None:
    for suffix in (".md", ".txt", ".png"):
        with pytest.raises(rename_structured_data.UnsupportedStructuredDataError):
            rename_structured_data.transform_structured_data(OLD_PRODUCT, suffix, manifest)
    with pytest.raises(rename_structured_data.UnsupportedStructuredDataError, match="binary"):
        rename_structured_data.transform_structured_data("bad\x00data", ".json", manifest)


def test_cli_dry_run_is_deterministic_and_apply_is_idempotent(tmp_path: Path) -> None:
    source = tmp_path / f"src/{OLD_EXECUTOR}/src/{OLD_EXECUTOR}/example.py"
    source.parent.mkdir(parents=True)
    source.write_text(f"from {OLD_SLUG} import {OLD_PRODUCT}\n", encoding="utf-8")
    command = [
        sys.executable,
        str(REPO_ROOT / "scripts/rebrand/rename_python.py"),
        "--repo-root",
        str(tmp_path),
        "--manifest",
        str(MANIFEST_PATH),
        "--dry-run",
        str(source),
    ]
    first = subprocess.run(command, check=True, capture_output=True, text=True).stdout
    second = subprocess.run(command, check=True, capture_output=True, text=True).stdout
    assert first == second
    report = json.loads(first)
    assert report["changes"]
    assert source.exists()

    apply_command = [part for part in command if part != "--dry-run"]
    subprocess.run(apply_command, check=True, capture_output=True, text=True)
    moved = tmp_path / "src/kfx/src/kfx/example.py"
    assert moved.read_text(encoding="utf-8") == "from ketos import Ketos\n"

    final = subprocess.run([*command[:-1], str(moved)], check=True, capture_output=True, text=True).stdout
    assert json.loads(final)["changes"] == []
