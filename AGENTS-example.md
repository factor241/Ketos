# Ketos agent guide example

Read the nearest `AGENTS.md` before editing. Keep changes inside the assigned
scope, preserve unrelated work, and verify the exact contract you changed.

Canonical paths are `src/backend/base/ketos`, `src/frontend`, `src/kfx`, and
`src/bundles`. Use `uv run` for Python, `make backend` and `make frontend` for
hot reload, and `KFX_DEV=1` for dynamic component loading.

Never rename a persisted component class. Do not edit lock files, generated
OpenAPI outputs, release artifacts, or deployment configuration unless the
assigned stage explicitly owns them.
