# Ketos Public Page MCP and Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Repository policy requires the main
> agent to perform every tool call and workspace edit; no-tools subagents may
> review complete packets supplied by the main agent.

**Goal:** Remove the unsuitable product screenshot, make the implemented MCP
control surface prominent and accurately documented, and align the MIT
copyright notices for Langflow-derived and original Ketos-specific material.

**Architecture:** `README.md` remains the product-first overview.
`src/kfx/KFX_MCP.md` owns the detailed tool and client-configuration reference.
`LICENSE` preserves the MIT grant while listing both applicable copyright
notices, and `NOTICE` explains their boundaries without transferring upstream
or contributor rights.

**Tech Stack:** GitHub Flavored Markdown, FastMCP, KFX, Python, FastAPI,
Docusaurus, Git, GitHub CLI, Chrome.

## Global Constraints

- Write all changed public documentation in professional English.
- Keep Ketos described as an active-alpha, local-first visual builder and
  runtime for extensible AI workflows.
- Remove the screenshot, caption, and `docs/assets/ketos-board-workspace.jpg`;
  do not replace them with another product image.
- Give MCP a dedicated README section immediately after the infinite Canvas.
- Describe only MCP tools and behavior present in
  `src/kfx/src/kfx/mcp/`.
- State that MCP controls flows, components, connections, and execution rather
  than every Ketos screen or Board interaction.
- Run `kfx-mcp` from an initialized Ketos source checkout; do not recommend the
  unrelated `kfx` package currently published on PyPI.
- Preserve the complete MIT permission grant and disclaimer.
- Preserve `Copyright (c) 2024 Langflow`.
- Add the user-approved line exactly:
  `Portions Copyright (c) 2026 Daria Shemelina`.
- Do not imply ownership of unchanged Langflow code or of contributions
  authored by other people.
- Preserve application code, generated artifacts, lock files, deployment
  configuration, persisted component identifiers, and KFX/Bundle wire
  contracts.
- Current shipped interface languages are English and Russian. Other regional
  languages remain planned.
- Do not claim hosted production availability, production readiness, complete
  offline operation, universal MCP control, regulatory compliance, adoption,
  or market leadership.

---

### Task 1: Update the root public page

**Files:**
- Modify: `README.md`
- Delete: `docs/assets/ketos-board-workspace.jpg`

**Interfaces:**
- Consumes: the verified Canvas and MCP behavior in the approved design.
- Produces: the canonical product overview and navigation hub.

- [x] **Step 1: Remove the product visual**

Delete the screenshot Markdown, its italic caption, and the image asset. Confirm
there are no remaining references:

```bash
rg -n "ketos-board-workspace|current local build of the Ketos Board" README.md
test ! -e docs/assets/ketos-board-workspace.jpg
```

Expected: no matches outside historical Git diffs.

- [x] **Step 2: Add the MCP product section**

Insert `## Programmatic control through MCP` immediately after
`## The infinite Canvas`. Explain:

- the stdio MCP server connects an MCP-compatible client to a running Ketos
  REST API;
- authentication uses `KETOS_API_KEY` or the `login` tool;
- supported areas are flows, starters, components, connections, validation,
  builds, execution, layout, batching, and UI-settled notification;
- changes appear in the Ketos visual editor because MCP and the UI use the same
  stored flow model;
- the current scope does not provide universal control of every screen or all
  Board placements.

Link the full tool and setup reference to `src/kfx/KFX_MCP.md`.

- [x] **Step 3: Thread MCP through the existing overview**

Add bounded MCP entries to:

- `Core capabilities`;
- `Example workflows`;
- `How Ketos fits together`;
- `Development status`;
- `Known limitations`;
- `Documentation`.

Avoid duplicating the detailed tool list outside the dedicated MCP section.

- [x] **Step 4: Replace the license summary**

Use a concise final section stating:

```text
Ketos is distributed under the MIT License. Portions derived from Langflow
retain their original copyright and MIT license notices. Original
Ketos-specific contributions authored by Daria Shemelina are Copyright (c)
2026 Daria Shemelina and are also released under the MIT License.
Contributions authored by other contributors remain copyrighted by their
respective authors unless those rights have been separately assigned.
```

Retain links to `LICENSE` and `NOTICE` and the independent/unofficial
affiliation disclaimer.

- [x] **Step 5: Review the README structure**

Confirm the section order matches the approved design and that all relative
links resolve from the repository root.

---

### Task 2: Correct the detailed KFX MCP guide

**Files:**
- Modify: `src/kfx/KFX_MCP.md`

**Interfaces:**
- Consumes: the `kfx-mcp` console entry point in `src/kfx/pyproject.toml` and
  tool implementations under `src/kfx/src/kfx/mcp/`.
- Produces: the authoritative source-based setup and tool reference linked by
  the README.

- [x] **Step 1: Bound the opening claim**

Replace “full programmatic control over a Ketos instance” with language that
names flows, components, connections, builds, validation, and execution. State
that the server does not expose every application screen or Board interaction.

- [x] **Step 2: Replace the unsafe installation instructions**

Document:

```bash
git clone https://github.com/factor241/Ketos.git
cd Ketos
make init
uv run kfx-mcp
```

Add the package-name warning that the public PyPI package named `kfx` is not
Ketos KFX. Remove every recommendation to use:

```text
uv pip install kfx
pip install kfx
uvx --from kfx
```

- [x] **Step 3: Correct MCP client configuration**

Use this source-checkout pattern:

```json
{
  "command": "uv",
  "args": [
    "run",
    "--project",
    "/absolute/path/to/Ketos",
    "kfx-mcp"
  ]
}
```

Keep `KETOS_SERVER_URL` and `KETOS_API_KEY` in the client environment. Explain
that the placeholder path must be replaced with the absolute local checkout.

- [x] **Step 4: Correct the Claude Code example**

Use:

```bash
read -rs KETOS_API_KEY && export KETOS_API_KEY

claude mcp add ketos \
  -e KETOS_SERVER_URL=http://localhost:7860 \
  -e KETOS_API_KEY="$KETOS_API_KEY" \
  -- uv run --project /absolute/path/to/Ketos kfx-mcp
```

Also show the variant that omits `KETOS_API_KEY` and authenticates later through
the MCP `login` tool. Correct the expected `claude mcp list` output and
troubleshooting commands to the same source path.

- [x] **Step 5: Verify the tool reference**

Compare every documented tool name against the server registration and run:

```bash
uv run --project /absolute/path/to/Ketos \
  python -c "import shutil; print(shutil.which('kfx-mcp'))"
cd src/kfx
uv sync --frozen
uv run pytest -q tests/unit/mcp
```

Expected: the local console entry point resolves inside the worktree and the
focused MCP tests pass.

---

### Task 3: Align MIT copyright and attribution

**Files:**
- Modify: `LICENSE`
- Modify: `NOTICE`

**Interfaces:**
- Consumes: the upstream MIT notice and the user-approved Ketos notice.
- Produces: the authoritative root legal notices referenced by the README.

- [x] **Step 1: Add the Ketos-specific copyright notice**

Directly below the existing Langflow line in `LICENSE`, add:

```text
Portions Copyright (c) 2026 Daria Shemelina
```

Do not modify the MIT permission grant or disclaimer.

- [x] **Step 2: Clarify NOTICE boundaries**

State that:

- Langflow-derived portions retain their original copyright and MIT notice;
- original Ketos-specific modifications authored by Daria Shemelina carry the
  approved 2026 notice and are released under MIT;
- other contributors retain their own copyrights unless separately assigned;
- Ketos is not affiliated with, endorsed by, or sponsored by Langflow.

- [x] **Step 3: Cross-check the three public statements**

Compare `README.md`, `LICENSE`, and `NOTICE` line by line. Confirm that none
claims ownership of unchanged upstream code or third-party contributions.

---

### Task 4: Verify and independently review the documentation

**Files:**
- Verify every file changed by Tasks 1-3 and the approved design/plan updates.
- Modify: `docs/tests/docs-shell-contract.test.js`

**Interfaces:**
- Consumes: the complete branch diff.
- Produces: reproducible evidence that the documentation is consistent,
  buildable, and bounded by current source behavior.

- [x] **Step 1: Run textual integrity checks**

```bash
git diff --check factor241/main...HEAD
rg -n "ketos-board-workspace|current local build of the Ketos Board" README.md
test ! -e docs/assets/ketos-board-workspace.jpg
rg -n -- "-- uvx|uvx .*kfx-mcp|full programmatic control" \
  README.md src/kfx/KFX_MCP.md
```

Expected: `git diff --check` exits `0`; forbidden public instructions and the
removed screenshot have no active documentation matches.

- [x] **Step 2: Run documentation gates**

```bash
cd docs
npm run check:links
npm run build
```

Expected: both commands exit `0`.

The documentation contract must permit `Langflow` only in the root README's
`License and attribution` section. It must continue to reject upstream product
branding from all preceding product sections.

- [x] **Step 3: Run focused MCP tests**

```bash
cd src/kfx
uv sync --frozen
uv run pytest -q tests/unit/mcp
```

Expected: all focused tests pass.

- [x] **Step 4: Verify Markdown links**

Resolve every relative link in the changed Markdown files from its containing
directory. Confirm the public GitHub repository URL is reachable.

- [x] **Step 5: Obtain no-tools subagent review**

Provide a complete diff packet to fresh review subagents. Require verdicts on:

- factual MCP scope;
- README information hierarchy;
- license/NOTICE consistency;
- source-install safety;
- unsupported product, legal, security, or production claims.

Apply valid corrections through the main agent and rerun the affected checks.

- [x] **Step 6: Commit**

```bash
git add README.md LICENSE NOTICE src/kfx/KFX_MCP.md \
  docs/tests/docs-shell-contract.test.js \
  docs/superpowers/specs/2026-07-28-ketos-public-project-page-design.md \
  docs/superpowers/plans/2026-07-28-ketos-public-project-page.md
git add -u docs/assets/ketos-board-workspace.jpg
git commit -m "docs: clarify Ketos MCP control and attribution"
```

---

### Task 5: Publish and inspect the public result

**Files:**
- Publish the verified branch to `factor241/Ketos`.

**Interfaces:**
- Consumes: the verified commit from Task 4.
- Produces: a merged public `main` and browser-verified project page.

- [ ] **Step 1: Confirm repository and account state**

Use GitHub CLI to confirm the target repository is `factor241/Ketos`, the
default branch is `main`, and the `factor241` account is available. Do not
remove the existing `ustyuzhaninkirillwhite-ui` login.

- [ ] **Step 2: Push the feature branch**

Switch GitHub CLI to `factor241`, push
`codex/public-readme-mcp-attribution`, and create a pull request targeting
`main`.

- [ ] **Step 3: Review and merge**

Inspect the PR checks and complete diff. Merge only after required checks pass.
Do not force-push or bypass a failing required check.

- [ ] **Step 4: Restore the original CLI account**

Switch GitHub CLI back to `ustyuzhaninkirillwhite-ui`.

- [ ] **Step 5: Verify public rendering**

Without relying on an authenticated repository view, inspect:

- the root README with no screenshot;
- the dedicated MCP section;
- `src/kfx/KFX_MCP.md`;
- `LICENSE`;
- `NOTICE`;
- the final `main` commit and MIT license detection.

Expected: all pages are public, internally consistent, and rendered without
broken Markdown.
