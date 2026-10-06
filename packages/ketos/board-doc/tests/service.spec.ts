// The ctx.ketosBoardDoc service: one lazy open of the database, document, and
// journal, atomic batches, one change per committed row, and a close that
// every later call refuses.
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { KetosBoardDocService, type BoardChange, type KetosBoardDocOptions } from '../src/service.ts'
import type { BoardCreateOp, ElementId } from '../src/types.ts'

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

const ID_A = brandString<ElementId>('00000000-0000-4000-8000-000000000001')
const ID_B = brandString<ElementId>('00000000-0000-4000-8000-000000000002')

/**
 * One create operation.
 * @param id - element id.
 * @returns the create operation.
 */
function createOp(id: ElementId): BoardCreateOp {
  return {
    op: 'create', id, kind: 'note', x: 0, y: 0, w: 10, h: 10,
    data: { text: '', font: 'sans', size: 'm', scale: 1 },
  }
}

/** Fresh temporary directory that the running test owns. */
async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-board-service-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  return root
}

/**
 * Mount one service over a fresh context.
 * @param path - database path.
 * @param overrides - options to replace.
 * @returns the context, the service, and a change recorder.
 */
function mount(path: string, overrides: Partial<KetosBoardDocOptions> = {}): {
  ctx: Context
  service: KetosBoardDocService
  changes: BoardChange[]
  invalid: string[]
} {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const invalid: string[] = []
  const service = new KetosBoardDocService(ctx, {
    path,
    limits: { maxOpsPerRequest: 64, maxElements: 2000, elements: { elementBytesMax: 262_144, noteTextMax: 20_000 } },
    journalCompactRows: 500,
    logger: (message) => { invalid.push(message) },
    ...overrides,
  })
  cleanups.push(() => service.close())
  const changes: BoardChange[] = []
  return { ctx, service, changes, invalid }
}

describe('board document service', () => {
  it('opens lazily and answers a snapshot with the published limits', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'board.db')
    const { service } = mount(path, {
      limits: { maxOpsPerRequest: 64, maxElements: 2000, elements: { elementBytesMax: 1024, noteTextMax: 20_000 } },
    })
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    const snapshot = await service.snapshot()
    expect(snapshot).toMatchObject({ revision: 0, elements: [], limits: { elementBytesMax: 1024, noteTextMax: 20_000 } })
    expect(snapshot.selfId).toBe(await service.selfId())
    expect(snapshot.docId).toBe(await service.docId())
    expect((await stat(path)).isFile()).toBe(true)
  })

  it('reports one change per committed batch to every subscriber', async () => {
    const root = await temporaryDirectory()
    const { service, changes } = mount(join(root, 'board.db'))
    const first: BoardChange[] = []
    const second: BoardChange[] = []
    const stopFirst = service.subscribe((change) => { first.push(change) })
    service.subscribe((change) => { second.push(change) })

    expect(await service.apply([createOp(ID_A)], 'browser')).toEqual({ revision: 1 })
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    expect(first[0]).toMatchObject({ revision: 1, removes: [] })
    expect(first[0]?.upserts[0]?.id).toBe(ID_A)
    expect(changes).toEqual([])

    stopFirst()
    expect(await service.apply([{ op: 'patch', id: ID_A, x: 1 }], 'browser')).toEqual({ revision: 2 })
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(2)
    expect((await service.snapshot()).elements[0]).toMatchObject({ id: ID_A, x: 1 })
  })

  it('applies a host batch and stays silent for an empty one', async () => {
    const root = await temporaryDirectory()
    const { service } = mount(join(root, 'board.db'))
    const seen: BoardChange[] = []
    service.subscribe((change) => { seen.push(change) })
    expect(await service.apply([], 'host')).toEqual({ revision: 0 })
    expect(seen).toEqual([])
    expect(await service.apply([createOp(ID_A), createOp(ID_B)], 'host')).toEqual({ revision: 1 })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.upserts).toHaveLength(2)
    expect(await service.apply([{ op: 'remove', id: ID_A }], 'host')).toEqual({ revision: 2 })
    expect(seen[1]).toEqual({ revision: 2, upserts: [], removes: [ID_A] })
  })

  it('refuses every call after close and tolerates a repeated close', async () => {
    const root = await temporaryDirectory()
    const { service } = mount(join(root, 'board.db'))
    await service.snapshot()
    await service.close()
    await service.close()
    await expect(service.selfId()).rejects.toThrow(/already closed/u)
    await expect(service.docId()).rejects.toThrow(/already closed/u)
    await expect(service.snapshot()).rejects.toThrow(/already closed/u)
    await expect(service.apply([createOp(ID_A)], 'browser')).rejects.toThrow(/already closed/u)
  })

  it('closes before the first call and after a failed open', async () => {
    const root = await temporaryDirectory()
    const untouched = mount(join(root, 'untouched.db'))
    await untouched.service.close()
    await expect(untouched.service.selfId()).rejects.toThrow(/already closed/u)

    const blocker = join(root, 'blocker')
    await writeFile(blocker, 'not a directory')
    const failing = mount(join(blocker, 'board.db'))
    await expect(failing.service.selfId()).rejects.toThrow()
    await failing.service.close()
    await expect(failing.service.snapshot()).rejects.toThrow(/already closed/u)

    const retried = mount(join(blocker, 'board.db'))
    await expect(retried.service.selfId()).rejects.toThrow()
    await rm(blocker)
    expect(await retried.service.selfId()).toBeTypeOf('string')
  })
})
