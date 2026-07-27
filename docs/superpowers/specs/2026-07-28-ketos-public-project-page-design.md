# Ketos Public Project Page Design

## Purpose

Prepare the public `factor241/Ketos` repository for open-source program review
by making the project page accurate, useful, and professionally structured.
The page must help a new reader understand the product in under two minutes
without hiding its alpha status or claiming capabilities that the repository
does not demonstrate.

This work is documentation-focused. It does not change application behavior,
deployment configuration, persisted component identifiers, KFX or Bundle API
contracts, licensing, or attribution.

## Audience

The primary readers are:

- open-source program reviewers evaluating the project's purpose and maturity;
- developers evaluating Ketos as a local AI-workflow environment;
- potential contributors looking for a clear entry point;
- technical users in Kazakhstan, Russia, and other CIS countries who may
  benefit from English and Russian interface support.

The repository documentation describes the product and community scope. It
must not contain the maintainer's citizenship, residency, or other personal
application information.

## Editorial position

Ketos will be described as an MIT-licensed, local-first visual builder and
runtime for extensible AI workflows under active alpha development.

The README will use a product-first narrative with the unified Canvas as the
main differentiator:

1. define the product and its current maturity;
2. show a current, factual product visual;
3. explain the problem and intended users;
4. explain the Canvas and supported placement types;
5. show concrete use cases and capabilities;
6. provide a minimal, verified quick start;
7. summarize the architecture and extension model;
8. distinguish implemented, in-development, planned, and unavailable work;
9. state limitations and regional-language context;
10. route readers to documentation, contribution, security, and licensing
    information.

The text will avoid promotional superlatives, adoption claims, production
guarantees, compliance claims, and delivery dates.

## Verified product facts

The public page may state that the current repository is published under the
MIT License and includes:

- project-scoped Boards with persisted viewport and placement data;
- note, chat, automation, and job-result placements;
- placement movement, resizing, collapsing, and maximizing;
- Board note creation, editing, and deletion;
- Board chat and automation creation with idempotency protection;
- automation editing, local execution, and result placement;
- revision-aware Board updates and `409` conflict handling;
- starter choices including a clean Board, Simple Agent, Vector Store RAG,
  and the starter gallery;
- a React and TypeScript frontend using React Flow, TanStack Query, Zustand,
  and i18next;
- a Python and FastAPI backend with versioned APIs and persistence services;
- KFX as the component and lightweight execution SDK;
- extension bundles and a versioned Bundle API;
- English and Russian interface catalogs.

Claims about a hosted service, production rollout, production-grade
multi-client collaboration, complete offline operation, regulatory compliance,
or additional shipped languages are not supported.

## README structure

The root README will contain:

### Header and status

- project name and one-sentence description;
- a visible active-alpha statement;
- low-maintenance MIT and alpha badges only;
- navigation links to quick start, status, documentation, contributing, and
  security.

A CI badge will not be added while the public repository has failing scheduled
or inherited workflows.

### Product visual

Use one current static screenshot that shows real Board behavior. The image
must not contain secrets, personal data, browser chrome, debugging overlays, or
internal audit labels. It should use the English interface and show a coherent
combination of Board placements when a clean capture can be produced.

If a clean and truthful capture cannot be produced, the README will ship
without a hero image rather than use an obsolete or misleading visual.

### Problem and users

Explain that AI-workflow work is often split among chat tools, visual editors,
automation controls, and execution output. Ketos brings those artifacts
together in a persistent spatial workspace while retaining a programmable
runtime and extension boundary.

The intended audience is developers, automation builders, technical teams, and
contributors prototyping and inspecting AI workflows locally.

### Unified Canvas

Describe the Canvas as a spatial workspace that can be panned and zoomed and
that persists its viewport and item layout. Use “infinite Canvas” as the product
concept, not as a mathematical or scalability guarantee.

Document the four verified placement kinds and the current interaction model.
Do not imply real-time multiplayer editing.

### Capabilities and examples

Use concise examples grounded in shipped starters and current Board behavior:

- create a simple agent workflow;
- assemble a retrieval workflow from the Vector Store RAG starter;
- keep notes, an AI conversation, an automation, and its output on one Board;
- author or run reusable components through KFX.

Provider credentials and component-specific setup will be presented as
workflow-dependent requirements.

### Quick start

Document only the supported source workflow:

```bash
make init
make run_cli
```

State the verified prerequisites and the default local address. Link to
`DEVELOPMENT.md` for hot reload, testing, and component development.

### Architecture

Provide a short narrative and component table covering:

- `src/frontend`;
- `src/backend/base/ketos`;
- `src/kfx`;
- `src/bundles`.

Explain the server-authoritative Board model, TanStack Query server cache,
transient Zustand state, revision conflicts, and stable persisted component
class names without reproducing API-reference detail.

### Status, limitations, and roadmap

Use a status table with these categories:

- Implemented in the local alpha;
- In development;
- Planned;
- Not currently provided.

The limitations section will explicitly cover:

- no hosted production service;
- APIs and user experience may change before a stable release;
- additional PostgreSQL-backed multi-client hardening remains;
- broader browser and deployment validation remains;
- only English and Russian are currently shipped;
- external AI or data services may still receive data when a configured
  workflow calls them.

Roadmap themes will remain outcome-based and undated:

- runtime and concurrency hardening;
- Canvas and workflow usability;
- extension and documentation maturity;
- broader browser and deployment validation;
- Kazakh, Kyrgyz, Tajik, Uzbek, and other regional languages.

### Regional context

The README will state that the initial product and community focus includes
Kazakhstan, Russia, and other CIS countries. It will distinguish current
English and Russian interface coverage from planned regional languages.

It will not claim regional hosting, data residency, compliance, customer
adoption, or market leadership.

## Related public documentation

The documentation update includes:

- `CONTRIBUTING.md`: replace the test repository URL, clarify the pull-request
  workflow, and retain links to contributor guides;
- `SECURITY.md`: remove the test-fork language and test email, direct private
  reports to GitHub private vulnerability reporting, and state alpha security
  limitations;
- `CODE_OF_CONDUCT.md`: remove the unusable test contact and provide an honest
  private-contact escalation procedure without exposing personal contact data;
- `docs/docs/development/board-workspace.md`: replace the obsolete Stage 03
  boundary with the current Board and placement contract;
- `src/kfx/README.md`: replace public test-domain repository links where an
  accurate GitHub or repository-relative target exists;
- `docs/docs/index.mdx`: align the documentation landing page with the public
  README's current product and alpha status.

Internal handoff reports remain engineering evidence and will not be presented
as public product documentation. Unrelated planning files, generated files,
locks, deployment configuration, `LICENSE`, and `NOTICE` remain unchanged.

## Verification

Before publication:

1. review every feature claim against current source or accepted repository
   evidence;
2. run `git diff --check`;
3. scan public-facing Board documentation for stale stage boundaries, and scan
   every changed document for `git.ketos.test`, `docs.ketos.test`,
   `@ketos.test`, and unsupported product claims;
4. run the documentation link checker and build, including every changed KFX
   link and the documentation landing page;
5. verify commands and versions against the current Makefiles and manifests;
6. inspect rendered Markdown locally or through GitHub;
7. confirm that private vulnerability reporting is enabled;
8. publish through a pull request to `factor241/Ketos`;
9. inspect the public repository page in Chrome after merge.

Application-wide test suites are not required for text-only changes unless a
documentation contract check or repository workflow indicates a broader
regression.

## Acceptance criteria

The work is complete when:

- the public README contains every user-requested topic in clear English;
- implemented and planned capabilities are visibly distinguished;
- all changed public documentation uses real repository and reporting paths;
- no personal application information is added;
- no unsupported production, security, adoption, compliance, or localization
  claim is introduced;
- documentation verification passes or any external blocker is reported
  precisely;
- the changes are merged into the public default branch, and its GitHub page
  renders correctly without authentication.
