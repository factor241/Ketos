# Agent Note: Board window ownership and access

Status: implemented

English | [中文](2026-10-06-ketos-board-window-ownership.zh.md)

## Problem

Board windows had no owner and no access: a stored window carried its geometry, panels, and clone identity, the board showed every window as anonymous, and the layout had no place to record who a window belongs to or who else may work with it. The 16 October demo needs visible ownership — a color and a name on each window, and a way to hand a window to another participant — without multi-user logic: there are no accounts, no concurrent editors, and no roster service yet. The real participant roster arrives with stage 32 and the shared board with stage 33, so the representation and the resolution of owners must survive those arrivals unchanged.

## Decision

**Owner and access are durable layout fields.** `board-settings.ts` adds `ownerId` to every stored window — `z.string().default('')`, where the empty string means the acting participant and the repair resolves it before the layout reaches the store — and an `access` record `{ mode: 'owner' | 'selected' | 'all', people: string[] }` defaulting to owner-only with an empty list (`BOARD_ACCESS_MODES` and `BOARD_ACCESS_MAX_PEOPLE` bound the mode union and the list). `BOARD_SETTINGS_VERSION` stays 1: the defaults are additive, so a version-1 document stored before ownership existed parses and reads back as owned by the current participant with owner-only access, and bumping the version would discard every stored layout.

**Repair validates format, never membership.** `sanitizeWindowAccess(raw, ownerId)` keeps a well-formed owner id (`isOwnerIdFormat`: non-empty, at most `OWNER_ID_MAX_LENGTH` characters, no control characters), drops duplicates and the owner, and stops at `BOARD_ACCESS_MAX_PEOPLE`; an unknown mode falls back to `'owner'`. It deliberately does not check `boardParticipants`, because the real roster arrives asynchronously in stage 32 and a membership check would erase stored people while the roster is absent; an id the roster does not know keeps the neutral palette slot and the `Unknown participant` label.

**`owners.ts` is the single participant source.** The module owns `OwnerId`, the demo team (`DEMO_TEAM` with `DEMO_SELF_ID`, colors 1–4), `currentOwnerId(state)`, `boardParticipants(state)`, `participantOf`, `ownerColorAttr`, `participantLabel`, `participantInitial`, `isOwnerIdFormat`, and `sanitizeWindowAccess`. Consumers read those selectors and never the demo constants, so stages 28 and 32 replace the source behind them without touching a component; `canManageWindow(state, window)` is the management predicate (the owner equals the current participant; stage 33 adds "the window lives on this machine"), and both transfer and access actions in the store run only when it holds.

**Colors are tokens selected by one root attribute.** `BoardViews.module.css` declares 22 custom properties — `--board-owner-{1..10,unknown}-{edge,fill}` — on the board `.root` with a dark rule rebinding the same names, and `.root [data-board-owner-color='N']` maps the window root's attribute to `--board-owner-edge`/`--board-owner-fill`. Components style themselves with those two aliases only and write no literal colors; an unresolved id carries `"unknown"`.

**The bezel is a child layer of `WindowFrame`.** `WindowBezel.tsx` renders under the window surface (z-index -2, behind the frame's theme fill) and carries `OwnerBadge` and `AccessIndicator`; the managing participant gets `OwnerTransferMenu` and `AccessMenu` on the same spots, everyone else the plain captions. Because it is a child of the frame, it moves, resizes, and scales with the window without board-side synchronization. The 2px owner edge on the frame's `::before` is always visible; the bezel slides out on hover, focus within, or selection with `var(--ds-transition-duration)`, reduced motion drops the transition, an open panel suppresses the strip on its side, and `simplified` mode below `detailZoomThreshold` renders the edge only.

**Transfer and access are owner-only, in-place writes.** `transferWindow(id, ownerId)` sets the window's owner, leaves the window's place and its agent untouched, and removes the new owner from `people`; the previous owner's `canManageWindow` then returns false, so the transferred window leaves them with the plain captions and no way back. `setWindowAccess(id, access)` keeps the `people` list across `owner`/`selected`/`all` mode switches (the menu passes the stored list on a mode change and toggles one person at a time), so returning to `selected` restores the same people.

## Alternatives considered

- **Render the bezel in a separate board-level layer above the canvas.** Rejected: the layer would have to re-sync the window's pan/zoom geometry on every board and window change, while a frame child gets placement, scale, and clipping for free.
- **Validate roster membership during repair.** Rejected: the roster arrives asynchronously at stage 32, so a document read before it lands would erase real people from every window; unknown ids degrade to the neutral color and `Unknown participant` instead.
- **Bump `BOARD_SETTINGS_VERSION` for the new fields.** Rejected: a version bump discards every stored layout, and additive schema defaults migrate old documents implicitly without a migration path.
- **Write literal owner colors in components.** Rejected: the palette belongs to the theme surface; 22 tokens in `.root` plus the `data-board-owner-color` attribute keep components free of literal colors and let one rule theme both schemes.

## Consequences

Old layouts read as owned by the current participant with owner-only access, so the first open after upgrade shows every pre-existing window under the acting owner and needs no migration. A transferred window genuinely leaves the previous participant: they cannot move it back, change its access, or transfer it again until a later stage returns the window or hands over the per-clone agent. The demo team is temporary data — names and colors come from `DEMO_TEAM`, and there is no screen for changing an owner's color — and the single swap point for real participants is `owners.ts`, whose selectors stages 28 and 32 replace behind. The unknown id path is a deliberate degradation, not a repair: the window stays usable and visible, but its owner shows the neutral slot until the roster learns the id.

## Testing

`packages/client/ui-board/tests/owners.client.spec.ts` covers the roster, the owner resolution, the label fallback, the id format, and the access repair (duplicates, the owner, the cap, the unknown mode); `board-settings.client.spec.ts` covers the schema defaults and bounds; `board-layout.client.spec.ts` covers the full repair of an old document into the current participant with owner-only access. `window-bezel.client.spec.tsx` covers the frame's owner color and management attributes, the simplified edge-only switch, the panel-side attributes, the badge and access captions, the three access modes with the kept people list, the in-place transfer, and the menu-free captions on a window the acting owner does not manage. `apps/web/tests/board-bezel.e2e.ts` drives the assembled board.

## Related

- [Board layout persistence](2026-09-18-ketos-board-layout-persistence.md) — the `ui-board` settings document and its version whose window records this note extends.
- [Board input and the popover layer](2026-09-25-ketos-board-input-and-popover-layer.md) — the sibling stage note whose board popover layer the bezel's menus portal through.
- [Board gestures, culling, and the window-manager budgets](2026-09-17-ketos-board-gestures-culling.md) — the `detailZoomThreshold` simplified mode the bezel's edge-only rule follows.
