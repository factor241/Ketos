# Task 1 — Stage 01C admission and closure evidence report

## Scope and result

Implemented only Task 1 on `codex/stage01-blocker-closure`, with baseline
`db6ec4a2465a4f1bb00579732ea1c1d902ae33d5`. The historical Stage 01 report,
root checkout, Stage 02 implementation, B01, and B02 were not modified.

The append-only closure bundle captures the admission branch/HEAD/no-upstream
state, dirty root-checkout snapshot, worktree registry, aggregate RSS, and
runtime versions. It also records the Stage 02 ownership boundary:

- S02-T02 through S02-T05 fully overlap.
- Only the webhook slice of S02-T07 overlaps.
- S02-T06 and S02-T08 through S02-T12 are untouched.
- Stage 02 must reverify and cannot inherit PASS from this admission evidence.

## Changed files

- `docs/evidence/stage-01/closure/stage-01c-admission-snapshot.json`
- `docs/evidence/stage-01/closure/stage-01c-governance-decision.md`
- `docs/evidence/stage-01/closure/validate_admission.py`
- `docs/evidence/stage-01/tests/test_closure_admission_artifacts.py`
- `.superpowers/sdd/task-1-report.md`

## TDD evidence

### RED

Command:

```bash
uv run pytest docs/evidence/stage-01/tests/test_closure_admission_artifacts.py -q
```

Result: `3 failed in 0.10s`. The new test failed on the baseline because the
admission snapshot, governance decision, and validator did not exist.

### GREEN

Commands:

```bash
uv run pytest docs/evidence/stage-01/tests/test_closure_admission_artifacts.py -q
uv run python docs/evidence/stage-01/closure/validate_admission.py
uv run pytest docs/evidence/stage-01/tests -q
uv run python -c "import json; from pathlib import Path; [json.loads(path.read_text(encoding='utf-8')) for path in Path('docs/evidence/stage-01').rglob('*.json')]; print('JSON syntax: PASS')"
git diff --check
```

Results:

- Focused admission suite: `3 passed in 0.08s`.
- Admission validator: `Stage 01C admission evidence: PASS`.
- Relevant Stage 01 evidence suite: `33 passed in 3.23s`.
- JSON syntax: `PASS`; `git diff --check`: exit 0.

## Review-fix evidence

The review found that the initial validator accepted incomplete or altered
evidence because it checked only basic truthiness. The validator now compares
immutable capture metadata, exact branch/HEAD/upstream facts, the full dirty
root snapshot, required worktree registry, RSS value/threshold interpretation,
and exact runtime availability/version records. It also verifies the historical
Stage 01 report SHA-256, governance-decision SHA-256 and boundary text, and the
fixed `db6ec4a..349d6042` Task 1 changed-path set. The diff check is anchored
to the original admission commit, so it does not depend on later Stage 01C
commits.

### Review-fix RED

Command:

```bash
uv run pytest docs/evidence/stage-01/tests/test_closure_admission_artifacts.py -q
```

Result: `8 failed, 3 passed in 0.13s`. The added mutation tests proved that the
previous validator accepted missing capture metadata, forged root/worktree/RSS
facts, unavailable runtimes, altered governance text, a forged historical
report, and an insufficient append-only path allowlist.

### Review-fix GREEN

Commands:

```bash
uv run pytest docs/evidence/stage-01/tests/test_closure_admission_artifacts.py -q
uv run python docs/evidence/stage-01/closure/validate_admission.py
uv run pytest docs/evidence/stage-01/tests -q
uv run python -c "import json; from pathlib import Path; [json.loads(path.read_text(encoding='utf-8')) for path in Path('docs/evidence/stage-01').rglob('*.json')]; print('JSON syntax: PASS')"
git diff --check
```

Results:

- Focused admission suite: `11 passed in 0.25s`.
- Admission validator: `Stage 01C admission evidence: PASS`.
- Relevant Stage 01 evidence suite: `41 passed in 3.31s`.
- JSON syntax: `PASS`; `git diff --check`: exit 0.

## Quality follow-up

Applied only mechanical Ruff formatting and import sorting to
`validate_admission.py` and `test_closure_admission_artifacts.py`; no validator
logic, evidence values, product source, or Task 2 files changed.

Commands:

```bash
uv run pytest docs/evidence/stage-01/tests/test_closure_admission_artifacts.py -q
uv run python docs/evidence/stage-01/closure/validate_admission.py
uv run ruff format --check docs/evidence/stage-01/closure/validate_admission.py docs/evidence/stage-01/tests/test_closure_admission_artifacts.py
uv run ruff check --select I docs/evidence/stage-01/closure/validate_admission.py docs/evidence/stage-01/tests/test_closure_admission_artifacts.py
git diff --check
```

Results: focused admission suite `11 passed in 0.25s`, validator `PASS`, Ruff
format reported `2 files already formatted`, import sorting reported `All
checks passed!`, and `git diff --check` exited 0.

## Residual concerns

- This is a timestamped admission snapshot, not a final Stage 01 closure
  verdict and not an authorization to begin Stage 02.
- The closure branch had no configured upstream at capture time; this is
  explicitly represented as `null`, not inferred.
- The focused and full evidence pytest runs emitted existing environment
  warnings from `sentry_sdk`/Eventlet and NumExpr thread configuration; tests
  remained green. No production behavior was changed to suppress them.
