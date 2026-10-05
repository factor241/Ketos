# Agent Note: Fork-owned CI for factor241/Ketos

Status: implemented

English | [中文](2026-10-03-ketos-fork-ci.zh.md)

## Problem

Stage 22's MVP acceptance had no CI signal from the fork. Upstream `ci.yml` pins its Linux and Windows jobs to the upstream organization's enterprise runners (`dsh-ubuntu-24-04-16core`, `dsh-windows-2025-16core`) and resolves failover pools through `DSH_CI_FAILOVER_*` variables that the fork does not set, so those jobs stay queued; `ci-master.yml` listens to `master` pushes and runs on self-hosted pools; the E2E workflow died before reaching the tests because the pinned `bubblewrap_0.9.0-1ubuntu0.1` payload disappeared from `archive.ubuntu.com`; and the fork holds no secrets. Acceptance rested on local gates only.

## Decision

The fork owns one CI workflow, [.github/workflows/ketos-ci.yml](../../../../.github/workflows/ketos-ci.yml), and disables the upstream infrastructure workflows it cannot run.

- `ketos-ci` triggers on `push` to `main`, `pull_request` into `main`, and `workflow_dispatch`. Its `linux / node 24` job runs on `ubuntu-24.04`: `pnpm install --frozen-lockfile`, `scripts/prepare-ci-bubblewrap.sh`, `pnpm run build`, `typecheck`, `lint`, `test:gui`, `doc-sync`, `hygiene`, and `DSH_SNAPSHOT=replay pnpm run test:web:built`. Parallelism values match the 4-core row of ci-master.yml's consolidated topology.
- A `coverage` job of the same workflow runs `pnpm run check:ci:coverage` (with `DSH_COVERAGE_TEST_TIMEOUT_MS=90000`) on a daily schedule and manual dispatch only; pull requests skip it.
- [scripts/prepare-ci-bubblewrap.sh](../../../../scripts/prepare-ci-bubblewrap.sh) is upstream's file: it downloads the pinned `0.12.0-1` payload from a fixed Launchpad build URL, and `sha256sum --check` stays mandatory. The fork's Launchpad-first modification is retired because upstream moved to the same permanent URL.
- The fork deliberately leaves `DEEPSEEK_API_KEY_EXTERNAL` unconfigured: its owner runs Ketos through the OpenCode Go subscription, and the E2E job remains a built-app check (bubblewrap, the official build, the example bins) whose real-API cases self-skip. The preflight in [.github/workflows/e2e.yml](../../../../.github/workflows/e2e.yml) reports the missing key as a warning instead of failing; re-recording session goldens needs the key and runs outside CI. With the payload fixed, the suite reaches the tests; the one failing keyless assertion — the CLI help line still expected `dsh plugin --profile` after the stage-0.3 `ketos` rebranding — now expects `ketos plugin --profile`.
- Infrastructure workflows that need absent secrets, environments, or runners are recorded in [docs/ketos/ci-fork.md](../../../../docs/ketos/ci-fork.md): seven are disabled through `gh workflow disable`, and eleven files the Actions registry has not registered on `main` cannot be disabled through the API and do not trigger on pull requests or `main` pushes. Upstream `ci.yml` and `ci-master.yml` stay byte-identical as the reference for future upstream acceptances.

## Alternatives considered

**Retarget upstream `ci.yml` through `DSH_CI_FAILOVER_LINUX`.** Setting the variable to `blacksmith` needs a Blacksmith account, and `selfhosted` needs the upstream organization's in-house pool; any edit to `ci.yml` also conflicts on every upstream sync. Lost: the fork would inherit a workflow designed around a fleet it does not have.

**Run a self-hosted runner for the fork.** Lost: operating a fleet for a product checkpoint does not justify the infrastructure; standard hosted runners are free for the public fork.

**Keep every upstream workflow enabled.** Lost: pull requests carry permanently queued or red infrastructure checks, hiding the gates that do work.

**Move the bubblewrap download to the current `0.9.0-1ubuntu0.3` payload.** Lost: the pinned SHA256 would change with every Ubuntu point release, and the gate wants a fixed, verified byte payload.

## Consequences

`ketos-ci` is the fork's required Linux signal and must track gate-list changes in upstream `ci.yml`. Windows, the Python runtime matrix, benchmarks, and self-hosted standbys are not covered in the fork; the local Wine gate remains the Windows diagnostic. Keyless E2E runs report green while every real-API case self-skips; because the fork does not configure the key (OpenCode Go), re-recording session goldens stays outside CI. One upstream file carries a recorded fork edit, logged in [docs/ketos/upstream-sync.md](../../../../docs/ketos/upstream-sync.md): `.github/workflows/e2e.yml` (warning preflight); `scripts/prepare-ci-bubblewrap.sh` is back to the upstream file. The [upstream real-API CI note](../testing/2026-06-19-real-api-e2e-ci.md) keeps its upstream design and cross-links here.

## Testing

`ketos-ci` runs its gates on every pull request; the bubblewrap script keeps the SHA256 check mandatory, and `bash -n scripts/prepare-ci-bubblewrap.sh`, `actionlint`, and `pnpm run doc-sync` pass locally.

## Related

- [.github/workflows/ketos-ci.yml](../../../../.github/workflows/ketos-ci.yml) — the fork workflow.
- [docs/ketos/ci-fork.md](../../../../docs/ketos/ci-fork.md) — what runs, what is disabled, how to re-enable, how to add the E2E key.
- [Real-API e2e in CI against the external DeepSeek API](../testing/2026-06-19-real-api-e2e-ci.md) — upstream design the fork preflight deviates from.
- [docs/ketos/upstream-sync.md](../../../../docs/ketos/upstream-sync.md) — divergence ledger.
