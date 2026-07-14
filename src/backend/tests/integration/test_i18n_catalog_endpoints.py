"""Endpoint-level contracts for locale-specific built-in starter content."""

from __future__ import annotations

import pytest
from ketos.api.v1.starter_projects import get_starter_projects
from ketos.initial_setup.load import get_starter_projects_dump
from ketos.utils import i18n as i18n_utils
from starlette.requests import Request


def _request(locale: str) -> Request:
    request = Request({"type": "http", "method": "GET", "path": "/api/v1/starter-projects/", "headers": []})
    request.state.locale = locale
    return request


@pytest.mark.asyncio
async def test_python_built_starter_endpoint_localizes_name_description_and_note(monkeypatch):
    name_key = "starter_flows.basic_prompting.name"
    description_key = "starter_flows.basic_prompting.description"
    note_key = "template_notes.basic_prompting.test"
    english = {
        name_key: "Basic Prompting",
        description_key: "Perform basic prompting with an OpenAI model.",
        note_key: "English note",
    }
    russian = {
        name_key: "Базовый промпт",
        description_key: "Выполняет базовый промпт с помощью модели OpenAI.",  # noqa: RUF001
        note_key: "Русская заметка",
    }
    monkeypatch.setattr(i18n_utils, "_translations", {"en": english, "ru": russian})
    raw = {
        "name": "Basic Prompting",
        "description": "Perform basic prompting with an OpenAI model.",
        "name_i18n_key": name_key,
        "description_i18n_key": description_key,
        "is_component": False,
        "endpoint_name": "basic-prompting",
        "data": {
            "nodes": [
                {
                    "type": "noteNode",
                    "data": {"node": {"i18n_key": note_key, "description": english[note_key]}},
                }
            ],
            "edges": [],
        },
    }

    monkeypatch.setattr("ketos.initial_setup.load.get_starter_projects_dump", lambda: [raw])

    result = await get_starter_projects(_request("ru"))

    assert result[0].name == russian["starter_flows.basic_prompting.name"]
    assert result[0].description == russian["starter_flows.basic_prompting.description"]
    assert result[0].name_i18n_key == name_key
    assert result[0].description_i18n_key == description_key
    assert result[0].data.nodes[0]["data"]["node"]["description"] == russian[note_key]
    assert raw["name"] == "Basic Prompting"
    assert raw["data"]["nodes"][0]["data"]["node"]["description"] == english[note_key]


def test_python_built_starter_dumps_declare_stable_i18n_keys():
    expected = {
        "Basic Prompting": "basic_prompting",
        "Blog Writer": "blog_writer",
        "Document Q&A": "document_q_a",
        "Memory Chatbot": "memory_chatbot",
        "Vector Store RAG": "vector_store_rag",
    }

    dumps = get_starter_projects_dump()

    assert len(dumps) == len(expected)
    for item in dumps:
        slug = expected[item["name"]]
        assert item["name_i18n_key"] == f"starter_flows.{slug}.name"
        assert item["description_i18n_key"] == f"starter_flows.{slug}.description"
