# Agent Note: Board detail view and window resize

Status: implemented

English | [中文](2026-09-29-ketos-board-detail-view-and-resize.zh.md)

## Problem

The board audit left the window geometry and the small-zoom presentation open (Д3.3 and Д6 of [the audit plan](../../../../docs/ketos/board-audit-plan.md)). A corner drag only ever grew a window — `resizeStep` forced `Math.max(1, factorX, factorY)` — so a diagonal drag could not shrink one and always scaled both axes; the modifier that disabled the grid snap was Shift, which the decisions table reserved for proportional scaling (R-8). The floor under every window was the agent window's default size, 552×648 (`MIN_WINDOW_SIZE`), wire-format-controlled sizes below it were raised on restore, and nothing proved a smaller layout stayed usable (П-27, R-5). At small zoom the board painted fully interactive windows at unreadable sizes (П-32): 17px type at zoom 0.2 renders 3.4 screen pixels while buttons, menus, and labels stay hit-testable. The canvas surface carried a standing `will-change: transform` (П-33, hypothesis), the dot grid kept its 24-unit step to 4.8 screen pixels so the whole board rippled (П-34), and no animation catalog stated what each transition does under `prefers-reduced-motion` (П-35).

## Decision

**A corner resizes both axes independently; Shift makes it proportional.** `resizeStep` takes `ResizeModifiers { proportional, snap }`, and `isProportional(direction)` became `isCorner(direction)`. A corner drag moves width and height by the pointer's own deltas with the opposite corner anchored, in both directions; with Shift held, one factor — the axis whose pointer movement deviates further from 1 — scales both axes, floored by the tighter of the two axes' minimum ratios so the ratio survives the floor. The grid snap is on unless Alt is held (`resize-gesture.ts` maps `moveEvt.shiftKey`/`moveEvt.altKey`). Edge drags are unchanged.

**The window floor is the minimum working layout.** `MIN_WINDOW_SIZE` is `408×480` (decision R-5) for every window kind; both values stay on the 24px grid. `clampWindowSize` applies the floor after snapping, and `sanitizeWindow` only raises stored sizes that fall below it, so a stored 480×500 survives a reload while the old floor would have raised it.

**Below `detailZoomThreshold` a window is a simplified card.** The `ui-board` `Config` gained `detailZoomThreshold` (validated 0.2–1, default 0.4 per R-6), injected into the board root and every window registration. Each frame subscribes through one boolean store selector (`zoom < threshold`) and, when set, renders `WindowSimplifiedCard`: the resolved window title and, when a session channel exists, `StateDot` plus the localized status. Its type is `ceil(12 / threshold)` world pixels, so the card renders at least 12 screen pixels at the threshold. The header, clone bar, and body stay mounted with `visibility: hidden` (`> :not([data-board-action='window-simplified-card'])`), preserving the lane, draft, and attachments; the frame's eight handles, the screen-space handle ring, and the chats rail are not rendered, and crossing the threshold enters `windowMenuDismissToken` so an open window menu closes. A primary-button pointerdown and a keyboard click restore the detail view by setting the zoom to the threshold and centering the window; the pointerdown path exists because raising a window reorders the window layer, and a real click whose button moved in the DOM between down and up is never delivered.

**The canvas keeps GPU rasterization only while a gesture is live.** `BoardRoot` arms `data-board-gesture` on the root from any `pointerdown` inside it and from every wheel or Safari gesture event, and removes it 150 ms after the last `pointerup`, `pointercancel`, or wheel/gesture event; the stylesheet maps the attribute to `will-change: transform` on the canvas layer, and `DashboardCanvas.module.css` has no standing `will-change`.

**The dot grid never renders denser than 8 screen pixels.** `DashboardCanvas` doubles the world step (24 → 48 → 96) while `step · zoom < 8`, and fades the dots as the screen step approaches that floor: `--board-grid-dot-opacity` interpolates 0→1 over the 8–12 px band and the stylesheet composes the dot color with `color-mix` toward transparent. `StateDot`'s running chase becomes a static ring under `prefers-reduced-motion: reduce`.

## Alternatives considered

- **Keep every corner drag proportional and let it shrink.** Rejected: it cannot express "wider but shorter" and it needs an anchor rule for every combination; independent axes plus Shift are what the audit's decision R-8 asked for.
- **Keep Shift as the snap release and add another key for proportional.** Rejected (R-8): Shift for proportional and Alt for the snap release is the conventional pair, and Alt was unused.
- **Give every window kind its own minimum.** Rejected: the floor states one minimum working layout; the agent window is the binding constraint, and tool windows are larger by template anyway.
- **Save the floor per stored layout and migrate.** Rejected: the floor is a clamping rule, not document state; only sizes below it are raised, and the schema stays version 1.
- **Drive the simplified view from a class on the canvas surface through CSS alone.** Rejected: the card carries the window title and session status, so it needs per-window data; the boolean store selector re-renders a frame only when it crosses the threshold.
- **Unmount the lane and composer below the threshold.** Rejected (Д6.1): their drafts, attachments, and scroll state must survive the trip, so they stay mounted and hidden.
- **Keep the standing `will-change: transform`.** The repro did not confirm blur in headless Chromium — the captured header at zoom 2 is byte-identical with and without a forced layer (probe artifacts under `.playwright-mcp/stage-23-board-audit/probe/`) — but the standing hint has no benefit at rest, so the surface keeps it only while a gesture is live.
- **Hide the dense grid instead of doubling its step.** Rejected (П-34): the doubled step keeps the board readable at the minimum zoom, and the fade removes the density jump.

## Consequences

Windows can now shrink to a 408×480 layout and resize along either axis by corner or edge; zoom/Alt semantics are explicit; a stored layout keeps sizes between 408×480 and the old 552×648. At zoom below 0.4 the board shows name-and-status cards instead of miniature chrome, which removes the interactive-but-unreadable state and cuts painting work at low zoom (20 windows pan at 60 FPS at zoom 0.3). What it gives up: the old "diagonal drag scales proportionally" convention and its test are gone, `isProportional` is renamed, and `resizeStep` takes a modifiers object — all internal to `ui-board`. The detail threshold is deployment-tunable, so a deployment can turn the detail view off only by setting a threshold at or below the minimum zoom; the card's fixed role is presentation-only and carries no interactivity beyond restoring the zoom. `ui-primitives` and `ui-layout` again carry fork divergences (the reduced-motion rule; the shell pinch guard now listening on the document), recorded in [`docs/ketos/upstream-sync.md`](../../../../docs/ketos/upstream-sync.md).

## Testing

`packages/client/ui-board/tests/resize.client.spec.ts` covers all eight directions in both directions, independent corner axes, proportional scaling and shrinking with the ratio floor, snapping, and the `isCorner` names. `store.client.spec.ts` pins the new floor and the snap-then-floor order; `board-layout.client.spec.ts` keeps a stored 480×500 unchanged. `slots.client.spec.tsx` drives corner shrink, Shift scaling, Alt snap release, the simplified card (title, status, `30px` type at the 0.4 threshold, no handles, no ring, no rail, click restore), and the 150 ms `data-board-gesture` window. `canvas.client.spec.tsx` reads the doubled grid step and the faded dot opacity. `packages/client/ui-primitives/tests/state-dot-styles.client.spec.ts` asserts the reduced-motion rule. `packages/client/ui-layout/tests/pinch-guard.client.spec.ts` covers the document-level guard over a `document.body` portal (П-37). `apps/web/tests/board-geometry.e2e.ts` adds the minimum-layout scenario (П-26/П-27) and the simplified-view scenario (П-32/П-34: cards, hidden header, 9.6px grid at the minimum zoom, restore on click), and flips П-18 to a passing assertion.

## Related

- [Board input and the popover layer](../architecture/2026-09-25-ketos-board-input-and-popover-layer.md) — owns the wheel/pinch classifier, the popover layer, and the shell pinch guard; the guard's listener moved from the frame root to the frame's document, closing the П-37 gap that note deferred.
- [Board gestures, culling, and the window-manager budgets](../architecture/2026-09-17-ketos-board-gestures-culling.md) — the z-band, culling, and pointer-gesture decisions this note's resize modifiers extend.
- [`docs/ketos/board-audit-plan.md`](../../../../docs/ketos/board-audit-plan.md) — the audit problems П-18 and П-26/П-27, П-32–П-35 this change closes, and the decisions R-5/R-6/R-8.
- [`docs/ketos/upstream-sync.md`](../../../../docs/ketos/upstream-sync.md) — the fork-divergence records for `ui-primitives` and `ui-layout`.
