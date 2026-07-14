# AGENTS.md

## Repository

Ketos is a visual AI workflow builder with a Python/FastAPI backend,
React/TypeScript frontend, and KFX component/executor SDK.

## Commands

```bash
make init
make run_cli
make backend
make frontend
make format_backend
make format_frontend
make lint
make unit_tests
make test_frontend
make tests_frontend
```

Always use `uv run` for Python commands. Use `KFX_DEV=1 make backend` when
developing components dynamically.

## Layout

- `src/backend/base/ketos`: backend package and `/api/v1`, `/api/v2` routes
- `src/frontend`: React application
- `src/kfx`: KFX SDK and CLI
- `src/bundles`: official extension distributions

Components inherit from `kfx.custom.Component` and use declarations from
`kfx.io`. A component class name is a persisted identifier and must never be
renamed. Extension manifests use `ketos.extensions`, `[tool.ketos.extension]`,
and `https://schemas.ketos.test/extension/v1.json` only.

Preserve unrelated dirty state. Do not modify generated artifacts, lock files,
deployment configuration, `LICENSE`, or `NOTICE` unless the task explicitly
owns them. Verify focused tests first, then the relevant package gate.
