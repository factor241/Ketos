#!/usr/bin/env python3
"""Run the aggregate-only Stage 01 Job owner census on local SQLite."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

DATABASE = Path.home() / "Library" / "Application Support" / "Ketos" / "data" / "ketos.db"


def scalar(connection: sqlite3.Connection, query: str) -> int:
    row = connection.execute(query).fetchone()
    return int(row[0] or 0)


uri = f"file:{DATABASE.as_posix()}?mode=ro"
connection = sqlite3.connect(uri, uri=True)
connection.execute("PRAGMA query_only=ON")
connection.execute("PRAGMA busy_timeout=3000")
quick_check = connection.execute("PRAGMA quick_check").fetchone()[0]

required_tables = {"job", "flow", "memory_base", "knowledge_base", "ingestion_run"}
available_tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
missing_tables = sorted(required_tables - available_tables)
if missing_tables:
    raise SystemExit(f"required census tables missing: {', '.join(missing_tables)}")

classification_query = """
WITH candidate_rows AS (
    SELECT j.job_id, CAST(f.user_id AS TEXT) AS candidate_user
      FROM job AS j JOIN flow AS f ON f.id = j.flow_id
     WHERE j.user_id IS NULL AND f.user_id IS NOT NULL
    UNION ALL
    SELECT j.job_id, CAST(m.user_id AS TEXT)
      FROM job AS j JOIN memory_base AS m ON m.flow_id = j.flow_id
     WHERE j.user_id IS NULL AND m.user_id IS NOT NULL
    UNION ALL
    SELECT j.job_id, CAST(m.user_id AS TEXT)
      FROM job AS j JOIN memory_base AS m ON CAST(m.id AS TEXT) = CAST(j.asset_id AS TEXT)
     WHERE j.user_id IS NULL AND m.user_id IS NOT NULL
    UNION ALL
    SELECT j.job_id, CAST(k.user_id AS TEXT)
      FROM job AS j JOIN knowledge_base AS k ON CAST(k.id AS TEXT) = CAST(j.asset_id AS TEXT)
     WHERE j.user_id IS NULL AND k.user_id IS NOT NULL
    UNION ALL
    SELECT j.job_id, CAST(i.user_id AS TEXT)
      FROM job AS j JOIN ingestion_run AS i ON i.job_id = j.job_id
     WHERE j.user_id IS NULL AND i.user_id IS NOT NULL
), candidate_counts AS (
    SELECT j.job_id, COUNT(DISTINCT candidate_rows.candidate_user) AS candidate_count
      FROM job AS j LEFT JOIN candidate_rows ON candidate_rows.job_id = j.job_id
     WHERE j.user_id IS NULL
     GROUP BY j.job_id
)
SELECT
    COALESCE(SUM(candidate_count = 1), 0) AS attributable,
    COALESCE(SUM(candidate_count > 1), 0) AS ambiguous,
    COALESCE(SUM(candidate_count = 0), 0) AS orphan
  FROM candidate_counts
"""
attributable, ambiguous, orphan = map(int, connection.execute(classification_query).fetchone())
all_jobs = scalar(connection, "SELECT COUNT(*) FROM job")
all_null = scalar(connection, "SELECT COUNT(*) FROM job WHERE user_id IS NULL")
owned = scalar(connection, "SELECT COUNT(*) FROM job WHERE user_id IS NOT NULL")
groups = [
    {"type": row[0], "status": row[1], "count": int(row[2])}
    for row in connection.execute(
        "SELECT type, status, COUNT(*) FROM job WHERE user_id IS NULL GROUP BY type, status ORDER BY type, status"
    )
]
connection.close()

payload = {
    "access_mode": "sqlite-mode-ro-query-only",
    "aggregate_only": True,
    "quick_check": quick_check,
    "all_jobs": all_jobs,
    "owned": owned,
    "all_null_owner": all_null,
    "attributable": attributable,
    "ambiguous": ambiguous,
    "orphan": orphan,
    "equations": {
        "owned_plus_null_equals_all": owned + all_null == all_jobs,
        "classified_null_equals_all_null": attributable + ambiguous + orphan == all_null,
    },
    "null_owner_type_status_groups": groups,
    "database_path_emitted": False,
    "row_content_emitted": False,
}
print(json.dumps(payload, indent=2, sort_keys=True))
