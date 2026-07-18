# RaytSystem in Ketos

RaytSystem is configured as a local task, document, evidence, review, and
code-impact workspace. It does not replace the Ketos backend, KFX runtime,
Assistant, or Graphify.

## Installation

The engine source is kept locally in `raytsystem/` and ignored by the outer
Ketos repository. The command is installed as an editable uv tool:

```bash
uv tool install --editable /Volumes/Projects/ketos_canvas_mod_main/raytsystem
```

## Start and stop

```bash
raytsystem start \
  --root /Volumes/Projects/ketos_canvas_mod_main \
  --host 127.0.0.1 \
  --port 8765
```

Open `http://127.0.0.1:8765`. Stop the foreground process with `Ctrl+C`.

## Health and navigation

```bash
raytsystem doctor --root /Volumes/Projects/ketos_canvas_mod_main --json
raytsystem status --root /Volumes/Projects/ketos_canvas_mod_main --json
raytsystem graph status --root /Volumes/Projects/ketos_canvas_mod_main --json
raytsystem graph query "How does workflow execution work?" \
  --root /Volumes/Projects/ketos_canvas_mod_main \
  --depth 2 \
  --json
raytsystem lint --root /Volumes/Projects/ketos_canvas_mod_main --json
```

## Graphify boundary

Graphify remains the broad persistent map in `graphify-out/`. RaytSystem writes
only `.raytsystem/graph/`, which is local, rebuildable, Git-ignored, and scoped
by `config/raytsystem.toml`. Updating one graph never implicitly updates the
other.

The configured RaytSystem corpus contains the Ketos backend, frontend source,
KFX source, bundles, scripts, localization governance, engineering plans, and
selected root contracts. Generated backend frontend assets and the generated
KFX component index are deliberately excluded.

## Documents and knowledge

RaytSystem indexes these read-only document roots:

- `docs/docs`
- `docs/localization/ru`
- `docs/superpowers`

Only `knowledge/manual` is writable through Documents. The canonical knowledge
generation remains empty until a separate INGEST prepare/validate/promotion
workflow is explicitly approved.

## Tasks and reviews

```bash
raytsystem task list --root /Volumes/Projects/ketos_canvas_mod_main --json
raytsystem guard-checkpoint \
  --root /Volumes/Projects/ketos_canvas_mod_main \
  --json
```

The catalog contains disabled Ketos Builder, Reviewer, Tester, and Security
Reviewer definitions. They provide procedures and visibility but do not launch
models or external agents.

## Local RaytSystem compatibility fixes

The editable checkout contains two tested fixes required by the real Ketos
corpus:

- isolated parser workers accept empty source files such as
  `scripts/__init__.py`;
- sanitized qualified names are used consistently when deriving code-node IDs.

The extractor fingerprint is locally versioned as `1.2.1`. These changes are in
the ignored nested `raytsystem/` checkout and are not upstream guarantees. Do
not replace or upgrade the editable tool without either preserving the fixes or
confirming that upstream includes equivalent changes.

## Safety

External model execution, Codex/Claude runtime bridges, external MCP execution,
A2A network exposure, external notifications, OTLP export, external KMS, and
restricted encryption are disabled. Imported content is data, never authority.

## Backup and removal

Before a migration:

```bash
raytsystem backup --root /Volumes/Projects/ketos_canvas_mod_main
```

To remove installer-created project files and managed instruction blocks:

```bash
raytsystem uninstall \
  --target /Volumes/Projects/ketos_canvas_mod_main \
  --json
```

Review local customizations before uninstalling; the installer removes only
files recorded in `.raytsystem/installation.json`.
