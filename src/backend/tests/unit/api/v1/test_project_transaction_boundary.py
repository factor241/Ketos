import io
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import orjson
import pytest
from ketos.api.v1 import projects as projects_api
from ketos.api.v1 import projects_files as projects_files_api
from ketos.services.database.models.folder.model import FolderCreate
from starlette.datastructures import UploadFile


class _EmptyProjectQuery:
    def first(self):
        return None


@pytest.mark.asyncio
async def test_create_project_commits_before_returning(monkeypatch):
    session = SimpleNamespace(
        add=MagicMock(),
        commit=AsyncMock(),
        exec=AsyncMock(return_value=_EmptyProjectQuery()),
        flush=AsyncMock(),
        refresh=AsyncMock(),
    )
    settings = SimpleNamespace(
        auth_settings=SimpleNamespace(AUTO_LOGIN=True),
        settings=SimpleNamespace(add_projects_to_mcp_servers=False),
    )
    monkeypatch.setattr(
        projects_api,
        "ensure_project_permission",
        AsyncMock(),
    )
    monkeypatch.setattr(projects_api, "get_settings_service", lambda: settings)

    created = await projects_api.create_project(
        session=session,
        project=FolderCreate(
            name="Committed project",
            description="",
            flows_list=[],
            components_list=[],
        ),
        current_user=SimpleNamespace(id=uuid4()),
    )

    assert created.name == "Committed project"
    session.commit.assert_awaited_once()
    session.refresh.assert_awaited()


@pytest.mark.asyncio
async def test_project_import_discards_persisted_flow_ids(monkeypatch):
    persisted_flow_id = uuid4()
    payload = orjson.dumps(
        {
            "flows": [
                {
                    "id": str(persisted_flow_id),
                    "name": "Imported automation",
                    "data": {},
                }
            ]
        }
    )
    session = SimpleNamespace(
        add=MagicMock(),
        flush=AsyncMock(),
        refresh=AsyncMock(),
    )
    settings = SimpleNamespace(
        auth_settings=SimpleNamespace(AUTO_LOGIN=True),
    )
    captured_flow_list = None

    async def capture_create_flows(*, flow_list, **_kwargs):
        nonlocal captured_flow_list
        captured_flow_list = flow_list
        return []

    monkeypatch.setattr(
        projects_files_api,
        "generate_unique_folder_name",
        AsyncMock(return_value="collection"),
    )
    monkeypatch.setattr(
        projects_files_api,
        "generate_unique_flow_name",
        AsyncMock(return_value="Imported automation"),
    )
    monkeypatch.setattr(projects_files_api, "create_flows", capture_create_flows)
    monkeypatch.setattr(
        projects_files_api,
        "get_settings_service",
        lambda: settings,
    )

    await projects_files_api.upload_project_flows(
        session=session,
        file=UploadFile(
            filename="collection.json",
            file=io.BytesIO(payload),
        ),
        current_user=SimpleNamespace(id=uuid4()),
    )

    assert captured_flow_list is not None
    assert captured_flow_list.flows[0].id is None
    assert captured_flow_list.flows[0].name == "Imported automation"
