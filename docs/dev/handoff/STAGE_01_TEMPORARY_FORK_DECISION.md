# Stage 01 temporary fork decision

- Status: **PENDING**
- Approved owner: `factor241`
- Scope: dependency-source admission only
- Effect: this decision does not grant PASS

## Narrow supersession

This decision temporarily supersedes only the dependency-source clauses in
Stage 01 A01 that limit a candidate to an upstream release or upstream
immutable commit. A user-owned fork is also an admissible candidate source
when it is owned by `factor241`, is pinned to an exact commit, and is supplied
with the fail-closed provenance record defined below.

Every protocol, behavior, security, licensing, type, authentication,
authorization, pre-dispatch, all-open resume, standard event, test, and frozen
dependency gate in the Stage 01 plan remains unchanged. Fork ownership is not
evidence that any gate passes. A wrapper, custom protocol/event, deprecated
resume channel, or security bypass remains forbidden.

## Required immutable provenance record

The probe accepts one JSON object with exactly these fields and no extensions:

```json
{
  "artifact_kind": "wheel | tgz",
  "package_name": "ag-ui-langgraph",
  "package_version": "<exact artifact version>",
  "approved_owner": "factor241",
  "canonical_repo_url": "https://github.com/factor241/ag-ui",
  "upstream_base_sha": "<40 lowercase hex>",
  "fork_commit_sha": "<40 lowercase hex>",
  "artifact_filename": "<exact local filename>",
  "artifact_sha256": "<64 lowercase hex>",
  "source_archive_sha256": "<64 lowercase hex>",
  "license_spdx": "MIT",
  "license_sha256": "<64 lowercase hex>",
  "changed_files": ["<exact approved repository-relative path>"],
  "build_command": "<exact command bound to fork_commit_sha>",
  "test_command": "<exact command bound to fork_commit_sha>"
}
```

For a wheel, the wheel and its immutable source archive are separate inputs and
both hashes are recomputed. For a source `tgz`, the same file may satisfy both
artifact and source-archive hash fields. The probe rejects missing or extra
fields, unapproved owners/repositories/paths, floating refs, unsafe paths,
duplicate changed files, metadata mismatch, and any artifact, source, or
license hash mismatch.

The source input must be a Git archive whose embedded commit equals
`fork_commit_sha`. The approved local repository is also mandatory: its
canonical `origin`, commit objects, base ancestry, commit-derived changed-file
set, and archived package tree are checked against the sidecar, source archive,
and built artifact. Provenance JSON is bounded to 64 KiB before parsing.

The integration invocation is:

```bash
uv run --isolated --no-project --with '<exact fork artifact requirement>' \
  python scripts/mvp/probe_ag_ui_adapter.py \
  --artifact-path '<exact wheel-or-tgz path>' \
  --fork-provenance-path '<exact provenance.json path>' \
  --source-archive-path '<exact source tgz path>' \
  --fork-repository-path '<exact factor241/ag-ui checkout path>' \
  --json
```

`--source-archive-path` may be omitted only when `artifact_kind` is `tgz` and
the artifact itself is the source archive. `--fork-repository-path` is required
whenever fork provenance is supplied.

## Pending evidence

No fork artifact, source archive, provenance JSON, or executable probe output
is attached to this decision yet. The existing A01 verdict therefore remains
**BLOCKED**, package manifests and locks remain unchanged, and integration must
replace every placeholder with independently verified exact values before any
admission decision can change.
