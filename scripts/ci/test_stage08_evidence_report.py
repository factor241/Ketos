from __future__ import annotations

import importlib.util
import json
import sqlite3
from pathlib import Path

import pytest

REPORT_MODULE = Path(__file__).with_name("stage08_evidence_report.py")
RUNNER = Path(__file__).with_name("run-stage08-gate.sh")
TRANSITION_SCHEMA = Path(__file__).parents[2] / "docs/evidence/stage-08/schemas/transition-input.schema.json"
REPORT_TEMPLATE = Path(__file__).parents[2] / "docs/evidence/stage-08/templates/STAGE_08_REPORT.template.md"
BROWSER_SCHEMA = Path(__file__).parents[2] / "docs/evidence/stage-08/schemas/browser.schema.json"
BROWSER_SPEC = (
    Path(__file__).parents[2]
    / "src/frontend/tests/core/integrations/ai-flow-preview-confirm.spec.ts"
)
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


def _load_report_module():
    assert REPORT_MODULE.is_file(), (
        "Stage 08 has no executable report-contract module; the shell runner can "
        "currently seal an abbreviated Markdown report"
    )
    spec = importlib.util.spec_from_file_location("stage08_evidence_report", REPORT_MODULE)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _transition_input(code_sha: str, base_sha: str) -> dict[str, object]:
    task_handoffs = []
    for number in range(1, 11):
        task_id = f"S08-A{number:02d}"
        task_handoffs.append(
            {
                "taskId": task_id,
                "owner": f"{task_id} tool-free role + main agent",
                "baseSha": base_sha,
                "commitSha": code_sha,
                "changedPaths": [f"stage08/{task_id.lower()}"],
                "reviewerId": f"reviewer-{number:02d}",
                "reviewVerdict": "PASS",
            }
        )
    return {
        "schemaVersion": "1",
        "stage": "08",
        "baseSha": base_sha,
        "syncASha": code_sha,
        "frozenSha": code_sha,
        "stagePassReferences": [
            {"stage": stage, "status": "PASS", "evidence": "logs/provenance.log"} for stage in ("01", "05", "06", "07")
        ],
        "officialDocumentation": [
            {
                "name": "LangGraph interrupts",
                "url": "https://docs.langchain.com/oss/python/langgraph/interrupts",
            }
        ],
        "taskHandoffs": task_handoffs,
        "reviews": [
            {
                "reviewerId": "transition-reviewer",
                "kind": "independent",
                "scope": "Stage 08 transition acceptance",
                "inputSha": code_sha,
                "verdict": "PASS",
                "findings": "нет",
                "resolution": "accepted for frozen gate",
            }
        ],
        "deviations": ["Repository AGENTS policy kept all tool calls and commits on the main agent."],
    }


def _nodes() -> list[dict[str, object]]:
    node_ids = (
        "runtime-preflight",
        "provenance",
        "dependency-probes",
        "migration-sqlite",
        "migration-postgres",
        "backend-focused",
        "postgres-behavioral",
        "flow-version",
        "kfx-lfx",
        "frontend",
        "negative-guards",
        "browser",
        "repository",
    )
    return [
        {
            "id": node_id,
            "name": node_id,
            "status": "PASS",
            "startedAt": "2026-07-21T08:00:00+00:00",
            "endedAt": "2026-07-21T08:00:01+00:00",
            "command": f"run {node_id}",
            "exitCode": 0,
            "logPath": f"logs/{node_id}.log",
            "artifactPaths": [],
            "reason": None,
        }
        for node_id in node_ids
    ]


def _write_runtime_artifacts(bundle: Path) -> None:
    database_path = bundle / "artifacts/browser-run/backend/ketos.sqlite3"
    database_path.parent.mkdir(parents=True)
    connection = sqlite3.connect(database_path)
    connection.execute(
        """
        CREATE TABLE command_proposal (
            id TEXT, actor_id TEXT, project_id TEXT, chat_run_id TEXT,
            thread_id TEXT, interrupt_id TEXT, interrupt_bound_at TEXT,
            source_kind TEXT, source_proposal_id TEXT, flow_id TEXT,
            sequence INTEGER, idempotency_key TEXT, proposal_hash TEXT,
            base_flow_revision INTEGER, base_flow_hash TEXT,
            result_flow_hash TEXT, pinned_flow_version_id TEXT,
            status TEXT, outcome TEXT, created_at TEXT
        )
        """
    )
    connection.execute(
        """
        INSERT INTO command_proposal VALUES (
            'proposal-1', 'actor-1', 'project-1', 'chat-run-1', 'chat-1',
            'interrupt-1', '2026-07-21T08:00:00+00:00', 'ai_run', NULL,
            'flow-1', 1, 'secret-idempotency', ?, 0, ?, ?, 'version-1',
            'applied', ?, '2026-07-21T08:00:00+00:00'
        )
        """,
        (
            "a" * 64,
            "b" * 64,
            "c" * 64,
            json.dumps({"after_revision": 1, "reason": "SENSITIVE-OUTCOME-DETAIL"}),
        ),
    )
    connection.commit()
    connection.close()

    checkpoint = bundle / "artifacts/browser-run/checkpoint/langgraph-checkpoints.sqlite3"
    checkpoint.parent.mkdir(parents=True)
    checkpoint.touch()
    browser = bundle / "artifacts/browser"
    browser.mkdir(parents=True)
    (browser / "browser-network.json").write_text(
        json.dumps(
            {
                "resumeBodies": [
                    {
                        "threadId": "chat-1",
                        "runId": "resume-run-1",
                        "resume": [
                            {
                                "interruptId": "interrupt-1",
                                "status": "resolved",
                                "payload": {"approved": True},
                            }
                        ],
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    (bundle / "artifacts/postgres-race.json").write_text(
        json.dumps(
            {
                "status": "PASS",
                "skipped": 0,
                "scenarios": [],
                "phaseVerdicts": [{"passed": True}, {"passed": True}],
            }
        ),
        encoding="utf-8",
    )


def test_rendered_report_is_self_contained_and_transition_complete(tmp_path: Path) -> None:
    module = _load_report_module()
    code_sha = "1" * 40
    base_sha = "2" * 40
    transition_input = _transition_input(code_sha, base_sha)
    _write_runtime_artifacts(tmp_path)
    (tmp_path / "transition-input.json").write_text(json.dumps(transition_input), encoding="utf-8")

    markdown = module.render_stage08_report(
        bundle=tmp_path,
        nodes=_nodes(),
        status="PASS",
        code_sha=code_sha,
        base_sha=base_sha,
        run_id="20260721T080000Z-123",
        generated_at="2026-07-21T08:00:02+00:00",
        transition_input=transition_input,
    )

    module.validate_stage08_report(markdown, status="PASS")
    for heading in REQUIRED_HEADINGS:
        assert heading in markdown
    for number in range(1, 11):
        assert f"S08-A{number:02d}" in markdown
    assert "Переход к Этапу 09: РАЗРЕШЁН" in markdown
    assert "SENSITIVE-OUTCOME-DETAIL" not in markdown
    assert "(не заполнено)" not in markdown
    assert "нет" in markdown


def test_abbreviated_report_is_rejected() -> None:
    module = _load_report_module()
    abbreviated = """# Отчёт по Этапу 08 — AI create/edit Flow

Статус этапа: этап выполнен
Внутренний gate: PASS

## Узлы

- runtime-preflight: PASS

## Acceptance semantics

- server-side apply
"""

    with pytest.raises(module.ReportContractError, match="missing required sections"):
        module.validate_stage08_report(abbreviated, status="PASS")


def test_transition_input_requires_all_ten_practical_handoffs() -> None:
    module = _load_report_module()
    code_sha = "1" * 40
    transition_input = _transition_input(code_sha, "2" * 40)
    transition_input["taskHandoffs"] = transition_input["taskHandoffs"][:-1]

    with pytest.raises(module.ReportContractError, match="S08-A10"):
        module.validate_transition_input(transition_input, code_sha=code_sha, base_sha="2" * 40)


def test_transition_input_requires_an_independent_review() -> None:
    module = _load_report_module()
    code_sha = "1" * 40
    transition_input = _transition_input(code_sha, "2" * 40)
    transition_input["reviews"][0]["kind"] = "practical"

    with pytest.raises(module.ReportContractError, match="independent review"):
        module.validate_transition_input(transition_input, code_sha=code_sha, base_sha="2" * 40)


def test_pass_report_rejects_missing_runtime_correlation_evidence(tmp_path: Path) -> None:
    module = _load_report_module()
    code_sha = "1" * 40
    base_sha = "2" * 40

    with pytest.raises(module.ReportContractError, match="correlation evidence"):
        module.render_stage08_report(
            bundle=tmp_path,
            nodes=_nodes(),
            status="PASS",
            code_sha=code_sha,
            base_sha=base_sha,
            run_id="20260721T080000Z-123",
            generated_at="2026-07-21T08:00:02+00:00",
            transition_input=_transition_input(code_sha, base_sha),
        )


def test_runner_validates_complete_report_before_manifest_and_seal() -> None:
    runner = RUNNER.read_text(encoding="utf-8")

    assert "--transition-input" in runner
    assert "transition-input.json" in runner
    assert "stage08_evidence_report" in runner
    validate_position = runner.index("validate_stage08_report")
    manifest_position = runner.index('bundle / "manifest.json"')
    seal_position = runner.index('bundle / "SEAL.json"')
    assert validate_position < manifest_position < seal_position
    assert 'S08_TRANSITION_INPUT="$BUNDLE/transition-input.json"' in runner
    assert "ABORTED.json" in runner
    assert "FINAL_VALIDATION_EXIT" in runner


def test_pass_report_rejects_duplicate_or_missing_global_criterion(tmp_path: Path) -> None:
    module = _load_report_module()
    code_sha = "1" * 40
    base_sha = "2" * 40
    transition_input = _transition_input(code_sha, base_sha)
    _write_runtime_artifacts(tmp_path)
    markdown = module.render_stage08_report(
        bundle=tmp_path,
        nodes=_nodes(),
        status="PASS",
        code_sha=code_sha,
        base_sha=base_sha,
        run_id="20260721T080000Z-123",
        generated_at="2026-07-21T08:00:02+00:00",
        transition_input=transition_input,
    )
    tampered = markdown.replace("| §10 G27", "| §10 G01")

    with pytest.raises(module.ReportContractError, match="global criterion"):
        module.validate_stage08_report(tampered, status="PASS")


def test_transition_input_has_a_committed_fail_closed_schema() -> None:
    assert TRANSITION_SCHEMA.is_file()
    schema = json.loads(TRANSITION_SCHEMA.read_text(encoding="utf-8"))
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) >= {
        "baseSha",
        "syncASha",
        "frozenSha",
        "stagePassReferences",
        "officialDocumentation",
        "taskHandoffs",
        "reviews",
    }
    assert schema["properties"]["taskHandoffs"]["minItems"] == 10
    assert schema["properties"]["taskHandoffs"]["maxItems"] == 10


def test_committed_report_template_mirrors_every_normative_section() -> None:
    template = REPORT_TEMPLATE.read_text(encoding="utf-8")
    for heading in REQUIRED_HEADINGS:
        assert heading in template


def test_browser_schema_only_accepts_redacted_resume_envelope_keys() -> None:
    schema = json.loads(BROWSER_SCHEMA.read_text(encoding="utf-8"))
    resume_keys = schema["$defs"]["network"]["properties"]["resumeBodyKeys"]

    assert resume_keys["uniqueItems"] is True
    assert set(resume_keys["items"]["enum"]) == {"threadId", "runId", "resume"}
    assert resume_keys["minItems"] == 3
    assert resume_keys["maxItems"] == 3


def test_browser_trace_is_sanitized_before_it_enters_the_evidence_bundle() -> None:
    spec = BROWSER_SPEC.read_text(encoding="utf-8")

    assert "sanitizePlaywrightTrace" in spec
    assert 'zip.remove("trace.network")' in spec
    assert 'entry.type !== "frame-snapshot"' in spec
    assert "SENSITIVE_TRACE_KEYS" in spec
    assert '"message",' in spec
    assert "rawTracePath" in spec
    assert "finally" in spec
    assert "existsSync(rawTracePath)" in spec
