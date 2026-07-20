"""Stage 05 prep guard for chat-stack source boundaries."""

# ruff: noqa: S101

from __future__ import annotations

import hashlib
import re
from pathlib import Path

WORKSPACE = Path(__file__).resolve().parents[2]
INTENDED_STAGE05_PATHS = (
    WORKSPACE / "src/backend/base/ketos/services/chat_threads",
    WORKSPACE / "src/backend/base/ketos/api/v1/chat_threads.py",
    WORKSPACE / "src/backend/base/ketos/agentic/api/ag_ui_router.py",
    WORKSPACE / "src/copilot-runtime/src",
    WORKSPACE / "src/frontend/src/components/core/board",
    WORKSPACE / "src/frontend/src/components/core/chats",
)
LEGACY_PATHS = (
    WORKSPACE / "src/frontend/src/components/core/assistant/AssistantPanel.tsx",
    WORKSPACE / "src/frontend/src/pages/FlowPage.tsx",
    WORKSPACE / "src/frontend/src/CustomNodes/NoteNode",
)
KFX_AGENT_COMPONENT = WORKSPACE / "src/backend/base/ketos/components/agents/agent.py"
IGNORED_PARTS = frozenset({"node_modules", "build", "dist", "generated", "graphify-out", ".venv"})
SOURCE_SUFFIXES = frozenset({".py", ".ts", ".tsx", ".js", ".jsx"})

OFFICIAL_AG_UI_EVENT_NAMES = frozenset(
    {"TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END", "RUN_STARTED", "RUN_FINISHED"}
)
ALLOWED_STOCK_COMPONENTS = frozenset({"CopilotChat"})
FORBIDDEN_SEMANTIC_CATEGORIES = {
    "conversation_buffer_durable_truth": (("ConversationBuffer durable truth", re.compile(r"\bConversationBuffer\b")),),
    "custom_ag_ui_event_types": (
        (
            "custom AG-UI event type",
            re.compile(
                r"""\b(?:type|event_type|eventType)\b\s*[:=]\s*["']"""
                r"""(?:TOKEN|PROGRESS|INTERRUPT|RESUME)["']"""
            ),
        ),
    ),
    "chat_turn_or_event_log_tables": (
        (
            "ChatTurn model table",
            re.compile(r"class\s+ChatTurn\b[\s\S]{0,240}__tablename__", re.IGNORECASE),
        ),
        (
            "chat event-log model table",
            re.compile(
                r"class\s+\w*(?:EventLog|ChatEvent|ChatTurnEvent)\w*\b[\s\S]{0,240}__tablename__",
                re.IGNORECASE,
            ),
        ),
    ),
    "local_storage_transcript_truth": (
        (
            "localStorage transcript truth",
            re.compile(
                r"""localStorage\.(?:getItem|setItem)\(\s*["'][^"']*(?:transcript|messages|chat)[^"']*["']""",
                re.IGNORECASE,
            ),
        ),
    ),
    "arbitrary_chat_runtime_routing": (
        ("arbitrary chat runtime routing", re.compile(r"\b(?:target_url|mcp_url|tool_router|model_router)\b")),
    ),
    "replacement_chat_components": (
        (
            "replacement chat component",
            re.compile(r"\b(?:ChatMessageList|ChatComposer|ChatLoadingCard|CustomToolRenderer)\b"),
        ),
    ),
}


def _is_ignored(path: Path) -> bool:
    return any(part in IGNORED_PARTS for part in path.parts)


def _iter_existing_stage05_sources() -> list[Path]:
    sources: set[Path] = set()
    this_file = Path(__file__).resolve()
    for intended_path in INTENDED_STAGE05_PATHS:
        if not intended_path.exists():
            continue
        candidates = intended_path.rglob("*") if intended_path.is_dir() else (intended_path,)
        for candidate in candidates:
            if (
                candidate.is_file()
                and candidate.suffix in SOURCE_SUFFIXES
                and candidate.resolve() != this_file
                and not _is_ignored(candidate)
            ):
                sources.add(candidate.resolve())
    return sorted(sources)


def _relative(path: Path) -> str:
    return path.relative_to(WORKSPACE).as_posix()


def _scan_stage05_sources() -> list[str]:
    failures: list[str] = []
    for source in _iter_existing_stage05_sources():
        contents = source.read_text(encoding="utf-8", errors="replace")
        for patterns in FORBIDDEN_SEMANTIC_CATEGORIES.values():
            for label, pattern in patterns:
                if pattern.search(contents):
                    failures.append(f"{_relative(source)}: matched forbidden {label}")
    return failures


def _legacy_hashes() -> dict[str, str]:
    files = (path for root in LEGACY_PATHS if root.exists() for path in (root.rglob("*") if root.is_dir() else (root,)))
    return {
        _relative(path): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in files
        if path.is_file() and path.suffix in SOURCE_SUFFIXES
    }


def test_stage05_chat_stack_boundaries() -> None:
    failures = _scan_stage05_sources()
    assert not failures, "\n".join(failures)


def test_stage05_kfx_agent_component_identifier_is_preserved() -> None:
    if not KFX_AGENT_COMPONENT.is_file():
        return
    source = KFX_AGENT_COMPONENT.read_text(encoding="utf-8", errors="replace")
    assert re.search(r"^class\s+AgentComponent\b", source, re.MULTILINE), (
        f"{_relative(KFX_AGENT_COMPONENT)}: persisted AgentComponent identifier is missing"
    )


def test_stage05_guard_does_not_rewrite_legacy_sources() -> None:
    before = _legacy_hashes()
    _scan_stage05_sources()
    assert _legacy_hashes() == before


def test_stage05_guard_has_explicit_prohibitions() -> None:
    required = {
        "conversation_buffer_durable_truth",
        "custom_ag_ui_event_types",
        "chat_turn_or_event_log_tables",
        "local_storage_transcript_truth",
        "arbitrary_chat_runtime_routing",
        "replacement_chat_components",
    }
    assert required <= FORBIDDEN_SEMANTIC_CATEGORIES.keys()
    assert all(FORBIDDEN_SEMANTIC_CATEGORIES[category] for category in required)
