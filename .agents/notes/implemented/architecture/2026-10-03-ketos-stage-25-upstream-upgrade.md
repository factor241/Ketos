# Agent Note: Ketos stage 25: the core upgrade to dsh-v0.2.0-rc.2

Status: implemented

English | [中文](2026-10-03-ketos-stage-25-upstream-upgrade.zh.md)

## Problem

The Ketos fork stood on the upstream 0.1.5-rc.2 release line plus stages 1–24 and could not take a newer release with an ordinary merge: `main` began at a synthetic import root whose tree equalled the upstream base commit but which had no ancestor relationship to upstream history, so `git merge <tag>` had no merge base to work from. Upstream had meanwhile cut the 0.2.0 release candidates; the board, clone core, and Russian locale import from 66 upstream packages, and almost every file at the other end had changed. The release also carried breaking changes the fork consumes: session log format v3 → v4, renamed packages (`agent-presets` → `agent-preset-registry`, `code-runtime` → `ptc-runtime`, `fs/tool-present` → `deliverables/tool-present`), reworked conversation records that feed the board's tool cards, the new desktop application, and product analytics enabled by default. The OpenCode Go subscription depended on a fork edit upstream does not carry (the `x-opencode-session` header in `llm-pi-ai`), and a trial merge reported 109 conflicting files.

## Decision

**Р-1 — the target is `dsh-v0.2.0-rc.2`.** It is the release-candidate slice closest to stable; `dsh-v0.2.1-alpha.1` (three more conflicts) is left to the next ordinary synchronization.

**Р-2 — one-time local root graft, then ordinary merges.** `git replace --graft` attached the synthetic import root to the upstream base commit, the tag merged with `--no-ff` in `stage-25-upstream-0.2.0-rc.2`, and the replacement was deleted immediately after the merge commit. The replacement never reached a remote; `main` now has the tag commit as a real merge base, and every later acceptance is `git merge --no-ff <tag>` in a `sync/<tag>` branch.

**Р-3 — analytics and telemetry stay off in Ketos profiles.** `packages/bundle/web-app/cordis.patch.yml` disables `desktop-product-telemetry` and sets `product-analytics` to `enabled: false`; the rewritten `packages/bundle/web-app/tests/product-analytics.spec.ts` pins the policy for the `desktop` and `web` profiles and asserts that neither service activates.

**Р-4 — `apps/desktop` is not built or rebranded.** Ketos remains a web product; the Electron app stays upstream-owned.

**Р-5 — the DeepSeek account stays mounted as upstream but is inert in the web profile.** `deepseek-account-platform` receives `desktopPlatform: null` outside the `desktop` profile and the client half leaves `apply` without `globalThis.dshDesktop`, so account pages and RPC never activate in Ketos web; sign-in goes through providers, including OpenCode Go.

**Р-6 — every new UI key is translated.** `@ketos/client-locale-ru` grew from 44 to 58 namespaces and 2,472 keys, covering the new settings pages, sidebar tabs, plugin manager, and shortcuts.

**Р-7 — the upgrade is stage 25.** It was planned, tracked, and accepted like stages 1–24.

**Fate of the fork edits.** Ported over the new upstream code: `x-opencode-session` in `llm-pi-ai` (first, with its `opencode-go` adapter test), `keepDefault` in `selectModel`, the tooltip and menu portal via `PopoverHost`, the `StateDot` reduced-motion rule, the public `SessionInput.addFiles`/`takeDraft` and the `conversation.session.header.blank` slot, `sidebar.brand.actions`, `ILayout.declarePanelSidebar`, and `blockPagePinchZoom`. Kept by automatic merge: `workspace/invalid-path` rejecting `$DSH_HOME`/`~/.ketos`/`~/.dsh`, the `@ketos/*` client-bundle purity branch, and the keyless E2E warning preflight. Retired because upstream or the fork no longer needs them: the `vendor/hmr` `registerConfig` polling (`boot/hmr`'s `watch-config` owns the scenario), the local fullscreen glyphs in `ui-sidebar-right` (upstream replaced the artwork), the Launchpad URL in `prepare-ci-bubblewrap.sh` (upstream pins a permanent build URL), and `ISessions.openStream`, replaced by upstream ownership semantics: the board now retains each window session with `retain(sessionId, { source: 'boardWindow' })` and releases it on unbind, so restoring a layout never changes the application's current session.

**Session data.** The v3 → v4 migration is adjacent: opening a stored v3 session adds a `session.v4.jsonl.zstd` successor and leaves the committed v3 generation byte-identical; `clones.db` is untouched.

**First run on real data.** `SettingsForms.importLegacyDocument` renames `~/.ketos/settings.yaml` to `settings.yaml.imported` before the first write and imports each section into the active profile's `cordis.patch.yml` (web is the only profile Ketos builds); the profile patch becomes the source of truth and the renamed file remains as the pre-upgrade snapshot. The transition procedure and rollback live in [`docs/ketos/upstream-sync.md`](../../../../docs/ketos/upstream-sync.md).

**Stand rule.** Every stand and test run against stored data uses a temporary `DSH_HOME` guarded by `test -n "$DSH_HOME" && [ "$DSH_HOME" != "$HOME/.ketos" ] || exit 1`. A stand run during this stage that omitted `DSH_HOME` rewrote `~/.ketos/profiles/web/cordis.yml` and `cordis.patch.yml`; both files were restored from the stage archive and no session, `clones.db`, or storage file was affected.

## Alternatives considered

**Import the upgrade as a snapshot.** Applying `git diff <base> <tag>` as one commit is simpler than resolving 109 conflicts, but it leaves `main` without upstream history and every later release needs another hand-built base. Lost: provenance and one-command future syncs.

**Target `dsh-v0.2.1-alpha.1`.** Fresher by four days with three more conflicts, but an alpha branch that keeps moving; the release candidate is the stable-adjacent slice.

**Delete the analytics and telemetry rows from the profile.** Removing the packages would delete upstream-owned code from the tree and lose one-line reversibility; `enabled: false` and `disabled: true` keep the packages loadable and the policy test pins the choice.

**Disable the DeepSeek account rows in the web profile.** The first attempt removed the rows and broke the packages' own Loader-based tests (27 host tests, 9 web scenarios), which expect the rows to be present; upstream's desktop gate already makes the account inert outside `desktop`, which is the isolation Ketos wants.

**Rebrand and build `apps/desktop` now.** The desktop app is not a Ketos product; branding it would commit to maintaining a second client.

**Exclude the new UI packages from the Russian locale.** The locale gate would fail by design and users would see English; translating the keys is the requirement.

## Consequences

`main` gains real upstream history through the merge commit: upstream commits are reachable by an ancestor walk, later releases merge with one command, and the synthetic root remains below as historical residue. The one-time cost was 109 resolved conflicts, 17 re-decided fork edits, regenerated catalogs and translation pairs, and refreshed web goldens. The board and clone core run on v4 conversation records and owned window sessions; OpenCode Go works through the ported header (adapter tests plus live rounds); analytics and telemetry are off in every Ketos profile; the account surfaces exist as upstream but cannot activate outside desktop. Two known non-regressions: `plugin-install-github` (two scenarios) fails through the host's Git/GitHub access on a clean upstream checkout too, and the macOS per-file coverage gap for `readProcessStart` is closed by the Linux CI lane. Verification: `pnpm run typecheck`, `lint`, `test:gui` (644 files, 10,219 passed, 0 failed), `DSH_SNAPSHOT=replay pnpm run test:web` (635 passed, 2 known failures), `board-geometry.e2e.ts` 35/35, `doc-sync` 43/43, `hygiene` 18/18, `build`, `check:ci:coverage`, and live OpenCode Go rounds; the stage report and CI evidence live in [`docs/ketos/reports/stage-25-upstream-upgrade.md`](../../../../docs/ketos/reports/stage-25-upstream-upgrade.md).

## Related

- [`docs/ketos/upstream-sync.md`](../../../../docs/ketos/upstream-sync.md) — the base tag, the merge procedure, and the fork-edit ledger with per-edit verification.
- [`docs/ketos/reports/stage-25-upstream-upgrade.md`](../../../../docs/ketos/reports/stage-25-upstream-upgrade.md) — the stage report: gate numbers, conflict list, and data checks.
- [Ketos repository home and stage worktrees](../process/2026-09-14-ketos-repository-and-stage-worktrees.md) — the repository layout and worktree policy this upgrade advances.
