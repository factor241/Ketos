// The document wrapper stores the nested element maps, reads them back as
// typed elements, and skips an element this build cannot decode instead of
// breaking the board.
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import * as Y from 'yjs'
import { BoardDocument } from '../src/doc.ts'
import type { BoardElement, ElementId, OwnerId } from '../src/types.ts'

const SELF = brandString<OwnerId>('demo-self')
const ELEMENT = brandString<ElementId>('11111111-1111-4111-8111-111111111111')
const OTHER_ELEMENT = brandString<ElementId>('22222222-2222-4222-8222-222222222222')
const THIRD_ELEMENT = brandString<ElementId>('33333333-3333-4333-8333-333333333333')

/** A stored envelope every field of which this build can decode. */
const BASE: Record<string, unknown> = {
  kind: 'note',
  ownerId: 'demo-self',
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  z: 1,
  createdAt: 1,
  updatedAt: 1,
}

/** One element a test builds by hand, valid or not. */
function storedMap(values: Record<string, unknown> = BASE, data: unknown = new Y.Map()): Y.Map<unknown> {
  const map = new Y.Map<unknown>()
  for (const [key, value] of Object.entries(values)) map.set(key, value)
  if (data !== undefined) map.set('data', data)
  return map
}

/**
 * Put one hand-built element map into a document.
 * @param doc - document to write to.
 * @param id - element key.
 * @param map - the stored map.
 */
function put(doc: BoardDocument, id: ElementId, map: Y.Map<unknown>): void {
  doc.ydoc.getMap<Y.Map<unknown>>('elements').set(id, map)
}

/** Open a document that records the lines it skipped. */
function openDoc(): { doc: BoardDocument; invalid: string[] } {
  const invalid: string[] = []
  const doc = BoardDocument.open(Y, (message) => { invalid.push(message) })
  return { doc, invalid }
}

/** One complete element for direct writes. */
function element(overrides: Partial<BoardElement> = {}): BoardElement {
  return {
    id: ELEMENT,
    kind: 'note',
    ownerId: SELF,
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    z: 1,
    data: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('board document reads', () => {
  it('stores and reads one element through the nested maps', () => {
    const { doc, invalid } = openDoc()
    doc.create(element({ data: { text: 'привет', done: false } }))
    expect(doc.readElement(ELEMENT)).toEqual(element({ data: { text: 'привет', done: false } }))
    expect(doc.readAll()).toEqual([element({ data: { text: 'привет', done: false } })])
    expect(doc.ids()).toEqual([ELEMENT])
    expect(doc.count()).toBe(1)
    expect(doc.maxZ()).toBe(1)
    expect(invalid).toEqual([])
  })

  it('merges a patch by data key and keeps untouched fields', () => {
    const { doc } = openDoc()
    doc.create(element({ data: { a: 1, b: 2 } }))
    doc.patch(ELEMENT, { x: 5, y: 6, w: 20, h: 30, z: 4, updatedAt: 9, data: { a: 1, b: 3, c: 4 } })
    expect(doc.readElement(ELEMENT)).toEqual(element({
      x: 5, y: 6, w: 20, h: 30, z: 4, updatedAt: 9, data: { a: 1, b: 3, c: 4 },
    }))
  })

  it('removes an element and ignores a patch for an absent one', () => {
    const { doc } = openDoc()
    doc.create(element())
    doc.patch(OTHER_ELEMENT, { x: 0, y: 0, w: 10, h: 10, z: 1, updatedAt: 2, data: {} })
    doc.remove(ELEMENT)
    expect(doc.readElement(ELEMENT)).toBeUndefined()
    expect(doc.readAll()).toEqual([])
    expect(doc.count()).toBe(0)
  })

  it('skips an element with an unreadable envelope and reports why', () => {
    const cases: Array<[string, Record<string, unknown>, unknown]> = [
      ['kind is unknown', { ...BASE, kind: 'doodle' }, new Y.Map()],
      ['ownerId is missing', { ...BASE, ownerId: '' }, new Y.Map()],
      ['x is not a finite number', { ...BASE, x: Number.NaN }, new Y.Map()],
      ['w must be positive', { ...BASE, w: 0 }, new Y.Map()],
      ['h must be positive', { ...BASE, h: -1 }, new Y.Map()],
      ['z is not a finite number', { kind: 'note', ownerId: 'demo-self', x: 0, y: 0, w: 1, h: 1, createdAt: 1, updatedAt: 1 }, new Y.Map()],
      ['data is not a map', BASE, 'text'],
    ]
    for (const [reason, values, data] of cases) {
      const { doc, invalid } = openDoc()
      put(doc, ELEMENT, storedMap(values, data))
      const message = `board element ${ELEMENT} skipped: ${reason}`
      expect(doc.readElement(ELEMENT), reason).toBeUndefined()
      expect(invalid, reason).toEqual([message])
      invalid.length = 0
      expect(doc.readAll(), reason).toEqual([])
      expect(invalid, reason).toEqual([message])
    }
  })

  it('ignores a stored key that is not an element id', () => {
    const { doc } = openDoc()
    put(doc, brandString<ElementId>('not-a-uuid'), storedMap())
    expect(doc.readAll()).toEqual([])
    expect(doc.ids()).toEqual([])
    expect(doc.count()).toBe(1)
  })

  it('reports the highest readable z and ignores unreadable elements', () => {
    const { doc } = openDoc()
    doc.create(element({ id: ELEMENT, z: 3 }))
    doc.create(element({ id: OTHER_ELEMENT, z: 1, kind: 'stroke' }))
    put(doc, THIRD_ELEMENT, storedMap({ ...BASE, z: 99, kind: 'doodle' }))
    expect(doc.maxZ()).toBe(3)
  })
})
