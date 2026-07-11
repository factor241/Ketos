"""Static contracts for translation-maintenance workflows."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def _workflow(name: str) -> str:
    return (ROOT / ".github" / "workflows" / name).read_text(encoding="utf-8")


def test_download_prs_require_validation_and_manual_review():
    workflow = _workflow("gp-download.yml")

    assert "[skip ci]" not in workflow
    assert "Enable auto-merge" not in workflow
    assert "npm run i18n:check" in workflow
    assert "scripts/i18n/check_backend_locales.py" in workflow
    assert "linguistic review" in workflow.lower()
    assert "download-backend:\n    if: github.event_name == 'workflow_dispatch'" not in workflow
    assert workflow.count("GP_TRANSLATION_PR_TOKEN") >= 4
    assert workflow.count("draft: true") == 2
    assert workflow.count("GP_LINGUISTIC_REVIEWER") >= 2
    assert "CI Success" in workflow
    assert "I18n Contract Gates" in workflow
    assert "reviewDecision" in workflow
    assert "autoMergeRequest" in workflow


def test_workflows_expose_ru_frontend_backend_command_paths():
    upload = _workflow("gp-upload.yml")
    download = _workflow("gp-download.yml")

    assert "upload.py --target frontend" in upload
    assert "upload.py --target backend" in upload
    assert "download.py --target frontend" in download
    assert "download.py --target backend" in download
    assert "--lang ru" in download


def test_backend_extraction_workflow_covers_contract_inputs_without_skipping_ci():
    workflow = _workflow("gp-backend-check.yml")

    assert "[skip ci]" not in workflow
    for required_path in (
        "scripts/gp/extract_backend_strings.py",
        "scripts/i18n/**",
        "src/backend/base/langflow/utils/i18n.py",
        "src/lfx/src/lfx/io/**",
    ):
        assert required_path in workflow
    assert "--check --report-json" in workflow
