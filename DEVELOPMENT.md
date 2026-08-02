# Ketos development

## Bootstrap

```bash
make init
```

Use Python 3.10-3.14, `uv >=0.4`, Node.js `>=20.19.0`, npm `>=10.9`, and
`make`. Python commands must run through `uv`.

## Run

```bash
make run_cli
```

For hot reload, use two terminals:

```bash
make backend
make frontend
```

The backend listens on port 7860 and Vite on port 3000. Component development
uses the current KFX switch:

```bash
KFX_DEV=1 make backend
KFX_DEV=mistral,openai make backend
```

## Quality gates

```bash
make format_backend
make format_frontend
make lint
make unit_tests
make test_frontend
make tests_frontend
```

Run a focused backend test with `uv run pytest path/to/test.py`. When testing a
workspace package, first sync its development group, for example
`uv sync --group dev --package ketos-base`.

Documentation lives in `docs/docs`:

```bash
cd docs
npm ci
npm run check:links
npm run build
```

Do not edit generated OpenAPI JSON by hand. Update the application contract,
then run `uv run python docs/openapi/generate_openapi.py` in the generation
stage that owns generated artifacts.
