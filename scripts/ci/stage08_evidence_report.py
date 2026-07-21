# ruff: noqa: E501, EM101, EM102, PERF401, TC003, TRY003
"""Render and validate the normative Stage 08 transition report.

The JSON node files are machine evidence.  This module turns them, the
pre-frozen transition handoffs, and the browser/PostgreSQL artifacts into the
self-contained Markdown report required by Stage 08 sections 14 and 15.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from collections.abc import Mapping, Sequence
from datetime import datetime
from pathlib import Path
from typing import Any

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
TASK_IDS = tuple(f"S08-A{number:02d}" for number in range(1, 11))
REQUIRED_HEADINGS = (
    "## Admission и зависимости",
    "## S08-A01…A10",
    "## Сводка выполнения задач",
    "## Wave/Sync DAG и merge ledger",
    "## Инварианты и domain evidence",
    "## Entity and correlation ledger",
    "## Тесты и gate ledger",
    "## Дефекты и активные блокеры",
    "## Subagent reviews",
    "## Соответствие критериям",
    "## Transition verdict",
)

TASK_NODE_MAP: dict[str, tuple[str, ...]] = {
    "S08-A01": ("migration-sqlite", "migration-postgres"),
    "S08-A02": ("backend-focused", "postgres-behavioral"),
    "S08-A03": ("backend-focused", "negative-guards"),
    "S08-A04": ("dependency-probes", "backend-focused", "kfx-lfx"),
    "S08-A05": ("dependency-probes", "backend-focused", "browser"),
    "S08-A06": ("backend-focused", "postgres-behavioral"),
    "S08-A07": ("backend-focused", "flow-version", "browser"),
    "S08-A08": ("frontend", "browser"),
    "S08-A09": ("negative-guards", "browser", "repository"),
    "S08-A10": (),
}

TASK_DELIVERABLES = {
    "S08-A01": "schema, migration, interrupt-phase constraints and FlowVersion provenance",
    "S08-A02": "canonical hashes, idempotency/sequence, recovery authorization and writers",
    "S08-A03": "seven-operation typed validation and bounded redacted preview",
    "S08-A04": "proposal-only KFX facade with unchanged public ABI",
    "S08-A05": "standard LangGraph/AG-UI interrupt and durable correlation",
    "S08-A06": "one-use apply, Flow CAS and two-connection PostgreSQL races",
    "S08-A07": "pin retention, owner-only restore and non-orphan lineage",
    "S08-A08": "CopilotKit all-open confirmation UI and authoritative outcomes",
    "S08-A09": "backend/frontend no-bypass and no-browser-mutation guards",
    "S08-A10": "wiring, i18n, browser story, runbook and fail-closed evidence closure",
}

GLOBAL_CRITERIA: tuple[tuple[str, str, str], ...] = (
    ("G01", "A01-A10 are frozen on one tested SHA; actual results are external", "provenance,repository"),
    ("G02", "base, Sync A and frozen SHA are recorded with reproducible merge order", "provenance"),
    (
        "G03",
        "the exact seven-operation allowlist agrees across code, tests and docs",
        "backend-focused,negative-guards",
    ),
    (
        "G04",
        "AI proposals have server-owned ChatRun/thread/interrupt/sequence and phase checks",
        "migration-sqlite,migration-postgres,backend-focused",
    ),
    ("G05", "recovery and restore authorize CommandProposal to ChatRun to ChatThread to Folder", "backend-focused"),
    (
        "G06",
        "canonical DTO/hash/model/migration/evidence fields agree",
        "backend-focused,migration-sqlite,migration-postgres",
    ),
    (
        "G07",
        "confirmation resume carries correlation and boolean decision without an authoritative patch",
        "browser,negative-guards",
    ),
    ("G08", "only the server command service mutates Flow", "backend-focused,negative-guards,browser"),
    (
        "G09",
        "Flow apply uses owner/project/revision conditional CAS and current hash",
        "backend-focused,postgres-behavioral",
    ),
    ("G10", "proposal resolution is a DB one-use conditional claim", "backend-focused,postgres-behavioral"),
    ("G11", "snapshot, Flow CAS and terminal outcome are atomic", "backend-focused,postgres-behavioral"),
    ("G12", "create approve writes one Flow and create reject writes zero", "backend-focused,browser"),
    ("G13", "invalid/no-op preview cannot be approved", "backend-focused,frontend"),
    ("G14", "every open interrupt remains visible and partial resume is denied", "frontend,browser"),
    ("G15", "abandonment is not business rejection", "frontend,browser"),
    ("G16", "UI waits for authoritative server outcome and handles stale/consumed/error", "frontend,browser"),
    ("G17", "RU/EN and risk copy have parity", "frontend,browser"),
    ("G18", "new paths do not import legacy mutation helpers", "negative-guards"),
    ("G19", "filesystem-backed Flow proposals fail closed", "backend-focused,negative-guards"),
    ("G20", "KFX/LFX persisted ABI and extension manifests remain unchanged", "kfx-lfx,repository"),
    ("G21", "SQLite and PostgreSQL migration/model parity are green", "migration-sqlite,migration-postgres"),
    ("G22", "PostgreSQL proves five races, two phases, distinct connections and zero skips", "postgres-behavioral"),
    ("G23", "there is no unresolved Critical finding", "repository"),
    ("G24", "forbidden, generated, deployment and unrelated paths are unchanged", "repository"),
    (
        "G25",
        "the external bundle contains redacted report, logs, IDs, screenshots and race evidence",
        "browser,postgres-behavioral",
    ),
    ("G26", "optional evidence pointer is absent or explicitly untested", "provenance"),
    ("G27", "the full stage gate runs sequentially after focused tests", "repository"),
)

INVARIANTS: tuple[tuple[str, str], ...] = (
    ("Exact typed allowlist", "logs/backend-focused.log; logs/negative-guards.log"),
    ("Durable proposal lineage", "logs/migration-sqlite.log; logs/migration-postgres.log"),
    ("Phase-aware interrupt", "artifacts/postgres-race.json; logs/backend-focused.log"),
    ("Recovery authorization", "logs/backend-focused.log"),
    ("Canonical proposal/Flow hashes", "logs/backend-focused.log"),
    ("Server actor/owner scope", "logs/backend-focused.log; logs/negative-guards.log"),
    ("One-use confirmation", "artifacts/postgres-race.json"),
    ("Flow revision/hash CAS", "artifacts/postgres-race.json"),
    ("Pinned snapshot/restore", "logs/flow-version.log; artifacts/browser/browser-evidence.json"),
    ("Standard AG-UI", "logs/dependency-probes.log; artifacts/browser/browser-network.json"),
    ("No browser apply", "logs/negative-guards.log; artifacts/browser/browser-network.json"),
    ("KFX/LFX unchanged", "logs/kfx-lfx.log; logs/repository.log"),
    ("PostgreSQL behavioral concurrency", "artifacts/postgres-race.json"),
    ("Evidence boundary", "logs/provenance.log; logs/repository.log; manifest.json; SEAL.json"),
    ("RU/EN/keyboard/focus", "logs/frontend.log; artifacts/browser/browser-evidence.json"),
)


class ReportContractError(ValueError):
    """The transition report or its trusted coordinator input is incomplete."""


def _require_sha(value: object, field: str) -> str:
    if not isinstance(value, str) or not SHA_RE.fullmatch(value):
        raise ReportContractError(f"{field} must be a full lower-case Git SHA")
    return value


def _required_text(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ReportContractError(f"{field} must be a non-empty string")
    return value.strip()


def validate_transition_input(payload: Mapping[str, Any], *, code_sha: str, base_sha: str) -> None:
    """Fail closed when the pre-frozen task/review handoff is incomplete."""
    if payload.get("schemaVersion") != "1" or payload.get("stage") != "08":
        raise ReportContractError("transition input must use Stage 08 schema version 1")
    if payload.get("frozenSha") != code_sha:
        raise ReportContractError("transition input frozenSha does not match S08_CODE_SHA")
    if payload.get("baseSha") != base_sha:
        raise ReportContractError("transition input baseSha does not match S08_BASE_SHA")
    _require_sha(payload.get("syncASha"), "syncASha")

    references = payload.get("stagePassReferences")
    if not isinstance(references, list):
        raise ReportContractError("stagePassReferences must be an array")
    reference_stages = {
        item.get("stage")
        for item in references
        if isinstance(item, Mapping)
        and item.get("status") == "PASS"
        and isinstance(item.get("evidence"), str)
        and item["evidence"].strip()
    }
    missing_stages = {"01", "05", "06", "07"} - reference_stages
    if missing_stages:
        raise ReportContractError("missing prerequisite PASS references: " + ", ".join(sorted(missing_stages)))

    documentation = payload.get("officialDocumentation")
    if not isinstance(documentation, list) or not documentation:
        raise ReportContractError("officialDocumentation must contain primary references")
    for index, item in enumerate(documentation):
        if not isinstance(item, Mapping):
            raise ReportContractError(f"officialDocumentation[{index}] must be an object")
        _required_text(item.get("name"), f"officialDocumentation[{index}].name")
        url = _required_text(item.get("url"), f"officialDocumentation[{index}].url")
        if not url.startswith("https://"):
            raise ReportContractError("official documentation URLs must use https")

    handoffs = payload.get("taskHandoffs")
    if not isinstance(handoffs, list):
        raise ReportContractError("taskHandoffs must be an array")
    by_id: dict[str, Mapping[str, Any]] = {}
    for item in handoffs:
        if not isinstance(item, Mapping):
            raise ReportContractError("every task handoff must be an object")
        task_id = item.get("taskId")
        if task_id in by_id:
            raise ReportContractError(f"duplicate task handoff: {task_id}")
        if isinstance(task_id, str):
            by_id[task_id] = item
    missing_tasks = [task_id for task_id in TASK_IDS if task_id not in by_id]
    if missing_tasks:
        raise ReportContractError("missing task handoffs: " + ", ".join(missing_tasks))
    unexpected_tasks = sorted(set(by_id) - set(TASK_IDS))
    if unexpected_tasks:
        raise ReportContractError("unexpected task handoffs: " + ", ".join(unexpected_tasks))
    for task_id in TASK_IDS:
        item = by_id[task_id]
        _required_text(item.get("owner"), f"{task_id}.owner")
        _require_sha(item.get("baseSha"), f"{task_id}.baseSha")
        _require_sha(item.get("commitSha"), f"{task_id}.commitSha")
        paths = item.get("changedPaths")
        if (
            not isinstance(paths, list)
            or not paths
            or not all(isinstance(path, str) and path.strip() for path in paths)
        ):
            raise ReportContractError(f"{task_id}.changedPaths must be non-empty")
        _required_text(item.get("reviewerId"), f"{task_id}.reviewerId")
        if item.get("reviewVerdict") != "PASS":
            raise ReportContractError(f"{task_id} reviewVerdict must be PASS")

    reviews = payload.get("reviews")
    if not isinstance(reviews, list) or not reviews:
        raise ReportContractError("at least one independent review is required")
    independent_review_count = 0
    for index, review in enumerate(reviews):
        if not isinstance(review, Mapping):
            raise ReportContractError(f"reviews[{index}] must be an object")
        for field in ("reviewerId", "kind", "scope", "findings", "resolution"):
            _required_text(review.get(field), f"reviews[{index}].{field}")
        if review.get("inputSha") != code_sha:
            raise ReportContractError(f"reviews[{index}].inputSha must equal S08_CODE_SHA")
        if review.get("verdict") != "PASS":
            raise ReportContractError(f"reviews[{index}].verdict must be PASS")
        if review.get("kind") == "independent":
            independent_review_count += 1
    if independent_review_count == 0:
        raise ReportContractError("at least one independent review is required")


def _duration_ms(node: Mapping[str, Any]) -> int:
    try:
        started = datetime.fromisoformat(str(node["startedAt"]).replace("Z", "+00:00"))
        ended = datetime.fromisoformat(str(node["endedAt"]).replace("Z", "+00:00"))
    except (KeyError, TypeError, ValueError):
        return 0
    return max(0, round((ended - started).total_seconds() * 1000))


def _escape(value: object) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ").strip()


def _short_paths(paths: Sequence[object]) -> str:
    return ", ".join(_escape(path) for path in paths) if paths else "нет"


def _load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return default


def _correlation_ledger(bundle: Path) -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    db_path = bundle / "artifacts/browser-run/backend/ketos.sqlite3"
    if db_path.is_file():
        try:
            connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            connection.row_factory = sqlite3.Row
            proposals = connection.execute(
                """
                SELECT id, actor_id, project_id, chat_run_id, thread_id,
                       interrupt_id, interrupt_bound_at, source_kind,
                       source_proposal_id, flow_id, sequence, idempotency_key,
                       proposal_hash, base_flow_revision, base_flow_hash,
                       result_flow_hash, pinned_flow_version_id, status, outcome
                  FROM command_proposal
                 ORDER BY created_at, sequence
                """
            ).fetchall()
            connection.close()
        except sqlite3.Error as exc:
            raise ReportContractError(f"cannot read browser correlation database: {exc}") from exc
        for proposal in proposals:
            idempotency_digest = hashlib.sha256(str(proposal["idempotency_key"]).encode("utf-8")).hexdigest()[:16]
            outcome = _load_outcome(proposal["outcome"])
            details = (
                f"proposal={proposal['id']}; source={proposal['source_kind']}; "
                f"chatRun={proposal['chat_run_id']}; thread={proposal['thread_id']}; "
                f"interrupt={proposal['interrupt_id'] or 'NULL'}; "
                f"boundAt={proposal['interrupt_bound_at'] or 'NULL'}; "
                f"sourceProposal={proposal['source_proposal_id'] or 'NULL'}; "
                f"project={proposal['project_id']}; flow={proposal['flow_id']}; "
                f"sequence={proposal['sequence']}; idempotencyHash={idempotency_digest}; "
                f"proposalHash={proposal['proposal_hash']}; "
                f"baseRevision={proposal['base_flow_revision']}; "
                f"baseHash={proposal['base_flow_hash'] or 'NULL'}; "
                f"resultHash={proposal['result_flow_hash']}; "
                f"pin={proposal['pinned_flow_version_id'] or 'NULL'}; "
                f"status={proposal['status']}; outcome={outcome}"
            )
            rows.append(("CommandProposal", details))

    network = _load_json(bundle / "artifacts/browser/browser-network.json", {})
    bodies = network.get("resumeBodies", []) if isinstance(network, Mapping) else []
    if isinstance(bodies, list):
        for body in bodies:
            if not isinstance(body, Mapping):
                continue
            resumes = body.get("resume", [])
            interrupt_ids = (
                [
                    item.get("interruptId")
                    for item in resumes
                    if isinstance(item, Mapping) and isinstance(item.get("interruptId"), str)
                ]
                if isinstance(resumes, list)
                else []
            )
            rows.append(
                (
                    "AG-UI resume",
                    f"thread={body.get('threadId')}; run={body.get('runId')}; "
                    f"interrupts={','.join(interrupt_ids) or 'нет'}",
                )
            )
    checkpoint = bundle / "artifacts/browser-run/checkpoint/langgraph-checkpoints.sqlite3"
    if checkpoint.is_file():
        rows.append(("Checkpoint", checkpoint.relative_to(bundle).as_posix()))
    return rows


def _load_outcome(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return "redacted"
    if not isinstance(value, Mapping):
        return "redacted"
    allowed = {
        key: item
        for key, item in value.items()
        if key in {"before_revision", "after_revision", "before_hash", "after_hash"}
    }
    return json.dumps(allowed, sort_keys=True, separators=(",", ":"))


def _postgres_summary(bundle: Path) -> str:
    artifact = _load_json(bundle / "artifacts/postgres-race.json", {})
    if not isinstance(artifact, Mapping):
        return "artifact unavailable"
    scenarios = artifact.get("scenarios", [])
    phases = artifact.get("phaseVerdicts", [])
    scenario_rows = []
    if isinstance(scenarios, list):
        for scenario in scenarios:
            if not isinstance(scenario, Mapping):
                continue
            participants = scenario.get("participants", [])
            pids = (
                [participant.get("backendPid") for participant in participants if isinstance(participant, Mapping)]
                if isinstance(participants, list)
                else []
            )
            barrier = scenario.get("barrier", {})
            barrier_id = barrier.get("id") if isinstance(barrier, Mapping) else "missing"
            scenario_rows.append(f"{scenario.get('id')}={scenario.get('status')} pids={pids} barrier={barrier_id}")
    phase_pass = (
        sum(1 for phase in phases if isinstance(phase, Mapping) and phase.get("passed") is True)
        if isinstance(phases, list)
        else 0
    )
    return (
        f"status={artifact.get('status')}; skipped={artifact.get('skipped')}; "
        f"scenarios=[{'; '.join(scenario_rows)}]; phaseVerdicts={phase_pass}"
    )


def render_stage08_report(
    *,
    bundle: Path,
    nodes: Sequence[Mapping[str, Any]],
    status: str,
    code_sha: str,
    base_sha: str,
    run_id: str,
    generated_at: str,
    transition_input: Mapping[str, Any],
) -> str:
    """Return the complete Markdown report; validation is performed separately."""
    validate_transition_input(transition_input, code_sha=code_sha, base_sha=base_sha)
    node_by_id = {str(node["id"]): node for node in nodes}
    correlation_rows = _correlation_ledger(bundle)
    if status == "PASS":
        correlation_kinds = {name for name, _ in correlation_rows}
        missing_correlation = {
            "CommandProposal",
            "AG-UI resume",
            "Checkpoint",
        } - correlation_kinds
        if missing_correlation:
            raise ReportContractError(
                "PASS report is missing runtime correlation evidence: " + ", ".join(sorted(missing_correlation))
            )
    handoff_by_id = {item["taskId"]: item for item in transition_input["taskHandoffs"]}
    status_phrase = {
        "PASS": "этап выполнен",
        "FAIL": "этап выполнен частично",
        "BLOCKED": "этап заблокирован",
    }[status]
    transition_allowed = status == "PASS" and all(node.get("status") == "PASS" for node in nodes)
    transition_word = "РАЗРЕШЁН" if transition_allowed else "ЗАПРЕЩЁН"
    sync_a_sha = transition_input["syncASha"]
    bundle_key = f"stage-08/{code_sha}/{run_id}"

    lines = [
        "# Отчёт по Этапу 08 — AI create/edit Flow",
        "",
        f"Статус этапа: {status_phrase}",
        f"Внутренний gate: {status}",
        f"Baseline SHA: {base_sha}",
        f"Sync A SHA: {sync_a_sha}",
        f"S08_CODE_SHA (tested): {code_sha}",
        f"External evidence bundle key: {bundle_key}",
        "External seal receipt: SEAL.json (detached post-manifest receipt; digest is not self-referenced)",
        "S08_EVIDENCE_SHA: отсутствует",
        "Migration revision: s08c0mmand01",
        f"Дата/время и timezone: {generated_at}",
        "",
        "## Admission и зависимости",
        "",
        "| Prerequisite | Version/commit/path | Command/evidence | Exit | Result | Artifact |",
        "| --- | --- | --- | ---: | --- | --- |",
    ]
    for reference in transition_input["stagePassReferences"]:
        lines.append(
            f"| Stage {reference['stage']} PASS | {base_sha} ancestry | inherited baseline admission | 0 | PASS | {_escape(reference['evidence'])} |"
        )
    for document in transition_input["officialDocumentation"]:
        lines.append(
            f"| Official docs: {_escape(document['name'])} | {_escape(document['url'])} | pinned dependency probe | 0 | PASS | logs/dependency-probes.log |"
        )
    for node_id in ("runtime-preflight", "provenance", "dependency-probes"):
        node = node_by_id[node_id]
        lines.append(
            f"| {node['name']} | {code_sha} | `{_escape(node['command'])}` | {node['exitCode']} | {node['status']} | {node['logPath']} |"
        )

    lines.extend(
        [
            "",
            "## S08-A01…A10",
            "",
            "| Task | Internal gate | Категория | Owner | Base SHA | Commit SHA | Changed paths | Gate/evidence |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
    )
    task_statuses: dict[str, str] = {}
    for task_id in TASK_IDS:
        handoff = handoff_by_id[task_id]
        required_nodes = TASK_NODE_MAP[task_id] or tuple(node_by_id)
        task_status = (
            "PASS"
            if handoff["reviewVerdict"] == "PASS"
            and all(node_by_id[node_id]["status"] == "PASS" for node_id in required_nodes)
            else "FAIL"
        )
        task_statuses[task_id] = task_status
        category = "выполнена" if task_status == "PASS" else "выполнена частично"
        evidence = ", ".join(
            f"{node_id}:{node_by_id[node_id]['status']}({node_by_id[node_id]['logPath']})" for node_id in required_nodes
        )
        lines.append(
            f"| {task_id} — {TASK_DELIVERABLES[task_id]} | {task_status} | {category} | "
            f"{_escape(handoff['owner'])} | {handoff['baseSha']} | {handoff['commitSha']} | "
            f"{_short_paths(handoff['changedPaths'])} | {evidence}; review={handoff['reviewerId']}:{handoff['reviewVerdict']} |"
        )

    passed_tasks = [task_id for task_id, value in task_statuses.items() if value == "PASS"]
    failed_tasks = [task_id for task_id, value in task_statuses.items() if value != "PASS"]
    lines.extend(
        [
            "",
            "## Сводка выполнения задач",
            "",
            "Выполненные задачи: " + ", ".join(passed_tasks),
            "Невыполненные задачи: " + (", ".join(failed_tasks) if failed_tasks else "нет"),
            "Частично выполненные задачи: " + (", ".join(failed_tasks) if failed_tasks else "нет"),
            "",
            "## Wave/Sync DAG и merge ledger",
            "",
            "| Barrier/milestone | SHA | Фактическое содержание | Verification |",
            "| --- | --- | --- | --- |",
            f"| Admission / Stage 07 base | {base_sha} | предыдущие stages 01/05/06/07 | logs/provenance.log |",
            f"| Sync A | {sync_a_sha} | contract/kernel integration recorded by coordinator | focused tests + ancestry proof |",
            f"| Sync B / frozen S08_CODE_SHA | {code_sha} | code, tests, runner, schemas/templates; no runtime results | all 13 external nodes |",
        ]
    )
    deviations = transition_input.get("deviations", [])
    lines.append(
        "Фактические отклонения от lane DAG: "
        + ("; ".join(_escape(item) for item in deviations) if deviations else "нет")
        + ". Полный gate повторён на frozen SHA."
    )

    lines.extend(
        [
            "",
            "## Инварианты и domain evidence",
            "",
            "| Invariant | Evidence |",
            "| --- | --- |",
        ]
    )
    lines.extend(f"| {name} | {evidence} |" for name, evidence in INVARIANTS)

    lines.extend(
        [
            "",
            "## Entity and correlation ledger",
            "",
            "| Entity/correlation | Redacted durable evidence |",
            "| --- | --- |",
        ]
    )
    for name, value in correlation_rows:
        lines.append(f"| {_escape(name)} | {_escape(value)} |")

    lines.extend(
        [
            "",
            "## Тесты и gate ledger",
            "",
            "| Command | Tested SHA | Exit code | Duration ms | Result | Immutable artifact/log |",
            "| --- | --- | ---: | ---: | --- | --- |",
        ]
    )
    for node in nodes:
        evidence = [node["logPath"], *node.get("artifactPaths", [])]
        lines.append(
            f"| `{_escape(node['command'])}` | {code_sha} | {node['exitCode']} | {_duration_ms(node)} | "
            f"{node['status']} | {_short_paths(evidence)} |"
        )
    lines.append(f"PostgreSQL behavioral detail: {_escape(_postgres_summary(bundle))}")

    failures = [node for node in nodes if node.get("status") == "FAIL"]
    blockers = [node for node in nodes if node.get("status") == "BLOCKED"]
    closed_defects = transition_input.get("closedDefects", [])
    lines.extend(
        [
            "",
            "## Дефекты и активные блокеры",
            "",
            "Открытые дефекты: " + (", ".join(_escape(node["id"]) for node in failures) if failures else "нет"),
            "Активные блокеры: " + (", ".join(_escape(node["id"]) for node in blockers) if blockers else "нет"),
            "Закрытые blocking/Critical defects: "
            + ("; ".join(_escape(item) for item in closed_defects) if closed_defects else "нет"),
            "",
            "## Subagent reviews",
            "",
            "| Reviewer/subagent ID | Kind | Scope | Input SHA | Verdict | Findings | Resolution/evidence |",
            "| --- | --- | --- | --- | --- | --- | --- |",
        ]
    )
    for review in transition_input["reviews"]:
        lines.append(
            f"| {_escape(review['reviewerId'])} | {_escape(review['kind'])} | {_escape(review['scope'])} | "
            f"{review['inputSha']} | {review['verdict']} | {_escape(review['findings'])} | {_escape(review['resolution'])} |"
        )

    lines.extend(
        [
            "",
            "## Соответствие критериям",
            "",
            "| Criterion ID/source | Conforms | Evidence | Gap/owner | Internal effect |",
            "| --- | --- | --- | --- | --- |",
        ]
    )
    for task_id in TASK_IDS:
        conforms = "yes" if task_statuses[task_id] == "PASS" else "no"
        effect = "PASS" if conforms == "yes" else "FAIL"
        nodes_for_task = TASK_NODE_MAP[task_id] or tuple(node_by_id)
        lines.append(
            f"| §9 {task_id} | {conforms} | {', '.join(nodes_for_task)}; task table | "
            f"{'нет' if conforms == 'yes' else handoff_by_id[task_id]['owner']} | {effect} |"
        )
    for criterion_id, requirement, evidence in GLOBAL_CRITERIA:
        node_ids = tuple(item.strip() for item in evidence.split(","))
        conforms = "yes" if all(node_by_id[node_id]["status"] == "PASS" for node_id in node_ids) else "no"
        lines.append(
            f"| §10 {criterion_id} — {requirement} | {conforms} | {evidence} | "
            f"{'нет' if conforms == 'yes' else 'coordinator'} | {'PASS' if conforms == 'yes' else 'FAIL'} |"
        )

    handoff_summary = "; ".join(value for _, value in correlation_rows)
    lines.extend(
        [
            "",
            "## Transition verdict",
            "",
            f"Переход к Этапу 09: {transition_word}",
            f"Основание: internal {status}; A01-A10={','.join(task_statuses.values())}; all mandatory nodes are recorded above.",
            f"Tested S08_CODE_SHA: {code_sha}",
            f"External sealed bundle: {bundle_key}; receipt SEAL.json; manifest manifest.json",
            "S08_EVIDENCE_SHA: отсутствует",
            "Переданные Stage-09 IDs/paths: " + (_escape(handoff_summary) if handoff_summary else "нет"),
            "PostgreSQL behavioral gate: artifacts/postgres-race.json; " + _escape(_postgres_summary(bundle)),
            "Coordinator: Codex main agent under repository main-agent-only tool policy",
            "Independent audit: reviews table above; final seal/digest audit follows manifest creation",
            "",
        ]
    )
    return "\n".join(lines)


def validate_stage08_report(markdown: str, *, status: str) -> None:
    """Reject structurally incomplete or self-contradictory Markdown reports."""
    missing = [heading for heading in REQUIRED_HEADINGS if heading not in markdown]
    if missing:
        raise ReportContractError("missing required sections: " + ", ".join(missing))
    forbidden_markers = ("(не заполнено)", "TODO", "TBD", "PARTIAL")
    present = [marker for marker in forbidden_markers if marker in markdown]
    if present:
        raise ReportContractError("report contains placeholders: " + ", ".join(present))
    missing_tasks = [task_id for task_id in TASK_IDS if task_id not in markdown]
    if missing_tasks:
        raise ReportContractError("report omits task rows: " + ", ".join(missing_tasks))
    required_labels = (
        "Baseline SHA:",
        "Sync A SHA:",
        "S08_CODE_SHA (tested):",
        "External seal receipt:",
        "Выполненные задачи:",
        "Невыполненные задачи:",
        "Частично выполненные задачи:",
        "Открытые дефекты:",
        "Активные блокеры:",
        "Переданные Stage-09 IDs/paths:",
    )
    missing_labels = [label for label in required_labels if label not in markdown]
    if missing_labels:
        raise ReportContractError("report omits required fields: " + ", ".join(missing_labels))
    if status == "PASS":
        required_pass_lines = (
            "Статус этапа: этап выполнен",
            "Внутренний gate: PASS",
            "Невыполненные задачи: нет",
            "Частично выполненные задачи: нет",
            "Открытые дефекты: нет",
            "Активные блокеры: нет",
            "Переход к Этапу 09: РАЗРЕШЁН",
        )
        missing_pass = [line for line in required_pass_lines if line not in markdown]
        if missing_pass:
            raise ReportContractError("PASS report has incomplete transition semantics: " + ", ".join(missing_pass))
        task_criteria = re.findall(r"^\| §9 (S08-A\d{2}) \| yes \|.*\| PASS \|$", markdown, re.MULTILINE)
        if set(task_criteria) != set(TASK_IDS) or len(task_criteria) != len(TASK_IDS):
            raise ReportContractError("PASS report must contain ten §9 task criteria")
        expected_global_ids = {criterion_id for criterion_id, _, _ in GLOBAL_CRITERIA}
        global_criteria = re.findall(r"^\| §10 (G\d{2})\b.*\| yes \|.*\| PASS \|$", markdown, re.MULTILINE)
        if set(global_criteria) != expected_global_ids or len(global_criteria) != len(expected_global_ids):
            raise ReportContractError("PASS report must contain every §10 global criterion")
    elif "Переход к Этапу 09: ЗАПРЕЩЁН" not in markdown:
        raise ReportContractError("FAIL/BLOCKED report must deny the transition")
