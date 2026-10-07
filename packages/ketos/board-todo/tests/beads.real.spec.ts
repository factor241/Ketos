// The wrapper against the real bd on PATH: one full create, read, close, and
// reopen round trip in a temporary Beads database. The spec self-skips when bd
// is not installed, so it never fails a machine without Beads.
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { BeadsCli } from '../src/beads.ts'

/** Whether a real bd is reachable without a shell. */
function bdOnPath(): boolean {
  try {
    execFileSync('bd', ['version'], { stdio: 'ignore' })
    return true
  } catch {
    // No bd on PATH: the real-CLI spec is not applicable on this machine.
    return false
  }
}

const available = bdOnPath()

describe.skipIf(!available)('BeadsCli against a real bd', () => {
  let dir = ''
  let cli: BeadsCli
  const logs: string[] = []

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ketos-bd-real-'))
    cli = new BeadsCli(new LocalSubprocessRuntime(new Context()), {
      beadsDir: dir,
      bdCommand: 'bd',
      beadsPrefix: 'kt',
      bdTimeoutMs: 60_000,
      bdOutputMaxBytes: 1_048_576,
      todoTitleMaxChars: 200,
      logger: (message) => { logs.push(message) },
    })
  }, 120_000)

  afterAll(async () => {
    if (dir !== '') await rm(dir, { recursive: true, force: true })
  })

  it('creates a list, adds and closes items, and rereads them in order', async () => {
    const signal = new AbortController().signal
    const epic = await cli.createEpic('Покупки', signal)
    expect(epic.title).toBe('Покупки')
    const first = await cli.createItem(epic.id, 'Молоко', signal)
    const second = await cli.createItem(epic.id, '--parent=evil', signal)
    await cli.setDone(second.id, true, signal)
    const items = await cli.children(epic.id, signal)
    expect(items.map(item => item.id)).toEqual([first.id, second.id])
    expect(items[1]?.status).toBe('closed')
    await expect(cli.show(epic.id, signal)).resolves.toMatchObject({ id: epic.id, title: 'Покупки' })
    expect(logs.some(message => message.startsWith('bd '))).toBe(true)
  }, 120_000)
})
