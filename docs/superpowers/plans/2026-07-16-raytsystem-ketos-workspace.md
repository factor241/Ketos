# RaytSystem Ketos Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure RaytSystem as a local-first Ketos project workspace while preserving Graphify as the existing broad project graph.

**Architecture:** Apply the reversible managed software bootstrap, install the RaytSystem CLI as an editable uv tool, and customize the generated project configuration for Ketos. Keep runtime data local, use a narrow disposable RaytSystem graph, expose project documentation read-only, and leave all external execution disabled.

**Tech Stack:** Python 3.12, uv, RaytSystem 0.1.0, TOML, YAML, Markdown, FastAPI loopback UI, Graphify.

## Global Constraints

- Do not modify `graphify-out/` or rebuild Graphify.
- Preserve all unrelated dirty and untracked files.
- Do not modify Ketos lock files, deployment files, `LICENSE`, or `NOTICE`.
- Do not enable external models, external MCP execution, network exposure, notifications, or publishing.
- The nested `raytsystem/` checkout remains local and is not added as an embedded Git repository.
- Use the RaytSystem command from an editable uv tool, not Ketos `uv run`.

---

### Task 1: Install the project-facing RaytSystem command

**Files:**
- Verify: `raytsystem/pyproject.toml`
- Create locally: uv tool environment outside the repository

**Interfaces:**
- Consumes: `/Volumes/Projects/ketos_canvas_mod_main/raytsystem`
- Produces: `raytsystem` executable available on `PATH`

- [ ] **Step 1: Confirm the command is absent**

Run:

```bash
command -v raytsystem
```

Expected: no path before installation.

- [ ] **Step 2: Install the editable tool**

Run:

```bash
uv tool install --editable /Volumes/Projects/ketos_canvas_mod_main/raytsystem
```

Expected: RaytSystem 0.1.0 is installed and exposes the `raytsystem` command.

- [ ] **Step 3: Verify the command**

Run:

```bash
raytsystem --help
raytsystem doctor --root /Volumes/Projects/ketos_canvas_mod_main/raytsystem --json
```

Expected: command help succeeds and the source workspace remains healthy.

### Task 2: Apply the reversible bootstrap

**Files:**
- Merge: `AGENTS.md`
- Merge: `CLAUDE.md`
- Create: `WORK.md`
- Create: `.agents/skills/start/SKILL.md`
- Create: `.agents/skills/graph/SKILL.md`
- Create: `.claude/skills/start/SKILL.md`
- Create: `.claude/skills/graph/SKILL.md`
- Create: `config/raytsystem.toml`
- Create: `config/platform.yaml`
- Create: `config/policies.yaml`
- Create: `config/runtime-adapters.yaml`
- Create: `config/policies/policy_software.yaml`
- Create: `skills/skill_builder/SKILL.md`
- Create: `skills/skill_reviewer/SKILL.md`
- Create: `skills/skill_tester/SKILL.md`
- Create: `skills/skill_security_reviewer/SKILL.md`
- Create: `packs/software/**`
- Create: `workflows/software.yaml`
- Create: `tasks/software-sample.json`
- Create: `ledger/CURRENT`
- Create: `ledger/generations/genesis.json`
- Create: `knowledge/**`
- Create: `.raytsystem/installation.json`

**Interfaces:**
- Consumes: fresh bootstrap fingerprint
- Produces: reversible RaytSystem installation record and genesis workspace

- [ ] **Step 1: Generate a fresh Russian managed-software preview**

Run:

```bash
raytsystem bootstrap \
  --target /Volumes/Projects/ketos_canvas_mod_main \
  --source-type software \
  --template software \
  --mode managed \
  --context-language ru \
  --dry-run \
  --json
```

Expected: no blockers; existing dirty state is a warning; README is preserved;
AGENTS and CLAUDE are merge targets.

- [ ] **Step 2: Apply the exact fresh fingerprint**

Run:

```bash
raytsystem bootstrap \
  --target /Volumes/Projects/ketos_canvas_mod_main \
  --source-type software \
  --template software \
  --mode managed \
  --context-language ru \
  --apply \
  --confirm <FRESH_FINGERPRINT> \
  --json
```

Expected: status `installed`, genesis created, index rebuilt, and an uninstall
record written.

### Task 3: Configure Ketos graph, documents and local safety

**Files:**
- Modify: `config/raytsystem.toml`
- Modify: `config/platform.yaml`
- Modify: `config/policies.yaml`
- Modify: `config/runtime-adapters.yaml`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: RaytSystem schema 1.4.0 and Ketos repository layout
- Produces: read-only docs, narrow local graph, disabled external runtimes

- [ ] **Step 1: Add the RaytSystem local-state ignore block**

Append a fenced `RAYTSYSTEM` block that ignores the engine checkout, derived
state, exact raw blobs, operational databases/runs, backups, encrypted state and
draft outbox artifacts.

- [ ] **Step 2: Replace the generated `raytsystem.toml`**

Configure:

```toml
[[documents.roots]]
id = "manual"
path = "knowledge/manual"
mode = "read_write"
kind = "notes"

[[documents.roots]]
id = "product-docs"
path = "docs/docs"
mode = "read_only"
kind = "documentation"

[[documents.roots]]
id = "localization"
path = "docs/localization/ru"
mode = "read_only"
kind = "documentation"

[[documents.roots]]
id = "engineering-plans"
path = "docs/superpowers"
mode = "read_only"
kind = "documentation"
```

Set `[code_graph].roots` to the selected Ketos source and documentation roots,
and list the root contracts/audit reports explicitly in `[code_graph].files`.

- [ ] **Step 3: Keep the platform fail-closed**

Verify all external feature flags remain false and the policy remains:

```yaml
network_default: none
workspace_default: staging_only
external_actions_default: approval_required
mcp_tool_default: catalog_only
```

- [ ] **Step 4: Validate configuration before building**

Run:

```bash
raytsystem doctor --root /Volumes/Projects/ketos_canvas_mod_main --json
```

Expected: config and genesis checks pass; graph may still report missing until
Task 5.

### Task 4: Customize the Ketos catalog and instructions

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `WORK.md`
- Modify: `.agents/skills/start/SKILL.md`
- Modify: `.agents/skills/graph/SKILL.md`
- Modify: `.claude/skills/start/SKILL.md`
- Modify: `.claude/skills/graph/SKILL.md`
- Modify: `skills/skill_builder/SKILL.md`
- Modify: `skills/skill_reviewer/SKILL.md`
- Modify: `skills/skill_tester/SKILL.md`
- Modify: `skills/skill_security_reviewer/SKILL.md`
- Modify: `packs/software/pack.yaml`
- Modify: `packs/software/agents/*.yaml`
- Modify: `workflows/software.yaml`
- Modify: `tasks/software-sample.json`
- Create: `knowledge/manual/ketos-workspace.md`
- Create: `docs/RAYTSYSTEM.md`

**Interfaces:**
- Consumes: existing Ketos AGENTS rules and `.agents/skills`
- Produces: Ketos-specific RaytSystem catalog and operator instructions

- [ ] **Step 1: Replace `uv run raytsystem` commands**

Use the project-facing global command:

```bash
raytsystem <command> --root /Volumes/Projects/ketos_canvas_mod_main
```

- [ ] **Step 2: Rewrite the four catalog skills**

Each skill must identify exact Ketos scope, required existing repo skill,
focused verification, Graphify read-only boundary and PASS/BLOCKED/FAIL output.

- [ ] **Step 3: Rewrite catalog agents and workflow**

Keep agents disabled and bind them to the customized skills. Replace the sample
workflow/task with a Ketos setup/review flow that has no external action.

- [ ] **Step 4: Write operator documentation**

Document start/stop, doctor, status, graph, documents, tasks, lint, backup,
uninstall, Graphify boundary and the fact that canonical knowledge remains empty
until separately approved ingest promotion.

### Task 5: Build projections and switch the live UI to Ketos

**Files:**
- Create locally: `.raytsystem/graph/**`
- Create locally: `.raytsystem/documents.sqlite`
- Update generated: `knowledge/index.md`
- Update generated: `knowledge/hot.md`
- Update generated: `knowledge/graph.json`

**Interfaces:**
- Consumes: finalized config and catalog
- Produces: current graph, current document index and Ketos-rooted UI

- [ ] **Step 1: Rebuild the knowledge projections and document index**

Run:

```bash
raytsystem rebuild-index --root /Volumes/Projects/ketos_canvas_mod_main --json
```

Then call the local document-index rebuild endpoint or supported CLI path.

- [ ] **Step 2: Build the narrow RaytSystem graph**

Run:

```bash
raytsystem graph rebuild --root /Volumes/Projects/ketos_canvas_mod_main --json
raytsystem graph status --root /Volumes/Projects/ketos_canvas_mod_main --json
```

Expected: state `current`; no paths start with `raytsystem/` or
`graphify-out/`.

- [ ] **Step 3: Switch the UI root**

Stop the old RaytSystem-source-rooted server and run:

```bash
raytsystem start \
  --root /Volumes/Projects/ketos_canvas_mod_main \
  --host 127.0.0.1 \
  --port 8765 \
  --no-open
```

Expected: `http://127.0.0.1:8765` serves the Ketos workspace.

### Task 6: Final verification and audit

**Files:**
- Verify: all files from Tasks 2-5
- Create: `RAYTSYSTEM_KETOS_CONFIGURATION_REPORT.md`

**Interfaces:**
- Consumes: complete configured workspace
- Produces: evidence-backed PASS/BLOCKED/FAIL report

- [ ] **Step 1: Run RaytSystem gates**

Run:

```bash
raytsystem doctor --root . --json
raytsystem status --root . --json
raytsystem lint --root . --json
raytsystem graph status --root . --json
raytsystem guard-checkpoint --root . --json
```

Expected: doctor healthy, lint clean, graph current and checkpoint allowed.

- [ ] **Step 2: Verify live API projections**

Check:

```text
/api/v1/system
/api/v1/skills
/api/v1/code-graph/status
/api/v1/knowledge
/api/v1/documents/index
/api/v1/execution/features
```

Expected: Ketos counts and customized skills are visible; external execution is
disabled.

- [ ] **Step 3: Verify Graphify and dirty-state boundaries**

Confirm:

- no tracked `graphify-out/` file changed;
- existing user untracked reports remain untouched;
- `raytsystem/` and runtime data are ignored;
- only RaytSystem configuration and documentation are new project changes.

- [ ] **Step 4: Write the configuration report**

Record exact commands, hashes, graph/document counts, remaining limitations,
uninstall command and the next optional canonical-ingest pilot.

