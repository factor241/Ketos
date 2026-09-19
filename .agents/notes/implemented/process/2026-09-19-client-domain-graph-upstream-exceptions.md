# Agent Note: Client domain graph: frozen upstream exceptions

Status: implemented

English | [中文](2026-09-19-client-domain-graph-upstream-exceptions.zh.md)
## Problem

`verify-client-domain-graph` checks the layering of `packages/client/*/src/client/`: domains may import `contract/` and top-level shared modules, never each other, and only `apply.ts`/`index.ts` assemble across domains. The upstream import predates the gate, so `ui-sidebar-documentpreview` (21 violations) and `ui-conversation` (4) kept `check:all` red on every Ketos base from stage 3 on (`ketos-bmz`); stages 5–10 also left ten sibling-domain imports in the fork-owned `ui-board` that nobody re-checked.

## Decision

Every package keeps the strict rule. The verifier gains an explicit local exception map, `UPSTREAM_LAYOUT_EXCEPTIONS`: `ui-conversation` with an exact 4 and `ui-sidebar-documentpreview` with an exact 21, each entry carrying a one-line rationale and the tracking issue. An entry matches only at its exact count: a new violation fails as a violation, and a fixed or cleared package fails as drift until the entry is updated, so an exemption cannot hide changed code. The green line reports the exempted counts.

`ui-board` returns to zero violations under the strict rule: the cross-domain shared modules moved out of `canvas/` and `window/` into the package's top-level shared layer, which the gate already treats as importable by every domain, next to `store.ts`, `pointer-gesture.ts`, and `open-window.ts`. The moved files are `pan-gesture.ts`, `wheel-zoom.ts`, `culling.ts`, `window-screen.ts`, `HandleRing.tsx` with its CSS Module, `resize.ts`, `resize-gesture.ts`, `window-title.ts`, `chat-list-model.ts`, and `dictation.tsx`; each domain keeps its feature-local modules.

## Alternatives considered

**Rewrite the upstream packages under `contract/`.** Lost: the fork does not maintain upstream files, and the upstream sync re-imports them, so the rewrite would be reverted or reapplied forever; the correction belongs upstream.

**Skip upstream packages entirely.** Lost: the gate would stop observing twenty-five imports that the fork still ships, so a new upstream violation would pass unnoticed; the exact-count entry keeps a failure signal at the same scope.

**Add ui-board to the exception list.** Lost: the fork owns the package, and its ten violations were regressions rather than inherited layout; stage 3 had cleared the same rule once, and an exception would let new board code break layering without a signal.

**Move ui-board's cross-domain modules into `contract/`.** Lost: `contract/` holds the slot contract (types and declarations), while the moved files are runtime helpers, hooks, and a component; the top-level shared layer is where the package already keeps that kind of module.

## Consequences

The gate is green on the stage base and keeps per-package count checks on the upstream layout: an upstream sync that moves either count fails the gate until the entry is updated, and fork-owned packages keep the strict rule. `ui-board`'s shared layer now holds the helpers the canvas, window, dock, and omnibox domains all import. The mechanism is local to `scripts/verify-client-domain-graph.ts`; the layering rule itself is unchanged.

## Testing

`scripts/verify-client-domain-graph.spec.ts` covers the partition: unexempted failures, an exact-count exemption, and drift for a gained and a cleared violation. `pnpm exec vitest run packages/client/ui-board/tests` (298 tests, 26 files) passes with the moved modules, `pnpm run verify-client-domain-graph` is green, and `pnpm run lint` and `pnpm run typecheck` pass.

## Related

- `docs/ketos/baseline-issues.md` — the base-issue record this closes.
- [Board gestures, culling, and the window-manager budgets](../architecture/2026-09-17-ketos-board-gestures-culling.md) — the moved gesture, culling, and ring modules.
- [Board window chats panel](../architecture/2026-09-16-ketos-board-window-chats-panel.md) — the moved chat-list model.
- [Chat window states and titles](../feature/2026-09-18-ketos-chat-window-states-titles.md) — the moved title and ring modules.
