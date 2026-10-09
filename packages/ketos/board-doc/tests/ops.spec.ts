// The operation wire: parsing one batch body, resolving host-owned defaults,
// checking the complete merged result, and applying the batch atomically with
// the owner rules a browser batch obeys.
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import * as Y from 'yjs'
import { BoardDocument } from '../src/doc.ts'
import { BOARD_ELEMENT_KINDS, BOARD_HOST_DATA_KINDS } from '../src/kinds.ts'
import { applyBoardOps, parseBoardOps, resolveCreate, type BoardOpLimits } from '../src/ops.ts'
import type { BoardCreateOp, BoardElement, BoardElementData, BoardOp, ElementId, OwnerId } from '../src/types.ts'
import { BoardError } from '../src/wire.ts'

const SELF = brandString<OwnerId>('demo-self')
const OTHER = brandString<OwnerId>('demo-legal')
const NOW = 1_700_000_000_000

/** One valid todo payload the generic fixtures carry. */
const DATA: BoardElementData = { epicId: 'kt-1', title: 'list', items: [], syncedAt: '2026-10-06T12:00:00Z' }

/** One valid note payload the browser-origin fixtures carry. */
const NOTE: BoardElementData = { text: 'a', font: 'sans', size: 'm', scale: 1 }

/**
 * One deterministic element id.
 * @param serial - number filling the id's last group.
 * @returns the branded id.
 */
function elementId(serial: number): ElementId {
  return brandString<ElementId>(`00000000-0000-4000-8000-${String(serial).padStart(12, '0')}`)
}

const ID_A = elementId(1)
const ID_B = elementId(2)
const ID_C = elementId(3)

/**
 * Deployment limits with test overrides.
 * @param overrides - fields to replace.
 * @returns the limits.
 */
function limits(overrides: Partial<BoardOpLimits> = {}): BoardOpLimits {
  return {
    maxOpsPerRequest: 64,
    maxElements: 2000,
    maxWindowRecords: 100,
    elements: { elementBytesMax: 262_144, noteTextMax: 20_000, strokePointsMax: 2000, todoItemsMax: 200 },
    ...overrides,
  }
}

/**
 * One create operation with test defaults.
 * @param id - element id.
 * @param overrides - fields to replace.
 * @returns the create operation.
 */
function createOp(id: ElementId, overrides: Partial<Omit<BoardCreateOp, 'op' | 'id'>> = {}): BoardCreateOp {
  return { op: 'create', id, kind: 'todo', x: 0, y: 0, w: 10, h: 10, ...overrides }
}

/** A fresh document that records its skipped elements and update count. */
function openDoc(): { doc: BoardDocument; invalid: string[]; updates: () => number } {
  const invalid: string[] = []
  const doc = BoardDocument.open(Y, (message) => { invalid.push(message) })
  let updates = 0
  doc.ydoc.on('update', () => { updates += 1 })
  return { doc, invalid, updates: () => updates }
}

/**
 * The stable code one refused operation carries.
 * @param run - operation to run.
 * @returns the code, or undefined when the operation was accepted.
 */
function codeOf(run: () => unknown): string | undefined {
  try {
    run()
    return undefined
  } catch (error) {
    if (error instanceof BoardError) return error.code
    throw error
  }
}

/**
 * Store one element through the host path.
 * @param doc - document to write to.
 * @param id - element id.
 * @param ownerId - owner to stamp.
 * @param data - element data.
 * @returns the stored element.
 */
function seed(doc: BoardDocument, id: ElementId, ownerId: OwnerId = SELF, data: BoardElementData = DATA): BoardElement {
  const result = applyBoardOps(doc, [createOp(id, { data })], 'host', ownerId, limits(), NOW)
  return result.upserts[0] as BoardElement
}

describe('operation body parsing', () => {
  const badBodies: Array<[string, unknown]> = [
    ['an array body', []],
    ['an unknown body field', { ops: [], extra: true }],
    ['a missing ops field', {}],
    ['a non-array ops field', { ops: {} }],
    ['a non-object operation', { ops: ['create'] }],
    ['an unknown operation', { ops: [{ op: 'rename', id: ID_A }] }],
    ['an unknown create field', { ops: [{ op: 'create', id: ID_A, kind: 'note', x: 0, y: 0, w: 1, h: 1, ownerId: SELF }] }],
    ['a malformed id', { ops: [{ op: 'create', id: 'nope', kind: 'note', x: 0, y: 0, w: 1, h: 1 }] }],
    ['an unknown kind', { ops: [{ op: 'create', id: ID_A, kind: 'doodle', x: 0, y: 0, w: 1, h: 1 }] }],
    ['a non-numeric x', { ops: [{ op: 'create', id: ID_A, kind: 'note', x: '0', y: 0, w: 1, h: 1 }] }],
    ['a non-finite x', { ops: [{ op: 'create', id: ID_A, kind: 'note', x: Number.POSITIVE_INFINITY, y: 0, w: 1, h: 1 }] }],
    ['an out-of-bounds x', { ops: [{ op: 'create', id: ID_A, kind: 'note', x: 100_001, y: 0, w: 1, h: 1 }] }],
    ['a zero width', { ops: [{ op: 'create', id: ID_A, kind: 'note', x: 0, y: 0, w: 0, h: 1 }] }],
    ['a negative height', { ops: [{ op: 'create', id: ID_A, kind: 'note', x: 0, y: 0, w: 1, h: -1 }] }],
    ['an array data field', { ops: [{ op: 'create', id: ID_A, kind: 'note', x: 0, y: 0, w: 1, h: 1, data: [] }] }],
    ['an unknown patch field', { ops: [{ op: 'patch', id: ID_A, ownerId: SELF }] }],
    ['a patch with a non-finite z', { ops: [{ op: 'patch', id: ID_A, z: Number.NaN }] }],
    ['a patch with an out-of-bounds width', { ops: [{ op: 'patch', id: ID_A, w: -1 }] }],
    ['an unknown remove field', { ops: [{ op: 'remove', id: ID_A, x: 1 }] }],
    ['a remove without an id', { ops: [{ op: 'remove' }] }],
  ]

  for (const [name, body] of badBodies) {
    it(`refuses ${name}`, () => {
      expect(codeOf(() => parseBoardOps(body, limits()))).toBe('ketos/invalid')
    })
  }

  it('refuses a batch larger than the request bound', () => {
    const body = { ops: [createOp(ID_A), createOp(ID_B)] }
    expect(codeOf(() => parseBoardOps(body, limits({ maxOpsPerRequest: 1 })))).toBe('ketos/invalid')
  })

  it('parses creates and patches with absent optional fields', () => {
    expect(parseBoardOps({ ops: [createOp(ID_A)] }, limits()))
      .toEqual([{ op: 'create', id: ID_A, kind: 'todo', x: 0, y: 0, w: 10, h: 10 }])
    expect(parseBoardOps({ ops: [{ op: 'patch', id: ID_A }] }, limits()))
      .toEqual([{ op: 'patch', id: ID_A }])
    expect(parseBoardOps({
      ops: [{ op: 'patch', id: ID_A, x: 1, y: 2, w: 3, h: 4, z: 5, data: { a: 1 } }],
    }, limits())).toEqual([{ op: 'patch', id: ID_A, x: 1, y: 2, w: 3, h: 4, z: 5, data: { a: 1 } }])
  })

  it('parses a complete batch into typed operations', () => {
    const ops = parseBoardOps({
      ops: [createOp(ID_A, { data: { text: 'x' } }), { op: 'patch', id: ID_A, x: 4 }, { op: 'remove', id: ID_A }],
    }, limits())
    expect(ops).toEqual([
      { op: 'create', id: ID_A, kind: 'todo', x: 0, y: 0, w: 10, h: 10, data: { text: 'x' } },
      { op: 'patch', id: ID_A, x: 4 },
      { op: 'remove', id: ID_A },
    ])
    expect(parseBoardOps({ ops: [] }, limits())).toEqual([])
  })
})

describe('operation application', () => {
  it('stamps owner, z above the ceiling, and both timestamps on create', () => {
    const { doc } = openDoc()
    seed(doc, ID_A, OTHER)
    const result = applyBoardOps(doc, [createOp(ID_B, { kind: 'note', data: NOTE })], 'browser', SELF, limits(), NOW)
    expect(result).toEqual({
      upserts: [{
        id: ID_B,
        kind: 'note',
        ownerId: SELF,
        x: 0,
        y: 0,
        w: 10,
        h: 10,
        z: 2,
        data: NOTE,
        createdAt: NOW,
        updatedAt: NOW,
      }],
      removes: [],
      windowUpserts: [],
      windowRemoves: [],
    })
    expect(doc.readElement(ID_B)).toEqual(result.upserts[0])
  })

  it('defaults absent create data to an empty object', () => {
    expect(resolveCreate(createOp(ID_A), { ids: new Set(), maxZ: 0 }, SELF, NOW).data).toEqual({})
  })

  it('refuses a create whose id is occupied and one past the element budget', () => {
    const { doc } = openDoc()
    seed(doc, ID_A)
    expect(codeOf(() => applyBoardOps(doc, [createOp(ID_A, { kind: 'note', data: NOTE })], 'browser', SELF, limits(), NOW)))
      .toBe('ketos/element-exists')
    expect(codeOf(() => applyBoardOps(doc, [createOp(ID_B, { kind: 'note', data: NOTE })], 'browser', SELF, limits({ maxElements: 1 }), NOW)))
      .toBe('ketos/limit')
  })

  it('refuses a patch or remove of an absent element', () => {
    const { doc } = openDoc()
    expect(codeOf(() => applyBoardOps(doc, [{ op: 'patch', id: ID_A, x: 1 }], 'browser', SELF, limits(), NOW)))
      .toBe('ketos/element-not-found')
    expect(codeOf(() => applyBoardOps(doc, [{ op: 'remove', id: ID_A }], 'browser', SELF, limits(), NOW)))
      .toBe('ketos/element-not-found')
  })

  it('lets only the host touch another participant’s element', () => {
    const { doc } = openDoc()
    seed(doc, ID_A, OTHER)
    expect(codeOf(() => applyBoardOps(doc, [{ op: 'patch', id: ID_A, x: 1 }], 'browser', SELF, limits(), NOW)))
      .toBe('ketos/element-foreign')
    expect(codeOf(() => applyBoardOps(doc, [{ op: 'remove', id: ID_A }], 'browser', SELF, limits(), NOW)))
      .toBe('ketos/element-foreign')
    const applied = applyBoardOps(doc, [{ op: 'patch', id: ID_A, x: 1 }], 'host', SELF, limits(), NOW)
    expect(applied.upserts[0]?.x).toBe(1)
    expect(doc.readElement(ID_A)?.x).toBe(1)
  })

  it('lets a browser patch its own element and merge data by key', () => {
    const { doc } = openDoc()
    seed(doc, ID_A, SELF, DATA)
    applyBoardOps(doc, [createOp(ID_B, { kind: 'note', data: NOTE })], 'browser', SELF, limits(), NOW)
    const result = applyBoardOps(doc, [{ op: 'patch', id: ID_B, data: { text: 'updated' } }], 'browser', SELF, limits(), NOW)
    expect(doc.readElement(ID_B)).toMatchObject({ data: { ...NOTE, text: 'updated' }, updatedAt: NOW })
    expect(result.upserts).toHaveLength(1)
    expect(result.removes).toEqual([])
  })

  it('removes a data key whose patch value is null', () => {
    const { doc } = openDoc()
    seed(doc, ID_A, SELF, { ...DATA, missing: true })
    applyBoardOps(doc, [{ op: 'patch', id: ID_A, data: { missing: null } }], 'host', SELF, limits(), NOW)
    expect(doc.readElement(ID_A)?.data).toEqual(DATA)
  })

  it('removes an element and reports it', () => {
    const { doc } = openDoc()
    seed(doc, ID_A)
    const result = applyBoardOps(doc, [{ op: 'remove', id: ID_A }], 'browser', SELF, limits(), NOW)
    expect(result).toEqual({ upserts: [], removes: [ID_A], windowUpserts: [], windowRemoves: [] })
    expect(doc.readElement(ID_A)).toBeUndefined()
  })

  it('leaves the document untouched when a later operation fails', () => {
    const { doc, updates } = openDoc()
    expect(codeOf(() => applyBoardOps(
      doc,
      [createOp(ID_A, { kind: 'note', data: NOTE }), { op: 'patch', id: ID_B, x: 1 }],
      'browser',
      SELF,
      limits(),
      NOW,
    ))).toBe('ketos/element-not-found')
    expect(doc.readElement(ID_A)).toBeUndefined()
    expect(doc.count()).toBe(0)
    expect(updates()).toBe(0)
  })

  it('resolves a create followed by a patch of the same element inside one batch', () => {
    const { doc } = openDoc()
    const result = applyBoardOps(
      doc,
      [createOp(ID_A, { kind: 'note', data: NOTE }), { op: 'patch', id: ID_A, x: 7, data: { text: 'updated' } }],
      'browser',
      SELF,
      limits(),
      NOW,
    )
    expect(result.upserts).toHaveLength(1)
    expect(doc.readElement(ID_A)).toMatchObject({ x: 7, data: { ...NOTE, text: 'updated' } })
  })

  it('resolves a remove followed by a create of the same id inside one batch', () => {
    const { doc } = openDoc()
    seed(doc, ID_A, SELF, { ...DATA, title: 'old' })
    const result = applyBoardOps(
      doc,
      [{ op: 'remove', id: ID_A }, createOp(ID_A, { kind: 'note', data: { ...NOTE, text: 'fresh' } })],
      'browser',
      SELF,
      limits(),
      NOW,
    )
    expect(result.removes).toEqual([])
    expect(doc.readElement(ID_A)).toMatchObject({ kind: 'note', data: { ...NOTE, text: 'fresh' } })
  })

  it('reports an element removed earlier in the same batch as absent', () => {
    const { doc } = openDoc()
    seed(doc, ID_A)
    expect(codeOf(() => applyBoardOps(
      doc,
      [{ op: 'remove', id: ID_A }, { op: 'patch', id: ID_A, x: 1 }],
      'browser',
      SELF,
      limits(),
      NOW,
    ))).toBe('ketos/element-not-found')
    expect(doc.readElement(ID_A)).toBeDefined()
  })

  it('applies an empty batch as a no-op', () => {
    const { doc, updates } = openDoc()
    expect(applyBoardOps(doc, [], 'browser', SELF, limits(), NOW)).toEqual({ upserts: [], removes: [], windowUpserts: [], windowRemoves: [] })
    expect(updates()).toBe(0)
  })

  it('refuses data that is not a JSON object when a host caller bypasses parsing', () => {
    const { doc } = openDoc()
    expect(codeOf(() => applyBoardOps(doc, [createOp(ID_A, { data: 'text' as never })], 'host', SELF, limits(), NOW)))
      .toBe('ketos/invalid')
    expect(doc.count()).toBe(0)
  })

  it('accepts an element exactly at the byte bound and refuses one byte more', () => {
    const base: BoardElement = {
      id: ID_A,
      kind: 'todo',
      ownerId: SELF,
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      z: 1,
      data: DATA,
      createdAt: NOW,
      updatedAt: NOW,
    }
    const bytes = new TextEncoder().encode(JSON.stringify(base)).length
    const exact = limits({ elements: { elementBytesMax: bytes, noteTextMax: 20_000, strokePointsMax: 2000, todoItemsMax: 200 } })
    expect(codeOf(() => applyBoardOps(openDoc().doc, [createOp(ID_A, { data: DATA })], 'host', SELF, exact, NOW)))
      .toBeUndefined()
    const tight = limits({ elements: { elementBytesMax: bytes - 1, noteTextMax: 20_000, strokePointsMax: 2000, todoItemsMax: 200 } })
    expect(codeOf(() => applyBoardOps(openDoc().doc, [createOp(ID_A, { data: DATA })], 'host', SELF, tight, NOW)))
      .toBe('ketos/limit')
  })

  it('refuses a patch whose merged keys exceed the byte budget', () => {
    const { doc } = openDoc()
    seed(doc, ID_A, SELF, DATA)
    const tight = limits({ elements: { elementBytesMax: 150, noteTextMax: 20_000, strokePointsMax: 2000, todoItemsMax: 200 } })
    expect(codeOf(() => applyBoardOps(
      doc,
      [{ op: 'patch', id: ID_A, data: { title: 'y'.repeat(100) } }],
      'host',
      SELF,
      tight,
      NOW,
    ))).toBe('ketos/invalid')
    expect(doc.readElement(ID_A)?.data).toEqual(DATA)
  })

  it('rejects an operation variant outside the closed union', () => {
    const { doc } = openDoc()
    const bogusName: string = 'bogus'
    const bogusOp = { op: bogusName, id: ID_A } as BoardOp
    expect(() => applyBoardOps(doc, [bogusOp], 'host', SELF, limits(), NOW)).toThrow(/unreachable variant/u)
  })
})

describe('create resolution', () => {
  it('resolves the host-owned fields against the batch state', () => {
    expect(resolveCreate(createOp(ID_C, { data: { a: 1 } }), { ids: new Set(), maxZ: 7 }, SELF, NOW)).toEqual({
      id: ID_C,
      kind: 'todo',
      ownerId: SELF,
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      z: 8,
      data: { a: 1 },
      createdAt: NOW,
      updatedAt: NOW,
    })
    expect(codeOf(() => resolveCreate(createOp(ID_C), { ids: new Set([ID_C]), maxZ: 0 }, SELF, NOW)))
      .toBe('ketos/element-exists')
  })
})

describe('host-owned element data', () => {
  it('lists the todo kind as host-owned and every host-owned kind as a known kind', () => {
    expect(BOARD_HOST_DATA_KINDS).toEqual(['todo'])
    for (const kind of BOARD_HOST_DATA_KINDS) expect(BOARD_ELEMENT_KINDS).toContain(kind)
  })

  it('refuses a browser create of a host-owned kind and leaves the document untouched', () => {
    const { doc, updates } = openDoc()
    expect(codeOf(() => applyBoardOps(
      doc,
      [createOp(ID_A, { kind: 'todo', data: DATA })],
      'browser',
      SELF,
      limits(),
      NOW,
    ))).toBe('ketos/element-host-data')
    expect(doc.count()).toBe(0)
    expect(updates()).toBe(0)
  })

  it('refuses a browser patch of host-owned data, including its own element and an empty data object', () => {
    const { doc } = openDoc()
    seed(doc, ID_A, SELF, DATA)
    for (const data of [{ epicId: 'kt-2' }, { title: 'renamed' }, {}]) {
      expect(codeOf(() => applyBoardOps(doc, [{ op: 'patch', id: ID_A, data }], 'browser', SELF, limits(), NOW)))
        .toBe('ketos/element-host-data')
    }
    expect(doc.readElement(ID_A)?.data).toEqual(DATA)
  })

  it('lets a browser move, resize, restack, and remove a host-owned element', () => {
    const { doc } = openDoc()
    seed(doc, ID_A, SELF, DATA)
    const patched = applyBoardOps(doc, [{ op: 'patch', id: ID_A, x: 5, y: 6, w: 20, h: 30, z: 9 }], 'browser', SELF, limits(), NOW)
    expect(patched.upserts[0]).toMatchObject({ x: 5, y: 6, w: 20, h: 30, z: 9, data: DATA })
    const removed = applyBoardOps(doc, [{ op: 'remove', id: ID_A }], 'browser', SELF, limits(), NOW)
    expect(removed.removes).toEqual([ID_A])
  })

  it('lets the host create a host-owned element and patch its data', () => {
    const { doc } = openDoc()
    seed(doc, ID_A, SELF, DATA)
    applyBoardOps(doc, [{ op: 'patch', id: ID_A, data: { title: 'synced' } }], 'host', SELF, limits(), NOW)
    expect(doc.readElement(ID_A)?.data).toMatchObject({ epicId: 'kt-1', title: 'synced' })
  })

  it('lets a browser create and edit a kind that is not host-owned', () => {
    const { doc } = openDoc()
    applyBoardOps(doc, [createOp(ID_A, { kind: 'note', data: NOTE })], 'browser', SELF, limits(), NOW)
    applyBoardOps(doc, [{ op: 'patch', id: ID_A, data: { text: 'b' } }], 'browser', SELF, limits(), NOW)
    expect(doc.readElement(ID_A)?.data).toMatchObject({ text: 'b' })
  })
})
