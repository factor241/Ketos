/**
 * The board document's cross-plane vocabulary: the branded identifiers, the
 * element envelope every kind shares, the snapshot and patch the browser reads
 * from the event stream, the operation union it writes, and the stable error
 * codes the routes answer with.
 *
 * The module is types only, so the browser imports it without pulling any host
 * module into the client bundle.
 * @module @ketos/board-doc/types
 */

import type { Branded, BrandedNumber } from '@deepseek-ai/dsh-brand'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Identity of one board element, minted by the creating client. */
export type ElementId = Branded<'ElementId'>

/** Identity of one board participant; the local Ketos owns exactly one. */
export type OwnerId = Branded<'OwnerId'>

/**
 * Identity of one board window, minted by the client that opens it. The brand
 * is the client layout vocabulary's `BoardWindowId` brand, so a window state
 * and its published record share one type.
 */
export type WindowId = Branded<'BoardWindowId'>

/** Identity of the board document, stable across restarts of one Ketos. */
export type BoardDocId = Branded<'BoardDocId'>

/** Monotone revision of the document: the `seq` of its latest journal row. */
export type BoardRevision = BrandedNumber<'BoardRevision'>

/** Kind of a board element; each kind owns its body renderer and data rules. */
export type BoardElementKind = 'note' | 'stroke' | 'todo'

/** Kind of a board window; each kind selects the frame the client renders. */
export type BoardWindowKind = 'agent' | 'connectors' | 'settings' | 'dashboard' | 'clone' | 'tasks'

/** Body of a board window; each body selects the `board.window.body` occupant. */
export type BoardWindowBodyKind =
  | 'conversation' | 'connectors' | 'settings' | 'dashboard' | 'clone' | 'clone-memory' | 'tasks'

/** Status of one published window, as the publisher's session resolves it. */
export type BoardWindowStatus = 'idle' | 'running' | 'ready' | 'error'

/**
 * Identity of the Harness session one chat window shows. The brand is the
 * canonical `SessionId` brand, so the value crosses to the session packages
 * without a conversion.
 */
export type WindowSessionId = Branded<'SessionId'>

/** Who one window is open to; the client's access menu owns the semantics. */
export type BoardWindowAccessMode = 'owner' | 'selected' | 'all'

/** Access of one window: its mode plus the people a `selected` window admits. */
export interface BoardWindowAccess {
  readonly mode: BoardWindowAccessMode
  /** Owner ids the window is open to under `selected`, in menu order. */
  readonly people: readonly OwnerId[]
}

/**
 * One window as the shared document carries it. The record lives where the
 * window lives: `hostId` names the publishing Ketos, `ownerId` the participant
 * who manages the window there. `title` is the user-given name or the chat
 * title; `null` lets the receiver name the window by `kind` and `ordinal`.
 */
export interface BoardWindowRecord {
  /** Board-local window identity, minted by the publisher. */
  readonly id: WindowId
  /** Identity of the Ketos where the window lives; the host stamps it. */
  readonly hostId: OwnerId
  /** Participant who owns and manages the window. */
  readonly ownerId: OwnerId
  readonly kind: BoardWindowKind
  readonly bodyKind: BoardWindowBodyKind
  /** User-given or chat name; null names the window by kind and ordinal. */
  readonly title: string | null
  /** Ordinal among the window's kind, fixed at opening. */
  readonly ordinal: number
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly z: number
  readonly access: BoardWindowAccess
  /** Status the publisher resolved from the window's session. */
  readonly status: BoardWindowStatus
  /** Session a chat window shows; present only for windows that carry one. */
  readonly sessionId?: WindowSessionId
  /** Last-change time in milliseconds since the Unix epoch; the host stamps it. */
  readonly updatedAt: number
}

/** Identity of one Beads issue: the epic of a to-do list or one of its items. */
export type BeadsIssueId = Branded<'BeadsIssueId'>

/** Beads status of one to-do item, as the board snapshot carries it. */
export type TodoStatus = 'open' | 'in_progress' | 'blocked' | 'deferred' | 'closed'

/** One item of a to-do list, as the snapshot of the list carries it. */
export interface TodoItem {
  /** Beads issue id of the item. */
  readonly id: BeadsIssueId
  /** Item text. */
  readonly title: string
  /** Beads status; `closed` draws the item under the done section. */
  readonly status: TodoStatus
}

/**
 * Kind-owned payload of one to-do list: the host-owned snapshot of a Beads
 * epic and its child items. `epicId` names the epic in the Ketos Beads
 * database, `syncedAt` is the time of the last successful re-read, `missing`
 * marks an epic whose `bd show` no longer finds it while the item snapshot is
 * kept, and `pendingPlacement` marks a list created from chat that a visible
 * browser tab has yet to place in the center of the visible area.
 */
export interface TodoData {
  /** Beads issue id of the list's epic. */
  readonly epicId: BeadsIssueId
  /** The epic's title. */
  readonly title: string
  /** The epic's child items, in `created_at` order. */
  readonly items: readonly TodoItem[]
  /** Time of the last successful re-read, ISO 8601. */
  readonly syncedAt: string
  /** Present when `bd` no longer finds the epic; the items stay as last read. */
  readonly missing?: true
  /** Present until a visible browser tab places the list. */
  readonly pendingPlacement?: true
}

/** Font family one note draws its text with. */
export type NoteFont = 'sans' | 'serif' | 'mono'

/** Base text size of one note; the element scale is separate. */
export type NoteSize = 's' | 'm' | 'l'

/**
 * Kind-owned payload of one note: the plain text and the owner's display
 * choices. `scale` zooms the whole element: the world rectangle is `w × h` and
 * the content draws at `w/scale × h/scale` under `transform: scale(scale)`.
 */
export interface NoteData {
  readonly text: string
  readonly font: NoteFont
  readonly size: NoteSize
  readonly scale: number
}

/** Thickness of one stroke; each selection's world width is the protocol constant `STROKE_SIZES`. */
export type StrokeWidth = 's' | 'm' | 'l'

/**
 * One point of a stroke: x and y in world units and the pointer pressure in
 * `[0, 1]`. Stored points are relative to the element's `(x, y)`, so moving a
 * stroke patches the envelope without rewriting its points.
 */
export type StrokePoint = readonly [number, number, number]

/** One point of an eraser path in world units. */
export type StrokePathPoint = readonly [number, number]

/**
 * Kind-owned payload of one stroke: the drawing's points relative to the
 * element's `(x, y)`, the chosen thickness, and whether a pen produced it.
 * `pen` and `width` are the complete input of the paint options, so every
 * Ketos renders the same stored points into the same path.
 */
export interface StrokeData {
  readonly points: readonly StrokePoint[]
  readonly width: StrokeWidth
  readonly pen: boolean
}

/** The element box a stroke's relative points must stay inside. */
export interface StrokeBox {
  /** Envelope width in world units. */
  readonly w: number
  /** Envelope height in world units. */
  readonly h: number
}

/** The world rectangle of a stroke element: its `(x, y)` origin and size. */
export interface StrokeWorldBox {
  /** World x of the left edge. */
  readonly x: number
  /** World y of the top edge. */
  readonly y: number
  /** World width. */
  readonly w: number
  /** World height. */
  readonly h: number
}

/** Bounding box a stroke's absolute points resolve into, with the stored relative points. */
export interface StrokeBounds {
  /** World x of the box, the leftmost point less half the thickness. */
  readonly x: number
  /** World y of the box, the topmost point less half the thickness. */
  readonly y: number
  /** World width of the box, the point spread plus the thickness. */
  readonly w: number
  /** World height of the box, the point spread plus the thickness. */
  readonly h: number
  /** The points relative to `(x, y)`, coordinates rounded to 0.1 and pressure to 0.01. */
  readonly points: readonly StrokePoint[]
}

/** Kind-owned payload of one element, carried as plain JSON values. */
export type BoardElementData = Readonly<Record<string, JsonValue>>

/**
 * One board element as both the wire and the document expose it: the envelope
 * the host owns plus the kind-owned `data` payload.
 */
export interface BoardElement {
  readonly id: ElementId
  readonly kind: BoardElementKind
  readonly ownerId: OwnerId
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly z: number
  readonly data: BoardElementData
  /** Creation time in milliseconds since the Unix epoch; the host sets it. */
  readonly createdAt: number
  /** Last-change time in milliseconds since the Unix epoch; the host sets it. */
  readonly updatedAt: number
}

/** Limits the snapshot publishes so the browser can validate before sending. */
export interface BoardLimits {
  /** Largest serialized size, in bytes, of one stored element. */
  readonly elementBytesMax: number
  /** Largest note text the host accepts, in UTF-16 code units. */
  readonly noteTextMax: number
  /** Largest number of points one stroke may carry. */
  readonly strokePointsMax: number
  /** Largest number of items one to-do list may carry. */
  readonly todoItemsMax: number
}

/**
 * One participant record stored in the document, keyed by `selfId`. Each
 * Ketos writes only its own record; a synchronized document therefore holds
 * one writer per entry.
 */
export interface BoardParticipantRecord {
  /** Board participant identity this record belongs to. */
  readonly id: OwnerId
  /** Display name, 1–64 characters. */
  readonly name: string
  /** Palette color, 1–10. */
  readonly color: number
  /** Last write time in milliseconds since the Unix epoch; the writer sets it. */
  readonly updatedAt: number
}

/** Participant changes one patch carries beside its element changes. */
export interface BoardParticipantPatch {
  readonly upserts: readonly BoardParticipantRecord[]
  readonly removes: readonly OwnerId[]
}

/** Window-record changes one patch carries beside its element changes. */
export interface BoardWindowPatch {
  readonly upserts: readonly BoardWindowRecord[]
  readonly removes: readonly WindowId[]
}

/** Full state of the document at one revision, the first event of the stream. */
export interface BoardSnapshot {
  readonly docId: BoardDocId
  /** Identity of the local Ketos; never stored in the synchronized document. */
  readonly selfId: OwnerId
  readonly revision: BoardRevision
  readonly elements: readonly BoardElement[]
  /** Every stored participant record this build can decode. */
  readonly participants: readonly BoardParticipantRecord[]
  /** Every stored window record this build can decode. */
  readonly windows: readonly BoardWindowRecord[]
  readonly limits: BoardLimits
}

/** Incremental change of the document between two revisions. */
export interface BoardPatch {
  readonly revision: BoardRevision
  readonly upserts: readonly BoardElement[]
  readonly removes: readonly ElementId[]
  /** Present when the batch changed participants rather than elements. */
  readonly participants?: BoardParticipantPatch
  /** Present when the batch changed window records. */
  readonly windows?: BoardWindowPatch
}

/** Outcome of applying one update from another Ketos to the document. */
export interface BoardRemoteResult {
  /**
   * Whether Yjs kept structs or deletions of the document waiting for an
   * earlier update that has not arrived. The update is applied as far as its
   * dependencies allow; while anything waits, the received bytes are also
   * journaled whole, so the waiting part survives a restart and integrates
   * when the missing update arrives. The sender must still deliver what the
   * document's state vector misses.
   */
  readonly pending: boolean
}

/**
 * Payload of the `overflow` event of the event stream. The host sends it as
 * the last event before it closes a stream whose unread patches passed the
 * queue bound; the browser re-reads the snapshot after a pause instead of
 * treating the close as a transport failure.
 */
export interface BoardOverflowEvent {
  /** What the host ran out of: the per-stream queue of unread patches. */
  readonly reason: 'queue'
}

/** One create operation; the host fills `ownerId`, `z`, and the timestamps. */
export interface BoardCreateOp {
  readonly op: 'create'
  readonly id: ElementId
  readonly kind: BoardElementKind
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly data?: BoardElementData
}

/** One patch operation; absent fields keep their stored value. */
export interface BoardPatchOp {
  readonly op: 'patch'
  readonly id: ElementId
  readonly x?: number
  readonly y?: number
  readonly w?: number
  readonly h?: number
  readonly z?: number
  /**
   * Data fields to merge by key; a `null` value removes that data key from the
   * stored element, which is how optional flags are cleared.
   */
  readonly data?: BoardElementData
}

/** One remove operation. */
export interface BoardRemoveOp {
  readonly op: 'remove'
  readonly id: ElementId
}

/**
 * One publish of a window record. The client sends everything it knows about
 * the window; the host stamps `hostId` with its own `selfId` and `updatedAt`
 * with the batch time. A record written by another Ketos is refused.
 */
export interface BoardWindowPutOp {
  readonly op: 'window.put'
  readonly record: BoardWindowRecordInput
}

/** One removal of a window record. */
export interface BoardWindowRemoveOp {
  readonly op: 'window.remove'
  readonly id: WindowId
}

/**
 * One window record as a publisher sends it: the complete record, with
 * `hostId` and `updatedAt` optional because the host stamps them.
 */
export interface BoardWindowRecordInput {
  readonly id: WindowId
  /** Present when the publisher relays a record it holds; must equal `selfId`. */
  readonly hostId?: OwnerId
  readonly ownerId: OwnerId
  readonly kind: BoardWindowKind
  readonly bodyKind: BoardWindowBodyKind
  readonly title: string | null
  readonly ordinal: number
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly z: number
  readonly access: BoardWindowAccess
  readonly status: BoardWindowStatus
  readonly sessionId?: WindowSessionId
}

/** An operation of one atomic batch the browser sends. */
export type BoardOp = BoardCreateOp | BoardPatchOp | BoardRemoveOp | BoardWindowPutOp | BoardWindowRemoveOp

/**
 * Who sent an operation batch: a `browser` batch may only touch the elements
 * `selfId` owns, a `host` batch is a trusted in-process caller and bypasses
 * that check.
 */
export type BoardOrigin = 'browser' | 'host'

/** Answer of a successful operation batch. */
export interface BoardOpsResponse {
  readonly revision: BoardRevision
}

/** Stable error code of the board routes. */
export type BoardErrorCode =
  | 'ketos/invalid'
  | 'ketos/element-not-found'
  | 'ketos/element-foreign'
  | 'ketos/element-exists'
  | 'ketos/element-host-data'
  | 'ketos/window-foreign'
  | 'ketos/limit'
