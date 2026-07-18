# Baseline defects

## S01-BD-001 — interrupted broad messages test

- Command: `uv run pytest src/backend/tests/unit/test_messages.py -q`
- Observation: manually interrupted after excessive repeated migration setup.
- Observed summary: `1 failed, 64 passed, 1 warning, 12 errors in 21.16s`.
- Product failure observed before the interruption:
  `test_to_lc_message_keeps_supported_image_attachments` raised `IndexError`
  after a rejected absolute image path.
- The teardown/setup errors occurred after Ctrl-C and are **not** product
  failures.
- Classification: `INCONCLUSIVE_WITH_BASELINE_DEFECT`.
- Verdict: `INCONCLUSIVE` — never PASS.

This command is recorded separately from the focused Stage 01 baseline test
and was intentionally not rerun. The focused command and PASS record are
`records/focused-backend-baseline.json`.
