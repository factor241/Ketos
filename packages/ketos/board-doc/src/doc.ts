/**
 * The Yjs document wrapper: the one `elements` map, the nested per-element
 * maps the element envelope lives in, the typed reads, and the mutations the
 * operation batch applies.
 *
 * A read validates every stored field and skips an element that does not match
 * this build's envelope; after stage 33 a synchronized document may carry data
 * another Ketos version wrote, and one unusable element must not break the
 * whole board.
 * @module @ketos/board-doc/doc
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import type * as Y from 'yjs'
import { isElementId, parseBoardParticipant } from './data.ts'
import { PEER_ORIGIN } from './journal.ts'
import { isBoardElementKind } from './kinds.ts'
import type {
  BoardElement, BoardElementKind, BoardOrigin, BoardParticipantRecord, BoardWindowRecord, ElementId,
  OwnerId, WindowId,
} from './types.ts'
import { isWindowId, parseBoardWindowRecord } from './windows.ts'

/** The Yjs module surface the document wrapper uses. */
type YjsModule = typeof import('yjs')

/** Receives one line per element this build cannot read. */
export type InvalidElementListener = (message: string) => void

/**
 * Keys one transaction changed, per document slice, including changes to the
 * nested maps inside one entry.
 */
export interface BoardDocumentDelta {
  /** Element ids whose entry or nested data changed. */
  readonly elements: ReadonlySet<string>
  /** Participant ids whose record changed. */
  readonly participants: ReadonlySet<string>
  /** Window ids whose record changed. */
  readonly windows: ReadonlySet<string>
}

/** A byte sequence this document cannot read as a Yjs update. */
export class BoardSyncError extends Error {
  /**
   * @param reason - what the bytes got wrong; for logs, never for the browser.
   */
  constructor(reason: string) {
    super(reason)
    this.name = 'BoardSyncError'
  }
}

/** Document key of the elements map. */
const ELEMENTS_KEY = 'elements'

/** Document key of the participant map, keyed by owner id. */
const PARTICIPANTS_KEY = 'participants'

/** Document key of the window map, keyed by window id. */
const WINDOWS_KEY = 'windows'

/** Element key of the kind-owned data map. */
const DATA_KEY = 'data'

/** Envelope keys that must be finite numbers. */
const NUMERIC_KEYS = ['x', 'y', 'w', 'h', 'z', 'createdAt', 'updatedAt'] as const

/** One element's mutable envelope fields a patch may change. */
export interface BoardElementPatch {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly z: number
  readonly updatedAt: number
  /** Complete data of the element after the key-wise merge. */
  readonly data: BoardElement['data']
}

/**
 * The board's live document. It owns one `Y.Doc`; the journal owns persistence
 * and the service owns the transaction boundaries.
 */
export class BoardDocument {
  private constructor(
    private readonly y: YjsModule,
    private readonly doc: Y.Doc,
    private readonly onInvalid: InvalidElementListener,
  ) {}

  /**
   * Create an empty document over one Yjs module instance.
   * @param y - the lazily loaded Yjs module.
   * @param onInvalid - receives a line per skipped element.
   * @returns the document wrapper.
   */
  static open(y: YjsModule, onInvalid: InvalidElementListener): BoardDocument {
    return new BoardDocument(y, new y.Doc(), onInvalid)
  }

  /**
   * The underlying Yjs document; the journal follows it.
   * @returns the Yjs document.
   */
  get ydoc(): Y.Doc {
    return this.doc
  }

  /**
   * Read one element by id.
   * @param id - element id.
   * @returns the element, or undefined when it is absent or unreadable.
   */
  readElement(id: ElementId): BoardElement | undefined {
    const value = this.elements().get(id)
    if (value === undefined) return undefined
    return this.decode(id, value)
  }

  /**
   * Read every element this build can decode, in document order.
   * @returns the readable elements.
   */
  readAll(): readonly BoardElement[] {
    const elements: BoardElement[] = []
    for (const [id, value] of this.elements()) {
      if (!isElementId(id)) continue
      const element = this.decode(id, value)
      if (element !== undefined) elements.push(element)
    }
    return elements
  }

  /**
   * Every occupied element key, readable or not.
   * @returns the element ids in document order.
   */
  ids(): readonly ElementId[] {
    return [...this.elements().keys()].filter(isElementId)
  }

  /**
   * Number of occupied element keys, including unreadable ones.
   * @returns the stored element count.
   */
  count(): number {
    return this.elements().size
  }

  /**
   * Read one participant record by owner id.
   * @param id - the participant's board identity.
   * @returns the record, or undefined when it is absent or unreadable.
   */
  readParticipant(id: OwnerId): BoardParticipantRecord | undefined {
    const value = this.participants().get(id)
    if (value === undefined) return undefined
    return this.decodeParticipant(id, value)
  }

  /**
   * Read every participant record this build can decode, in document order.
   * @returns the readable participant records.
   */
  readParticipants(): readonly BoardParticipantRecord[] {
    const records: BoardParticipantRecord[] = []
    for (const [id, value] of this.participants()) {
      const record = this.decodeParticipant(brandString<OwnerId>(id), value)
      if (record !== undefined) records.push(record)
    }
    return records
  }

  /**
   * Write one participant record. The caller has already validated it; each
   * Ketos writes only the record its own `selfId` keys, so a stored value that
   * is not a map is replaced by a new map.
   * @param id - the participant's board identity.
   * @param record - name, color, and write time.
   */
  writeParticipant(id: OwnerId, record: Omit<BoardParticipantRecord, 'id'>): void {
    const map = this.entryMap(this.participants(), id)
    map.set('name', record.name)
    map.set('color', record.color)
    map.set('updatedAt', record.updatedAt)
  }

  /**
   * The highest `z` among readable elements, 0 while the document is empty.
   * @returns the current paint priority ceiling.
   */
  maxZ(): number {
    let max = 0
    for (const element of this.readAll()) {
      if (element.z > max) max = element.z
    }
    return max
  }

  /**
   * Run one mutation batch as a single Yjs transaction.
   * @param origin - transaction origin the journal records.
   * @param mutate - the mutations to run.
   */
  transact(origin: BoardOrigin, mutate: () => void): void {
    this.doc.transact(mutate, origin)
  }

  /**
   * Encode this document's state vector: the summary another Ketos sends to
   * ask for exactly the updates it is missing.
   * @returns the encoded state vector.
   */
  stateVector(): Uint8Array {
    return this.y.encodeStateVector(this.doc)
  }

  /**
   * Encode every update the other side's state vector does not cover.
   * @param stateVector - the other Ketos's encoded state vector.
   * @returns the encoded diff update.
   */
  diffSince(stateVector: Uint8Array): Uint8Array {
    return this.y.encodeStateAsUpdate(this.doc, stateVector)
  }

  /**
   * Apply one update that arrived from another Ketos with the `peer`
   * transaction origin. The bytes are decoded first, so an unreadable update
   * throws {@link BoardSyncError} before the document changes; a committed
   * update is journaled and reaches the follow listeners like any transaction.
   * @param update - one encoded update produced by another Ketos.
   * @returns the keys the update changed per slice.
   */
  applyRemote(update: Uint8Array): BoardDocumentDelta {
    try {
      this.y.decodeUpdate(update)
    } catch (error: unknown) {
      throw new BoardSyncError(`update is unreadable: ${String(error)}`)
    }
    return this.changedKeys(() => {
      this.y.applyUpdate(this.doc, update, PEER_ORIGIN)
    })
  }

  /**
   * Whether Yjs holds structs or deletions that wait for an update that has
   * not arrived. A pending part integrates by itself when the missing update
   * is applied.
   * @returns true while any part of an applied update waits for its dependencies.
   */
  hasPendingUpdates(): boolean {
    const { store } = this.doc
    return store.pendingStructs !== null || store.pendingDs !== null
  }

  /**
   * Run one mutation and report the keys it changed across the document maps,
   * nested `data` changes included. Observers attach for exactly this call and
   * detach even when the mutation throws.
   * @param mutate - the mutation to run.
   * @returns the changed keys per slice.
   */
  changedKeys(mutate: () => void): BoardDocumentDelta {
    const elements = new Set<string>()
    const participants = new Set<string>()
    const windows = new Set<string>()
    const detach = [
      this.observeMapKeys(ELEMENTS_KEY, (key) => { elements.add(key) }),
      this.observeMapKeys(PARTICIPANTS_KEY, (key) => { participants.add(key) }),
      this.observeMapKeys(WINDOWS_KEY, (key) => { windows.add(key) }),
    ]
    try {
      mutate()
    } finally {
      for (const stop of detach) stop()
    }
    return { elements, participants, windows }
  }

  /**
   * Whether a raw element key is occupied, readable or not.
   * @param id - element id.
   * @returns whether the key exists.
   */
  hasElement(id: ElementId): boolean {
    return this.elements().has(id)
  }

  /**
   * Whether a raw participant key is occupied, readable or not.
   * @param id - participant's board identity.
   * @returns whether the key exists.
   */
  hasParticipant(id: OwnerId): boolean {
    return this.participants().has(id)
  }

  /**
   * Read one window record by id.
   * @param id - window id.
   * @returns the record, or undefined when it is absent or unreadable.
   */
  readWindow(id: WindowId): BoardWindowRecord | undefined {
    const value = this.windows().get(id)
    if (value === undefined) return undefined
    return this.decodeWindow(id, value)
  }

  /**
   * Read every window record this build can decode, in document order.
   * @returns the readable records.
   */
  readWindows(): readonly BoardWindowRecord[] {
    const records: BoardWindowRecord[] = []
    for (const [id, value] of this.windows()) {
      if (!isWindowId(id)) continue
      const record = this.decodeWindow(brandString<WindowId>(id), value)
      if (record !== undefined) records.push(record)
    }
    return records
  }

  /**
   * Number of occupied window keys, including unreadable ones.
   * @returns the stored window count.
   */
  windowCount(): number {
    return this.windows().size
  }

  /**
   * Whether a raw window key is occupied, readable or not.
   * @param id - window id.
   * @returns whether the key exists.
   */
  hasWindow(id: WindowId): boolean {
    return this.windows().has(id)
  }

  /**
   * Write one complete window record. Only the Ketos that hosts the window
   * writes its record, so the write replaces every field and a stored value
   * that is not a map is replaced by a new map; the caller has already
   * validated the record and stamped the host fields.
   * @param record - the record to store.
   */
  writeWindow(record: BoardWindowRecord): void {
    const map = this.entryMap(this.windows(), record.id)
    map.set('hostId', record.hostId)
    map.set('ownerId', record.ownerId)
    map.set('kind', record.kind)
    map.set('bodyKind', record.bodyKind)
    map.set('title', record.title)
    map.set('ordinal', record.ordinal)
    map.set('x', record.x)
    map.set('y', record.y)
    map.set('w', record.w)
    map.set('h', record.h)
    map.set('z', record.z)
    map.set('access', { mode: record.access.mode, people: [...record.access.people] })
    map.set('status', record.status)
    if (record.sessionId === undefined) map.delete('sessionId')
    else map.set('sessionId', record.sessionId)
    map.set('updatedAt', record.updatedAt)
  }

  /**
   * Delete one window record.
   * @param id - window id.
   */
  removeWindow(id: WindowId): void {
    this.windows().delete(id)
  }

  /**
   * Insert one new element. The caller has already resolved and validated it.
   * @param element - the element to store.
   */
  create(element: BoardElement): void {
    const map = new this.y.Map<unknown>()
    map.set('kind', element.kind)
    map.set('ownerId', element.ownerId)
    map.set('x', element.x)
    map.set('y', element.y)
    map.set('w', element.w)
    map.set('h', element.h)
    map.set('z', element.z)
    map.set('createdAt', element.createdAt)
    map.set('updatedAt', element.updatedAt)
    const data = new this.y.Map<unknown>()
    for (const [key, value] of Object.entries(element.data)) data.set(key, value)
    map.set(DATA_KEY, data)
    this.elements().set(element.id, map)
  }

  /**
   * Write the resolved envelope and data of an existing element, skipping
   * every value the document already holds. The comparison is what lets two
   * Ketos instances patch different fields of one element concurrently: a
   * patch that leaves `x` alone writes no `x` and cannot clobber the other
   * side's move. The passed data is the complete value after the key-wise
   * merge, so a key missing from it is deleted.
   * @param id - element id.
   * @param patch - the resolved element fields.
   */
  patch(id: ElementId, patch: BoardElementPatch): void {
    const map = this.elements().get(id)
    if (!(map instanceof this.y.Map)) return
    const envelope = [
      ['x', patch.x], ['y', patch.y], ['w', patch.w], ['h', patch.h],
      ['z', patch.z], ['updatedAt', patch.updatedAt],
    ] as const
    for (const [key, value] of envelope) {
      if (map.get(key) !== value) map.set(key, value)
    }
    const data = map.get(DATA_KEY) as Y.Map<unknown>
    for (const key of [...data.keys()]) {
      if (!Object.hasOwn(patch.data, key)) data.delete(key)
    }
    for (const [key, value] of Object.entries(patch.data)) {
      if (data.get(key) !== value) data.set(key, value)
    }
  }

  /**
   * Delete one element.
   * @param id - element id.
   */
  remove(id: ElementId): void {
    this.elements().delete(id)
  }

  /**
   * The nested map stored under one key, storing a new empty map when the key
   * is absent or holds another value.
   * @param parent - one top-level document map.
   * @param key - entry key.
   * @returns the nested map to write fields into.
   */
  private entryMap(parent: Y.Map<unknown>, key: string): Y.Map<unknown> {
    const stored = parent.get(key)
    if (stored instanceof this.y.Map) return stored
    const map = new this.y.Map<unknown>()
    parent.set(key, map)
    return map
  }

  // Values are `unknown`: another Ketos can store any value under a key, and
  // every reader checks for a nested map before it reads one.
  private elements(): Y.Map<unknown> {
    return this.doc.getMap<unknown>(ELEMENTS_KEY)
  }

  private participants(): Y.Map<unknown> {
    return this.doc.getMap<unknown>(PARTICIPANTS_KEY)
  }

  private windows(): Y.Map<unknown> {
    return this.doc.getMap<unknown>(WINDOWS_KEY)
  }

  /**
   * Follow one top-level map and its nested maps for the duration of one
   * {@link changedKeys} call. A top-level event names the changed keys
   * directly; a nested event's path starts with the entry key it belongs to.
   * @param name - document key of the map.
   * @param collect - receives every changed key.
   * @returns the detach function.
   */
  private observeMapKeys(name: string, collect: (key: string) => void): () => void {
    const map = this.doc.getMap<unknown>(name)
    const handler = (events: Y.YEvent<Y.AbstractType<unknown>>[]): void => {
      for (const event of events) {
        if (event.target === map) {
          for (const key of (event as Y.YMapEvent<unknown>).keysChanged) collect(String(key))
          continue
        }
        collect(String(event.path[0]))
      }
    }
    map.observeDeep(handler)
    return () => { map.unobserveDeep(handler) }
  }

  /**
   * Decode one stored window record after validating it.
   * @param id - window id.
   * @param value - the value stored under the window key.
   * @returns the record, or undefined when the value is not a readable window map.
   */
  private decodeWindow(id: WindowId, value: unknown): BoardWindowRecord | undefined {
    const map: Y.Map<unknown> | undefined = value instanceof this.y.Map ? value : undefined
    const record = map === undefined ? null : parseBoardWindowRecord({
      id,
      hostId: map.get('hostId'),
      ownerId: map.get('ownerId'),
      kind: map.get('kind'),
      bodyKind: map.get('bodyKind'),
      title: map.get('title'),
      ordinal: map.get('ordinal'),
      x: map.get('x'),
      y: map.get('y'),
      w: map.get('w'),
      h: map.get('h'),
      z: map.get('z'),
      access: map.get('access'),
      status: map.get('status'),
      sessionId: map.get('sessionId'),
      updatedAt: map.get('updatedAt'),
    })
    if (record === null) {
      this.onInvalid(`board window ${id} skipped: record does not match this build`)
      return undefined
    }
    return record
  }

  /**
   * Decode one stored participant record after validating it.
   * @param id - the participant's board identity.
   * @param value - the value stored under the participant key.
   * @returns the record, or undefined when the value is not a readable participant map.
   */
  private decodeParticipant(id: OwnerId, value: unknown): BoardParticipantRecord | undefined {
    const map: Y.Map<unknown> | undefined = value instanceof this.y.Map ? value : undefined
    const record = map === undefined ? null : parseBoardParticipant({
      id,
      name: map.get('name'),
      color: map.get('color'),
      updatedAt: map.get('updatedAt'),
    })
    if (record === null) {
      this.onInvalid(`board participant ${id} skipped: record does not match this build`)
      return undefined
    }
    return record
  }

  /**
   * Reason one stored map is not a readable element, or null when it is.
   * @param map - one element map.
   * @returns the first rejection reason.
   */
  private rejectionReason(map: Y.Map<unknown>): string | null {
    if (!isBoardElementKind(map.get('kind'))) return 'kind is unknown'
    const ownerId = map.get('ownerId')
    if (typeof ownerId !== 'string' || ownerId === '') return 'ownerId is missing'
    for (const key of NUMERIC_KEYS) {
      const value = map.get(key)
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${key} is not a finite number`
    }
    if ((map.get('w') as number) <= 0) return 'w must be positive'
    if ((map.get('h') as number) <= 0) return 'h must be positive'
    if (!(map.get(DATA_KEY) instanceof this.y.Map)) return 'data is not a map'
    return null
  }

  /**
   * Decode one stored element after validating it.
   * @param id - element id.
   * @param value - the value stored under the element key.
   * @returns the element, or undefined when the value is not a readable element map.
   */
  private decode(id: ElementId, value: unknown): BoardElement | undefined {
    if (!(value instanceof this.y.Map)) {
      this.onInvalid(`board element ${id} skipped: entry is not a map`)
      return undefined
    }
    const map: Y.Map<unknown> = value
    const reason = this.rejectionReason(map)
    if (reason !== null) {
      this.onInvalid(`board element ${id} skipped: ${reason}`)
      return undefined
    }
    const data = map.get(DATA_KEY) as Y.Map<unknown>
    return {
      id,
      kind: map.get('kind') as BoardElementKind,
      ownerId: brandString<OwnerId>(map.get('ownerId') as string),
      x: map.get('x') as number,
      y: map.get('y') as number,
      w: map.get('w') as number,
      h: map.get('h') as number,
      z: map.get('z') as number,
      data: data.toJSON(),
      createdAt: map.get('createdAt') as number,
      updatedAt: map.get('updatedAt') as number,
    }
  }
}
