# Bundles & the nightly build

> **Status:** Approach A (canonical pre-releases) is **implemented in this PR**. The guard against
> premature activation is the [activation gate](#activation-gate-must-read) below — **not** merge or
> draft state: this must **NOT** be merged/activated until stable `kfx 1.10.0` is published **and**
> the nightly's base version has moved to the next minor. Sibling docs: [PORTING.md](./PORTING.md).

## Goal

Have **both** the normal release and the nightly depend on the regular published `kfx-*` bundle
packages, and **stop producing nightly bundle packages** (`kfx-arxiv-nightly`, …). The nightly
bundle track is pure overhead — bundle code is low-churn and does not need a per-night rebuild.

## The bundles

Four bundles are extracted as standalone PyPI packages (the only dirs here with a `pyproject.toml`):

| Package          | Dir                       | Version | PyPI    |
| ---------------- | ------------------------- | ------- | ------- |
| `kfx-arxiv`      | `src/bundles/arxiv`       | `0.1.0` | ✅ live |
| `kfx-docling`    | `src/bundles/docling`     | `0.1.0` | ✅ live |
| `kfx-duckduckgo` | `src/bundles/duckduckgo`  | `0.1.0` | ✅ live |
| `kfx-ibm`        | `src/bundles/ibm`         | `0.1.0` | ✅ live |

Each pins `kfx>=1.10.0,<2.0.0` and is wired into the root `pyproject.toml` as a direct dependency
(`kfx-*>=0.1.0`), a `[tool.uv.sources]` workspace entry, and a `[tool.uv.workspace]` member. **The
bundles are unchanged by this PR.**

## The normal release already meets the goal

Stable `ketos 1.10.0` → `kfx-*>=0.1.0` → `kfx>=1.10.0,<2.0.0` → stable `kfx`. One consistent,
canonical `kfx`. No change needed there.

## Background: why the nightly renamed the bundles (removed by this PR)

The old nightly published the core as a **separate distribution**, `kfx-nightly` — but the rename
only rewrote `[project].name`; the wheel still shipped the **same `kfx/` import package**. So a
`ketos-nightly` depending on a *stable* bundle would drag in **stable `kfx` alongside
`kfx-nightly`** — two distributions both owning `site-packages/kfx/` → an install-time collision.
To avoid that, the nightly gave the bundles their own `-nightly` track (`update_kfx_dep_in_bundles`
+ `rename_bundles_for_nightly` in `update_kfx_version.py`). Approach A removes the dual-distribution
design entirely, so that bundle renaming is no longer needed.

## What this PR changes (Approach A — canonical pre-releases)

Publish the nightly under the **canonical** package names as `.devN` pre-releases (`kfx==X.Y.Z.devN`,
`ketos==…`, `ketos-base==…`, `ketos-sdk==…`) instead of separate `*-nightly` distributions.
A single canonical `kfx` then exists, so the stable bundles resolve cleanly — **no bundle changes**.

- **Stop renaming the core.** `update_kfx_version.py`, `update_pyproject_combined.py`,
  `update_sdk_version.py` no longer rename to `*-nightly`; they only set the `.devN` version and
  re-pin inter-package deps to **exact canonical dev versions** (`ketos-base[complete]==<dev>`,
  `kfx==<dev>`, `ketos-sdk==<dev>` — via `update_uv_dependency.py` / `update_lf_base_dependency.py`).
  The exact dev pins also enable pre-release resolution down the tree, so the bundles' `kfx>=…`
  range latches onto the dev `kfx`.
- **Drop the bundle nightly track.** `update_kfx_dep_in_bundles()` and `rename_bundles_for_nightly()`
  are deleted; bundles keep their stable names + `kfx>=1.10.0,<2.0.0` pins.
- **Version math.** `pypi_nightly_tag.py` / `kfx_nightly_tag.py` / `sdk_nightly_tag.py` count `.devN`
  against the **canonical** PyPI histories (`ketos` / `ketos-base` / `kfx` / `ketos-sdk`),
  not the `*-nightly` projects. The base version is still read from the pyproject of the latest
  `release-*` branch the nightly builds from (see `nightly_build.yml`'s `resolve-release-branch`),
  so it tracks the release cadence automatically.
- **Publish workflow.** `release_nightly.yml` publishes canonical pre-releases; the bundle build
  step, the `dist-nightly-bundles` artifact, the `publish-nightly-bundles` job, and its gate in
  `publish-nightly-main` are removed. Verify steps now expect canonical names; the main wheel glob
  is `dist/ketos-*.whl`.

## Activation gate (MUST READ)

Do **not** merge/activate until **both**:

1. **Stable `kfx 1.10.0` is published to PyPI** (the bundles' `kfx>=1.10.0` floor must be satisfiable
   by a real release), **and**
2. **The nightly's base version is the next minor** (i.e. the latest `release-*` branch is
   `release-1.11.0`, so nightlies are `1.11.0.devN`).

Why (2) is not optional: a bundle pins `kfx>=1.10.0,<2.0.0`, and PEP 440 sorts `1.10.0.devN`
**below** `1.10.0`. So a `1.10.0.devN` nightly is **not** `>= 1.10.0` — `ketos-base`'s exact
`kfx==1.10.0.devN` pin would directly conflict with the bundle's `kfx>=1.10.0` floor and resolution
**fails**. Only a next-minor dev (`1.11.0.devN`, which *is* `>= 1.10.0`) resolves. The nightly runs
daily from **main's** workflow definition, so merging this before the gate would break the live
nightly on the next run.

> **Post-activation fix (2026-06):** condition (2) as stated was still fragile — the `release-1.11.0`
> fork's `make patch v=1.11.0` re-synced every bundle floor to `kfx>=1.11.0`
> (`scripts/ci/sync_bundle_kfx_pin.py`), which sorts **above** that same branch's `1.11.0.devN`
> nightlies and reintroduced exactly this conflict on the very first `1.11.0.dev0` nightly (the
> workspace-built bundle's metadata shadows the satisfiable PyPI `0.1.1` in the
> `uv pip install dist/*.whl` test step). The synced floor format is now
> `kfx>=X.Y.0.dev0,<(X+1).0.0` — `X.Y.0.dev0` is the lowest version PEP 440 admits in the minor
> line, so every `devN` / `rcN` / final satisfies it while older lines stay excluded, and the gate
> can no longer regress on future minor forks.

## A1 vs A2 + remaining follow-ups (decide before activating)

This PR implements the **A1** publish behavior: the separate `ketos-nightly` / `ketos-base-nightly`
/ `kfx-nightly` distributions go away; the nightly is installed via `pip install --pre ketos`.

Addressed here (consumers of the dropped `*-nightly` PyPI names, so the cutover stays self-consistent):

- **Runtime nightly detection.** `_get_version_info` (`src/backend/base/ketos/utils/version.py`,
  `test_version.py`) now derives the "Nightly" label from the `.dev` version marker — the canonical
  `ketos` distribution matches first, so the package *name* alone no longer identifies a nightly.
  Keeps the startup banner and telemetry `package` field correct.
- **CI nightly consumers.** `ci.yml`'s `check-nightly-status` inspects the latest `.devN` release of
  the canonical `ketos` project (not `ketos-nightly`); `db-migration-validation.yml` installs
  the nightly as `ketos[postgresql]==<dev>` instead of `ketos-nightly[...]`.
- **KFX install doc.** `src/kfx/README.md` nightly install is now `uv pip install --pre kfx`.

Still open (deferred by design — decisions, not blockers):

- **Docker nightly image.** `ketosai/ketos-nightly` (Docker Hub) is independent of the PyPI
  name and works as-is; decide whether to keep or rename.
- **Website install docs.** Any `pip install ketos-nightly` instructions on the docs site (not in
  this repo) should become `pip install --pre ketos`.
- **A2 alternative (preserve the install name).** Instead of dropping `ketos-nightly`, keep it as
  a thin meta-package pinning `ketos==X.Y.Z.devN`. The scripts already produce exact dev pins, so
  A2 only adds a meta-package publish step and leaves the `pip install ketos-nightly` UX intact.

## Approach B (alternative, not taken)

Move each bundle's `kfx` dependency into an extra (e.g. `kfx-<name>[standalone]`) so the same wheel
is safe inside a `kfx-nightly` env; keep the `-nightly` core and the `pip install ketos-nightly`
UX. Downside: standalone `pip install kfx-arxiv` no longer auto-installs `kfx`, and bundles must
re-publish as `0.1.1`.

## Verification (run against this branch)

- `scripts/ci/test_pypi_nightly_tag.py` passes (15/15) with canonical URLs.
- Tag scripts run live against canonical PyPI and emit `vX.Y.Z.dev0` (no `*-nightly` counted).
- Dry-run `update_sdk_version.py` / `update_kfx_version.py` / `update_pyproject_combined.py` with
  `v1.11.0.dev0` tags → all packages keep canonical names; versions set; pins become
  `ketos-base[complete]==1.11.0.dev0`, `kfx==1.11.0.dev0`, `ketos-sdk==…`; **no** `src/bundles/*`
  file is touched.
- Both workflows are valid YAML; no `publish-nightly-bundles` job remains.
