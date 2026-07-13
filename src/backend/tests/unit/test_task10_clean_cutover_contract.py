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
    runbook = ROOT / "docs/docs/operations/environment.mdx"
    text = " ".join(runbook.read_text(encoding="utf-8").lower().split())
    ordered_steps = (
        "stop and prove quiescence",
        "archive outside the repository",
        "delete pre-cutover state",
        "initialize clean ketos state",
        "### rollback",
    )
    positions = [text.index(step) for step in ordered_steps]
    assert positions == sorted(positions)
    assert "before deleting anything" in text
    assert "do not flush a shared redis database" in text
    for required in (
        "all ketos-owned keys must use the `ketos:` prefix",
        "no pre-cutover application keys remain",
        "unrelated keys may remain in a shared redis database",
        "restore a redis snapshot only for a dedicated redis instance",
        "including when ketos uses a dedicated logical database number",
        "restore only the archived application namespace",
    ):
        assert required in text
    assert "dedicated redis database or instance" not in text


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
