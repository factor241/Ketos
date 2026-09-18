# Agent Note: Board windows restore their Harness sessions and reconcile them against the session list

Status: implemented

English | [中文](2026-09-19-ketos-board-session-restore.zh.md)

## Problem

Stage 4 gave every board window a real session, but the window id → session id map lived only in the bridge's apply closure: a page reload restored the window rectangles through the `ui-board` settings namespace and left every window session-less, so the body created a fresh chat for each one. Closing a window released its bridge record, and the stored layout kept no record of which session a window showed. Nothing reconciled a window against the session list either: a chat deleted while the window was open (or while the process was off) left the window attached to a dead session, and a chat that reappeared could never come back. The duplicate rule was also open: two windows could attach one session, and the project's reusable blank session was the easiest way to do it.

## Decision

**The bindings map is the second half of the stored `ui-board` section.** `BoardSettings` (schema version 1) carries `bindings: Record<windowId, sessionId>` beside the layout document. The layout capture still omits the map — `captureBoardLayout` captures the store and knows nothing about sessions — and `BoardLayoutPersistence` is the single writer that merges the bridge's live map into every section patch, so a layout gesture and a session change cannot race each other through two revision-CAS writers. `writeBindings` replaces the map and schedules the same debounced, min-interval, conflict-retrying write the layout uses, and the first-frame cache round-trips both halves.

**The bridge owns the live map and persists it on discrete events only.** `BoardSessionBridge.bindings()` derives the map from its records; `switchTo` (create, rebind, fork) and `release` (window close) hand it to the persistence hook. Frames never write it. Disposal writes nothing: unloading the plugin is not a close.

**Restore is an adoption listener, not a mount effect.** `persistence.onAdopt` fires for the first-frame cache (before the first render) and for the server section once the describe mirror answers; the apply registers `bridge.restore(settings.bindings, layoutWindowIds)`, so windows are pointed at their sessions before any window component mounts and `ensureWindowSession` finds a bound record instead of creating a second chat. `restore` reconciles the stored map with the layout first — a pair whose window is gone, and a session the map names twice, are dropped from the stored map (one session, one window; the first window keeps it) — and then reconciles every bound window against `sessions.list`.

**`sessions.list` is the authority for a bound session's life.** A window whose session is listed attaches immediately; a session the host has not reported (the list still `pending`) leaves the window in a new `restoring` status; a session the ready list no longer holds moves the window to a new `missing` status without deleting the window, clearing the derived lane state (chat, queue, goal, context) while keeping the last title and directory for the frame and the "create" action. A later list snapshot that contains the session again reattaches it, and nothing auto-creates a replacement: the window offers New session (a chat in the last known directory) and Choose a chat (the window's chats panel). The dock maps `restoring` to idle and `missing` to error.

**One session, one window.** `bind` returns a discriminated `BoardBindOutcome` (`bound` | `same` | `duplicate` | `unknown`) instead of silently ignoring the case. A chat another window already shows returns `duplicate` with the holder's id, and the apply — the only layer that owns store actions — centers that window instead of rebinding; an id the list does not know returns `unknown`, which the chats panel and the Omnibox report as a localized "chat is gone" notice. `startChat` reuses a project's blank session only while no other window shows it. The Omnibox's menu lists the six most recently updated chats with their directory and reopens one through the same rule, focusing the window that already shows it.

**A settling request never overrules a newer gesture.** `create`, `createChat`, `createChatTarget`, and `forkChat` capture their window record before awaiting and drop the result when the record left the bridge (the window closed) or when the record's session moved on (the user picked a chat meanwhile). `whenReady` clears its pending entry only when it still owns the slot, so a released-and-reopened window cannot erase a newer creation.

## Alternatives considered

- **Store the map inside the layout document and write it with every capture.** Rejected: the capture is a pure function of the board store, and sessions are object-layer data; the bridge would have had to write its map through the store or the persistence layer would have needed a second capture input, and the stage-8 schema already separates the two halves deliberately.
- **A second settings writer for bindings.** Rejected: two writers sharing one revision-CAS namespace produce conflict churn for no benefit; one owner for the section is the invariant the layout work established.
- **Auto-create a replacement session for a missing one.** Rejected: it would silently turn a deleted chat into a new empty one and hide the loss; the body's explicit actions are the honest outcome, and the plan asks for them.
- **Allow duplicates with a marker.** Rejected as the MVP rule: comparing two windows on one session is not a stage-9 scenario, and focusing the holder is predictable; the decision is documented and covered by tests.
- **Subscribe to `sessions.list` per bound record for reconciliation.** Rejected: one bridge-wide subscription is enough, the list is a single snapshot, and per-record subscriptions would multiply with window count for the same information.
- **Watch the session face for removal instead of the list.** Rejected: the list is the host's durable truth and already drives the attached records; a removed session still has a locally addressable binding for a while, so the face would report stale liveness.
- **Write bindings on every publish.** Rejected: publishes happen per stream chunk; the section write budget (at most one per second, only after a discrete event) exists to keep the settings file quiet.

## Consequences

A reload paints the saved windows with their chats and the bridge reopens each session (the last attach makes its session current — the stage-4 trade-off, unchanged). A chat that is gone leaves an honest window with two ways back; a chat that returns reattaches by itself. One chat can no longer appear in two windows, and the surfaces that can reach a chat the list dropped say so instead of doing nothing. The stored map can outlive a session's file (the pair is kept while the session is missing), and it prunes itself against the layout on every adoption.

Verification: `tests/session-bridge.client.spec.ts` covers two-pair restore (one `open` per pair), the restoring-to-ready handoff, the missing-and-returned transition, removal while attached, duplicate/unknown/same outcomes, the blank-session rule, map persistence on create/rebind/close/dispose, close-during-create and bind-during-create races, and the open-close and rebind leak checks; `tests/board-persistence.client.spec.ts` covers the cache round-trip, the reconciled cache, the adopt listener, and one-patch writes; `tests/apply.client.spec.tsx` proves an adopted settings section opens both stored sessions before any window mounts; `tests/conversation-body.client.spec.tsx` and `tests/omnibox.client.spec.tsx` cover the missing-state actions and the recent-chat reopening. `pnpm exec vitest run packages/client/ui-board/tests`, `pnpm run test:gui`, and `DSH_SNAPSHOT=replay pnpm run test:web` are green.

## Related

- [Board windows own Harness sessions and rebuild the chat composer](2026-09-16-ketos-board-window-sessions.md) — the bridge this note extends; its per-window channel, subscriptions, and focus side effect still hold.
- [The board layout persists through the `ui-board` settings namespace](2026-09-18-ketos-board-layout-persistence.md) — the section, schema, cache, and write path the bindings ride on.
- [The window's chats panel](../../../../packages/client/ui-board/src/client/window/WindowChatsPanel.tsx) — the surface whose chat selection follows the duplicate rule.
- [`packages/client/AGENTS.md`](../../../../packages/client/AGENTS.md) — the inject-hooks and subscription rules the bridge follows.
