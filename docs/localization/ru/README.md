# Russian localization governance

This directory contains current Ketos localization contracts. The Stage 7
cutover classified the eleven files that still carried pre-cutover markers:

- retained and rewritten for current Ketos paths and names:
  `evidence/preferred-locale-postgresql.json`, `glossary.md`, `maintenance.md`,
  `release-rollout-rollback.md`, `style-guide.md`, `surface-manifest.csv`, and
  `translation-boundary.md`;
- removed as historical point-in-time evidence: the R0 audit snapshot, both
  R11 canary/metrics snapshots, and the old exhaustive route acceptance report.

`flow-abi-evidence.md` and `linguistic-review.md` were already current and remain
owned by localization maintenance. Release acceptance is owned only by Stage 11
of `KETOS_RENAME_REMAINING_WORK_PLAN.md`; this directory has no independent
acceptance task.
