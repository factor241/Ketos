# Agent Note: The Ketos board composes through its slot cascade

Status: implemented

English | [中文](2026-09-15-ketos-board-slot-composition.zh.md)

## Problem

`packages/client/ui-board` declared six `board.*` slot keys in its contract while nothing owned or rendered them: `DashboardCanvas` constructed `AgentCard` and `ToolWindow` directly in JSX, so the declarations were dead, the canvas domain imported the window, dock, omnibox, and inspector domains, and every later stage that needed a new window type or new window content would have had to patch the canvas.

The framework's rule is that a slot exists only while an entry declares it, and that rendering a key outside the declaring entry's `children` table fails with `SlotOwnershipError` (`packages/client/ui-slots/src/index.ts`, `packages/client/ui-renderer/src/client/scoped-slots.tsx`). The board therefore had three defects at once: declarations without owners, a monolith that bypassed them, and an intra-package domain graph the repository gate rejects (`verify-client-domain-graph`).

## Decision

One `apply` composes the whole board through slot registration, and every key in `SlotMap` has exactly one declarer and at least one render site:

- The `main`/`board` entry (BoardRoot) declares `board.canvas`, `board.dock`, `board.omnibar`, and `board.minimap`, and renders all four through `renderSlot`.
- The `board.canvas` occupant (`DashboardCanvas`) keeps pan, wheel zoom, the dot grid, the transformed surface, and the viewport measurement, and declares `board.windows`, which it renders inside the transform.
- The `board.windows` occupant (`BoardWindowLayer`) maps `windowOrder` and renders the keyed `board.window` per window with `entryKey: window.kind`.
- Window frames are registered once per `WindowKind` (`agent` and `clone` → `AgentCard`, `connectors`/`settings`/`dashboard`/`tasks` → `ToolWindow`); the instance travels in the owner share, so two windows of one type render from one registration.
- `board.window.body` is keyed by `WindowBodyKind` and ships `conversation` (the conversation lane's seat), `connectors`, and `settings` (the tool window's panes). Switching a window's `bodyKind` — the tool window's tab strip calls `setWindowBodyKind` — swaps the rendered occupant.
- The keyed key domains are the exported `WindowKind`/`WindowBodyKind` unions through mapped `keyProps` tables, so registering or dispatching an unknown key is a compile error rather than a blank cell. The window instance and the body dispatcher are the same for every key and ride the owner share; the keyed tables exist to close the dispatch domain and say which keys are taken.
- One `dsh-client-store` handle is created in `apply` and declared by every layer and frame registration, so all of them read and write one instance through the framework `useStore`/`actions` seats. `setViewport`, `openWindow`, `centerOnWindow`, and `setWindowBodyKind` join the draft action table.
- Components stay ctx-free: the dock, omnibar, minimap, frames, and bodies read state through `useStore` and mutate through `actions`; the shared window-opening policy (templates, id minting, placement) lives in `open-window.ts` and `store.ts`, which both dock and omnibar import.

One constraint forced a deviation from the stage plan's literal cascade. `SlotCore.register` allows a single declarer per child key, so six `board.window` registrations cannot each declare `board.window.body` («occupant `board.window` … объявляет keyed `board.window.body`»). The windows layer is the one declarer, and its `children` carries the body seat; each frame receives a `renderBody(window)` dispatcher in its owner share and calls it where the content region belongs. This is the same slot-backed-renderer shape as ui-chat's `ChatNodeOwnerProps['renderMessageImages']`; content still renders through the slot machinery, and the frames gain no `renderSlot` seat because they declare no children.

The selection overlay moved from `src/client/inspector/ElementSelectionContext.tsx` to the top-level `src/client/ElementSelectionOverlay.tsx`: board root renders it above the floating layers, and no top-level file imports a domain any more. Clear of both changes, `verify-client-domain-graph` no longer reports `ui-board` (the gate remains red for unrelated upstream packages at this base).

## Alternatives considered

- **Let each frame declare `board.window.body` (the plan's literal cascade).** Rejected by the slot core: the second declaration of a key throws `slot "board.window.body" is already declared`. The viable variants were worse — registering one body kind per frame leaves five of six window types without a body, and giving each frame its own body slot key abandons the single body seat the plan and stage 6 depend on.
- **Key `board.window` by window id.** Rejected: a dynamic UUID has no matching static registration, so every window would render an empty cell; the plan records the same reasoning, and one registration per type is what makes multi-window rendering a single occupant with different owner props.
- **Keep the canvas constructing frames directly and register the slots later.** Rejected: the declared keys stay dead, the canvas keeps patching for every new window type, and the same change would recur at each of stages 6–19.
- **Render the body in the windows layer beside the frame.** Rejected: the body belongs inside the frame's chrome (background, padding, scroll container), which only the frame owns.
- **Pass a rendered `ReactNode` body through owner props instead of a dispatcher.** Rejected: owner props must not carry ReactNode content; a dispatcher keeps the body slot the single dispatch point and the declaration with one owner.
- **Give the conversation body the real chat lane now.** Rejected: the chat lane is stage 6's anatomy work; this stage only fixes the seam it will mount into.
- **Keep `addWindow` as the only window action.** Kept, and `openWindow` added beside it: placement and id minting belong to the store (viewport- and pan-dependent), while `addWindow` remains the explicit-state path the store tests drive.

## Consequences

Later stages add window types and window contents without touching the canvas: a new `WindowKind` frame is a `ctx.slots.inject('board.window', …)` registration, a new body is one line in `apply`'s body table, and the client slot catalog reports the taken keys (`agent, clone, connectors, dashboard, settings, tasks` / `connectors, conversation, settings`).

The layers own what they draw: the canvas measures itself and publishes `setViewport`, the dock and omnibar open windows through one helper, and the minimap centers the view with `centerOnWindow` — the store, not a component, holds the placement and centering math.

Trade-offs accepted: frames for kinds whose body has no occupant yet (`clone`, `dashboard`, `tasks`) render an empty body region, because no UI creates those windows before their stages; and each keyed seat declares its share twice — once as the common `owner` and once in the mapped `keyProps` table — because the catalog's lexical scan reads owner props from `owner` while the closed key domain requires the keyed table.

Two defects found while moving the gesture code remain out of scope and are tracked: board gesture listeners registered on `globalThis` survive an unmount mid-drag (`ketos-0s0`), and the 8-direction resize algorithm is duplicated in both frames with min-size guards that only the store enforces (`ketos-4k3`).

Verification: `tests/slots.client.spec.tsx` pins the cascade (one occupant per layer, six frame registrations, three body registrations), instance routing (two agent windows through one registration), body swapping by `bodyKind`, the unoccupied-body case, re-apply without duplicates, and full withdrawal on `board.dispose()`; `tests/apply.client.spec.tsx` keeps the deferred-declaration path and now asserts the cascade registers and the board's declarations collapse. Removing a `children` key by hand (`board.omnibar`, then `board.window`) fails those specs with `SlotOwnershipError`, which is the mutation the stage checklist asks for.

## Related

- [`packages/client/AGENTS.md`](../../../../packages/client/AGENTS.md) — the children-as-authorization rule and the four props shares this composition follows.
- [`docs/subsystems/slots.md`](../../../../docs/subsystems/slots.md) — the slot protocol (`register`, `inject`, `renderSlot`, keyed dispatch).
- [`packages/client/ui-chat/src/client/contract/slots.ts`](../../../../packages/client/ui-chat/src/client/contract/slots.ts) — the `renderMessageImages` slot-backed renderer precedent for the frame body dispatcher.
- [Board in the web profile](2026-09-15-ketos-board-in-web-profile.md) — the stage-2 wiring note this composition follows.
