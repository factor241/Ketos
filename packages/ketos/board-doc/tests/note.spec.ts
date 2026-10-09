// The note kind's exact data rules: the four accepted fields, the text bound,
// the font, size, and scale lists, the merge of a text-only patch into the
// stored display choices, and the noteTextMax limit the snapshot publishes.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  NOTE_FONTS, NOTE_SCALE_STEPS, NOTE_SIZES, mintElementId, parseNoteData, validateElementData,
} from '../src/data.ts'
import type { BoardOpLimits } from '../src/ops.ts'
import { handleBoardOps, type BoardRouteConfig } from '../src/routes.ts'
import { KetosBoardDocService, type KetosBoardDocOptions } from '../src/service.ts'
import type { BoardCreateOp, BoardElementData, ElementId } from '../src/types.ts'

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

const ID = brandString<ElementId>('00000000-0000-4000-8000-000000000001')

const LIMITS: BoardOpLimits = {
  maxOpsPerRequest: 64,
  maxElements: 2000,
  maxWindowRecords: 100,
  elements: { elementBytesMax: 262_144, noteTextMax: 20_000, strokePointsMax: 2000, todoItemsMax: 200 },
}

/** One complete valid note payload. */
const NOTE = { text: 'hello', font: 'sans', size: 'm', scale: 1 } as const

/** Element box the note's validation receives; notes ignore it. */
const BOX = { w: 100, h: 100 }

/** One malformed payload and what it gets wrong. */
const BAD_NOTES: Array<[string, BoardElementData]> = [
  ['an extra field', { ...NOTE, extra: 1 }],
  ['an unknown font', { ...NOTE, font: 'cursive' }],
  ['an unknown size', { ...NOTE, size: 'xl' }],
  ['a scale outside the steps', { ...NOTE, scale: 0.6 }],
  ['a text over the bound', { ...NOTE, text: 'x'.repeat(20_001) }],
  ['a missing field', { text: 'hi', font: 'sans', size: 'm' }],
]

/** Fresh temporary directory that the running test owns. */
async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-board-note-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  return root
}

/**
 * Mount one document service and the operation route over it.
 * @param overrides - service options to replace.
 * @returns the service and the route configuration.
 */
async function mount(overrides: Partial<KetosBoardDocOptions> = {}): Promise<{
  service: KetosBoardDocService
  route: BoardRouteConfig
}> {
  const root = await temporaryDirectory()
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const service = new KetosBoardDocService(ctx, {
    path: join(root, 'board.db'),
    limits: LIMITS,
    journalCompactRows: 500,
    logger: () => {},
    ...overrides,
  })
  cleanups.push(() => service.close())
  return { service, route: { opLimits: LIMITS, maxRequestBytes: 1_048_576 } }
}

/**
 * Post one create operation through the route.
 * @param service - mounted service.
 * @param config - route configuration.
 * @param data - note data to send.
 * @returns the route's response.
 */
async function postNote(
  service: KetosBoardDocService,
  config: BoardRouteConfig,
  data: BoardElementData,
): Promise<Response> {
  const op: BoardCreateOp = { op: 'create', id: ID, kind: 'note', x: 0, y: 0, w: 10, h: 10, data }
  return await handleBoardOps(new Request('http://localhost/api/ketos.board.ops', {
    method: 'POST',
    body: JSON.stringify({ ops: [op] }),
    headers: { 'content-type': 'application/json' },
  }), service, config)
}

describe('note data parsing', () => {
  it('accepts every font, size, and scale step', () => {
    for (const font of NOTE_FONTS) {
      for (const size of NOTE_SIZES) {
        for (const scale of NOTE_SCALE_STEPS) {
          expect(parseNoteData({ text: 'hi', font, size, scale }, LIMITS.elements)).toEqual({
            text: 'hi', font, size, scale,
          })
        }
      }
    }
  })

  it('accepts a text exactly at the bound and refuses one code unit more', () => {
    const exact = 'x'.repeat(LIMITS.elements.noteTextMax)
    expect(parseNoteData({ ...NOTE, text: exact }, LIMITS.elements)).toMatchObject({ text: exact })
    const over = 'x'.repeat(LIMITS.elements.noteTextMax + 1)
    expect(parseNoteData({ ...NOTE, text: over }, LIMITS.elements)).toBeNull()
  })

  it('refuses extra and missing fields', () => {
    expect(parseNoteData({ ...NOTE, extra: 1 }, LIMITS.elements)).toBeNull()
    expect(parseNoteData({ text: 'hi', font: 'sans', size: 'm' }, LIMITS.elements)).toBeNull()
    expect(parseNoteData([], LIMITS.elements)).toBeNull()
  })

  it('refuses fields of the wrong JSON type', () => {
    expect(parseNoteData({ ...NOTE, text: 5 }, LIMITS.elements)).toBeNull()
    expect(parseNoteData({ ...NOTE, font: 5 }, LIMITS.elements)).toBeNull()
    expect(parseNoteData({ ...NOTE, size: 5 }, LIMITS.elements)).toBeNull()
    expect(parseNoteData({ ...NOTE, scale: '1' }, LIMITS.elements)).toBeNull()
  })

  it('refuses note data over the element byte budget before parsing the fields', () => {
    expect(validateElementData('note', NOTE, { elementBytesMax: 10, noteTextMax: 20_000, strokePointsMax: 2000, todoItemsMax: 200 }, BOX))
      .toMatch(/exceeds 10 bytes/u)
  })
})

describe('note data through the operation route', () => {
  it('accepts a valid note', async () => {
    const { service, route } = await mount()
    expect((await postNote(service, route, NOTE)).status).toBe(200)
    expect((await service.snapshot()).elements[0]?.data).toEqual(NOTE)
  })

  it('answers 400 ketos/invalid for every malformed note', async () => {
    const { service, route } = await mount()
    for (const [name, data] of BAD_NOTES) {
      const response = await postNote(service, route, data)
      expect(response.status, name).toBe(400)
      expect(await response.json(), name).toMatchObject({ ok: false, error: 'ketos/invalid' })
    }
    expect((await service.snapshot()).elements).toEqual([])
  })

  it('refuses a malformed note through a host batch with ketos/invalid', async () => {
    const { service } = await mount()
    const op: BoardCreateOp = { op: 'create', id: mintElementId(), kind: 'note', x: 0, y: 0, w: 10, h: 10, data: BAD_NOTES[0]?.[1] ?? {} }
    await expect(service.apply([op], 'host')).rejects.toMatchObject({ code: 'ketos/invalid' })
    expect((await service.snapshot()).elements).toEqual([])
  })
})

describe('note text patch', () => {
  it('merges a text-only patch into the stored display choices', async () => {
    const { service, route } = await mount()
    expect((await postNote(service, route, NOTE)).status).toBe(200)
    const response = await handleBoardOps(new Request('http://localhost/api/ketos.board.ops', {
      method: 'POST',
      body: JSON.stringify({ ops: [{ op: 'patch', id: ID, data: { text: 'edited' } }] }),
      headers: { 'content-type': 'application/json' },
    }), service, route)
    expect(response.status).toBe(200)
    expect((await service.snapshot()).elements[0]?.data).toEqual({ ...NOTE, text: 'edited' })
  })

  it('refuses a text over the bound on patch', async () => {
    const { service, route } = await mount()
    expect((await postNote(service, route, NOTE)).status).toBe(200)
    const response = await handleBoardOps(new Request('http://localhost/api/ketos.board.ops', {
      method: 'POST',
      body: JSON.stringify({ ops: [{ op: 'patch', id: ID, data: { text: 'x'.repeat(20_001) } }] }),
      headers: { 'content-type': 'application/json' },
    }), service, route)
    expect(response.status).toBe(400)
    expect((await service.snapshot()).elements[0]?.data).toEqual(NOTE)
  })
})

describe('note limits in the snapshot', () => {
  it('publishes noteTextMax from the deployment configuration', async () => {
    const { service } = await mount({
      limits: { ...LIMITS, elements: { elementBytesMax: 262_144, noteTextMax: 512, strokePointsMax: 2000, todoItemsMax: 200 } },
    })
    expect((await service.snapshot()).limits).toEqual({
      elementBytesMax: 262_144,
      noteTextMax: 512,
      strokePointsMax: 2000,
      todoItemsMax: 200,
    })
  })
})
