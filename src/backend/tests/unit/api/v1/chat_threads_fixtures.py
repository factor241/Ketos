"""Deterministic fixtures for future chat-thread API tests."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID, uuid5

_FIXTURE_NAMESPACE = UUID("b2e85bc9-721c-5a06-ae62-9180800ec46d")


def _fixture_uuid(name: str) -> UUID:
    return uuid5(_FIXTURE_NAMESPACE, name)


@dataclass(frozen=True)
class ActorFixture:
    id: UUID
    username: str


@dataclass(frozen=True)
class ProjectFixture:
    id: UUID
    owner_id: UUID | None


@dataclass(frozen=True)
class ChatCreateFixture:
    project_id: UUID
    title: str
    provider: str
    model_name: str
    context_policy: str

    def payload(self) -> dict[str, str]:
        return {
            "title": self.title,
            "provider": self.provider,
            "model_name": self.model_name,
            "context_policy": self.context_policy,
        }


@dataclass(frozen=True)
class ChatPatchFixture:
    expected_revision: int
    title: str | None = None
    provider: str | None = None
    model_name: str | None = None
    context_policy: str | None = None
    archived: bool | None = None

    def payload(self) -> dict[str, int | str | bool]:
        payload: dict[str, int | str | bool] = {"expected_revision": self.expected_revision}
        for key in ("title", "provider", "model_name", "context_policy", "archived"):
            value = getattr(self, key)
            if value is not None:
                payload[key] = value
        return payload


def owner_foreign_null_fixture(
    *, suffix: str = ""
) -> tuple[ActorFixture, ActorFixture, ProjectFixture, ProjectFixture, ProjectFixture]:
    owner = ActorFixture(_fixture_uuid(f"stage-05-owner{suffix}"), f"stage05-owner{suffix}")
    foreign = ActorFixture(_fixture_uuid(f"stage-05-foreign{suffix}"), f"stage05-foreign{suffix}")
    owned_project = ProjectFixture(_fixture_uuid(f"stage-05-owned-project{suffix}"), owner.id)
    foreign_project = ProjectFixture(_fixture_uuid(f"stage-05-foreign-project{suffix}"), foreign.id)
    null_owner_project = ProjectFixture(_fixture_uuid(f"stage-05-null-owner-project{suffix}"), None)
    return owner, foreign, owned_project, foreign_project, null_owner_project


def chat_create_fixture(project_id: UUID, suffix: str = "") -> ChatCreateFixture:
    return ChatCreateFixture(
        project_id=project_id,
        title=f"Stage 05 chat{suffix}",
        provider="openai",
        model_name="stage05-model",
        context_policy="chat_only",
    )


def forged_override_payload() -> dict[str, object]:
    return {
        "actor_id": str(_fixture_uuid("stage-05-forged-actor")),
        "user_id": str(_fixture_uuid("stage-05-forged-user")),
        "session_metadata": {"user_id": str(_fixture_uuid("stage-05-forged-session-user"))},
        "run_model": "forged-model-override",
        "tool": "forged-tool",
        "mcp": "forged-mcp",
        "url": "https://invalid.example.test/forged-override",
    }


def foreign_search_titles() -> tuple[str, str]:
    return "Stage 05 owned search title", "Stage 05 foreign search title"
