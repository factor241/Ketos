"""Early, settings-free CLI for durable brand-state migration."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated
from uuid import UUID

import typer
from platformdirs import user_state_path


def _journal_root() -> Path:
    return Path(user_state_path("ketos", "Ketos")) / "brand-migrations"


def _echo(payload: dict[str, object]) -> None:
    typer.echo(json.dumps(payload, sort_keys=True, separators=(",", ":")))


def _database_adapter_factory(discovery, engine):
    from ketos.brand_state import SQLiteDatabaseAdapter, StateOperation, StateStatus

    databases = [
        entry
        for entry in discovery.entries
        if entry.operation is StateOperation.SQLITE_BACKUP and entry.status is StateStatus.LEGACY_ONLY
    ]

    def build(transaction_id: str):
        if len(databases) != 1 or databases[0].source is None:
            return None
        return SQLiteDatabaseAdapter(
            source_root=databases[0].source.parent,
            transaction_root=engine.transaction_root(transaction_id),
        )

    return build


def migrate_brand_state(
    *,
    dry_run: Annotated[bool, typer.Option("--dry-run", help="Discover and validate without writing.")] = False,
    apply_state: Annotated[bool, typer.Option("--apply", help="Apply or resume a migration.")] = False,
    status: Annotated[bool, typer.Option("--status", help="List durable transaction status.")] = False,
    rollback: Annotated[str | None, typer.Option("--rollback", help="Rollback a transaction UUID.")] = None,
) -> None:
    """Migrate legacy Langflow state into Ketos transactionally."""
    selected = sum((dry_run, apply_state, status, rollback is not None))
    if selected != 1:
        message = "choose exactly one of --dry-run, --apply, --status, or --rollback"
        raise typer.BadParameter(message)

    from ketos.brand_state import BrandStateEngine, discover_brand_state

    if status:
        records = BrandStateEngine(journal_root=_journal_root()).list_transactions()
        transactions = [{"phase": item.phase.value, "transaction_id": item.transaction_id} for item in records]
        _echo({"transactions": transactions})
        return
    if rollback is not None:
        transaction_id = UUID(rollback)
        record = BrandStateEngine(journal_root=_journal_root()).rollback(transaction_id=transaction_id)
        _echo({"phase": record.phase.value, "transaction_id": record.transaction_id})
        return

    discovery = discover_brand_state(create=False)
    counts: dict[str, int] = {}
    for entry in discovery.entries:
        counts[entry.status.value] = counts.get(entry.status.value, 0) + 1
    if dry_run:
        _echo({"conflicts": discovery.has_conflicts, "counts": counts, "entries": len(discovery.entries)})
        if discovery.has_conflicts:
            raise typer.Exit(2)
        return

    engine = BrandStateEngine(journal_root=_journal_root())
    record = engine.apply_or_resume(
        discovery,
        database_adapter_factory=_database_adapter_factory(discovery, engine),
    )
    _echo({"phase": record.phase.value, "transaction_id": record.transaction_id})


app = typer.Typer(add_completion=False)
app.command()(migrate_brand_state)


def main(args: list[str] | None = None) -> None:
    app(args=args, prog_name="ketos migrate-brand-state")


__all__ = ["app", "main", "migrate_brand_state"]
