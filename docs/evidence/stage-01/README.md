# Stage 01 evidence contract

This directory is a standalone, append-only Stage 01 evidence bundle. The
stdlib-only runner invokes commands as argv with `shell=False`, writes redacted
stdout/stderr logs at deterministic `artifacts/<id>.<stream>.log` paths, hashes
those redacted bytes with SHA-256, and writes schema-shaped records in
`records/<id>.json`.

## Contract

- Verdicts are `PASS`, `FAIL`, `BLOCKED`, `BASELINE_DEFECT`, or `INCONCLUSIVE`.
  `PASS` is valid only when `exit_code` is exactly `0`; a negative exit code
  can never validate as PASS.
- Every record distinguishes `source_baseline_sha` (the product baseline being
  assessed) from `execution_revision` (the checked-out revision when the
  command ran). `DELIVERY_REVISION.md` describes the non-recursive post-commit
  attestation that ties a final review commit to its payload.
- Conventional `KEY`, `TOKEN`, `PASSWORD`, and `SECRET` assignments/options
  are redacted in logs, command metadata, and supplied profile metadata before
  persistence and hashing. This is a defensive redaction layer, not a claim
  that arbitrary secret formats can always be detected.
- Hash verification resolves only safe relative artifact paths and rejects
  traversal, non-artifact paths, modified log bytes, extra object fields, and
  malformed record values.
- Historical documents 01–14 stay frozen; corrections go to
  `ERRATA_REGISTER.md` or a new append-only decision record.

## Layout

- `schema/`: record shape and PASS/exit invariant.
- `tools/`: runner and verifier.
- `tests/`: black-box contract tests.
- `artifacts/`: redacted command logs.
- `records/`: command records linked to those logs.
- `preflight-manifest.json`, `worktree-registry.json`: baseline admission.
- `artifact-index.json`: SHA-256 inventory (it intentionally does not hash
  itself).
- `DELIVERY_REVISION.md`: source/execution revision and delivery-attestation
  contract.

## Validation

Run from `/Volumes/Projects/ketos-stage01-integration`:

```bash
uv run pytest docs/evidence/stage-01/tests -q
uv run python docs/evidence/stage-01/tools/evidence_runner.py --validate docs/evidence/stage-01/records/focused-backend-baseline.json
uv run python -c "import json; from pathlib import Path; [json.loads(p.read_text()) for p in Path('docs/evidence/stage-01').rglob('*.json')]; print('JSON syntax: PASS')"
git diff --check
git diff --name-only 80878261d07c21ad257de017d98069f211ada2c2..HEAD
```
