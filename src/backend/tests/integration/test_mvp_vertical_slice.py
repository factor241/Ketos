from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from sqlmodel import Session, SQLModel, create_engine, select

import ketos.services.database.models  # noqa: F401
from ketos.services.database.models.board.model import Board
from ketos.services.database.models.flow.model import Flow
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.user.model import User
from scripts.mvp.seed_vertical_slice import main as seed_main


SECRET_KEY_FRAGMENTS = {
    "api_key",
    "credential",
    "database_url",
    "password",
    "path",
    "secret",
}


def _assert_manifest_has_no_secret_bearing_keys(value: Any) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).casefold()
            assert not any(
                fragment in normalized for fragment in SECRET_KEY_FRAGMENTS
            ), f"secret-bearing manifest key: {key}"
            _assert_manifest_has_no_secret_bearing_keys(child)
    elif isinstance(value, list):
        for child in value:
            _assert_manifest_has_no_secret_bearing_keys(child)


def test_seed_idempotency_and_canonical_saver_path(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_path = (tmp_path / "acceptance.sqlite3").resolve()
    database_url = f"sqlite:///{database_path}"
    engine = create_engine(database_url)
    SQLModel.metadata.create_all(engine)

    data_dir = tmp_path / "ketos-data"
    monkeypatch.setenv("KETOS_DATA_DIR", str(data_dir))
    manifest_path = tmp_path / "seed-manifest.json"
    argv = [
        "--database-url",
        database_url,
        "--seed-key",
        "stage10-acceptance",
        "--output-seed-manifest",
        str(manifest_path),
        "--assert-canonical-saver-path",
    ]

    try:
        assert seed_main(argv) == 0
        first_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        assert seed_main(argv) == 0
        second_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        assert first_manifest["ids"] == second_manifest["ids"]
        assert first_manifest["row_counts"] == second_manifest["row_counts"]
        assert first_manifest["seed_key_sha256"] == second_manifest[
            "seed_key_sha256"
        ]
        assert first_manifest["operation"] == {"created": 4, "reused": 0}
        assert second_manifest["operation"] == {"created": 0, "reused": 4}
        assert second_manifest["row_counts"]["total"] == 4
        _assert_manifest_has_no_secret_bearing_keys(first_manifest)
        _assert_manifest_has_no_secret_bearing_keys(second_manifest)

        ids = second_manifest["ids"]
        with Session(engine) as session:
            users = session.exec(
                select(User).where(User.id == UUID(ids["user"])),
            ).all()
            projects = session.exec(
                select(Folder).where(Folder.id == UUID(ids["project"])),
            ).all()
            boards = session.exec(
                select(Board).where(Board.id == UUID(ids["board"])),
            ).all()
            flows = session.exec(
                select(Flow).where(Flow.id == UUID(ids["flow"])),
            ).all()

        assert len(users) == 1
        assert len(projects) == 1
        assert len(boards) == 1
        assert len(flows) == 1
        assert users[0].is_active is False
        assert users[0].is_superuser is False
        assert flows[0].data == {"nodes": [], "edges": []}
    finally:
        engine.dispose()


def test_seed_idempotency_rejects_relative_sqlite_url(tmp_path: Path) -> None:
    with pytest.raises(SystemExit, match="2"):
        seed_main(
            [
                "--database-url",
                "sqlite:///relative.sqlite3",
                "--seed-key",
                "stage10-invalid",
                "--output-seed-manifest",
                str(tmp_path / "must-not-exist.json"),
            ],
        )

    assert not (tmp_path / "must-not-exist.json").exists()
