# Agent Note: Board strokes — freehand drawing and erasing

Status: implemented

English | [中文](2026-10-06-ketos-board-strokes.zh.md)

## Problem

The board document (stage 28) carries a `stroke` kind with no rules of its own: any JSON object was accepted, nothing rendered it, and there was no way to draw, erase, or select a freehand line. Stage 30 must make drawing feel exact — the line stays under the cursor at every zoom, including a wheel zoom in the middle of one stroke — while the stored data stays compact enough for the document limits and deterministic enough that two Ketos instances render identical paths (stage 33). The eraser must remove parts of the owner's own strokes in one atomic batch per pass, and the fifty-stroke load must not push pan and zoom below the line's 55 FPS budget.

## Decision

**A stroke stores relative, rounded points.** `StrokeData` is exactly `{ points, width, pen }`: two to `strokePointsMax` `[x, y, pressure]` triples relative to the element's `(x, y)`, a thickness of `s`, `m`, or `l` (4, 8, or 16 world units), and whether a pen drew it. `strokeBounds` resolves absolute points into `x = min − width/2`, `y = min − width/2`, `w = spread + width`, `h = spread + width`, and rewrites the points relative to that box, rounding coordinates to 0.1 and pressure to 0.01. Moving a stroke is therefore a `patch { x, y }` that never rewrites its points, and a 2000-point drawing stays inside the 256 KiB element budget.

**Rendering is a pure function of the data.** `strokeToSvgPath` calls `perfect-freehand`'s `getStroke` with options derived only from `width` and `pen` (`size: STROKE_SIZES[width]`, `thinning: 0.5`, `smoothing: 0.5`, `streamline: 0.3`, `simulatePressure: !pen`, `last: true`) and converts the outline with the README's quadratic-midpoint construction. `simulatePressure` is the one option the pen flag controls, because a pen reports real pressure while a mouse reports none; every other choice is a constant. The path is memoized by the `StrokeData` reference, and the body memoizes its parse by the stored `element.data` reference, so panning and zooming never recompute an unchanged stroke.

**The eraser measures segment to segment.** `eraseStroke` drops a point closer than the radius to the eraser path and breaks the stroke where any stroke segment comes closer than the radius to any path segment, because a fast mouse crosses a stroke between two samples and a point-only check leaves gaps. Remaining parts shorter than two points are dropped. The radius is the fixed screen radius of the chosen thickness (`6/12/24 px`) divided by the live zoom, which is also the ring the canvas draws.

**One operation batch per gesture.** The brush commits exactly one `create` on pointerup, simplified through Ramer–Douglas–Peucker with a growing tolerance and dropped entirely on pointercancel or fewer than two points. The eraser commits exactly one batch per pass — `remove` for each touched stroke plus `create` for each remaining part — through the `eraseStrokes` injected verb; the local removals and creations land first, and a host refusal clears the optimistic slice with a fresh snapshot and a board notice. Foreign strokes are filtered out before the pass starts and are never candidates.

**The live eraser preview is transient store state.** While a pass runs, `eraserPreview` holds the touched element ids and the remaining parts; the element layer skips the hidden ids and the canvas draws the parts through the same `StrokeDraft` as the brush line. The preview never reaches the document, and pointercancel or disposal clears it.

**The tool is transient view state.** `tool` (`select`/`brush`/`eraser`) and `brushWidth` live in the board store, never in the layout document; switching to brush or eraser leaves the inspector and the note editor, entering either of those leaves the tool, and the Escape ladder gained the tool rung between the element selection and the window panels (`menu → editor → selection → tool → panel`).

**`perfect-freehand` 1.2.3 is a `devDependencies` entry of `@deepseek-ai/dsh-client-ui-board`.** It is a browser-only implementation library, so per the [dependency declaration rules](../../../../packages/client/AGENTS.md#dependency-declaration) it belongs in `devDependencies`; the client bundle inlines it and `THIRD_PARTY_NOTICES.md` discloses it, following the [dependencies-over-hand-rolling policy](../process/2026-07-26-dependencies-over-hand-rolling.md).

## Alternatives considered

- **Store absolute points and rewrite them on every move.** Rejected: moving a long drawing would rewrite thousands of coordinates, and a patch is a whole-value write at the wire.
- **Store unrounded points.** Rejected: full-precision floats nearly triple the serialized size and produce different JSON on different engines.
- **Point-only eraser distance.** Rejected: sparse pointer sampling leaves visible bridges across a fast stroke.
- **Commit each erased fragment as its own operation.** Rejected: one pass must be one atomic batch, so a refusal leaves the document as it was before the gesture.
- **Hand-roll the stroke outline.** Rejected: the outline algorithm is subtle, and the maintained library is the policy's choice.

## Consequences

The canvas keeps one code path for the brush line and the eraser parts (`StrokeDraft`), which lives in `canvas/` rather than the plan's `elements/` path because the client domain gate forbids a `canvas/` module from importing `elements/`. `parseStrokeData` needs the element box, so `validateElementData` takes the box as its fourth argument; `BoardLimits` gained `strokePointsMax` (default 2000) and the snapshot publishes it. A single eraser pass is one request under `maxOpsPerRequest` (64) and `maxRequestBytes`; a pass touching more strokes than the batch bound is refused with a notice and a fresh snapshot rather than split into several batches. The fifty-stroke bench records the budget in [perf-baseline.md](../../../../docs/ketos/perf-baseline.md): 60.2 FPS pan and 60.7 FPS zoom with 0 long tasks.

## Testing

`packages/ketos/board-doc/tests/stroke.spec.ts` covers parsing (every width, pen flags, bounds, the point-count and byte limits, the malformed table through the route), bounds rounding, simplification bounds, and every eraser case (middle split, edge shortening, sparse-path break, dropped short parts, degenerate and parallel path segments); the package holds 100% per-file coverage. `packages/client/ui-board/tests` covers the path determinism and memoization, the stroke body and fallback, tool-mode exclusivity, canvas routing, drawing (one operation, cancel, click, pan/zoom translation, mid-stroke zoom, live draft), erasing (one batch, split, shortening, foreign skip, cancel, preview), and selection/move/delete. `apps/web/tests/board-elements.e2e.ts` drives real mouse strokes under the cursor at zoom 0.5 and 2, after a pan and through a mid-stroke ctrl+wheel zoom, then selects, moves, and deletes one; `apps/web/tests/board-strokes.perf.ts` measures the fifty-stroke load.

## Related

- [The board document and its element model](2026-10-06-ketos-board-element-document.md) — the envelope, routes, and element kinds strokes join.
- [`@ketos/board-doc` README](../../../../packages/ketos/board-doc/README.md) — the `stroke` data rules and `strokePointsMax`.
- [`@deepseek-ai/dsh-client-ui-board` README](../../../../packages/client/ui-board/README.md) — the tool modes and stroke rendering in the product contract.
- [Ketos perf baseline](../../../../docs/ketos/perf-baseline.md) — the stage-30 measurement.
