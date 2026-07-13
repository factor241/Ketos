# Bundle authoring guide

This guide describes the current Ketos Extension Bundle contract. New and
existing bundles must expose only canonical Ketos identifiers. Historical
component aliases and compatibility shims are not supported.

## Prerequisites

- Components inherit from `kfx.custom.Component` and use declarations from
  `kfx.io`.
- A persisted component class name is an identifier. Never rename it.
- Bundle code imports public `kfx` APIs only; it must not import `ketos`
  internals.
- Runtime dependencies belong in the bundle's `pyproject.toml`.

Choose a lowercase snake-case bundle name such as `duckduckgo` and a
hyphenated distribution name such as `kfx-duckduckgo`.

## Layout

Create the bundle under `src/bundles/<bundle>/`:

```text
src/bundles/<bundle>/
├── README.md
├── pyproject.toml
└── src/
    └── kfx_<bundle>/
        ├── __init__.py
        ├── extension.json
        └── components/
            └── <bundle>/
                ├── __init__.py
                └── <source>.py
```

The package root and component package must re-export every component class.
The wheel include rules must package `extension.json` and the component source.

## Distribution metadata

Declare the extension entry point in `pyproject.toml`:

```toml
[project.entry-points."ketos.extensions"]
kfx-<bundle> = "kfx_<bundle>"
```

Declare the bundle as a workspace member and add its distribution to the root
project dependencies and `[tool.uv.sources]`. Keep the supported KFX range in
the bundle dependency list. Platform-specific dependencies need PEP 508
markers and lazy imports so discovery still works on unsupported platforms.

## Manifest

`src/kfx_<bundle>/extension.json` must use the canonical schema and namespace:

```json
{
  "$schema": "https://schemas.ketos.test/extension/v1.json",
  "id": "kfx-<bundle>",
  "version": "0.1.1",
  "name": "<Human-readable bundle name>",
  "description": "<One-line description>.",
  "kfx": { "compat": ["1"] },
  "bundles": [
    { "name": "<bundle>", "path": "components/<bundle>" }
  ]
}
```

The only persisted component identifier is
`ext:<bundle>:<ComponentClass>@official`. Do not add aliases, rewrite tables,
legacy slots, or alternate schema URLs.

## Remove an in-tree duplicate

When extracting an existing provider, delete its old directory under
`src/kfx/src/kfx/components/<provider>/` and remove its exports from
`src/kfx/src/kfx/components/__init__.py`. There must be one implementation and
one canonical identifier for each shipped component.

Regenerate the component index only when the task explicitly owns that
generated artifact:

```bash
KFX_DEV=1 uv run python scripts/build_component_index.py
```

## Verify

Run focused checks before the package gate:

```bash
uv run kfx extension validate src/bundles/<bundle>/src/kfx_<bundle>
uv run python -c "from kfx_<bundle> import <ComponentClass>; print(<ComponentClass>.__name__)"
uv run pytest src/bundles/<bundle>/tests -q
uv run pytest src/kfx/tests/unit/extension/test_destructive_cutover.py -q
uv run ruff check src/bundles/<bundle>
```

For a development smoke test, run:

```bash
uv run kfx extension dev src/bundles/<bundle>
```

Then confirm in the browser that the component appears in its bundle group,
can be added to the canvas, and reloads without errors.

## Review checklist

- The component class name is unchanged.
- The manifest uses `https://schemas.ketos.test/extension/v1.json`.
- The entry-point group is exactly `ketos.extensions`.
- Every identifier uses `ext:<bundle>:<Class>@official`.
- The wheel contains the manifest and component source.
- No second implementation, alias, rewrite table, or compatibility bridge
  remains.
- Focused tests and the relevant KFX package gate pass.
