"""Presentation-only localization contracts for built-in project folders."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from langflow.api.v1 import projects
from langflow.initial_setup.constants import ASSISTANT_FOLDER_NAME, STARTER_FOLDER_NAME
from langflow.services.database.models.folder.constants import DEFAULT_FOLDER_NAME
from langflow.services.database.models.folder.model import FolderReadWithFlows
from langflow.utils import i18n as i18n_utils
from starlette.requests import Request


def _request(locale: str) -> Request:
    request = Request({"type": "http", "method": "GET", "path": "/api/v1/projects/", "headers": []})
    request.state.locale = locale
    return request


def _folder(name: str, *, flows=None):
    return SimpleNamespace(
        id=uuid4(),
        parent_id=None,
        user_id=uuid4(),
        workspace_id=None,
        name=name,
        description=None,
        auth_settings=None,
        flows=[] if flows is None else flows,
    )


@pytest.fixture
def system_folder_translations(monkeypatch):
    english = {
        "system_folders.default.name": DEFAULT_FOLDER_NAME,
        "system_folders.starter.name": STARTER_FOLDER_NAME,
        "system_folders.assistant.name": ASSISTANT_FOLDER_NAME,
    }
    russian = {
        "system_folders.default.name": "Мои проекты",
        "system_folders.starter.name": "Стартовые проекты",
        "system_folders.assistant.name": "Помощник Langflow",
    }
    monkeypatch.setattr(i18n_utils, "_translations", {"en": english, "ru": russian})
    return russian


@pytest.mark.asyncio
async def test_read_projects_localizes_system_display_name_without_changing_db_name(
    monkeypatch, system_folder_translations
):
    assistant = _folder(ASSISTANT_FOLDER_NAME)
    custom = _folder("Customer Workspace")
    result_proxy = SimpleNamespace(all=lambda: [assistant, custom])
    session = SimpleNamespace(exec=AsyncMock(return_value=result_proxy))
    monkeypatch.setattr(projects, "filter_visible_resources", AsyncMock(return_value=[assistant, custom]))

    result = await projects.read_projects(
        request=_request("ru"),
        session=session,
        current_user=SimpleNamespace(id=assistant.user_id),
    )

    by_name = {folder.name: folder for folder in result}
    assert by_name[ASSISTANT_FOLDER_NAME].display_name == system_folder_translations["system_folders.assistant.name"]
    assert by_name[ASSISTANT_FOLDER_NAME].name == ASSISTANT_FOLDER_NAME
    assert by_name["Customer Workspace"].display_name == "Customer Workspace"


@pytest.mark.parametrize(
    ("db_name", "translation_key"),
    [
        (DEFAULT_FOLDER_NAME, "system_folders.default.name"),
        (STARTER_FOLDER_NAME, "system_folders.starter.name"),
        (ASSISTANT_FOLDER_NAME, "system_folders.assistant.name"),
    ],
)
def test_system_folder_with_flows_uses_separate_localized_display_name(
    db_name, translation_key, system_folder_translations
):
    raw = _folder(db_name)

    result = projects._folder_read_for_locale(raw, "ru", FolderReadWithFlows)

    assert result.display_name == system_folder_translations[translation_key]
    assert result.name == db_name
    assert raw.name == db_name

