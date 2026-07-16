# Subagent 14 — LangFlow knowledge corpus provenance

**Status:** DONE
**Workspace:** `/Volumes/Projects/ketos_canvas_mod_main`
**Manifest generated:** `2026-07-16T18:45:51.263Z`

## Outcome

The knowledge-corpus gap is closed with a separate provenance:

- provenance: `langflow-upstream@v1.10.2`;
- tag: `v1.10.2`;
- pinned and current checkout SHA:
  `a69a47ff1b5c99ce9c50edc4df45de4397151f17`;
- source checkout: `references/langflow-upstream`;
- checkout status: clean, detached at the exact tag commit.

The manifest now inventories the focused tracked LangFlow documentation corpus
without adding upstream application code, repository-wide JSON/fixtures,
dependencies, generated Graphify output, binary assets, or lockfiles.

## Candidate definition

The source of truth was:

```bash
git -C references/langflow-upstream ls-files
```

The focused candidate set is the exact tracked union of:

1. `.md`, `.mdx`, and `.txt` files under `docs/`;
2. key tracked root `.md`, `.mdx`, and `.txt` documents.

This selected **918 files / 6,248,923 bytes** from the clean pinned checkout.
The regression test reconstructs this set from `git ls-files` and proves that
every selected candidate is emitted exactly once as either included or
individually excluded.

The following are intentionally outside the candidate boundary:

- `.git` metadata;
- dependency trees such as `node_modules`;
- upstream Python, JavaScript, TypeScript, shell, CSS, and other code;
- JSON API payloads and JSON fixture corpora;
- `docs/package-lock.json` and other lockfiles;
- PNG, SVG, GIF, ICO, ZIP, and other binary/static media;
- generated site/runtime output;
- `graphify-out`.

Because those paths do not enter the focused text-document scan, they do not
create artificial per-file exclusions. Every path that does enter the scan and
is rejected is present in `manifest.excluded` with a concrete reason.

## LangFlow counts and bytes

| Measure | Files | Bytes |
|---|---:|---:|
| Focused tracked candidates | 918 | 6248923 |
| Included safe documentation | 786 | 5030435 |
| Individually excluded candidates | 132 | 1218488 |

### Included by type

| Type | Files | Bytes |
|---|---:|---:|
| `markdown` | 26 | 621866 |
| `mdx` | 758 | 4399176 |
| `text` | 2 | 9393 |

### Excluded by reason

| Reason | Files | Bytes |
|---|---:|---:|
| `sensitive-content` | 96 | 1209416 |
| `generated-api-example-result` | 33 | 8697 |
| `documentation-fixture` | 3 | 375 |

Sensitivity classification uses `raytsystem_secret_patterns` v`1.2.0`.
Excluded sensitive entries contain only path, provenance, type, size, and the
generic reason; no matched value, excerpt, scanner reason code, or content hash
is stored.

## Recomputed full-manifest totals

One pre-existing included Ketos file had changed since the prior inventory:
`skills/raytsystem-watch/SKILL.md` is now 3,233 bytes instead of 2,790 bytes.
Its size and SHA-256 were refreshed from current working-tree bytes. No source
file was modified.

| Measure | Files | Bytes |
|---|---:|---:|
| All candidates | 1754 | 31068661 |
| All included | 1587 | 17500285 |
| All excluded | 167 | 13568376 |

### Included by provenance

| Provenance | Files | Bytes |
|---|---:|---:|
| `ketos` | 267 | 10177321 |
| `raytsystem@b5ac705` | 534 | 2292529 |
| `langflow-upstream@v1.10.2` | 786 | 5030435 |

### Eligibility

- Documents-eligible Markdown/MDX (`<= 5 MiB`):
  **1125 files / 7055273 bytes**.
  LangFlow contributes **784 files / 5021042 bytes**.
- Ingestion-eligible offline types (`<= 25 MiB`):
  **814 files / 13034721 bytes**.
  LangFlow contributes **28 files / 631259 bytes**.
- LangFlow MDX is Documents-eligible but remains outside the current offline
  ingestion extension set.

## TDD evidence

### RED

After adding the missing-provenance assertion first:

```bash
node --test scripts/knowledge-corpus-manifest.test.mjs
```

exited `1` with **3 passed / 2 failed**. The new failure was:

```text
langflow-upstream@v1.10.2 provenance must be present
```

The other failure exposed the pre-existing current-byte drift in
`skills/raytsystem-watch/SKILL.md`; this was corrected by the required
full size/hash recomputation.

### GREEN

After manifest generation and expected-total updates:

```bash
node --test scripts/knowledge-corpus-manifest.test.mjs
```

exited `0` with **5 passed / 0 failed**. The test now verifies:

- exact provenance id, tag, SHA, path, status, and clean checkout;
- live checkout `HEAD` and exact tag match;
- exact candidate partition reconstructed from `git ls-files`;
- tracked-only docs/root scope and `.md/.mdx/.txt` boundary;
- every individual LangFlow exclusion and its approved reason;
- current file sizes and SHA-256 hashes;
- summary, provenance, type, exclusion, Documents, and ingestion aggregates.

## Commands

Pinned-checkout verification:

```bash
git -C references/langflow-upstream status --porcelain
git -C references/langflow-upstream rev-parse HEAD
git -C references/langflow-upstream describe --tags --exact-match HEAD
git -C references/langflow-upstream rev-parse 'v1.10.2^{commit}'
```

Tracked inventory and deterministic sensitivity scan:

```bash
git -C references/langflow-upstream ls-files
uv run --project raytsystem python /tmp/update_knowledge_manifest_langflow.py
```

Manifest and regression verification:

```bash
jq empty ops/knowledge-corpus-manifest.json
node --test scripts/knowledge-corpus-manifest.test.mjs
```

## Reviewer follow-up — lock-derived lineage regression

The reviewer-identified Medium gap is closed. The regression test now reads
`references/langflow-upstream.lock.json` directly instead of independently
hardcoding the tag, SHA, and provenance id.

The lock-derived validation asserts:

- official upstream URL and the checkout's `origin` URL;
- provenance id derived as `langflow-upstream@${lock.tag}`;
- manifest revision, expected revision, and tag from the lock;
- upstream checkout `HEAD`, exact tag commit, exact tag description, and clean
  status;
- Ketos `HEAD` against `current_fork_head`;
- Ketos base tag against the upstream SHA;
- live merge-base against `merge_base`;
- live commits-ahead count against `commits_ahead`.

### Follow-up RED

With the new drift regression calling an intentionally empty validation
function:

```bash
node --test scripts/knowledge-corpus-manifest.test.mjs
```

exited `1` with **5 passed / 1 failed**:

```text
LangFlow lock drift is rejected by provenance validation
AssertionError: Missing expected exception.
```

This reproduced the review finding: lock-only drift was not rejected.

### Follow-up GREEN

After implementing lock-derived validation:

```bash
node --test scripts/knowledge-corpus-manifest.test.mjs
```

exited `0` with **6 passed / 0 failed**. The in-memory drift regression now
rejects a changed lock SHA/merge-base, while the real lock passes all manifest
and live-Git lineage checks.

`ops/knowledge-corpus-manifest.json` was not changed because all lock data
continues to match the emitted provenance and current pinned checkout.

## Scope and side effects

- Modified only:
  - `ops/knowledge-corpus-manifest.json`;
  - `scripts/knowledge-corpus-manifest.test.mjs`;
  - `ops/subagent-reports/14-knowledge-langflow.md`.
- `ops/subagent-reports/05-knowledge-inventory.md` was not rewritten.
- No `Documents` config, `knowledge/`, ledger generation, `.raytsystem/`,
  Graphify artifact, reference checkout file, lock file, dependency, or source
  file was modified.
- No INGEST, prepare, validate, promote, commit, push, or external action was
  performed.

Final status: **DONE**.
