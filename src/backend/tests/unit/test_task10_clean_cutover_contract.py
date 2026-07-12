from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]


def _old_brand() -> str:
    return "lang" + "flow"


def test_task10_operator_surfaces_contain_no_old_environment_prefix():
    old_prefix = _old_brand().upper() + "_"
    paths = [ROOT / ".env.example", ROOT / "deploy/.env.example", ROOT / "scripts/migrate_secret_key.py"]
    offenders = [str(path.relative_to(ROOT)) for path in paths if old_prefix in path.read_text(encoding="utf-8")]
    assert offenders == []


def test_clean_cutover_runbook_documents_destructive_sequence():
    runbook = ROOT / "docs/docs/Operations/ketos-clean-cutover.mdx"
    text = runbook.read_text(encoding="utf-8").lower()
    for required in ("stop", "archive", "outside", "delete", "redis", "initialize", "rollback"):
        assert required in text


def test_deploy_example_requires_operator_supplied_credentials_and_keeps_flower_closed():
    text = (ROOT / "deploy/.env.example").read_text(encoding="utf-8")
    forbidden = (
        "KETOS_SUPERUSER_PASSWORD=superuser",
        "RABBITMQ_DEFAULT_PASS=ketos",
        "POSTGRES_PASSWORD=ketos",
        "PGADMIN_DEFAULT_PASSWORD=admin",
        "FLOWER_UNAUTHENTICATED_API=True",
        "BROKER_URL=amqp://ketos:ketos@",
        "github.com/ketos-ai/ketos/pull/2655",
    )
    assert [value for value in forbidden if value in text] == []
    for required in (
        "KETOS_SUPERUSER_PASSWORD=${KETOS_SUPERUSER_PASSWORD?",
        "RABBITMQ_DEFAULT_PASS=${RABBITMQ_DEFAULT_PASS?",
        "POSTGRES_PASSWORD=${POSTGRES_PASSWORD?",
        "PGADMIN_DEFAULT_PASSWORD=${PGADMIN_DEFAULT_PASSWORD?",
        "FLOWER_UNAUTHENTICATED_API=False",
        "BROKER_URL=amqp://${RABBITMQ_DEFAULT_USER}:${RABBITMQ_DEFAULT_PASS}@broker:5672",
    ):
        assert required in text
