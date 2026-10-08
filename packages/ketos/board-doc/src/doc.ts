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
import { isBoardElementKind } from './kinds.ts'
import type {
  BoardElement, BoardElementKind, BoardOrigin, BoardParticipantRecord, ElementId, OwnerId,
} from './types.ts'

/** The Yjs module surface the document wrapper uses. */
type YjsModule = typeof import('yjs')

/** Receives one line per element this build cannot read. */
export type InvalidElementListener = (message: string) => void

/** Document key of the elements map. */
const ELEMENTS_KEY = 'elements'

/** Document key of the participant map, keyed by owner id. */
const PARTICIPANTS_KEY = 'participants'

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
    const map = this.elements().get(id)
    if (map === undefined) return undefined
    return this.decode(id, map)
  }

  /**
   * Read every element this build can decode, in document order.
   * @returns the readable elements.
   */
  readAll(): readonly BoardElement[] {
    const elements: BoardElement[] = []
    for (const [id, map] of this.elements()) {
      if (!isElementId(id)) continue
      const element = this.decode(id, map)
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
    const map = this.participants().get(id)
    if (map === undefined) return undefined
    return this.decodeParticipant(id, map)
  }

  /**
   * Read every participant record this build can decode, in document order.
   * @returns the readable participant records.
   */
  readParticipants(): readonly BoardParticipantRecord[] {
    const records: BoardParticipantRecord[] = []
    for (const [id, map] of this.participants()) {
      const record = this.decodeParticipant(brandString<OwnerId>(id), map)
      if (record !== undefined) records.push(record)
    }
    return records
  }

  /**
   * Write one participant record. The caller has already validated it; each
   * Ketos writes only the record its own `selfId` keys.
   * @param id - the participant's board identity.
   * @param record - name, color, and write time.
   */
  writeParticipant(id: OwnerId, record: Omit<BoardParticipantRecord, 'id'>): void {
    let map = this.participants().get(id)
    if (map === undefined) {
      map = new this.y.Map<unknown>()
      this.participants().set(id, map)
    }
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
   * Write the resolved envelope and data of an existing element. The passed
   * data is the complete value after the key-wise merge, so a key missing from
   * it is deleted and a merge that changed nothing is a no-op.
   * @param id - element id.
   * @param patch - the resolved element fields.
   */
  patch(id: ElementId, patch: BoardElementPatch): void {
    const map = this.elements().get(id)
    if (map === undefined) return
    map.set('x', patch.x)
    map.set('y', patch.y)
    map.set('w', patch.w)
    map.set('h', patch.h)
    map.set('z', patch.z)
    map.set('updatedAt', patch.updatedAt)
    const data = map.get(DATA_KEY) as Y.Map<unknown>
    for (const key of [...data.keys()]) {
      if (!Object.hasOwn(patch.data, key)) data.delete(key)
    }
    for (const [key, value] of Object.entries(patch.data)) data.set(key, value)
  }

  /**
   * Delete one element.
   * @param id - element id.
   */
  remove(id: ElementId): void {
    this.elements().delete(id)
  }

  private elements(): Y.Map<Y.Map<unknown>> {
    return this.doc.getMap<Y.Map<unknown>>(ELEMENTS_KEY)
  }

  private participants(): Y.Map<Y.Map<unknown>> {
    return this.doc.getMap<Y.Map<unknown>>(PARTICIPANTS_KEY)
  }

  /**
   * Decode one stored participant record after validating it.
   * @param id - the participant's board identity.
   * @param map - one participant map.
   * @returns the record, or undefined when it is unreadable.
   */
  private decodeParticipant(id: OwnerId, map: Y.Map<unknown>): BoardParticipantRecord | undefined {
    const record = parseBoardParticipant({
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
   * @param map - one element map.
   * @returns the element, or undefined when it is unreadable.
   */
  private decode(id: ElementId, map: Y.Map<unknown>): BoardElement | undefined {
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
