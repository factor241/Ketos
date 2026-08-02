# Prepared run snapshot regression

## Result

PASS

`load_run_summaries()` now accepts the verified internal persisted state
`PromotionState.PREPARED.value` and preserves it as the public summary string
`"prepared"`. All normal public run states still pass through `RunState`, while
invented states continue to fail closed.

No immutable schema version or manifest state was changed.

## Root cause

`IngestPipeline.ingest(..., prepare_only=True)` writes
`ops/runs/<run_id>/manifest.json` with `state: "prepared"`, matching
`PromotionState.PREPARED`. The read model previously normalized every manifest
state through `RunState(state)`, but `RunState` intentionally does not contain
`"prepared"`. The resulting `ReadModelError` prevented snapshot construction.

## TDD evidence

Regression:

`tests/test_universe.py::test_prepared_run_is_available_in_public_summary`

The test creates a real prepared ingest run, reads its persisted manifest, and
requires `load_run_summaries()` to return a summary whose state is exactly
`"prepared"`.

RED before the production change:

```text
ValueError: 'prepared' is not a valid RunState
raytsystem.readmodel.ReadModelError: Committed run state is invalid
1 failed
```

GREEN after the minimal production change:

```text
uv run pytest tests/test_universe.py::test_prepared_run_is_available_in_public_summary tests/test_universe.py::test_invalid_committed_run_state_fails_closed -q
2 passed in 1.58s
```

The paired existing test confirms that an invented state such as
`"invented_success"` is still rejected.

## Verification

```text
uv run pytest tests/test_universe.py -q
6 passed in 2.31s

uv run ruff check src/raytsystem/readmodel.py tests/test_universe.py
All checks passed!

uv run mypy src/raytsystem/readmodel.py tests/test_universe.py
Success: no issues found in 2 source files
```

No commit or push was performed. Existing user `ops/runs` were not modified.
