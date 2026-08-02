# Ketos design contract

Ketos uses a Python/FastAPI backend, a React/TypeScript frontend, and KFX as the
component and execution boundary.

## Product structure

- `src/backend/base/ketos`: API, services, graph orchestration, persistence.
- `src/frontend`: visual editor and administrative UI.
- `src/kfx/src/kfx`: portable component types, schemas, executor, extensions.
- `src/bundles`: separately packaged official extensions.

The application API is mounted below `/api/v1` and `/api/v2`. Authentication is
handled by the backend service layer. API-key examples send `KETOS_API_KEY` in
the `x-api-key` header. `Authorization: Bearer` is reserved for JWT/OAuth
authentication. Request-scoped variables use `X-KETOS-GLOBAL-VAR-*`.

Extensions use only the `ketos.extensions` entry-point group,
`[tool.ketos.extension]`, and the canonical schema
`https://schemas.ketos.test/extension/v1.json`. Persisted component class names
are stable identifiers and must not be renamed.

Configuration owned by Ketos uses `KETOS_*`; KFX development configuration
uses `KFX_*`. Compatibility aliases and upstream discovery are not part of the
current design.
