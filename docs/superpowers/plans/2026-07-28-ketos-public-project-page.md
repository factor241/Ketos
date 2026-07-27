# Ketos Public Project Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task. Repository policy requires the main
> agent to perform every tool call and workspace edit. Subagents may review
> only complete text packets supplied by the main agent.

**Goal:** Publish an accurate, professional English project page and supporting
public documentation for `factor241/Ketos`.

**Architecture:** The root README is the product overview and navigation hub.
Focused supporting documents own contributor, security, Board-contract, KFX,
and documentation-site detail. Product claims are derived from the current
public `main` source and accepted repository evidence, while maturity,
deployment, and localization limits remain explicit.

**Tech Stack:** GitHub Flavored Markdown, Docusaurus, React/TypeScript,
Python/FastAPI, React Flow, TanStack Query, Zustand, KFX, GitHub CLI, Chrome.

## Global Constraints

- Write all public-facing project documentation changed by this plan in
  professional English.
- Describe Ketos as an MIT-licensed local-first visual builder and runtime for
  extensible AI workflows under active alpha development.
- Current shipped interface languages are English and Russian only.
- Kazakh, Kyrgyz, Tajik, Uzbek, and other regional languages are planned, not
  implemented.
- Use the current request's regional position: Kazakhstan, Russia, and other
  CIS countries.
- Do not claim a hosted service, production readiness, production-grade
  multi-client collaboration, complete offline operation, adoption, security
  certification, compliance, or market leadership.
- Preserve application code, generated files, lock files, deployment
  configuration, persisted component identifiers, KFX and Bundle API
  contracts, `LICENSE`, `NOTICE`, and unrelated internal planning files.
- Use GitHub private vulnerability reporting for confidential security reports;
  do not publish a personal email address or an `@ketos.test` address.
- Do not add a CI badge while inherited or scheduled public workflows are
  failing.
- Treat “infinite Canvas” as a spatial product concept, not as a mathematical
  size, performance, or scalability guarantee.

---

### Task 1: Prepare a truthful product visual

**Files:**
- Create when a clean capture succeeds:
  `docs/assets/ketos-board-workspace.png`
- Modify later: `README.md`

**Interfaces:**
- Consumes: current Board UI with note, chat, automation, and job-result
  placement support.
- Produces: a repository-relative image safe to embed as
  `./docs/assets/ketos-board-workspace.png`, or a recorded decision to omit the
  image.

- [ ] **Step 1: Inspect candidate repository screenshots**

Review current Board evidence images and reject any image containing browser
chrome, internal audit labels, personal data, debug overlays, or a layout that
does not represent current `main`.

- [ ] **Step 2: Attempt a clean English capture**

Run the current application from the isolated worktree, open it in Chrome, set
the interface to English, and capture a coherent Board view. The preferred
scene contains at least two current placement kinds and no fake customer,
adoption, or production data.

- [ ] **Step 3: Store or omit the asset**

If the capture is accurate and clean, store it as:

```text
docs/assets/ketos-board-workspace.png
```

If a clean capture cannot be produced from current source, do not add an image
and do not reuse an internal audit screenshot.

- [ ] **Step 4: Verify the asset**

Open the saved file at original resolution and check legibility, cropping,
absence of secrets, and absence of browser or debugger UI.

---

### Task 2: Rewrite the public README

**Files:**
- Modify: `README.md`
- Use when created: `docs/assets/ketos-board-workspace.png`

**Interfaces:**
- Consumes: the verified product facts and asset decision from Task 1.
- Produces: the canonical public product overview linked by all later
  contributor and documentation pages.

- [ ] **Step 1: Replace the sparse introduction**

Use this section order:

```text
# Ketos
status and navigation
product visual, when available
## What Ketos is
## Why it exists
## The infinite Canvas
## Core capabilities
## Example workflows
## Quick start
## How Ketos fits together
## Development status
## Known limitations
## Roadmap
## Regional and language focus
## Documentation
## Contributing and security
## License and attribution
```

- [ ] **Step 2: Add bounded product and audience copy**

State that Ketos is for developers, automation builders, and technical teams
who want to prototype, organize, run, and inspect AI workflows locally. Explain
that it brings notes, AI conversations, automations, and execution results into
one persistent spatial workspace while retaining a programmable runtime and
extension SDK.

- [ ] **Step 3: Document current Canvas behavior**

Describe:

- project-scoped Boards;
- panning, zooming, and persisted viewport;
- note, chat, automation, and job-result placements;
- moving, resizing, collapsing, and maximizing placements;
- Board note management;
- Board-scoped chat and automation creation;
- revision-aware conflict handling.

State explicitly that “infinite Canvas” is the interaction model and does not
promise unlimited scale or real-time multiplayer editing.

- [ ] **Step 4: Add a feature-status table**

Use four unambiguous states: `Implemented`, `In development`, `Planned`, and
`Not provided`. At minimum cover Canvas placements, workflow editing and local
runtime, KFX/extensions, English/Russian UI, multi-client PostgreSQL hardening,
additional regional languages, and hosted production service.

- [ ] **Step 5: Add quick start and examples**

Publish the verified prerequisites:

```text
Python 3.10-3.14
uv 0.4 or newer
Node.js 20.19 or newer; Node.js 22.12 LTS recommended
npm 10.9 or newer
GNU Make
```

Publish the source commands exactly:

```bash
make init
make run_cli
```

State that the default local address is `http://127.0.0.1:7860` and link to
`DEVELOPMENT.md`. Use Simple Agent, Vector Store RAG, mixed Board workspace,
and KFX component execution as bounded examples.

- [ ] **Step 6: Add architecture and lifecycle summary**

Include a compact table for:

```text
src/frontend
src/backend/base/ketos
src/kfx
src/bundles
```

Explain server-authoritative Board persistence, TanStack Query server cache,
transient Zustand UI state, FastAPI APIs, React Flow rendering, KFX components,
and stable persisted component class names.

- [ ] **Step 7: Add status, roadmap, and regional context**

Use active-alpha wording. State that no hosted production service is provided,
APIs and UX may change, PostgreSQL multi-client hardening and broader browser
and deployment validation remain, and external services can receive data when
a workflow is configured to call them.

List undated roadmap themes only. State that the initial product and community
focus includes Kazakhstan, Russia, and other CIS countries; English and Russian
are shipped, while other named regional languages are planned.

- [ ] **Step 8: Link contribution, security, license, and attribution**

Link to `CONTRIBUTING.md`, `SECURITY.md`, GitHub Issues, `LICENSE`, and
`NOTICE`. Do not duplicate legal text.

- [ ] **Step 9: Review the README packet independently**

Supply the complete README text to a no-tools subagent. Require it to flag
unsupported capabilities, ambiguous status language, missing requested
sections, broken relative links visible from the text, and marketing
overstatement. Apply valid corrections through the main agent.

- [ ] **Step 10: Commit the product overview**

```bash
git add README.md docs/assets/ketos-board-workspace.png
git commit -m "docs: refresh Ketos public project overview"
```

If no screenshot was created, omit the asset path from `git add`.

---

### Task 3: Repair contributor and security guidance

**Files:**
- Modify: `CONTRIBUTING.md`
- Modify: `SECURITY.md`
- Modify: `CODE_OF_CONDUCT.md`

**Interfaces:**
- Consumes: the canonical repository URL
  `https://github.com/factor241/Ketos` and enabled GitHub private vulnerability
  reporting.
- Produces: working contributor and confidential-reporting routes linked by
  the README.

- [ ] **Step 1: Update contribution instructions**

Replace the test repository URL with the GitHub repository. Keep the fork,
branch, focused verification, and pull-request workflow. Explain that issues
are used for bugs and feature proposals, and link `DEVELOPMENT.md` for setup.

- [ ] **Step 2: Replace the test security policy**

Describe the project as active alpha, not a test fork. Direct confidential
reports to the repository's GitHub private vulnerability reporting interface.
Ask reporters to include affected revision/version, reproduction steps,
impact, and suggested mitigation when available. Do not promise a response
SLA that has not been operationally established.

- [ ] **Step 3: Repair Code of Conduct enforcement contact**

Remove `support@ketos.test`. Instruct reporters to request a private maintainer
contact through a minimal GitHub issue without sensitive details when no
private contact channel is already available. Keep security vulnerabilities
on the separate private vulnerability-reporting path.

- [ ] **Step 4: Scan for invalid public contacts**

Run:

```bash
rg -n "git\\.ketos\\.test|@ketos\\.test|test fork|test-only placeholder" \
  CONTRIBUTING.md SECURITY.md CODE_OF_CONDUCT.md
```

Expected: no matches.

- [ ] **Step 5: Commit community documentation**

```bash
git add CONTRIBUTING.md SECURITY.md CODE_OF_CONDUCT.md
git commit -m "docs: repair public contribution and security guidance"
```

---

### Task 4: Align Board, documentation-site, and KFX pages

**Files:**
- Modify: `docs/docs/development/board-workspace.md`
- Modify: `docs/docs/index.mdx`
- Modify: `src/kfx/README.md`

**Interfaces:**
- Consumes: README terminology and current Board/KFX source contracts.
- Produces: supporting documentation that no longer contradicts the public
  project overview or routes users to test domains.

- [ ] **Step 1: Replace the historical Board stage boundary**

Rewrite `board-workspace.md` as the current Board workspace contract. Preserve
the verified persistence, owner authorization, revision conflict, TanStack
Query, Zustand, viewport-save, keyboard, and route facts. Add the current
placement kinds and interaction model. Remove statements that Boards contain
no placements or that later stages have not started.

- [ ] **Step 2: Align the documentation landing page**

Update `docs/docs/index.mdx` with the current active-alpha summary, unified
Canvas, supported English/Russian interface, local quick start, and existing
“Read next” links. Keep the page concise.

- [ ] **Step 3: Replace KFX test-domain repository links**

In `src/kfx/README.md`:

- replace source links under `https://git.ketos.test/ketos/ketos` with
  `https://github.com/factor241/Ketos`;
- replace the raw Simple Agent URL with the corresponding GitHub raw URL;
- replace clone instructions with
  `git clone https://github.com/factor241/Ketos.git`;
- replace `docs.ketos.test` links with accurate repository-relative
  documentation links when a target exists, otherwise convert the text to an
  unlinked local-documentation reference.

Do not change KFX commands, wire contracts, or runtime behavior.

- [ ] **Step 4: Scan public Board and KFX documentation**

Run:

```bash
rg -n "git\\.ketos\\.test|docs\\.ketos\\.test|@ketos\\.test|Stage 03|Stage 04 has not started|Boards contain no placements" \
  docs/docs/development src/kfx/README.md docs/docs/index.mdx
```

Expected: no stale product-boundary or test-domain matches in the changed
public pages.

- [ ] **Step 5: Review supporting-doc packet independently**

Supply the complete changed text to a no-tools subagent and require a
consistency review against the README terminology, alpha status, current
languages, repository URL, and security route.

- [ ] **Step 6: Commit aligned supporting documentation**

```bash
git add docs/docs/development/board-workspace.md docs/docs/index.mdx src/kfx/README.md
git commit -m "docs: align Board and KFX public documentation"
```

---

### Task 5: Verify the complete documentation change

**Files:**
- Verify all files changed by Tasks 1-4.

**Interfaces:**
- Consumes: the complete documentation branch.
- Produces: evidence that the branch is internally consistent and renderable.

- [ ] **Step 1: Check the Git diff**

Run:

```bash
git status --short
git diff --check factor241/main...HEAD
git diff --stat factor241/main...HEAD
```

Expected: no whitespace errors and only planned documentation/asset files.

- [ ] **Step 2: Run placeholder and unsupported-claim scans**

Run scoped scans for:

```text
git.ketos.test
docs.ketos.test
@ketos.test
production-ready
enterprise-ready
real-time collaboration
fully offline
Kazakh/Kyrgyz/Tajik/Uzbek described as currently available
```

Review every match rather than treating keyword presence alone as failure.

- [ ] **Step 3: Verify relative Markdown links**

Resolve every relative link in the changed Markdown files from its containing
directory. Confirm GitHub URLs with a non-mutating request or GitHub CLI.

- [ ] **Step 4: Run documentation checks**

From `docs`:

```bash
npm ci
npm run check:links
npm run build
```

Expected: all commands exit `0`. If the repository's locked dependency state
or an unrelated existing documentation defect blocks a command, record the
exact command, error, and scope before deciding whether the plan owns the fix.

- [ ] **Step 5: Confirm public repository settings**

Use GitHub CLI to confirm:

```text
factor241/Ketos
PUBLIC
default branch main
MIT license
Issues enabled
private vulnerability reporting enabled
```

- [ ] **Step 6: Review rendered README**

Render or inspect the README at desktop width. Confirm heading hierarchy,
tables, code blocks, screenshot sizing, alt text, link destinations, and
readability.

- [ ] **Step 7: Commit verification-only corrections**

If verification requires text or link corrections, commit them as:

```bash
git add README.md CONTRIBUTING.md SECURITY.md CODE_OF_CONDUCT.md \
  docs/docs/development/board-workspace.md docs/docs/index.mdx \
  src/kfx/README.md
git commit -m "docs: correct public page verification findings"
```

Stage only paths that actually changed, and do not create an empty commit when
no correction is needed.

---

### Task 6: Publish and verify the public default branch

**Files:**
- Publish the complete `codex/public-readme` branch.

**Interfaces:**
- Consumes: the verified branch from Task 5.
- Produces: merged documentation on the public `factor241/Ketos` default
  branch and a browser-verified public page.

- [ ] **Step 1: Confirm branch and account**

Confirm the branch is based on the current `factor241/main`, the working tree
is clean, and GitHub CLI is authenticated for an account authorized to push to
`factor241/Ketos`.

- [ ] **Step 2: Push the branch**

```bash
git push -u factor241 codex/public-readme
```

- [ ] **Step 3: Create the pull request**

Create a non-draft pull request with a concise summary, verification commands,
and explicit statements that the change is documentation-only and makes no
production-readiness claim.

- [ ] **Step 4: Inspect checks and merge**

Review all required checks. Resolve documentation-owned failures. Do not merge
through a failing required check caused by this change. Merge the pull request
when repository policy permits and the documentation checks are acceptable.

- [ ] **Step 5: Verify public `main`**

Confirm the merged commit is reachable from `factor241/main` and the default
branch README contains the new project overview.

- [ ] **Step 6: Verify without relying on private repository access**

Open `https://github.com/factor241/Ketos` in Chrome and inspect the public page.
Confirm the owner, repository visibility, README rendering, image rendering
when present, status table, quick-start blocks, links, and security guidance.

- [ ] **Step 7: Restore local authentication preference**

If GitHub CLI account selection was changed, restore the previously active
account after publication without removing the `factor241` authorization.
