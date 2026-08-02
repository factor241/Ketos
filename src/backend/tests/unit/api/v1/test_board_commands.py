from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from ketos.api.v1 import boards as boards_api
from ketos.api.v1.boards import router as boards_router
from ketos.api.v1.projects import router as projects_router
from ketos.api.v1.schemas.board_commands import (
    BlankAutomationStarter,
    BoardAutomationCreate,
    BoardBootstrapCreate,
    CleanStarter,
    SimpleAgentStarter,
    TemplateStarter,
    VectorStoreRagStarter,
)
from pydantic import ValidationError


@pytest.mark.parametrize(
    ("payload", "starter_type"),
    [
        ({"title": "Research Board", "starter": {"kind": "clean"}}, CleanStarter),
        (
            {"title": "Research Board", "starter": {"kind": "blank_automation", "name": "New automation"}},
            BlankAutomationStarter,
        ),
        (
            {"title": "Research Board", "starter": {"kind": "simple_agent", "name": "Simple Agent"}},
            SimpleAgentStarter,
        ),
        (
            {"title": "Research Board", "starter": {"kind": "vector_store_rag", "name": "Vector Store RAG"}},
            VectorStoreRagStarter,
        ),
        (
            {
                "title": "Research Board",
                "starter": {"kind": "template", "template_id": str(uuid4()), "name": "My template"},
            },
            TemplateStarter,
        ),
    ],
)
def test_bootstrap_starter_union_is_strict_and_discriminated(payload: dict, starter_type: type) -> None:
    parsed = BoardBootstrapCreate.model_validate(payload)

    assert isinstance(parsed.starter, starter_type)


@pytest.mark.parametrize(
    "payload",
    [
        {"title": "Board", "starter": {"kind": "clean", "name": "forbidden"}},
        {"title": "Board", "starter": {"kind": "blank_automation", "name": " "}},
        {"title": "Board", "starter": {"kind": "template", "template_id": "not-a-uuid", "name": "Template"}},
        {"title": "Board", "starter": {"kind": "unknown"}},
        {"title": "Board", "starter": {"kind": "clean"}, "extra": True},
    ],
)
def test_bootstrap_schema_rejects_extra_or_invalid_starter_fields(payload: dict) -> None:
    with pytest.raises(ValidationError):
        BoardBootstrapCreate.model_validate(payload)


def test_existing_board_command_excludes_clean_and_accepts_geometry() -> None:
    command = BoardAutomationCreate.model_validate(
        {
            "starter": {"kind": "blank_automation", "name": "New automation"},
            "placement": {"x": 10, "y": 20, "width": 360, "height": 240, "z_index": 4},
        }
    )

    assert command.starter.kind == "blank_automation"
    assert command.placement.x == 10
    assert command.placement.width == 360

    with pytest.raises(ValidationError):
        BoardAutomationCreate.model_validate({"starter": {"kind": "clean"}})


def test_template_id_remains_a_uuid() -> None:
    template_id = uuid4()
    command = BoardAutomationCreate.model_validate(
        {
            "starter": {"kind": "template", "template_id": str(template_id), "name": "Template clone"},
            "placement": {"x": 0, "y": 0},
        }
    )

    assert isinstance(command.starter.template_id, UUID)
    assert command.starter.template_id == template_id


@pytest.fixture
async def command_client(client: AsyncClient) -> AsyncClient:
    _ = client
    app = FastAPI()
    app.include_router(projects_router, prefix="/api/v1")
    app.include_router(boards_router, prefix="/api/v1")
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver/",
    ) as local_client:
        yield local_client


async def _create_project(client: AsyncClient, headers: dict[str, str]) -> str:
    response = await client.post(
        "/api/v1/projects/",
        json={"name": f"Commands {uuid4()}", "description": "", "flows_list": [], "components_list": []},
        headers=headers,
    )
    assert response.status_code == 201
    return response.json()["id"]


async def test_bootstrap_endpoint_requires_key_and_replays(command_client: AsyncClient, logged_in_headers) -> None:
    project_id = await _create_project(command_client, logged_in_headers)
    path = f"/api/v1/projects/{project_id}/boards/bootstrap"
    payload = {"title": "Atomic board", "starter": {"kind": "blank_automation", "name": "Atomic flow"}}
    missing_key = await command_client.post(path, json=payload, headers=logged_in_headers)
    assert missing_key.status_code == 422

    key = str(uuid4())
    headers = {**logged_in_headers, "Idempotency-Key": key}
    created = await command_client.post(path, json=payload, headers=headers)
    replay = await command_client.post(path, json=payload, headers=headers)

    assert created.status_code == 201, created.text
    assert replay.status_code == 201, replay.text
    assert created.json()["idempotency_replayed"] is False
    assert replay.json()["idempotency_replayed"] is True
    assert replay.json()["board"]["id"] == created.json()["board"]["id"]
    assert replay.json()["automation"]["id"] == created.json()["automation"]["id"]
    assert replay.json()["placement"]["id"] == created.json()["placement"]["id"]

    mismatch = await command_client.post(
        path,
        json={**payload, "title": "Different"},
        headers=headers,
    )
    assert mismatch.status_code == 409
    assert mismatch.json()["detail"]["code"] == "idempotency_key_reused"


async def test_existing_board_endpoint_returns_atomic_flow_and_placement(
    command_client: AsyncClient,
    logged_in_headers,
) -> None:
    project_id = await _create_project(command_client, logged_in_headers)
    board_response = await command_client.post(
        f"/api/v1/projects/{project_id}/boards",
        json={"title": "Existing"},
        headers=logged_in_headers,
    )
    assert board_response.status_code == 201
    board_id = board_response.json()["id"]

    response = await command_client.post(
        f"/api/v1/boards/{board_id}/automations",
        json={
            "starter": {"kind": "blank_automation", "name": "Inside"},
            "placement": {"x": 12, "y": 34},
        },
        headers={**logged_in_headers, "Idempotency-Key": str(uuid4())},
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["automation"]["folder_id"] == project_id
    assert body["placement"]["board_id"] == board_id
    assert body["placement"]["target_id"] == body["automation"]["id"]


async def test_bootstrap_hides_missing_or_inaccessible_project(command_client: AsyncClient, logged_in_headers) -> None:
    response = await command_client.post(
        f"/api/v1/projects/{uuid4()}/boards/bootstrap",
        json={"title": "Hidden", "starter": {"kind": "clean"}},
        headers={**logged_in_headers, "Idempotency-Key": str(uuid4())},
    )

    assert response.status_code == 404, response.text
    assert response.json()["detail"]["code"] == "board_command_resource_not_found"


async def test_workspace_kill_switch_blocks_compound_writes_but_preserves_legacy_board_reads(
    command_client: AsyncClient,
    logged_in_headers,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project_id = await _create_project(command_client, logged_in_headers)
    legacy = await command_client.post(
        f"/api/v1/projects/{project_id}/boards",
        json={"title": "Readable during rollback"},
        headers=logged_in_headers,
    )
    assert legacy.status_code == 201
    board_id = legacy.json()["id"]
    monkeypatch.setattr(
        boards_api,
        "FEATURE_FLAGS",
        SimpleNamespace(mvp_workspace=False),
    )

    bootstrap = await command_client.post(
        f"/api/v1/projects/{project_id}/boards/bootstrap",
        json={"title": "Blocked bootstrap", "starter": {"kind": "clean"}},
        headers={
            **logged_in_headers,
            "Idempotency-Key": str(uuid4()),
        },
    )
    automation = await command_client.post(
        f"/api/v1/boards/{board_id}/automations",
        json={
            "starter": {"kind": "blank_automation", "name": "Blocked automation"},
            "placement": {"x": 0, "y": 0},
        },
        headers={
            **logged_in_headers,
            "Idempotency-Key": str(uuid4()),
        },
    )

    for response in (bootstrap, automation):
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "board_command_disabled"
    listed = await command_client.get(
        f"/api/v1/projects/{project_id}/boards",
        headers=logged_in_headers,
    )
    fetched = await command_client.get(
        f"/api/v1/boards/{board_id}",
        headers=logged_in_headers,
    )
    assert [board["id"] for board in listed.json()] == [board_id]
    assert fetched.json()["title"] == "Readable during rollback"
