from __future__ import annotations

# ruff: noqa: S101 - assertions are the behavior under test.
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

import pytest
from conftest import commit_files, load_scanner


@pytest.mark.parametrize(
    "url",
    [
        "https://x.com/langflow_ai",
        "https://twitter.com/langflow_ai",
    ],
)
def test_langflow_ai_social_accounts_are_official_urls(url: str) -> None:
    assert load_scanner().is_official_url(url)


def test_freeze_uses_semantic_categories_and_keeps_unclear_copy_as_migration_debt(git_repo: Path) -> None:
    commit_files(
        git_repo,
        {
            "src/import_compat.py": "from langflow.api import router\n",
            "src/settings_compat.py": 'token = os.getenv("LANGFLOW_API_KEY")\n',
            "src/storage_compat.py": 'legacy_db = "~/.langflow/langflow.db"\n',
            "src/backend/base/langflow/alembic/versions/1234_legacy.py": 'revision_label = "langflow migration"\n',
            "tests/data/flows/legacy.json": '{"name": "langflow fixture"}\n',
            "src/protocol_compat.py": 'header = "x-langflow-global-var-access-token"\n',
            "src/resource_compat.py": 'legacy_resource_id = "langflow:550e8400-e29b-41d4-a716-446655440000"\n',
            "LICENSE": "Copyright 2024 Langflow contributors\n",
            "src/backend/base/langflow/api/router.py": 'description = "Langflow helper"\n',
            "src/copy.py": 'description = "Langflow helper"\n',
        },
    )

    contract = load_scanner().freeze_contract(git_repo)
    residues = {(item["path"], item["match"]): item["category"] for item in contract["residues"]}

    assert residues == {
        ("LICENSE", "Copyright 2024 Langflow contributors"): "legal_provenance",
        (
            "src/backend/base/langflow/alembic/versions/1234_legacy.py",
            'revision_label = "langflow migration"',
        ): "historical_migration",
        ("src/import_compat.py", "from langflow.api import router"): "import_alias",
        ("src/protocol_compat.py", 'header = "x-langflow-global-var-access-token"'): "wire_protocol",
        (
            "src/resource_compat.py",
            'legacy_resource_id = "langflow:550e8400-e29b-41d4-a716-446655440000"',
        ): "external_resource_id",
        ("src/settings_compat.py", "LANGFLOW_API_KEY"): "env_alias",
        ("src/storage_compat.py", 'legacy_db = "~/.langflow/langflow.db"'): "data_path",
        ("tests/data/flows/legacy.json", '{"name": "langflow fixture"}'): "historical_fixture",
    }

    user_visible_paths = {item["path"] for item in contract["migration_debt"]["user_visible"]["occurrences"]}
    assert {"src/backend/base/langflow/api/router.py", "src/copy.py"} <= user_visible_paths


def test_every_technical_group_has_explicit_metadata_even_when_empty(git_repo: Path) -> None:
    commit_files(git_repo, {"README.md": "Ketos\n"})
    contract = load_scanner().freeze_contract(git_repo)

    assert set(contract["technical_debt"]) == set(load_scanner().LEGACY_CATEGORIES)
    for group in contract["technical_debt"].values():
        assert set(group) == {
            "owner",
            "reason",
            "compatibility_test",
            "removal_condition",
            "occurrences",
        }
        assert group["occurrences"] == []
