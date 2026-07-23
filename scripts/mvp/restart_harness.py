#!/usr/bin/env python3
# ruff: noqa: EM101, EM102, TRY003
"""Run the Stage-09 real-process restart recovery fixture.

The harness deliberately owns only the two backend process groups it starts.
All mutable state and evidence stay below the caller-provided run root.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import hashlib
import http.cookiejar
import json
import os
import signal
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

REPO_ROOT = Path(__file__).resolve().parents[2]
READY_TIMEOUT_SECONDS = 120.0
STOP_TIMEOUT_SECONDS = 15.0
HTTP_OK = 200
HTTP_CONFLICT = 409
RESTART_PROCESS_COUNT = 2
EXPECTED_TRANSCRIPT_MESSAGES = 2
RECOVERY_CLOSED_DETAIL = "AG-UI recovery decision is no longer open"


class HarnessError(RuntimeError):
    """Fail-closed harness contract error."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _git_head() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],  # noqa: S607 - fixed trusted argv
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def _private_directory(path: Path) -> Path:
    resolved = path.expanduser().resolve(strict=True)
    if not resolved.is_dir():
        raise HarnessError(f"run root is not a directory: {resolved}")
    mode = resolved.stat().st_mode & 0o777
    if mode & 0o077:
        raise HarnessError(f"run root must be private (0700): {resolved} has {mode:04o}")
    if resolved == REPO_ROOT or resolved.is_relative_to(REPO_ROOT):
        raise HarnessError("run root must be outside the repository")
    return resolved


def _owned_path(run_root: Path, candidate: Path) -> Path:
    resolved = candidate.expanduser().resolve(strict=False)
    if not resolved.is_relative_to(run_root):
        raise HarnessError(f"path escapes run root: {resolved}")
    return resolved


def _reserve_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def _listener_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as client:
        client.settimeout(0.25)
        return client.connect_ex(("127.0.0.1", port)) == 0


@dataclass
class BackendProcess:
    process: subprocess.Popen[bytes]
    log_handle: Any
    port: int
    started_at: str
    log_path: Path

    @property
    def pid(self) -> int:
        return self.process.pid


@dataclass(frozen=True)
class AgUiResumeResponse:
    status: int
    events: list[dict[str, Any]]
    error: dict[str, Any] | None


def _start_backend(*, port: int, env: dict[str, str], log_path: Path) -> BackendProcess:
    log_handle = log_path.open("wb")
    command = [
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
    ]
    process = subprocess.Popen(  # noqa: S603 - fixed executable and argv
        command,
        cwd=REPO_ROOT,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    return BackendProcess(process, log_handle, port, _utc_now(), log_path)


def _stop_backend(backend: BackendProcess) -> dict[str, Any]:
    requested_at = _utc_now()
    if backend.process.poll() is None:
        os.killpg(backend.pid, signal.SIGTERM)
        try:
            backend.process.wait(timeout=STOP_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            os.killpg(backend.pid, signal.SIGKILL)
            backend.process.wait(timeout=5)
    exit_code = backend.process.returncode
    deadline = time.monotonic() + 10.0
    while _listener_open(backend.port) and time.monotonic() < deadline:
        time.sleep(0.1)
    listener_closed = not _listener_open(backend.port)
    backend.log_handle.close()
    if not listener_closed:
        raise HarnessError(f"listener remained open after stopping owned PID {backend.pid}")
    return {
        "pid": backend.pid,
        "started_at": backend.started_at,
        "stop_requested_at": requested_at,
        "stopped_at": _utc_now(),
        "exit_code": exit_code,
        "listener_closed": listener_closed,
        "log": backend.log_path.name,
    }


def _wait_ready(backend: BackendProcess) -> None:
    url = f"http://127.0.0.1:{backend.port}/health_check"
    deadline = time.monotonic() + READY_TIMEOUT_SECONDS
    last_error = "not attempted"
    while time.monotonic() < deadline:
        if backend.process.poll() is not None:
            break
        try:
            with urllib.request.urlopen(url, timeout=2) as response:  # noqa: S310 - loopback URL
                if response.status == HTTP_OK:
                    return
                last_error = f"HTTP {response.status}"
        except (OSError, urllib.error.URLError) as exc:
            last_error = str(exc)
        time.sleep(0.25)
    with contextlib.suppress(OSError):
        tail = backend.log_path.read_text(encoding="utf-8", errors="replace")[-8000:]
        last_error = f"{last_error}\n{tail}"
    raise HarnessError(f"backend PID {backend.pid} did not become ready: {last_error}")


class ApiClient:
    def __init__(self, port: int) -> None:
        self.base_url = f"http://127.0.0.1:{port}"
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        self.access_token: str | None = None

    def request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        *,
        expected: tuple[int, ...] = (200,),
    ) -> Any:
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(  # noqa: S310 - fixed loopback origin
            self.base_url + path,
            data=body,
            method=method,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        try:
            with self.opener.open(request, timeout=20) as response:
                status = response.status
                raw = response.read()
        except urllib.error.HTTPError as exc:
            status = exc.code
            raw = exc.read()
        if status not in expected:
            detail = raw.decode("utf-8", errors="replace")[:2000]
            raise HarnessError(f"{method} {path}: expected {expected}, got {status}: {detail}")
        if not raw:
            return None
        return json.loads(raw)

    def authenticate(self) -> str:
        payload = self.request("GET", "/api/v1/auto_login")
        if not isinstance(payload, dict) or not payload.get("access_token"):
            raise HarnessError("auto-login did not return an access token")
        self.access_token = str(payload["access_token"])
        user = self.request("GET", "/api/v1/users/whoami")
        if not isinstance(user, dict) or not user.get("id"):
            raise HarnessError("whoami did not return an actor id")
        return str(user["id"])

    def resume_recovered_interrupt(
        self,
        *,
        chat_id: str,
        project_id: str,
        interrupt_id: str,
        run_id: str,
        expected: tuple[int, ...] = (200,),
    ) -> AgUiResumeResponse:
        if self.access_token is None:
            raise HarnessError("AG-UI resume requires an authenticated access token")
        payload = {
            "threadId": chat_id,
            "runId": run_id,
            "state": {"projectId": project_id},
            "messages": [],
            "tools": [],
            "context": [],
            "forwardedProps": {},
            "resume": [
                {
                    "interruptId": interrupt_id,
                    "status": "resolved",
                    "payload": {"approved": False},
                }
            ],
        }
        request = urllib.request.Request(  # noqa: S310 - fixed loopback origin
            self.base_url + "/api/v1/agentic/ag-ui",
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={
                "Authorization": f"Bearer {self.access_token}",
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310 - loopback URL
                status = response.status
                raw = response.read()
        except urllib.error.HTTPError as exc:
            status = exc.code
            raw = exc.read()
        if status not in expected:
            detail = raw.decode("utf-8", errors="replace")[:2000]
            raise HarnessError(f"AG-UI resume expected {expected}, got {status}: {detail}")
        if status == HTTP_OK:
            events = [
                json.loads(line.removeprefix("data: "))
                for line in raw.decode("utf-8").splitlines()
                if line.startswith("data: ")
            ]
            return AgUiResumeResponse(status=status, events=events, error=None)
        try:
            error = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise HarnessError(f"AG-UI resume HTTP {status} did not return JSON") from exc
        if not isinstance(error, dict):
            raise HarnessError(f"AG-UI resume HTTP {status} error is not an object")
        return AgUiResumeResponse(status=status, events=[], error=error)


def _seed_real_api(client: ApiClient, *, actor_id: str) -> dict[str, str]:
    suffix = uuid4().hex[:12]
    project = client.request(
        "POST",
        "/api/v1/projects/",
        {"name": f"stage09-restart-{suffix}", "description": "Stage 09 restart fixture"},
        expected=(201,),
    )
    project_id = str(project["id"])
    board = client.request(
        "POST",
        f"/api/v1/projects/{project_id}/boards",
        {"title": "Restart recovery board"},
        expected=(201,),
    )
    chat = client.request(
        "POST",
        f"/api/v1/projects/{project_id}/chats",
        {
            "title": "Restart recovery chat",
            "provider": "OpenAI",
            "model_name": "gpt-5.4",
            "context_policy": "board",
        },
        expected=(201,),
    )
    flow = client.request(
        "POST",
        "/api/v1/flows/",
        {
            "name": f"Stage 09 recovery flow {suffix}",
            "description": "Restart recovery fixture",
            "folder_id": project_id,
            "data": {"nodes": [], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 1}},
        },
        expected=(201,),
    )
    automation_placement = client.request(
        "POST",
        f"/api/v1/boards/{board['id']}/placements",
        {
            "target_kind": "automation",
            "target_id": str(flow["id"]),
            "x": 560,
            "y": 180,
            "width": 420,
            "height": 320,
            "z_index": 4,
        },
        expected=(201,),
    )
    note_response = client.request(
        "POST",
        f"/api/v1/boards/{board['id']}/board-notes",
        {
            "content": "authoritative server state",
            "color": "neutral",
            "placement": {"x": 160, "y": 240, "width": 320, "height": 240, "z_index": 7},
        },
        expected=(201,),
    )
    ag_ui_health = client.request("GET", "/api/v1/agentic/ag-ui/health")
    if not isinstance(ag_ui_health, dict):
        raise HarnessError("AG-UI health response is not an object")
    return {
        "actor_id": actor_id,
        "project_id": project_id,
        "board_id": str(board["id"]),
        "chat_id": str(chat["id"]),
        "flow_id": str(flow["id"]),
        "automation_placement_id": str(automation_placement["id"]),
        "note_id": str(note_response["note"]["id"]),
        "placement_id": str(note_response["placement"]["id"]),
    }


def _activate_fixture_environment(env: dict[str, str]) -> None:
    for key, value in env.items():
        if key.startswith(("KETOS_", "LANGGRAPH_", "DO_NOT_TRACK")):
            os.environ[key] = value


async def _seed_durable_recovery_fixture(*, data_dir: Path, ids: dict[str, str]) -> dict[str, str]:
    """Create committed transcript and one exact open command interrupt.

    Base entity identity is created through authenticated HTTP. This narrow
    fixture then uses the same production services and public saver API that
    the backend uses; it never writes SQLite tables directly.
    """
    from ketos.agentic.persistence.checkpointer import open_mvp_checkpointer
    from ketos.services.chat_threads.message_adapter import append_user_message, commit_assistant_message
    from ketos.services.chat_threads.repository import claim_chat_run
    from ketos.services.commands.contracts import CommandProposalSpec
    from ketos.services.commands.proposal_service import bind_interrupt, ensure_proposal
    from ketos.services.commands.recovery import CommandCheckpointInspector
    from ketos.services.database.models.chat_thread.model import ChatRun, ChatRunStatus
    from ketos.services.database.models.command_proposal.model import (
        CommandProposalCommandType,
        CommandProposalSourceKind,
    )
    from ketos.services.deps import get_db_service
    from ketos.services.jobs.board_claim import claim_board_job
    from langgraph.graph import END, START, StateGraph
    from langgraph.types import Interrupt, interrupt
    from sqlalchemy import update

    actor_id = UUID(ids["actor_id"])
    project_id = UUID(ids["project_id"])
    chat_id = UUID(ids["chat_id"])
    fingerprint = hashlib.sha256(b"stage09-completed-run").hexdigest()
    database_service = get_db_service()
    job_claim = await claim_board_job(
        actor_id=actor_id,
        board_id=UUID(ids["board_id"]),
        flow_id=UUID(ids["flow_id"]),
        idempotency_key="stage09-restart-job",
        flow_hash="a" * 64,
        policy_version=1,
        worker_instance_id_provider=uuid4,
    )
    async with database_service.async_session_maker() as session:
        completed_claim = await claim_chat_run(
            session,
            chat_id=chat_id,
            actor_id=actor_id,
            ag_ui_run_id="stage09-completed-run",
            idempotency_key="run:stage09-completed-run",
            request_fingerprint=fingerprint,
        )
        await append_user_message(
            session,
            chat_id=chat_id,
            chat_run_id=completed_claim.run.id,
            actor_id=actor_id,
            text="Persist this exact transcript across restart.",
        )
        await commit_assistant_message(
            session,
            chat_id=chat_id,
            chat_run_id=completed_claim.run.id,
            actor_id=actor_id,
            text="Transcript committed before PID-1 stopped.",
        )
        await session.exec(
            update(ChatRun)
            .where(ChatRun.id == completed_claim.run.id)
            .values(status=ChatRunStatus.SUCCEEDED, outcome="success")
        )
        await session.commit()

        pending_claim = await claim_chat_run(
            session,
            chat_id=chat_id,
            actor_id=actor_id,
            ag_ui_run_id="stage09-pending-run",
            idempotency_key="run:stage09-pending-run",
            request_fingerprint=hashlib.sha256(b"stage09-pending-run").hexdigest(),
        )
        await session.exec(
            update(ChatRun).where(ChatRun.id == pending_claim.run.id).values(status=ChatRunStatus.RUNNING)
        )
        canonical_payload = {
            "name": "Stage 09 recovered flow",
            "description": "Rejected restart fixture",
            "data": {"nodes": [], "edges": []},
        }
        result_hash = hashlib.sha256(
            json.dumps(canonical_payload, separators=(",", ":"), sort_keys=True).encode()
        ).hexdigest()
        proposal = await ensure_proposal(
            session,
            CommandProposalSpec(
                actor_id=actor_id,
                project_id=project_id,
                source_kind=CommandProposalSourceKind.AI_RUN,
                chat_run_id=pending_claim.run.id,
                thread_id=str(chat_id),
                source_proposal_id=None,
                flow_id=uuid4(),
                command_type=CommandProposalCommandType.CREATE_FLOW,
                canonical_payload=canonical_payload,
                preview={"title": "Create Stage 09 recovered flow"},
                result_flow_hash=result_hash,
                idempotency_key="stage09-pending-proposal",
                request_fingerprint=hashlib.sha256(b"stage09-pending-proposal").hexdigest(),
                request_id="stage09-pending-proposal",
                redacted_audit={"fixture": "stage09"},
            ),
        )
        await session.commit()

    initial_value = {
        "reason": "confirmation",
        "message": "Confirm durable Stage 09 fixture",
        "responseSchema": {
            "type": "object",
            "properties": {"approved": {"type": "boolean"}},
            "required": ["approved"],
            "additionalProperties": False,
        },
        "metadata": {
            "type": "ketos.flow-command-confirmation.v1",
            "proposalId": str(proposal.id),
            "proposalHash": proposal.proposal_hash,
            "preview": {
                "before": {
                    "revision": None,
                    "hash": None,
                    "node_count": 0,
                    "edge_count": 0,
                },
                "after": {
                    "revision": 1,
                    "hash": result_hash,
                    "node_count": 0,
                    "edge_count": 0,
                },
                "operationSummaries": [
                    {
                        "index": 0,
                        "op": "create_flow",
                        "status": "applied",
                        "summary": "Create Stage 09 recovered flow",
                        "affectedNodeIds": [],
                        "affectedEdges": [],
                    }
                ],
                "warnings": [],
                "risk": "low",
                "canRestore": True,
            },
        },
    }

    def wait_for_confirmation(_state: dict[str, Any]) -> dict[str, Any]:
        interrupt(initial_value)
        return {}

    builder = StateGraph(dict)
    builder.add_node("stage09_confirmation", wait_for_confirmation)
    builder.add_edge(START, "stage09_confirmation")
    builder.add_edge("stage09_confirmation", END)
    async with open_mvp_checkpointer(data_dir) as saver:
        graph = builder.compile(checkpointer=saver)
        config = {"configurable": {"thread_id": str(chat_id)}}
        await graph.ainvoke({}, config=config)
        checkpoint_tuple = await saver.aget_tuple(config)
        if checkpoint_tuple is None:
            raise HarnessError("fixture graph did not persist a checkpoint")
        pending_writes = tuple(checkpoint_tuple.pending_writes or ())
        interrupt_writes = [write for write in pending_writes if write[1] == "__interrupt__"]
        if len(interrupt_writes) != 1:
            raise HarnessError("fixture graph did not persist exactly one interrupt write")
        task_id, _channel, values = interrupt_writes[0]
        open_interrupt = values[0]
        if not isinstance(open_interrupt, Interrupt):
            raise HarnessError("fixture graph persisted a non-standard interrupt")
        async with database_service.async_session_maker() as session:
            proposal = await bind_interrupt(
                session,
                proposal_id=proposal.id,
                chat_run_id=pending_claim.run.id,
                thread_id=str(chat_id),
                interrupt_id=open_interrupt.id,
            )
            await session.commit()
        final_value = dict(initial_value)
        final_value["metadata"] = {**initial_value["metadata"], "proposalHash": proposal.proposal_hash}
        await saver.aput_writes(
            checkpoint_tuple.config,
            [("__interrupt__", (Interrupt(value=final_value, id=open_interrupt.id),))],
            task_id,
        )
        async with database_service.async_session_maker() as session:
            proof = await CommandCheckpointInspector().require_exact(
                saver,
                thread_id=str(chat_id),
                proposal=proposal,
            )
    return {
        "completed_chat_run_id": str(completed_claim.run.id),
        "pending_chat_run_id": str(pending_claim.run.id),
        "proposal_id": str(proposal.id),
        "interrupt_id": proof.interrupt_id,
        "proposal_hash": proof.proposal_hash,
        "job_id": str(job_claim.job.job_id),
    }


def _read_ledger(client: ApiClient, ids: dict[str, str]) -> dict[str, Any]:
    board = client.request("GET", f"/api/v1/boards/{ids['board_id']}")
    chat = client.request("GET", f"/api/v1/chats/{ids['chat_id']}")
    messages = client.request("GET", f"/api/v1/chats/{ids['chat_id']}/messages")
    note = client.request("GET", f"/api/v1/board-notes/{ids['note_id']}")
    placements = client.request("GET", f"/api/v1/boards/{ids['board_id']}/placements")
    client.request("GET", "/api/v1/agentic/ag-ui/health")
    return {
        "ids": ids,
        "board": {"id": str(board["id"]), "revision": board["revision"], "title": board["title"]},
        "chat": {"id": str(chat["id"]), "revision": chat["revision"], "title": chat["title"]},
        "note": {"id": str(note["id"]), "revision": note["revision"], "content": note["content"]},
        "placements": [
            {
                "id": str(item["id"]),
                "target_id": str(item["target_id"]),
                "x": item["x"],
                "y": item["y"],
                "z_index": item["z_index"],
            }
            for item in placements
        ],
        "messages": messages,
    }


def _row_counts(database: Path) -> dict[str, int]:
    tables = ("folder", "board", "chat_thread", "chat_run", "message", "command_proposal", "job", "placement")
    counts: dict[str, int] = {}
    uri = f"file:{database.as_posix()}?mode=ro"
    with sqlite3.connect(uri, uri=True) as connection:
        existing = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for table in tables:
            counts[table] = (
                int(connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])  # noqa: S608
                if table in existing
                else 0
            )
    return counts


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--code-sha", required=True)
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--json-out", type=Path, required=True)
    return parser.parse_args(argv)


def run(args: argparse.Namespace) -> dict[str, Any]:
    head = _git_head()
    if args.code_sha != head:
        raise HarnessError(f"code SHA mismatch: expected current HEAD {head}, got {args.code_sha}")
    run_root = _private_directory(args.run_root)
    json_out = _owned_path(run_root, args.json_out)
    directories = {name: run_root / name for name in ("data", "config", "tmp", "logs", "process")}
    for directory in directories.values():
        directory.mkdir(mode=0o700, exist_ok=True)
        directory.chmod(0o700)
    json_out.parent.mkdir(mode=0o700, parents=True, exist_ok=True)

    database = directories["data"] / "ketos.db"
    checkpoint = directories["data"] / "mvp" / "langgraph-checkpoints.sqlite3"
    binding = directories["data"] / "mvp" / "run-bindings.ledger"
    env = dict(os.environ)
    env.update(
        {
            "KETOS_DATABASE_URL": f"sqlite:///{database}",
            "KETOS_CONFIG_DIR": str(directories["config"]),
            "KETOS_DATA_DIR": str(directories["data"]),
            "KETOS_TEMP_DIR": str(directories["tmp"]),
            "KETOS_AG_UI_BINDING_DB": str(binding),
            "KETOS_AUTO_LOGIN": "true",
            "KETOS_DEACTIVATE_TRACING": "true",
            "KETOS_FEATURE_MVP_WORKSPACE": "true",
            "KETOS_FEATURE_MVP_CHAT": "true",
            "KETOS_AGENTIC_EXPERIENCE": "true",
            "KETOS_LOG_LEVEL": "ERROR",
            "LANGGRAPH_STRICT_MSGPACK": "true",
            "DO_NOT_TRACK": "true",
            "PYTHONDONTWRITEBYTECODE": "1",
        }
    )
    _activate_fixture_environment(env)

    port = _reserve_loopback_port()
    process_records: list[dict[str, Any]] = []
    active: BackendProcess | None = None
    try:
        active = _start_backend(port=port, env=env, log_path=directories["logs"] / "backend-pid1.log")
        _wait_ready(active)
        client1 = ApiClient(port)
        actor_id = client1.authenticate()
        ids = _seed_real_api(client1, actor_id=actor_id)
        ids.update(asyncio.run(_seed_durable_recovery_fixture(data_dir=directories["data"], ids=ids)))
        before_ledger = _read_ledger(client1, ids)
        before_proposal = client1.request("GET", f"/api/v1/command-proposals/{ids['proposal_id']}")
        if before_proposal["status"] != "awaiting_confirmation":
            raise HarnessError("proposal was not pending before PID-1 stopped")
        if not database.is_file() or not checkpoint.is_file():
            raise HarnessError("backend did not create both canonical database files")
        before = {
            "database_sha256": _sha256(database),
            "checkpoint_sha256": _sha256(checkpoint),
            "row_counts": _row_counts(database),
            "ledger": before_ledger,
        }
        process_records.append(_stop_backend(active))
        pid1 = active.pid
        active = None

        active = _start_backend(port=port, env=env, log_path=directories["logs"] / "backend-pid2.log")
        _wait_ready(active)
        pid2 = active.pid
        if pid1 == pid2:
            raise HarnessError("backend PID did not change")
        client2 = ApiClient(port)
        client2.authenticate()
        after_ledger = _read_ledger(client2, ids)
        if before_ledger != after_ledger:
            raise HarnessError("persistent entity ledger changed across restart")
        job_history = client2.request(
            "GET",
            f"/api/v1/boards/{ids['board_id']}/automations/{ids['flow_id']}/runs",
        )
        recovered_job = [item for item in job_history if str(item.get("job_id")) == ids["job_id"]]
        if (
            len(recovered_job) != 1
            or recovered_job[0].get("status") != "failed"
            or recovered_job[0].get("reason") != "backend_restarted"
        ):
            raise HarnessError("prior-process Board Job did not recover once with backend_restarted")

        def concurrent_resume(run_id: str) -> AgUiResumeResponse:
            concurrent_client = ApiClient(port)
            concurrent_client.authenticate()
            return concurrent_client.resume_recovered_interrupt(
                chat_id=ids["chat_id"],
                project_id=ids["project_id"],
                interrupt_id=ids["interrupt_id"],
                run_id=run_id,
                expected=(200, 409),
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            concurrent_results = tuple(
                pool.map(concurrent_resume, ("stage09-recovery-race-a", "stage09-recovery-race-b"))
            )
        finished = [
            event for response in concurrent_results for event in response.events if event.get("type") == "RUN_FINISHED"
        ]
        winners = [response for response in concurrent_results if response.status == HTTP_OK]
        losers = [response for response in concurrent_results if response.status == HTTP_CONFLICT]
        if (
            len(winners) != 1
            or len(losers) != 1
            or losers[0].error != {"detail": RECOVERY_CLOSED_DETAIL}
            or len(finished) != 1
            or finished[0].get("result", {}).get("status") != "rejected"
        ):
            diagnostic = [
                {
                    "status": response.status,
                    "error": response.error,
                    "events": [
                        {
                            "type": event.get("type"),
                            "result_status": (
                                event.get("result", {}).get("status")
                                if isinstance(event.get("result"), dict)
                                else None
                            ),
                        }
                        for event in response.events
                    ],
                }
                for response in concurrent_results
            ]
            raise HarnessError(
                "concurrent AG-UI resumes did not finish exactly one recovered "
                f"rejection: {json.dumps(diagnostic, sort_keys=True)}"
            )
        replay_response = client2.resume_recovered_interrupt(
            chat_id=ids["chat_id"],
            project_id=ids["project_id"],
            interrupt_id=ids["interrupt_id"],
            run_id="stage09-recovery-replay",
            expected=(409,),
        )
        after_proposal = client2.request("GET", f"/api/v1/command-proposals/{ids['proposal_id']}")
        if (
            replay_response.status != HTTP_CONFLICT
            or replay_response.events
            or replay_response.error != {"detail": RECOVERY_CLOSED_DETAIL}
            or after_proposal["status"] != "rejected"
        ):
            raise HarnessError("recovered proposal was not rejected exactly once")
        after = {
            "database_sha256": _sha256(database),
            "checkpoint_sha256": _sha256(checkpoint),
            "row_counts": _row_counts(database),
            "ledger": after_ledger,
        }
        if before["row_counts"] != after["row_counts"]:
            raise HarnessError("persistent row counts changed across restart")
        process_records.append(_stop_backend(active))
        active = None
    finally:
        if active is not None:
            with contextlib.suppress(ProcessLookupError, subprocess.TimeoutExpired, HarnessError):
                process_records.append(_stop_backend(active))

    result = {
        "schema_version": 1,
        "status": "pass",
        "code_sha": head,
        "recorded_at": _utc_now(),
        "port": port,
        "processes": process_records,
        "pid_changed": len(process_records) >= RESTART_PROCESS_COUNT
        and process_records[0]["pid"] != process_records[1]["pid"],
        "files": {
            "database": database.name,
            "checkpoint": checkpoint.name,
            "database_path": str(database.relative_to(run_root)),
            "checkpoint_path": str(checkpoint.relative_to(run_root)),
        },
        "before": before,
        "after": after,
        "persistent_ids": ids,
        "outcomes": {
            "listener_pid1_closed": bool(process_records[0]["listener_closed"]),
            "same_database_path": True,
            "same_checkpoint_path": True,
            "same_entity_ledger": before_ledger == after_ledger,
            "same_row_counts": before["row_counts"] == after["row_counts"],
            "ag_ui_health_after_restart": True,
            "committed_transcript_replayed": len(after_ledger["messages"]) == EXPECTED_TRANSCRIPT_MESSAGES,
            "pending_proposal_recovered": before_proposal["status"] == "awaiting_confirmation",
            "pending_proposal_resolved_once": after_proposal["status"] == "rejected",
            "concurrent_resume_single_winner": len(finished) == 1,
            "concurrent_resume_exact_statuses": sorted(response.status for response in concurrent_results)
            == [200, 409],
            "concurrent_resume_loser_fail_closed": losers[0].error == {"detail": RECOVERY_CLOSED_DETAIL},
            "replay_rejected_fail_closed": replay_response.error == {"detail": RECOVERY_CLOSED_DETAIL},
            "prior_process_job_recovered_once": len(recovered_job) == 1,
            "job_reason_backend_restarted": recovered_job[0]["reason"] == "backend_restarted",
        },
    }
    temp_output = json_out.with_suffix(json_out.suffix + ".tmp")
    temp_output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temp_output.replace(json_out)
    return result


def main(argv: list[str] | None = None) -> int:
    try:
        result = run(_parse_args(sys.argv[1:] if argv is None else argv))
    except (HarnessError, OSError, subprocess.CalledProcessError, sqlite3.Error) as exc:
        print(f"restart harness failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({"status": result["status"], "pids": [item["pid"] for item in result["processes"]]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
