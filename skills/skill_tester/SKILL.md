---
name: skill_tester
description: Verify Ketos changes with focused tests followed by the relevant package gate and evidence-backed PASS/BLOCKED/FAIL closure.
test_status: pending
---

# Ketos Tester

## Procedure

1. Map each acceptance criterion to a concrete command or observable result.
2. Use `.agents/skills/frontend-testing` for Jest/RTL work and
   `.agents/skills/e2e-testing` for Playwright flows.
3. Run the narrowest affected test first.
4. Run the relevant gate: backend/KFX via `uv run` or Make targets, frontend
   via the package's Jest/Biome/build commands.
5. Record exact counts, skips, failures, environment blockers, and whether
   browser/runtime proof was performed.
6. Never convert an unexecuted check or historical artifact into PASS.
