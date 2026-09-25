# Agent Note: The board composer chips stay on one line, and the chats panel has one entry

Status: implemented

English | [中文](2026-09-25-ketos-board-composer-chips-and-panel-entry.zh.md)

## Problem

The board window composer's tool row wrapped at a 545px card width, and a floating window's card never grows past roughly 488px at the minimum window size — so near the default and minimum widths the row always split, the permission and model chips left the send control's line, and the card paid two rows for controls that fit on one. At the next threshold the responsive rules removed the permission and model labels outright: there was no state that kept one word, and the model chip had no glyph to fall back to, so the icon-only state would have left it unnamed.

Separately, the window frame header carried a panel-left button that duplicated the chats panel rail's own expand control: both were visible while the panel was collapsed, both called `openWindowPanel`, and in fullscreen the rail was hidden, which made the frame button the only way back into a collapsed panel.

## Decision

**The tool row never wraps.** `flex-wrap: nowrap` on `.toolRow`; the leading group (actions, mode chips) absorbs the squeeze through `min-width: 0` and `overflow: hidden`, and the trailing group (context ring, model chip, send) stays pinned to the right while the model chip — capped at `min(360px, 45cqw)` — and its shrink priorities take the rest of the squeeze. The ring and the send button keep `flex: none`, so the two setup chips share the send control's line at every width and the send control never moves.

**A chip label is a lead word plus an elided remainder.** `splitChipLabel(text)` splits on the first space; the permission and model chips render `.chipLead` (never shrunk, `flex: none`) and `.chipRest` (shrinkable, `text-overflow: ellipsis`). A label without a space — every Chinese label — keeps the whole text as the lead, which is the correct one-word unit for it.

**The shrink order is effort, then the model remainder, then the permission remainder.** `flex-shrink: 1000` on the effort label, `2` on the model name label, `1` on the permission label, so both chips keep their first word before either loses it.

**The thresholds keep a one-word floor and then drop to icons.** At `≤455px` the effort label and both remainders go, leaving one word per chip (the preset and plan chips keep their existing icon-only cut). At `≤405px` the permission and model labels go entirely: the permission chip keeps its shield and the model chip reveals its own `IconDataOutline16`, which ships hidden at ordinary widths.

**One entry per surface.** The frame header's chats button is removed with the `window.chats` dictionary key; the rail — rendered whenever the panel is not open — and the panel's own header carry the controls that open and collapse it. The rail now renders in fullscreen as well, hugging the docked panel's edge at the board panel's left, so a collapsed panel stays reachable in every presentation.

## Alternatives considered

- **Measuring the row in JavaScript** (`ResizeObserver` plus state). Rejected: the card already declares `container-type: inline-size` and every responsive rule in this composer is CSS; a measured layout would re-render the composer on every resize and duplicate the thresholds in TypeScript.
- **One threshold that hides the labels** (the previous behaviour). Rejected: the request fixes a one-word floor before the icon state, and hiding at a single cut removes the word the user asked to keep.
- **Language-aware word segmentation.** Rejected: splitting on the first space serves English and Russian labels; a Chinese label has no space and is already its own one-word unit.
- **Keeping the frame button in fullscreen only.** Rejected: one surface should have one entry, and the rail can serve fullscreen by hugging the docked edge; keeping the button alive for one mode would leave two controls to test and document.
- **Removing the rail and keeping the frame button.** Rejected: the rail sits on the panel's own edge and already carries the new-chat, folder, artifacts, and search entries; the header button was the duplicate.

## Consequences

The permission and model chips stay on the send control's line at every reachable floating width; between the two thresholds they show their first word plus an elided remainder, and below the narrowest they are icons only. The model chip gains a glyph that appears only in that icon-only state, so ordinary widths keep the previous look. The frame header loses its chats button; the panel opens from the rail in both presentations and collapses from its own header, and `window.chats` leaves the en, zh, and ru dictionaries.

Verification: `tests/composer.client.spec.tsx` (the lead/rest split for both chips, the effort run, and the hidden model glyph), `tests/conversation-body.client.spec.tsx` (the permission chip's split label), `tests/slots.client.spec.tsx` (no frame Chats button, the rail expand, the fullscreen rail at the board panel's left edge with the collapsed inset, and the Escape ladder), `tests/window-chats-panel.client.spec.tsx`, `tests/window-title.client.spec.tsx`, `tests/clone-flow.client.spec.tsx`, `tests/minimap-layers.client.spec.tsx`, and `tests/dock.client.spec.tsx` (every panel entry now goes through the rail), `tests/element-capture.client.spec.ts` (the description fixture), the ru pack spec with its key corpus, and `pnpm run test:gui`.

## Related

- [The chats panel is a window body of its own, opened beside the frame and docked in fullscreen](../architecture/2026-09-16-ketos-board-window-chats-panel.md) — the panel, its rail, and its geometry this decision adjusts.
- [Command identities and the composer file action](../architecture/2026-09-10-command-identities-and-composer-file-action.md) — the composer's command surface this change leaves untouched.
- [`packages/client/ui-board/README.md`](../../../../packages/client/ui-board/README.md) — the composer and panel contract with the updated responsive and entry statements.
