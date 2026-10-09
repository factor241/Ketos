// Window records: the record parser shared by wire and document, the publish,
// change, and removal operations, the foreign-host refusal, the record budget,
// and the window slice of snapshots, patches, and remote exchanges.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import * as Y from 'yjs'
import { BoardSyncError } from '../src/doc.ts'
import { parseBoardOps } from '../src/ops.ts'
import { KetosBoardDocService, type BoardChange, type KetosBoardDocOptions } from '../src/service.ts'
import type {
  BoardCreateOp, BoardLimits, BoardWindowRecordInput, ElementId, OwnerId, WindowId, WindowSessionId,
} from '../src/types.ts'
import {
  WINDOW_TITLE_MAX, clampWindowTitle, isBoardWindowRecord, isSameBoardWindowContent, parseBoardWindowInput,
  parseBoardWindowRecord,
} from '../src/windows.ts'

/** Element limits every mounted service and parser publishes. */
const LIMITS: BoardLimits = {
  elementBytesMax: 262_144,
  noteTextMax: 20_000,
  strokePointsMax: 2000,
  todoItemsMax: 200,
}

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

const ID_ELEMENT = brandString<ElementId>('00000000-0000-4000-8000-000000000001')
const WINDOW_ID = brandString<WindowId>('agent-1-test')
const SELF_ID = brandString<OwnerId>('owner-self')

/**
 * One window-record input.
 * @param id - window id.
 * @param overrides - fields to replace.
 * @returns the record input.
 */
function windowInput(id: WindowId = WINDOW_ID, overrides: Partial<BoardWindowRecordInput> = {}): BoardWindowRecordInput {
  return {
    id,
    ownerId: SELF_ID,
    kind: 'agent',
    bodyKind: 'conversation',
    title: null,
    ordinal: 1,
    x: 24,
    y: 24,
    w: 552,
    h: 648,
    z: 10,
    access: { mode: 'owner', people: [] },
    status: 'idle',
    ...overrides,
  }
}

/** Fresh temporary directory that the running test owns. */
async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-board-windows-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  return root
}

/**
 * Mount one service over a fresh context.
 * @param path - database path.
 * @param maxWindowRecords - window-record budget.
 * @returns the service, its change recorder, and its invalid-record log.
 */
function mount(path: string, maxWindowRecords = 100): {
  service: KetosBoardDocService
  changes: BoardChange[]
  invalid: string[]
} {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const invalid: string[] = []
  const options: KetosBoardDocOptions = {
    path,
    limits: {
      maxOpsPerRequest: 64,
      maxElements: 2000,
      maxWindowRecords,
      elements: { elementBytesMax: 262_144, noteTextMax: 20_000, strokePointsMax: 2000, todoItemsMax: 200 },
    },
    journalCompactRows: 500,
    logger: (message) => { invalid.push(message) },
  }
  const service = new KetosBoardDocService(ctx, options)
  cleanups.push(() => service.close())
  return { service, changes: [], invalid }
}

/** One root Yjs document carrying raw window records for a seed update. */
function rawWindowDocument(entries: Readonly<Record<string, unknown>>): Y.Doc {
  const holder = new Y.Doc()
  const windows = holder.getMap<Y.Map<unknown>>('windows')
  for (const [key, fields] of Object.entries(entries)) {
    const map = new Y.Map<unknown>()
    for (const [field, value] of Object.entries(fields as Record<string, unknown>)) map.set(field, value)
    windows.set(key, map)
  }
  return holder
}

describe('window record validation', () => {
  it('accepts a complete record and one without optional stamps', () => {
    const complete = {
      ...windowInput(),
      hostId: SELF_ID,
      updatedAt: 7,
      title: 'Чат',
      sessionId: brandString<WindowSessionId>('session-1'),
      access: { mode: 'selected', people: [SELF_ID] },
    }
    expect(parseBoardWindowInput(complete)).toMatchObject({
      id: WINDOW_ID,
      hostId: SELF_ID,
      updatedAt: 7,
      title: 'Чат',
      sessionId: 'session-1',
      access: { mode: 'selected', people: [SELF_ID] },
    })
    expect(parseBoardWindowInput(windowInput())).toMatchObject({ title: null })
    expect(parseBoardWindowRecord({ ...windowInput(), hostId: SELF_ID, updatedAt: 7 })).toMatchObject({ hostId: SELF_ID, updatedAt: 7 })
    expect(parseBoardWindowRecord(windowInput())).toBeNull()
    expect(parseBoardWindowRecord({ ...windowInput(), hostId: SELF_ID })).toBeNull()
    expect(parseBoardWindowRecord({ ...windowInput(), updatedAt: 7 })).toBeNull()
    expect(isBoardWindowRecord({ ...windowInput(), hostId: SELF_ID, updatedAt: 7 })).toBe(true)
    expect(isBoardWindowRecord(windowInput())).toBe(false)
  })

  it('refuses malformed records field by field', () => {
    const base = { ...windowInput(), hostId: SELF_ID, updatedAt: 7 }
    const cases: unknown[] = [
      null,
      [],
      { ...base, extra: true },
      { ...base, id: 7 },
      { ...base, id: '' },
      { ...base, id: 'x'.repeat(65) },
      { ...base, id: 'bad\u0001id' },
      { ...base, hostId: '' },
      { ...base, ownerId: 'x'.repeat(65) },
      { ...base, kind: 'unknown' },
      { ...base, bodyKind: 'unknown' },
      { ...base, title: 7 },
      { ...base, title: '' },
      { ...base, title: 'x'.repeat(201) },
      { ...base, ordinal: 0 },
      { ...base, ordinal: 1.5 },
      { ...base, x: -100_001 },
      { ...base, y: '0' },
      { ...base, w: 0 },
      { ...base, h: 100_001 },
      { ...base, z: -1 },
      { ...base, z: 1.5 },
      { ...base, access: null },
      { ...base, access: { mode: 'owner', people: [], extra: true } },
      { ...base, access: { mode: 'unknown', people: [] } },
      { ...base, access: { mode: 'owner', people: 'self' } },
      { ...base, access: { mode: 'owner', people: Array.from({ length: 51 }, () => SELF_ID) } },
      { ...base, access: { mode: 'owner', people: [''] } },
      { ...base, status: 'unknown' },
      { ...base, sessionId: '' },
      { ...base, sessionId: 'x'.repeat(129) },
      { ...base, updatedAt: -1 },
    ]
    for (const value of cases) {
      expect(parseBoardWindowInput(value), JSON.stringify(value)?.slice(0, 60)).toBeNull()
    }
  })
})

describe('window title clamp', () => {
  it('keeps a title within the limit unchanged', () => {
    expect(clampWindowTitle('Чат')).toBe('Чат')
    expect(clampWindowTitle('a'.repeat(WINDOW_TITLE_MAX))).toBe('a'.repeat(WINDOW_TITLE_MAX))
  })

  it('cuts a longer title at the record limit', () => {
    const clamped = clampWindowTitle('a'.repeat(WINDOW_TITLE_MAX + 50))
    expect(clamped).toBe('a'.repeat(WINDOW_TITLE_MAX))
    expect(parseBoardWindowInput(windowInput(WINDOW_ID, { title: clamped }))).not.toBeNull()
  })

  it('replaces control characters, which a record refuses, with spaces', () => {
    const clamped = clampWindowTitle('План\tпоказа\nи\u007fвсё')
    expect(clamped).toBe('План показа и всё')
    expect(parseBoardWindowInput(windowInput(WINDOW_ID, { title: clamped }))).not.toBeNull()
  })

  it('never splits a surrogate pair at the cut', () => {
    const straddling = `${'a'.repeat(WINDOW_TITLE_MAX - 1)}😀tail`
    const clamped = clampWindowTitle(straddling)
    expect(clamped).toBe('a'.repeat(WINDOW_TITLE_MAX - 1))
    expect(parseBoardWindowInput(windowInput(WINDOW_ID, { title: clamped }))).not.toBeNull()

    const fitting = `${'a'.repeat(WINDOW_TITLE_MAX - 2)}😀tail`
    expect(clampWindowTitle(fitting)).toBe(`${'a'.repeat(WINDOW_TITLE_MAX - 2)}😀`)
  })

  it('keeps a lone high surrogate that no low surrogate follows', () => {
    const lone = `${'a'.repeat(WINDOW_TITLE_MAX - 1)}\ud83dxyz`
    expect(clampWindowTitle(lone)).toBe(`${'a'.repeat(WINDOW_TITLE_MAX - 1)}\ud83d`)
  })
})

describe('window content comparison', () => {
  const stored = { ...windowInput(), hostId: SELF_ID, updatedAt: 7 }

  it('ignores only the write time', () => {
    expect(isSameBoardWindowContent(stored, { ...stored, updatedAt: 99 })).toBe(true)
    expect(isSameBoardWindowContent(stored, { ...stored, x: 25 })).toBe(false)
    expect(isSameBoardWindowContent(stored, { ...stored, title: 'Чат' })).toBe(false)
    expect(isSameBoardWindowContent(stored, { ...stored, status: 'running' })).toBe(false)
    expect(isSameBoardWindowContent(stored, { ...stored, hostId: brandString<OwnerId>('owner-other') })).toBe(false)
    expect(isSameBoardWindowContent(stored, { ...stored, sessionId: brandString<WindowSessionId>('s') })).toBe(false)
    expect(isSameBoardWindowContent(stored, { ...stored, access: { mode: 'all', people: [] } })).toBe(false)
  })

  it('compares the selected people in order and by length', () => {
    const one = { ...stored, access: { mode: 'selected' as const, people: [SELF_ID] } }
    const other = brandString<OwnerId>('owner-b')
    expect(isSameBoardWindowContent(one, { ...one, access: { mode: 'selected', people: [SELF_ID] } })).toBe(true)
    expect(isSameBoardWindowContent(one, { ...one, access: { mode: 'selected', people: [SELF_ID, other] } })).toBe(false)
    const two = { ...one, access: { mode: 'selected' as const, people: [SELF_ID, other] } }
    expect(isSameBoardWindowContent(two, { ...two, access: { mode: 'selected', people: [other, SELF_ID] } })).toBe(false)
  })
})

describe('window operations', () => {
  it('publishes, changes, and removes one window record', async () => {
    const root = await temporaryDirectory()
    const { service, changes } = mount(join(root, 'board.db'))
    service.subscribe((change) => { changes.push(change) })
    const selfId = await service.selfId()

    await service.apply([{ op: 'window.put', record: windowInput() }], 'browser')
    expect(changes.at(-1)).toEqual({
      revision: 1,
      upserts: [],
      removes: [],
      windows: { upserts: [expect.objectContaining({ id: WINDOW_ID, hostId: selfId, title: null, status: 'idle' })], removes: [] },
    })
    expect((await service.snapshot()).windows).toHaveLength(1)

    await service.apply([{ op: 'window.put', record: windowInput(WINDOW_ID, { x: 120, status: 'running' }) }], 'browser')
    expect(changes.at(-1)).toEqual({
      revision: 2,
      upserts: [],
      removes: [],
      windows: { upserts: [expect.objectContaining({ id: WINDOW_ID, x: 120, status: 'running' })], removes: [] },
    })
    await service.apply([{
      op: 'window.put',
      record: windowInput(WINDOW_ID, { sessionId: brandString<WindowSessionId>('session-1') }),
    }], 'browser')
    expect((await service.snapshot()).windows[0]).toMatchObject({ sessionId: 'session-1' })

    await service.apply([{ op: 'window.remove', id: WINDOW_ID }], 'browser')
    expect(changes.at(-1)).toEqual({
      revision: 4,
      upserts: [],
      removes: [],
      windows: { upserts: [], removes: [WINDOW_ID] },
    })
    expect((await service.snapshot()).windows).toEqual([])
    expect(await service.apply([{ op: 'window.remove', id: WINDOW_ID }], 'browser')).toEqual({ revision: 4 })
  })

  it('writes, journals, and announces nothing for a put that changes nothing but the write time', async () => {
    const root = await temporaryDirectory()
    const { service, changes } = mount(join(root, 'board.db'))
    service.subscribe((change) => { changes.push(change) })
    const local: Uint8Array[] = []
    service.onLocalUpdate((update) => { local.push(update) })

    expect(await service.apply([{ op: 'window.put', record: windowInput() }], 'browser')).toEqual({ revision: 1 })
    const published = (await service.snapshot()).windows[0]

    // A later write time must not make the record differ; the input's own
    // `updatedAt` is replaced by the host's anyway.
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(await service.apply([{ op: 'window.put', record: windowInput() }], 'browser')).toEqual({ revision: 1 })
    const stamped = { ...windowInput(), updatedAt: 1 }
    expect(await service.apply([{ op: 'window.put', record: stamped }], 'host')).toEqual({ revision: 1 })
    expect(changes).toHaveLength(1)
    expect(local).toHaveLength(1)
    expect((await service.snapshot()).windows[0]).toEqual(published)

    expect(await service.apply([{ op: 'window.put', record: windowInput(WINDOW_ID, { x: 99 }) }], 'browser')).toEqual({ revision: 2 })
    expect(changes).toHaveLength(2)
  })

  it('announces only the changed window of a batch that repeats an unchanged one', async () => {
    const root = await temporaryDirectory()
    const { service, changes } = mount(join(root, 'board.db'))
    service.subscribe((change) => { changes.push(change) })
    const second = brandString<WindowId>('agent-2-test')
    await service.apply([{ op: 'window.put', record: windowInput() }], 'browser')

    await service.apply([
      { op: 'window.put', record: windowInput() },
      { op: 'window.put', record: windowInput(second) },
      { op: 'window.put', record: windowInput(second) },
    ], 'browser')
    expect(changes).toHaveLength(2)
    expect(changes.at(-1)?.windows?.upserts.map(record => record.id)).toEqual([second])
  })

  it('applies several operations on one window inside one batch', async () => {
    const root = await temporaryDirectory()
    const { service, changes } = mount(join(root, 'board.db'))
    service.subscribe((change) => { changes.push(change) })
    await service.apply([
      { op: 'window.put', record: windowInput() },
      { op: 'window.put', record: windowInput(WINDOW_ID, { x: 48 }) },
    ], 'browser')
    expect(changes.at(-1)?.windows?.upserts).toHaveLength(1)
    expect(changes.at(-1)?.windows?.upserts[0]).toMatchObject({ x: 48 })
    await service.apply([
      { op: 'window.remove', id: WINDOW_ID },
      { op: 'window.remove', id: WINDOW_ID },
    ], 'browser')
    expect(changes.at(-1)?.windows).toEqual({ upserts: [], removes: [WINDOW_ID] })
    expect((await service.snapshot()).windows).toEqual([])
  })

  it('refuses a record another Ketos published and lets the host replace it', async () => {
    const root = await temporaryDirectory()
    const { service, changes } = mount(join(root, 'board.db'))
    service.subscribe((change) => { changes.push(change) })
    const selfId = await service.selfId()
    const foreign = rawWindowDocument({
      'agent-foreign': { ...windowInput(brandString<WindowId>('agent-foreign')), hostId: 'owner-other', updatedAt: 1 },
    })
    await service.applyRemote(Y.encodeStateAsUpdate(foreign))
    expect((await service.snapshot()).windows).toHaveLength(1)

    await expect(service.apply([{ op: 'window.put', record: windowInput(WINDOW_ID, { hostId: brandString<OwnerId>('owner-other') }) }], 'browser'))
      .rejects.toThrow(/published by another Ketos/u)
    await expect(service.apply([{ op: 'window.put', record: windowInput(brandString<WindowId>('agent-foreign')) }], 'browser'))
      .rejects.toThrow(/lives on another Ketos/u)
    await expect(service.apply([{ op: 'window.remove', id: brandString<WindowId>('agent-foreign') }], 'browser'))
      .rejects.toThrow(/lives on another Ketos/u)

    // The host-side caller replaces the foreign record with its own.
    await service.apply([{ op: 'window.put', record: windowInput(brandString<WindowId>('agent-foreign'), { x: 480 }) }], 'host')
    expect((await service.snapshot()).windows[0]).toMatchObject({ id: 'agent-foreign', hostId: selfId, x: 480 })
    expect(changes.at(-1)?.windows?.upserts[0]).toMatchObject({ hostId: selfId })
  })

  it('skips unreadable records and refuses browser writes to their keys', async () => {
    const root = await temporaryDirectory()
    const { service, changes, invalid } = mount(join(root, 'board.db'))
    service.subscribe((change) => { changes.push(change) })
    const broken = rawWindowDocument({
      'agent-broken': { ...windowInput(brandString<WindowId>('agent-broken')), hostId: 'owner-self', updatedAt: 1, kind: 'unknown' },
    })
    await service.applyRemote(Y.encodeStateAsUpdate(broken))
    expect(changes).toEqual([])
    expect(invalid.some(line => line.includes('board window agent-broken skipped'))).toBe(true)
    expect((await service.snapshot()).windows).toEqual([])

    const id = brandString<WindowId>('agent-broken')
    await expect(service.apply([{ op: 'window.put', record: windowInput(id) }], 'browser')).rejects.toThrow(/not readable/u)
    await expect(service.apply([{ op: 'window.remove', id }], 'browser')).rejects.toThrow(/not readable/u)
    await service.apply([{ op: 'window.remove', id }], 'host')
    expect(await service.apply([{ op: 'window.remove', id }], 'host')).toEqual({ revision: 2 })
  })

  it('refuses a browser write to a non-map entry and lets the host replace it', async () => {
    const root = await temporaryDirectory()
    const { service, invalid } = mount(join(root, 'board.db'))
    const holder = new Y.Doc()
    holder.getMap('windows').set(WINDOW_ID, 5)
    await service.applyRemote(Y.encodeStateAsUpdate(holder))
    expect((await service.snapshot()).windows).toEqual([])
    expect(invalid).toContain(`board window ${WINDOW_ID} skipped: record does not match this build`)

    await expect(service.apply([{ op: 'window.put', record: windowInput() }], 'browser')).rejects.toThrow(/not readable/u)
    await service.apply([{ op: 'window.put', record: windowInput() }], 'host')
    expect((await service.snapshot()).windows.map(record => record.id)).toEqual([WINDOW_ID])
  })

  it('enforces the window-record budget', async () => {
    const root = await temporaryDirectory()
    const { service } = mount(join(root, 'board.db'), 1)
    await service.apply([{ op: 'window.put', record: windowInput(brandString<WindowId>('agent-1')) }], 'browser')
    await expect(service.apply([{ op: 'window.put', record: windowInput(brandString<WindowId>('agent-2')) }], 'browser'))
      .rejects.toThrow(/window records/u)
    // The same record updates freely at the budget.
    await service.apply([{ op: 'window.put', record: windowInput(brandString<WindowId>('agent-1'), { x: 48 }) }], 'browser')
    expect((await service.snapshot()).windows).toHaveLength(1)
  })

  it('refuses a window operation whose body is malformed', () => {
    const limits = { maxOpsPerRequest: 64, maxElements: 2000, maxWindowRecords: 100, elements: LIMITS }
    const cases: unknown[] = [
      { ops: [{ op: 'window.put', record: { ...windowInput(), kind: 'unknown' } }] },
      { ops: [{ op: 'window.put', record: { ...windowInput(), extra: true } }] },
      { ops: [{ op: 'window.put', record: windowInput(), hostStamp: 1 }] },
      { ops: [{ op: 'window.remove', id: '' }] },
      { ops: [{ op: 'window.remove', id: WINDOW_ID, extra: true }] },
    ]
    for (const body of cases) {
      let code: string | undefined
      try {
        parseBoardOps(body, limits)
      } catch (error: unknown) {
        code = (error as { code?: string }).code
      }
      expect(code, JSON.stringify(body)).toBe('ketos/invalid')
    }
    expect(parseBoardOps({ ops: [{ op: 'window.put', record: windowInput() }, { op: 'window.remove', id: WINDOW_ID }] }, limits))
      .toHaveLength(2)
  })

  it('carries window records through the remote exchange', async () => {
    const first = mount(join(await temporaryDirectory(), 'board.db'))
    const second = mount(join(await temporaryDirectory(), 'board.db'))
    const source = first.service
    const target = second.service
    const seen: BoardChange[] = []
    target.subscribe((change) => { seen.push(change) })

    await source.apply([{ op: 'window.put', record: windowInput() }], 'browser')
    await target.applyRemote(await source.diffSince(await target.stateVector()))
    expect(seen.at(-1)?.windows?.upserts[0]).toMatchObject({ id: WINDOW_ID })
    expect((await target.snapshot()).windows).toHaveLength(1)

    await source.apply([{ op: 'window.remove', id: WINDOW_ID }], 'browser')
    await target.applyRemote(await source.diffSince(await target.stateVector()))
    expect(seen.at(-1)?.windows?.removes).toEqual([WINDOW_ID])

    // A remote transaction that only carries unusable window keys emits nothing.
    const noise = rawWindowDocument({
      ['x'.repeat(65)]: { kind: 'unknown' },
      'agent-broken': { ...windowInput(brandString<WindowId>('agent-broken')), kind: 'unknown' },
    })
    const emitted = seen.length
    await target.applyRemote(Y.encodeStateAsUpdate(noise))
    expect(seen).toHaveLength(emitted)
    expect((await target.snapshot()).windows).toEqual([])
  })

  it('keeps the element and window slices independent in one batch', async () => {
    const root = await temporaryDirectory()
    const { service, changes } = mount(join(root, 'board.db'))
    service.subscribe((change) => { changes.push(change) })
    const create: BoardCreateOp = {
      op: 'create', id: ID_ELEMENT, kind: 'note', x: 0, y: 0, w: 10, h: 10,
      data: { text: '', font: 'sans', size: 'm', scale: 1 },
    }
    await service.apply([create, { op: 'window.put', record: windowInput() }], 'browser')
    expect(changes.at(-1)).toMatchObject({
      upserts: [expect.objectContaining({ id: ID_ELEMENT })],
      windows: { upserts: [expect.objectContaining({ id: WINDOW_ID })] },
    })
  })

  it('refuses remote bytes that are not an update', async () => {
    const root = await temporaryDirectory()
    const { service } = mount(join(root, 'board.db'))
    await expect(service.applyRemote(new Uint8Array([9, 9, 9]))).rejects.toBeInstanceOf(BoardSyncError)
  })
})
