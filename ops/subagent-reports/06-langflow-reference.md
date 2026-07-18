# Subagent 06 — Langflow upstream reference

Status: **DONE**

## Scope

Created only:

- `references/langflow-upstream/` — an independent Git clone of the official
  Langflow repository;
- `references/langflow-upstream.lock.json` — the parent-side immutable
  reference record;
- `ops/subagent-reports/06-langflow-reference.md` — this report.

The parent `.gitignore`, repository config, skills, `AGENTS.md`, `CLAUDE.md`,
Ketos source code, generated Graphify artifacts, and unrelated dirty state were
not modified. No commit was created.

## Pinned upstream reference

| Field | Value |
|---|---|
| Official URL | `https://github.com/langflow-ai/langflow.git` |
| Tag | `v1.10.2` |
| Tag commit | `a69a47ff1b5c99ce9c50edc4df45de4397151f17` |
| Checkout | detached `HEAD` at the exact tag commit |
| Clone status | clean, zero porcelain status lines |
| Initialized submodules | zero |
| Clone size | `976M` total (`999044 KiB`) |
| Clone `.git` size | `762M` (`780080 KiB`) |

The clone was created with:

```text
git clone --branch v1.10.2 --single-branch --no-recurse-submodules \
  https://github.com/langflow-ai/langflow.git \
  references/langflow-upstream
```

No file inside the clone was modified after checkout.

## Ketos ancestry verification

The comparison uses only committed history. Existing parent working-tree
changes are not included.

```text
git rev-parse HEAD
572fad8ea2223e342508ecf095133091c7714e1b

git rev-parse 'v1.10.2^{commit}'
a69a47ff1b5c99ce9c50edc4df45de4397151f17

git merge-base HEAD 'v1.10.2^{commit}'
a69a47ff1b5c99ce9c50edc4df45de4397151f17

git rev-list --count 'v1.10.2^{commit}..HEAD'
70
```

Result: the local Ketos tag `v1.10.2` is the exact merge base of the current
fork `HEAD`, and the fork is **70 commits ahead** of that base.

## Read-only committed diff statistics

Full rename detection was enabled transiently with
`git -c diff.renameLimit=10000`; repository config was not changed.

```text
6311 files changed, 183502 insertions(+), 382574 deletions(-)

Added:    561
Deleted:  2126
Modified: 1589
Renamed:  2035
```

Changed path counts without rename collapsing:

| Area | Changed paths |
|---|---:|
| `src/backend` | 2145 |
| `src/lfx` | 1370 |
| `src/kfx` | 1344 |
| `src/frontend` | 1008 |
| `docs` | 1908 |
| `scripts` | 129 |
| `src/bundles` | 75 |
| `brand` | 53 |
| `src/ketos-stepflow` | 49 |
| `.github` | 41 |
| `src/sdk` | 40 |
| `src/compat` | 38 |
| `docker` | 17 |
| `deploy` | 11 |

These counts intentionally expose both sides of large namespace moves; the
rename-aware total above is the canonical overall diff statistic.

## High-level architectural delta

1. **Backend application namespace and platform services.** The dominant
   cutover moves the application surface from
   `src/backend/base/langflow/**` to `src/backend/base/ketos/**`, including API
   routes, services, database-facing code, configuration, starter flows,
   localization catalogs, deployment adapters, and the new brand-state
   enforcement surface.
2. **Executor, component, and SDK ecosystem.** The `lfx` executor/component
   tree is replaced by the canonical `kfx` tree, with corresponding tests,
   bundles, Ketos Stepflow integration, SDK naming, and explicit compatibility
   distributions under `src/compat`.
3. **Frontend product shell.** The React application changes span core
   components, API controllers, Main/Flow/Settings pages, modals, stores,
   routes, authorization, knowledge-base UI, theming, account/sidebar
   controls, and the RU/EN localization contract.
4. **Brand, docs, and public assets.** The fork replaces the upstream product
   identity across documentation, locale catalogs, visual assets, starter
   templates, legal compatibility records, and zero-residue brand checks.
5. **Packaging, release, CI, and deployment.** Changes cover workspace
   manifests, release artifact generation, compatibility packages, nightly
   versioning, GitHub Actions, Docker assets, and deployment/provider runtime
   contracts.
6. **Verification and migration contracts.** Large backend and frontend test
   changes enforce destructive namespace cutover, compatibility boundaries,
   localization completeness, packaging integrity, deployment behavior, and
   current-only runtime identities.

## Graphify cross-check

The existing graph was queried read-only with vocabulary-expanded terms:

```text
backend frontend kfx localization extension workflow deployment sdk executor brand route service
```

The traversal independently surfaced the same current-fork architecture:

- `BrandStateEngine` at
  `src/backend/base/ketos/brand_state/engine.py:L353`;
- deployment API/contracts under
  `src/backend/base/ketos/api/v1/deployments.py` and its mappers;
- frontend routing and state under `src/frontend/src/routes.tsx`,
  `flowStore.ts`, and `flowsManagerStore.ts`;
- KFX adapter contracts under
  `src/kfx/src/kfx/services/adapters/payload.py`;
- knowledge-base UI under
  `src/frontend/src/pages/MainPage/pages/knowledgePage/`.

Graphify reported that the existing graph uses its pre-`#1504` node-ID scheme.
No graph rebuild, reflection write, vocabulary sidecar, or saved query result
was produced because generated artifacts were outside this task's scope.

## Verification result

The upstream URL, exact tag, clone `HEAD`, parent tag, and merge base all resolve
to `a69a47ff1b5c99ce9c50edc4df45de4397151f17`. The clone is clean and detached,
the parent fork count is exactly 70 commits ahead, the lock file is outside the
clone, and no commit was created.
