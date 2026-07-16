# Ketos

Ketos is a local visual builder and runtime for AI workflows. This repository
contains the FastAPI backend, React frontend, the `kfx` execution and component
SDK, and optional extension bundles.

## Project status

Ketos is an actively developed public alpha. It is intended for local-first
workflow design, inspectable execution, and extension development without
requiring a hosted control plane. Interfaces may continue to evolve before a
stable release, while persisted component class names and the documented KFX
and bundle compatibility contracts are treated as durable identifiers.

The canonical public repository is
[factor241/Ketos](https://github.com/factor241/Ketos). See
[PROJECT_HISTORY.md](./PROJECT_HISTORY.md) for the project's Langflow lineage,
repository migrations, attribution, and the boundary of Ketos-specific work.

## Requirements

- Python 3.10 through 3.14
- `uv` 0.4 or newer
- Node.js 20.19 or newer (22.12 LTS recommended)
- npm 10.9 or newer
- `make`

## Run from source

```bash
make init
make run_cli
```

Ketos listens on `http://127.0.0.1:7860` by default. For hot reload, run
`make backend` and `make frontend` in separate terminals.

## Packages

- `ketos`: application and CLI (`uv run ketos run`)
- `ketos-base`: backend framework
- `kfx`: component SDK and lightweight executor (`uv run kfx --help`)

See [DEVELOPMENT.md](./DEVELOPMENT.md), [DESIGN.md](./DESIGN.md), and
[BUNDLE_API.md](./BUNDLE_API.md). Security reports follow
[SECURITY.md](./SECURITY.md). Legal attribution is kept in `LICENSE` and
`NOTICE`; those files are the authoritative legal text.

This repository does not enable external publishing or deployment by default.
