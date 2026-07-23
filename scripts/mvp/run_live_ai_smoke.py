#!/usr/bin/env python3
"""Run the redacted Stage 10 direct-provider and real Ketos live smoke."""

from __future__ import annotations

# ruff: noqa: BLE001, EM101, EM102, PLR2004, S603, S607, TRY003
import argparse
import hashlib
import json
import os
import re
import signal
import socket
import stat
import subprocess
import time
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import httpx
import psutil
from openai import OpenAI
from sqlalchemy.engine import make_url
from sqlmodel import Session, create_engine, select

COMETAPI_BASE_URL = "https://api.cometapi.com/v1"
LIVE_MODEL = "deepseek-v4-flash"
PROVIDER_ADAPTER = "OpenAI"
PROVIDER_UPSTREAM = "CometAPI"
DEFAULT_SECRET_FILE = Path("/Volumes/Projects/.ketos-stage10-secrets/cometapi.env")
REPO_ROOT = Path(__file__).resolve().parents[2]
SECRET_PATTERN = re.compile(r"\ACOMETAPI_KEY=([^\r\n\x00]+)\n?\Z")
FORBIDDEN_EVIDENCE_FIELDS = frozenset(
    {
        "api_key",
        "apikey",
        "authorization",
        "cookie",
        "cookies",
        "environment",
        "headers",
        "prompt",
        "raw_prompt",
        "raw_response",
        "reasoning",
        "response",
        "response_body",
        "secret",
        "token",
    }
)


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--assert-canonical-saver-path", action="store_true")
    parser.add_argument("--entity-ledger", required=True, type=Path)
    parser.add_argument("--evidence", required=True, type=Path)
    parser.add_argument(
        "--secret-file",
        type=Path,
        default=Path(os.environ.get("KETOS_STAGE10_SECRET_FILE", DEFAULT_SECRET_FILE)),
    )
    return parser


def _mode(path: Path) -> int:
    return stat.S_IMODE(path.stat(follow_symlinks=False).st_mode)


def _has_acl(path: Path) -> bool:
    if os.uname().sysname != "Darwin":
        return False
    result = subprocess.run(
        ["/bin/ls", "-lde", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    first = result.stdout.splitlines()[0].split(maxsplit=1)[0]
    return "+" in first


def load_hardened_secret(path: Path) -> str:
    """Read exactly one COMETAPI_KEY assignment without shell evaluation."""
    candidate = path.expanduser()
    if candidate.is_symlink():
        raise ValueError("secret file contract: symlink is forbidden")
    resolved = candidate.resolve(strict=True)
    parent = resolved.parent
    if parent.is_symlink():
        raise ValueError("secret file contract: parent symlink is forbidden")
    file_info = resolved.stat(follow_symlinks=False)
    parent_info = parent.stat(follow_symlinks=False)
    if not stat.S_ISREG(file_info.st_mode):
        raise ValueError("secret file contract: regular file required")
    if file_info.st_uid != os.getuid() or parent_info.st_uid != os.getuid():
        raise ValueError("secret file contract: current-user ownership required")
    if stat.S_IMODE(file_info.st_mode) != 0o600:
        raise ValueError("secret file contract: file mode 0600 required")
    if stat.S_IMODE(parent_info.st_mode) != 0o700:
        raise ValueError("secret file contract: parent mode 0700 required")
    if _has_acl(resolved) or _has_acl(parent):
        raise ValueError("secret file contract: ACL is forbidden")
    match = SECRET_PATTERN.fullmatch(resolved.read_text(encoding="utf-8"))
    if match is None or not match.group(1):
        raise ValueError("secret file contract: expected one COMETAPI_KEY assignment")
    return match.group(1)


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def flow_hash(flow: Mapping[str, Any]) -> str:
    material = {
        "data": flow["data"],
        "description": flow.get("description"),
        "name": flow["name"],
    }
    return hashlib.sha256(_canonical_json(material).encode()).hexdigest()


def parse_sse_events(body: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    try:
        for line in body.splitlines():
            if not line.startswith("data: "):
                continue
            payload = json.loads(line.removeprefix("data: "))
            if not isinstance(payload, dict):
                raise TypeError
            events.append(payload)
    except (json.JSONDecodeError, TypeError) as exc:
        raise ValueError("malformed AG-UI SSE record") from exc
    if not events:
        raise ValueError("malformed AG-UI SSE: no data records")
    return events


def require_exact_proposal_payload(
    payload: Mapping[str, Any],
    *,
    flow_id: str,
    expected_value: str,
) -> None:
    if str(payload.get("targetFlowId")) != flow_id:
        raise ValueError("proposal targets the wrong Flow")
    operations = payload.get("operations")
    if not isinstance(operations, list) or len(operations) != 1:
        raise ValueError("proposal must contain exactly one operation")
    operation = operations[0]
    expected = {
        "op": "set_parameter",
        "nodeId": "TextInput-stage10",
        "parameter": "input_value",
        "value": expected_value,
    }
    if operation != expected:
        raise ValueError("proposal operation does not match the safe Stage 10 contract")


def assert_redacted_evidence(value: Any) -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            if str(key).replace("-", "_").lower() in FORBIDDEN_EVIDENCE_FIELDS:
                raise ValueError(f"forbidden evidence field: {key}")
            assert_redacted_evidence(item)
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        for item in value:
            assert_redacted_evidence(item)


def write_json_exclusive(path: Path, payload: Mapping[str, Any]) -> None:
    assert_redacted_evidence(payload)
    target = path.expanduser()
    if not target.is_absolute():
        raise ValueError("evidence path must be absolute")
    parent = target.parent.resolve(strict=True)
    if parent.is_symlink() or target.is_symlink():
        raise ValueError("evidence path must not use symlinks")
    descriptor = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", closefd=False) as stream:
            json.dump(payload, stream, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.fchmod(descriptor, 0o600)
    finally:
        os.close(descriptor)


def _validate_paths(
    database_url: str,
    entity_ledger: Path,
    evidence: Path,
) -> tuple[Path, Path]:
    parsed = make_url(database_url)
    if parsed.drivername not in {"sqlite", "sqlite+pysqlite"}:
        raise ValueError("--database-url must use SQLite")
    if not parsed.database or parsed.database == ":memory:":
        raise ValueError("--database-url must name an on-disk SQLite database")
    database_path = Path(parsed.database).expanduser()
    if not database_path.is_absolute():
        raise ValueError("--database-url must contain an absolute SQLite path")
    ledger = entity_ledger.expanduser()
    target = evidence.expanduser()
    if not ledger.is_absolute() or not target.is_absolute():
        raise ValueError("entity ledger and evidence paths must be absolute")
    ledger = ledger.resolve(strict=True)
    if ledger.is_symlink() or target.is_symlink():
        raise ValueError("entity ledger and evidence must not be symlinks")
    if target.exists():
        raise FileExistsError(f"refusing to overwrite evidence: {target}")
    target_parent = target.parent.resolve(strict=True)
    try:
        target_parent.relative_to(REPO_ROOT)
    except ValueError:
        pass
    else:
        raise ValueError("evidence must remain outside the repository")
    return ledger, target_parent / target.name


def _git_sha() -> str:
    value = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if re.fullmatch(r"[0-9a-f]{40}", value) is None:
        raise RuntimeError("could not resolve S10 code SHA")
    return value


def _canonical_saver_path() -> Path:
    from ketos.agentic.persistence.checkpointer import checkpoint_path

    raw = os.environ.get("KETOS_DATA_DIR")
    if not raw:
        raise ValueError("KETOS_DATA_DIR is required")
    data_dir = Path(raw).expanduser().resolve(strict=False)
    actual = Path(checkpoint_path(data_dir)).resolve(strict=False)
    expected = (data_dir / "mvp" / "langgraph-checkpoints.sqlite3").resolve(strict=False)
    if actual != expected:
        raise ValueError("canonical saver path assertion failed")
    return actual


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def _wait_http(url: str, process: subprocess.Popen[bytes], timeout: float = 120.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("Ketos server exited before readiness")
        try:
            if httpx.get(url, timeout=2.0).is_success:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.25)
    raise TimeoutError("Ketos server readiness timed out")


def _group_members(pgid: int) -> list[dict[str, Any]]:
    members: list[dict[str, Any]] = []
    for process in psutil.process_iter(["pid", "ppid", "create_time", "cmdline"]):
        try:
            if os.getpgid(process.pid) != pgid or process.status() == psutil.STATUS_ZOMBIE:
                continue
            members.append(
                {
                    "pid": process.pid,
                    "ppid": process.ppid(),
                    "started_at_epoch": process.create_time(),
                    "command_sha256": hashlib.sha256(
                        "\0".join(process.cmdline()).encode()
                    ).hexdigest(),
                }
            )
        except (OSError, psutil.Error):
            continue
    return sorted(members, key=lambda item: item["pid"])


def _stop_owned_server(process: subprocess.Popen[bytes], pgid: int) -> dict[str, Any]:
    before = _group_members(pgid)
    outcome: dict[str, Any] = {
        "pid": process.pid,
        "pgid": pgid,
        "members": before,
        "term_sent": False,
        "kill_sent": False,
        "survivors": [],
    }
    if before:
        os.killpg(pgid, signal.SIGTERM)
        outcome["term_sent"] = True
    deadline = time.monotonic() + 15.0
    while _group_members(pgid) and time.monotonic() < deadline:
        time.sleep(0.1)
    survivors = _group_members(pgid)
    if survivors:
        before_by_pid = {item["pid"]: item for item in before}
        if all(
            item["pid"] in before_by_pid
            and item["started_at_epoch"] == before_by_pid[item["pid"]]["started_at_epoch"]
            and item["command_sha256"] == before_by_pid[item["pid"]]["command_sha256"]
            for item in survivors
        ):
            os.killpg(pgid, signal.SIGKILL)
            outcome["kill_sent"] = True
            time.sleep(0.2)
    outcome["survivors"] = _group_members(pgid)
    return outcome


def _request_json(
    client: httpx.Client,
    method: str,
    path: str,
    *,
    payload: Mapping[str, Any] | None = None,
) -> Any:
    response = client.request(method, path, json=payload)
    if not response.is_success:
        raise RuntimeError(f"Ketos request failed: {method} {path} status={response.status_code}")
    return response.json()


def _assistant_count(messages: Sequence[Mapping[str, Any]]) -> int:
    return sum(item.get("role") == "assistant" and bool(item.get("content")) for item in messages)


def _post_ag_ui(
    client: httpx.Client,
    *,
    thread_id: str,
    run_id: str,
    project_id: str,
    board_id: str,
    prompt: str | None = None,
    resume: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], int]:
    messages = []
    if prompt is not None:
        messages.append(
            {
                "id": str(uuid4()),
                "role": "user",
                "content": prompt,
            }
        )
    payload: dict[str, Any] = {
        "threadId": thread_id,
        "runId": run_id,
        "state": {"projectId": project_id, "boardId": board_id},
        "messages": messages,
        "tools": [],
        "context": [],
        "forwardedProps": {},
    }
    if resume is not None:
        payload["resume"] = resume
    started = time.monotonic()
    response = client.post("/api/v1/agentic/ag-ui", json=payload)
    latency_ms = round((time.monotonic() - started) * 1000)
    if response.status_code != 200:
        raise RuntimeError(f"AG-UI request failed with status={response.status_code}")
    events = parse_sse_events(response.text)
    if any(str(item.get("type", "")).upper() == "RUN_ERROR" for item in events):
        raise RuntimeError("AG-UI returned RUN_ERROR")
    return events, latency_ms


def _assistant_text(events: Sequence[Mapping[str, Any]]) -> str:
    chunks = [
        str(event.get("delta", ""))
        for event in events
        if str(event.get("type", "")).upper() == "TEXT_MESSAGE_CONTENT"
    ]
    value = "".join(chunks).strip()
    if not value:
        raise RuntimeError("live model produced no assistant text")
    return value


def _inspect_chat_run(
    database_url: str,
    *,
    chat_id: str,
    ag_ui_run_id: str,
) -> tuple[Any, list[Any], int]:
    from ketos.services.database.models.chat_thread.model import ChatRun
    from ketos.services.database.models.command_proposal.model import CommandProposal
    from ketos.services.database.models.message.model import MessageTable

    engine = create_engine(database_url)
    try:
        with Session(engine) as session:
            runs = list(
                session.exec(
                    select(ChatRun).where(
                        ChatRun.chat_id == UUID(chat_id),
                        ChatRun.ag_ui_run_id == ag_ui_run_id,
                    )
                ).all()
            )
            if len(runs) != 1:
                raise RuntimeError("expected exactly one durable ChatRun")
            run = runs[0]
            proposals = list(
                session.exec(
                    select(CommandProposal).where(CommandProposal.chat_run_id == run.id)
                ).all()
            )
            assistant_messages = len(
                session.exec(
                    select(MessageTable).where(
                        MessageTable.chat_run_id == run.id,
                        MessageTable.is_output.is_(True),
                    )
                ).all()
            )
            return run, proposals, assistant_messages
    finally:
        engine.dispose()


def _proposal_for_run(
    database_url: str,
    *,
    chat_id: str,
    run_id: str,
    flow_id: str,
    expected_value: str,
) -> Any:
    _run, proposals, _assistant_messages = _inspect_chat_run(
        database_url,
        chat_id=chat_id,
        ag_ui_run_id=run_id,
    )
    if len(proposals) != 1:
        raise RuntimeError("expected exactly one command proposal")
    proposal = proposals[0]
    if str(proposal.flow_id) != flow_id or str(proposal.command_type.value) != "set_parameter":
        raise RuntimeError("live proposal has the wrong command identity")
    require_exact_proposal_payload(
        proposal.canonical_payload,
        flow_id=flow_id,
        expected_value=expected_value,
    )
    if not proposal.interrupt_id or str(proposal.status.value) != "awaiting_confirmation":
        raise RuntimeError("live proposal is not awaiting exact confirmation")
    return proposal


def _usage(value: Any) -> dict[str, int] | None:
    if value is None:
        return None
    dumped = value.model_dump() if hasattr(value, "model_dump") else dict(value)
    allowed = ("prompt_tokens", "completion_tokens", "total_tokens")
    return {key: int(dumped[key]) for key in allowed if dumped.get(key) is not None}


def _direct_preflight(api_key: str) -> dict[str, Any]:
    client = OpenAI(base_url=COMETAPI_BASE_URL, api_key=api_key, timeout=30.0)
    models_started = time.monotonic()
    models = client.models.list()
    models_latency = round((time.monotonic() - models_started) * 1000)
    if LIVE_MODEL not in {item.id for item in models.data}:
        raise RuntimeError("exact live model is absent from authorized /models")

    extra_body = {
        "thinking": {"type": "enabled"},
        "reasoning_effort": "high",
    }
    reply_started = time.monotonic()
    reply = client.chat.completions.create(
        model=LIVE_MODEL,
        messages=[
            {"role": "system", "content": "Reply concisely."},
            {"role": "user", "content": "Reply with the single word READY."},
        ],
        max_tokens=64,
        stream=False,
        extra_body=extra_body,
    )
    reply_latency = round((time.monotonic() - reply_started) * 1000)
    if not (reply.choices and reply.choices[0].message.content):
        raise RuntimeError("direct provider reply is empty")

    tools = [
        {
            "type": "function",
            "function": {
                "name": "stage10_safe_sum",
                "description": "Add two small integers.",
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "a": {"type": "integer"},
                        "b": {"type": "integer"},
                    },
                    "required": ["a", "b"],
                },
            },
        }
    ]
    tool_started = time.monotonic()
    tool_call = client.chat.completions.create(
        model=LIVE_MODEL,
        messages=[
            {"role": "system", "content": "Use the provided function."},
            {"role": "user", "content": "Call stage10_safe_sum with a=2 and b=3."},
        ],
        tools=tools,
        tool_choice="required",
        max_tokens=128,
        stream=False,
        extra_body=extra_body,
    )
    tool_latency = round((time.monotonic() - tool_started) * 1000)
    calls = tool_call.choices[0].message.tool_calls if tool_call.choices else None
    if not calls or len(calls) != 1:
        raise RuntimeError("direct typed-tool preflight returned no exact tool call")
    call = calls[0]
    arguments = json.loads(call.function.arguments)
    if call.function.name != "stage10_safe_sum" or arguments != {"a": 2, "b": 3}:
        raise RuntimeError("direct typed-tool arguments are invalid")
    follow_started = time.monotonic()
    follow = client.chat.completions.create(
        model=LIVE_MODEL,
        messages=[
            {"role": "system", "content": "Use the provided function."},
            {"role": "user", "content": "Call stage10_safe_sum with a=2 and b=3."},
            tool_call.choices[0].message.model_dump(exclude_none=True),
            {"role": "tool", "tool_call_id": call.id, "content": "5"},
        ],
        tools=tools,
        max_tokens=64,
        stream=False,
        extra_body=extra_body,
    )
    follow_latency = round((time.monotonic() - follow_started) * 1000)
    if not (follow.choices and follow.choices[0].message.content):
        raise RuntimeError("direct typed-tool follow-up is empty")
    return {
        "models_status": "PASS",
        "models_latency_ms": models_latency,
        "reply_status": "PASS",
        "reply_request_id": getattr(reply, "_request_id", None),
        "reply_latency_ms": reply_latency,
        "reply_usage": _usage(reply.usage),
        "typed_tool_status": "PASS",
        "typed_tool_request_id": getattr(tool_call, "_request_id", None),
        "typed_tool_latency_ms": tool_latency,
        "typed_tool_usage": _usage(tool_call.usage),
        "tool_followup_status": "PASS",
        "tool_followup_request_id": getattr(follow, "_request_id", None),
        "tool_followup_latency_ms": follow_latency,
        "tool_followup_usage": _usage(follow.usage),
    }


def _run(args: argparse.Namespace) -> dict[str, Any]:
    ledger_path, evidence_path = _validate_paths(
        args.database_url,
        args.entity_ledger,
        args.evidence,
    )
    api_key = load_hardened_secret(args.secret_file)
    saver_path = _canonical_saver_path() if args.assert_canonical_saver_path else None
    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    project_id = str(ledger["project_id"])
    board_id = str(ledger["board_id"])
    flow_id = str(ledger["flow_id"])
    chat_id = str(ledger["chat_ids"][0])
    for value in (project_id, board_id, flow_id, chat_id):
        UUID(value)

    started_at = utc_now()
    direct = _direct_preflight(api_key)
    port = _find_free_port()
    env = os.environ.copy()
    env.update(
        {
            "KETOS_DATABASE_URL": args.database_url,
            "KETOS_CONFIG_DIR": str(Path(os.environ["KETOS_DATA_DIR"]).resolve()),
            "KETOS_TEMP_DIR": str(Path(os.environ["KETOS_DATA_DIR"]).resolve()),
            "KETOS_AUTO_LOGIN": "true",
            "KETOS_SKIP_AUTH_AUTO_LOGIN": "true",
            "KETOS_FEATURE_MVP_WORKSPACE": "true",
            "KETOS_FEATURE_MVP_CHAT": "true",
            "KETOS_AGENTIC_EXPERIENCE": "true",
            "KETOS_DEACTIVATE_TRACING": "true",
            "KETOS_LOG_LEVEL": "ERROR",
            "LANGGRAPH_STRICT_MSGPACK": "true",
            "DO_NOT_TRACK": "true",
            "OPENAI_API_KEY": api_key,
            "OPENAI_BASE_URL": COMETAPI_BASE_URL,
        }
    )
    process = subprocess.Popen(
        [
            "uv",
            "run",
            "uvicorn",
            "--factory",
            "ketos.main:create_app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--loop",
            "asyncio",
            "--workers",
            "1",
            "--log-level",
            "error",
            "--no-access-log",
        ],
        cwd=REPO_ROOT,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    pgid = os.getpgid(process.pid)
    process_started = psutil.Process(process.pid).create_time()
    cleanup: dict[str, Any] = {}
    try:
        _wait_http(f"http://127.0.0.1:{port}/health", process)
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=180.0) as client:
            _request_json(client, "GET", "/api/v1/auto_login")
            whoami = _request_json(client, "GET", "/api/v1/users/whoami")
            actor_id = str(whoami["id"])

            _request_json(
                client,
                "POST",
                "/api/v1/variables/",
                payload={
                    "name": "OPENAI_BASE_URL",
                    "value": COMETAPI_BASE_URL,
                    "type": "Generic",
                    "default_fields": [],
                },
            )
            _request_json(
                client,
                "POST",
                "/api/v1/variables/",
                payload={
                    "name": "OPENAI_API_KEY",
                    "value": api_key,
                    "type": "Credential",
                    "default_fields": [],
                },
            )
            variables = _request_json(client, "GET", "/api/v1/variables/")
            by_name = {item["name"]: item for item in variables}
            if (
                by_name.get("OPENAI_BASE_URL", {}).get("value") != COMETAPI_BASE_URL
                or by_name.get("OPENAI_BASE_URL", {}).get("type") != "Generic"
                or by_name.get("OPENAI_API_KEY", {}).get("type") != "Credential"
                or by_name.get("OPENAI_API_KEY", {}).get("value") is not None
            ):
                raise RuntimeError("Variables API did not persist the provider contract")

            config = _request_json(client, "GET", "/api/v1/agentic/check-config")
            providers = {
                item.get("name"): item
                for item in config.get("providers", [])
                if isinstance(item, dict)
            }
            openai_config = providers.get(PROVIDER_ADAPTER)
            available_models = {
                item.get("name")
                for item in (openai_config or {}).get("models", [])
                if isinstance(item, dict)
            }
            if (
                not config.get("configured")
                or PROVIDER_ADAPTER not in config.get("configured_providers", [])
                or openai_config is None
                or LIVE_MODEL not in available_models
            ):
                raise RuntimeError("Ketos check-config did not expose the exact live model")

            chat = _request_json(client, "GET", f"/api/v1/chats/{chat_id}")
            patched_chat = _request_json(
                client,
                "PATCH",
                f"/api/v1/chats/{chat_id}",
                payload={
                    "expected_revision": chat["revision"],
                    "provider": PROVIDER_ADAPTER,
                    "model_name": LIVE_MODEL,
                },
            )
            if (
                patched_chat["provider"] != PROVIDER_ADAPTER
                or patched_chat["model_name"] != LIVE_MODEL
            ):
                raise RuntimeError("Chat provider/model patch was not committed")

            messages_before = _request_json(client, "GET", f"/api/v1/chats/{chat_id}/messages")
            reply_run_id = str(uuid4())
            reply_events, reply_latency = _post_ag_ui(
                client,
                thread_id=chat_id,
                run_id=reply_run_id,
                project_id=project_id,
                board_id=board_id,
                prompt="Reply briefly with READY. Do not call a tool.",
            )
            reply_text = _assistant_text(reply_events)
            messages_after_reply = _request_json(
                client,
                "GET",
                f"/api/v1/chats/{chat_id}/messages",
            )
            if _assistant_count(messages_after_reply) != _assistant_count(messages_before) + 1:
                raise RuntimeError("live reply was not committed exactly once")
            reply_run, reply_proposals, reply_assistant_count = _inspect_chat_run(
                args.database_url,
                chat_id=chat_id,
                ag_ui_run_id=reply_run_id,
            )
            if reply_proposals or reply_assistant_count != 1:
                raise RuntimeError("live reply durable run has an invalid effect count")

            baseline_flow = _request_json(client, "GET", f"/api/v1/flows/{flow_id}")
            baseline_revision = int(baseline_flow["revision"])
            baseline_hash = flow_hash(baseline_flow)

            reject_value = f"Stage10-live-reject-{uuid4().hex[:8]}"
            reject_run_id = str(uuid4())
            reject_prompt = (
                "Use ProposeFlowChanges exactly once. "
                f'targetFlowId="{flow_id}". '
                "Use exactly one operation: "
                '{"op":"set_parameter","nodeId":"TextInput-stage10",'
                f'"parameter":"input_value","value":"{reject_value}"}}. '
                "Do not call any other tool."
            )
            _reject_events, reject_proposal_latency = _post_ag_ui(
                client,
                thread_id=chat_id,
                run_id=reject_run_id,
                project_id=project_id,
                board_id=board_id,
                prompt=reject_prompt,
            )
            rejected = _proposal_for_run(
                args.database_url,
                chat_id=chat_id,
                run_id=reject_run_id,
                flow_id=flow_id,
                expected_value=reject_value,
            )
            reject_resume_run_id = str(uuid4())
            reject_assistants_before = _assistant_count(
                _request_json(client, "GET", f"/api/v1/chats/{chat_id}/messages")
            )
            _reject_resume_events, reject_resume_latency = _post_ag_ui(
                client,
                thread_id=chat_id,
                run_id=reject_resume_run_id,
                project_id=project_id,
                board_id=board_id,
                resume=[
                    {
                        "interruptId": rejected.interrupt_id,
                        "status": "resolved",
                        "payload": {"approved": False},
                    }
                ],
            )
            rejected_after = _proposal_for_id(args.database_url, str(rejected.id))
            flow_after_reject = _request_json(client, "GET", f"/api/v1/flows/{flow_id}")
            reject_assistants_after = _assistant_count(
                _request_json(client, "GET", f"/api/v1/chats/{chat_id}/messages")
            )
            _reject_resume, reject_resume_proposals, reject_resume_assistant_count = _inspect_chat_run(
                args.database_url,
                chat_id=chat_id,
                ag_ui_run_id=reject_resume_run_id,
            )
            if (
                str(rejected_after.status.value) != "rejected"
                or int(flow_after_reject["revision"]) != baseline_revision
                or flow_hash(flow_after_reject) != baseline_hash
                or rejected_after.outcome != {"code": "rejected", "effect": "none"}
                or reject_assistants_after != reject_assistants_before + 1
                or reject_resume_proposals
                or reject_resume_assistant_count != 1
            ):
                raise RuntimeError("rejected live proposal changed state or audit counts")

            approve_value = f"Stage10-live-approve-{uuid4().hex[:8]}"
            approve_run_id = str(uuid4())
            approve_prompt = (
                "Use ProposeFlowChanges exactly once. "
                f'targetFlowId="{flow_id}". '
                "Use exactly one operation: "
                '{"op":"set_parameter","nodeId":"TextInput-stage10",'
                f'"parameter":"input_value","value":"{approve_value}"}}. '
                "Do not call any other tool."
            )
            _approve_events, approve_proposal_latency = _post_ag_ui(
                client,
                thread_id=chat_id,
                run_id=approve_run_id,
                project_id=project_id,
                board_id=board_id,
                prompt=approve_prompt,
            )
            approved = _proposal_for_run(
                args.database_url,
                chat_id=chat_id,
                run_id=approve_run_id,
                flow_id=flow_id,
                expected_value=approve_value,
            )
            if approved.id == rejected.id:
                raise RuntimeError("approve reused the rejected proposal")
            approve_resume_run_id = str(uuid4())
            approve_assistants_before = _assistant_count(
                _request_json(client, "GET", f"/api/v1/chats/{chat_id}/messages")
            )
            _approve_resume_events, approve_resume_latency = _post_ag_ui(
                client,
                thread_id=chat_id,
                run_id=approve_resume_run_id,
                project_id=project_id,
                board_id=board_id,
                resume=[
                    {
                        "interruptId": approved.interrupt_id,
                        "status": "resolved",
                        "payload": {"approved": True},
                    }
                ],
            )
            approved_after = _proposal_for_id(args.database_url, str(approved.id))
            flow_after_approve = _request_json(client, "GET", f"/api/v1/flows/{flow_id}")
            approve_assistants_after = _assistant_count(
                _request_json(client, "GET", f"/api/v1/chats/{chat_id}/messages")
            )
            _approve_resume, approve_resume_proposals, approve_resume_assistant_count = _inspect_chat_run(
                args.database_url,
                chat_id=chat_id,
                ag_ui_run_id=approve_resume_run_id,
            )
            approve_outcome = approved_after.outcome or {}
            if (
                str(approved_after.status.value) != "applied"
                or int(flow_after_approve["revision"]) != baseline_revision + 1
                or flow_hash(flow_after_approve) == baseline_hash
                or approve_outcome.get("beforeRevision") != baseline_revision
                or approve_outcome.get("afterRevision") != baseline_revision + 1
                or approve_assistants_after != approve_assistants_before + 1
                or approve_resume_proposals
                or approve_resume_assistant_count != 1
            ):
                raise RuntimeError("approved live proposal did not produce exactly one effect")
    finally:
        cleanup = _stop_owned_server(process, pgid)
        if cleanup["survivors"]:
            raise RuntimeError("owned Ketos live-smoke process survived cleanup")

    code_sha = _git_sha()
    evidence = {
        "schema": "ketos.stage10.live-ai-smoke.v1",
        "s10_code_sha": code_sha,
        "started_at": started_at,
        "ended_at": utc_now(),
        "verdict": "PASS",
        "provider_adapter": PROVIDER_ADAPTER,
        "provider_upstream": PROVIDER_UPSTREAM,
        "model": LIVE_MODEL,
        "base_url": COMETAPI_BASE_URL,
        "actor_id": actor_id,
        "project_id": project_id,
        "board_id": board_id,
        "chat_id": chat_id,
        "flow_id": flow_id,
        "canonical_saver": str(saver_path) if saver_path else None,
        "direct_preflight": direct,
        "ketos_live": {
            "reply": {
                "run_id": reply_run_id,
                "chat_run_id": str(reply_run.id),
                "request_id": str(reply_run.request_id),
                "latency_ms": reply_latency,
                "assistant_text_sha256": hashlib.sha256(reply_text.encode()).hexdigest(),
                "assistant_text_bytes": len(reply_text.encode()),
                "durable_assistant_commits": 1,
            },
            "reject": {
                "run_id": reject_run_id,
                "resume_run_id": reject_resume_run_id,
                "proposal_id": str(rejected.id),
                "proposal_latency_ms": reject_proposal_latency,
                "resume_latency_ms": reject_resume_latency,
                "revision_before": baseline_revision,
                "revision_after": int(flow_after_reject["revision"]),
                "hash_unchanged": True,
                "flow_effects": 0,
                "durable_assistant_commits": 1,
                "outcome": "rejected",
            },
            "approve": {
                "run_id": approve_run_id,
                "resume_run_id": approve_resume_run_id,
                "proposal_id": str(approved.id),
                "proposal_latency_ms": approve_proposal_latency,
                "resume_latency_ms": approve_resume_latency,
                "revision_before": baseline_revision,
                "revision_after": int(flow_after_approve["revision"]),
                "hash_changed": True,
                "flow_effects": 1,
                "durable_assistant_commits": 1,
                "outcome": "applied",
            },
        },
        "server_process": {
            "pid": process.pid,
            "pgid": pgid,
            "started_at_epoch": process_started,
            "term_sent": cleanup["term_sent"],
            "kill_sent": cleanup["kill_sent"],
            "survivor_count": len(cleanup["survivors"]),
        },
        "secret_file_retained": True,
        "raw_content_retained": False,
    }
    assert_redacted_evidence(evidence)
    write_json_exclusive(evidence_path, evidence)
    return evidence


def _proposal_for_id(database_url: str, proposal_id: str) -> Any:
    from ketos.services.database.models.command_proposal.model import CommandProposal

    engine = create_engine(database_url)
    try:
        with Session(engine) as session:
            proposal = session.get(CommandProposal, UUID(proposal_id))
            if proposal is None:
                raise RuntimeError("command proposal disappeared")
            session.expunge(proposal)
            return proposal
    finally:
        engine.dispose()


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        evidence = _run(args)
    except Exception as exc:
        print(f"BLOCKED: Stage 10 live AI smoke failed: {type(exc).__name__}")
        return 2
    print(
        "PASS "
        f"provider_adapter={evidence['provider_adapter']} "
        f"provider_upstream={evidence['provider_upstream']} "
        f"model={evidence['model']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
