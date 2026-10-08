// The participant map of the board document: the browser-safe record parser,
// the document read and write, and the service's own-record write with its
// name and color validation, announcement, and skip of an unreadable record.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import * as Y from 'yjs'
import {
  PARTICIPANT_COLOR_MAX, PARTICIPANT_COLOR_MIN, PARTICIPANT_NAME_MAX, parseBoardParticipant,
} from '../src/data.ts'
import { openDatabase } from '../src/db.ts'
import { BoardDocument } from '../src/doc.ts'
import { BoardJournal } from '../src/journal.ts'
import { KetosBoardDocService, type BoardChange } from '../src/service.ts'
import type { BoardParticipantRecord, OwnerId } from '../src/types.ts'

const SELF = brandString<OwnerId>('demo-self')
const OTHER = brandString<OwnerId>('other-owner')

/** A record every field of which this build accepts. */
const VALID: BoardParticipantRecord = { id: SELF, name: 'Аня', color: 3, updatedAt: 1_700_000_000_000 }

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

/** Fresh temporary directory that the running test owns. */
async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-board-participants-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  return root
}

/** A fresh document that records the lines it skipped. */
function openDoc(): { doc: BoardDocument; invalid: string[] } {
  const invalid: string[] = []
  const doc = BoardDocument.open(Y, (message) => { invalid.push(message) })
  return { doc, invalid }
}

/**
 * Store participant maps directly in a database file, as a synchronized
 * document another Ketos build could have written.
 * @param path - database path.
 * @param entries - owner id and raw participant fields to store.
 */
async function seedParticipants(
  path: string,
  entries: ReadonlyArray<readonly [string, Record<string, unknown>]>,
): Promise<void> {
  const db = await openDatabase(path)
  const doc = new Y.Doc()
  const journal = new BoardJournal(db, doc, 500)
  await journal.load()
  doc.transact(() => {
    const participants = doc.getMap<Y.Map<unknown>>('participants')
    for (const [id, fields] of entries) {
      const map = new Y.Map<unknown>()
      for (const [key, value] of Object.entries(fields)) map.set(key, value)
      participants.set(id, map)
    }
  }, 'host')
  journal.close()
  db.close()
}

/**
 * Mount one service over a fresh context and record its changes.
 * @param path - database path.
 * @returns the service, the received changes, and the log lines.
 */
function mount(path: string): { service: KetosBoardDocService; changes: BoardChange[]; invalid: string[] } {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const invalid: string[] = []
  const service = new KetosBoardDocService(ctx, {
    path,
    limits: {
      maxOpsPerRequest: 64,
      maxElements: 2000,
      elements: { elementBytesMax: 262_144, noteTextMax: 20_000, strokePointsMax: 2000, todoItemsMax: 200 },
    },
    journalCompactRows: 500,
    logger: (message) => { invalid.push(message) },
  })
  cleanups.push(() => service.close())
  const changes: BoardChange[] = []
  service.subscribe((change) => { changes.push(change) })
  return { service, changes, invalid }
}

describe('participant record parsing', () => {
  it('accepts a record with exactly the four published fields', () => {
    expect(parseBoardParticipant(VALID)).toEqual(VALID)
  })

  it('refuses a value that is not a JSON object', () => {
    for (const value of [undefined, null, 7, 'participant', ['participant']]) {
      expect(parseBoardParticipant(value)).toBeNull()
    }
  })

  it('refuses a record with an extra, missing, or unknown field', () => {
    expect(parseBoardParticipant({ ...VALID, extra: true })).toBeNull()
    expect(parseBoardParticipant({ id: SELF, name: 'Аня', color: 3 })).toBeNull()
    expect(parseBoardParticipant({ id: SELF, name: 'Аня', color: 3, timestamp: 1 })).toBeNull()
  })

  it('refuses an id that is not a non-empty string within the name bound', () => {
    expect(parseBoardParticipant({ ...VALID, id: 7 })).toBeNull()
    expect(parseBoardParticipant({ ...VALID, id: '' })).toBeNull()
    expect(parseBoardParticipant({ ...VALID, id: 'i'.repeat(PARTICIPANT_NAME_MAX + 1) })).toBeNull()
  })

  it('refuses a name that is not a non-empty string within the bound', () => {
    expect(parseBoardParticipant({ ...VALID, name: 7 })).toBeNull()
    expect(parseBoardParticipant({ ...VALID, name: '' })).toBeNull()
    expect(parseBoardParticipant({ ...VALID, name: 'n'.repeat(PARTICIPANT_NAME_MAX + 1) })).toBeNull()
  })

  it('refuses a color outside the integer palette', () => {
    expect(parseBoardParticipant({ ...VALID, color: '3' })).toBeNull()
    expect(parseBoardParticipant({ ...VALID, color: 1.5 })).toBeNull()
    expect(parseBoardParticipant({ ...VALID, color: PARTICIPANT_COLOR_MIN - 1 })).toBeNull()
    expect(parseBoardParticipant({ ...VALID, color: PARTICIPANT_COLOR_MAX + 1 })).toBeNull()
  })

  it('refuses a write time that is not a finite number', () => {
    expect(parseBoardParticipant({ ...VALID, updatedAt: 'now' })).toBeNull()
    expect(parseBoardParticipant({ ...VALID, updatedAt: Number.NaN })).toBeNull()
    expect(parseBoardParticipant({ ...VALID, updatedAt: Number.POSITIVE_INFINITY })).toBeNull()
  })

  it('accepts the boundary id, name, and color values', () => {
    expect(parseBoardParticipant({ id: 'i', name: 'n', color: PARTICIPANT_COLOR_MIN, updatedAt: 0 }))
      .toEqual({ id: 'i', name: 'n', color: PARTICIPANT_COLOR_MIN, updatedAt: 0 })
    const longest = 'x'.repeat(PARTICIPANT_NAME_MAX)
    expect(parseBoardParticipant({ id: longest, name: longest, color: PARTICIPANT_COLOR_MAX, updatedAt: 1 }))
      .toEqual({ id: longest, name: longest, color: PARTICIPANT_COLOR_MAX, updatedAt: 1 })
  })
})

describe('board document participants', () => {
  it('writes, updates, and reads one participant through the nested maps', () => {
    const { doc, invalid } = openDoc()
    doc.writeParticipant(SELF, { name: 'Аня', color: 3, updatedAt: 7 })
    expect(doc.readParticipant(SELF)).toEqual({ id: SELF, name: 'Аня', color: 3, updatedAt: 7 })
    expect(doc.readParticipants()).toEqual([{ id: SELF, name: 'Аня', color: 3, updatedAt: 7 }])
    doc.writeParticipant(SELF, { name: 'Борис', color: 4, updatedAt: 8 })
    expect(doc.readParticipants()).toEqual([{ id: SELF, name: 'Борис', color: 4, updatedAt: 8 }])
    expect(doc.ydoc.getMap('participants').size).toBe(1)
    expect(invalid).toEqual([])
  })

  it('returns undefined for an absent participant', () => {
    const { doc } = openDoc()
    expect(doc.readParticipant(brandString<OwnerId>('missing'))).toBeUndefined()
  })

  it('skips an unreadable participant record and reports its id', () => {
    const { doc, invalid } = openDoc()
    const map = new Y.Map<unknown>()
    map.set('name', '')
    map.set('color', 3)
    map.set('updatedAt', 1)
    doc.ydoc.getMap<Y.Map<unknown>>('participants').set('broken-owner', map)
    expect(doc.readParticipant(brandString<OwnerId>('broken-owner'))).toBeUndefined()
    expect(doc.readParticipants()).toEqual([])
    expect(invalid).toEqual([
      'board participant broken-owner skipped: record does not match this build',
      'board participant broken-owner skipped: record does not match this build',
    ])
  })
})

describe('board document service participants', () => {
  it('answers an empty document with no participants', async () => {
    const { service, changes } = mount(':memory:')
    expect(await service.participants()).toEqual([])
    expect((await service.snapshot()).participants).toEqual([])
    expect(changes).toEqual([])
  })

  it('writes only the local selfId record, announces it, and updates it in place', async () => {
    const { service, changes } = mount(':memory:')
    const selfId = await service.selfId()
    await service.putOwnParticipant({ name: 'Аня', color: 3 })
    const [first] = await service.participants()
    expect(first?.id).toBe(selfId)
    expect(first?.name).toBe('Аня')
    expect(first?.color).toBe(3)
    expect(typeof first?.updatedAt).toBe('number')
    expect((await service.snapshot()).participants).toEqual([first])
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      revision: 1,
      upserts: [],
      removes: [],
      participants: { upserts: [first], removes: [] },
    })

    await service.putOwnParticipant({ name: 'Борис', color: 10 })
    const records = await service.participants()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ id: selfId, name: 'Борис', color: 10 })
    expect(records[0]?.updatedAt).toBeTypeOf('number')
    expect(changes).toHaveLength(2)
    expect(changes[1]?.revision).toBe(2)
  })

  it('leaves another stored record untouched when the local record is written', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'board.db')
    await seedParticipants(path, [['other-owner', { name: 'Боря', color: 5, updatedAt: 42 }]])
    const { service } = mount(path)
    await service.putOwnParticipant({ name: 'Аня', color: 3 })
    const byId = new Map((await service.participants()).map(record => [record.id, record]))
    expect(byId.get(OTHER)).toEqual({ id: OTHER, name: 'Боря', color: 5, updatedAt: 42 })
    expect(byId.get(await service.selfId())).toMatchObject({ name: 'Аня', color: 3 })
  })

  it('refuses an empty name, a name over the bound, and a color outside the palette', async () => {
    const { service, changes } = mount(':memory:')
    const nameError = /participant name must be 1–64 characters/u
    const colorError = /participant color must be an integer from 1 to 10/u
    await expect(service.putOwnParticipant({ name: '', color: 1 })).rejects.toThrow(nameError)
    await expect(service.putOwnParticipant({ name: 'n'.repeat(PARTICIPANT_NAME_MAX + 1), color: 1 })).rejects.toThrow(nameError)
    await expect(service.putOwnParticipant({ name: 'ok', color: PARTICIPANT_COLOR_MIN - 1 })).rejects.toThrow(colorError)
    await expect(service.putOwnParticipant({ name: 'ok', color: PARTICIPANT_COLOR_MAX + 1 })).rejects.toThrow(colorError)
    await expect(service.putOwnParticipant({ name: 'ok', color: 1.5 })).rejects.toThrow(colorError)
    expect(await service.participants()).toEqual([])
    expect(changes).toEqual([])
  })

  it('skips an unreadable stored record with a log line instead of failing the snapshot', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'board.db')
    await seedParticipants(path, [
      ['broken-owner', { name: '', color: 3, updatedAt: 1 }],
      ['mirror-owner', { name: 'Боря', color: 5, updatedAt: 42 }],
    ])
    const { service, invalid } = mount(path)
    const snapshot = await service.snapshot()
    expect(snapshot.participants).toEqual([
      { id: brandString<OwnerId>('mirror-owner'), name: 'Боря', color: 5, updatedAt: 42 },
    ])
    expect(await service.participants()).toEqual(snapshot.participants)
    expect(invalid).toEqual([
      'board participant broken-owner skipped: record does not match this build',
      'board participant broken-owner skipped: record does not match this build',
    ])
  })

  it('refuses participant calls after close', async () => {
    const { service } = mount(':memory:')
    await service.snapshot()
    await service.close()
    await expect(service.participants()).rejects.toThrow(/already closed/u)
    await expect(service.putOwnParticipant({ name: 'Аня', color: 3 })).rejects.toThrow(/already closed/u)
  })
})
