// The wrapper against the real bd on PATH: one full create, read, close, and
// reopen round trip in a temporary Beads database, and recovery from a
// `bd init` interrupted midway. The spec self-skips when bd is not installed,
// so it never fails a machine without Beads.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { BeadsCli, BeadsCommandError } from '../src/beads.ts'
import type { BeadsCliOptions } from '../src/beads.ts'

/**
 * Milliseconds the first `bd init` runs after its database directory appears
 * before the caller aborts it. A full init takes about 2 s on a developer
 * machine; an abort 100–1200 ms after the directory appears leaves a database
 * that `bd init --init-if-missing` refuses with bd 1.2.2.
 */
const INTERRUPT_AFTER_DIRECTORY_MS = 300

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

/**
 * Deployment options of one real wrapper.
 * @param beadsDir - temporary Beads directory.
 * @param logs - sink of the wrapper's journal lines.
 * @returns the wrapper options.
 */
function options(beadsDir: string, logs: string[]): BeadsCliOptions {
  return {
    beadsDir,
    bdCommand: 'bd',
    beadsPrefix: 'kt',
    bdTimeoutMs: 60_000,
    bdOutputMaxBytes: 1_048_576,
    todoTitleMaxChars: 200,
    logger: (message) => { logs.push(message) },
  }
}

/**
 * The local runtime that aborts one controller while the first `bd init` runs:
 * {@link INTERRUPT_AFTER_DIRECTORY_MS} after the init's `BEADS_DIR` appears.
 */
class InitInterruptingRuntime extends LocalSubprocessRuntime {
  private armed = false
  private poll: ReturnType<typeof setInterval> | undefined
  private pending: ReturnType<typeof setTimeout> | undefined

  constructor(ctx: Context, private readonly controller: AbortController) {
    super(ctx)
  }

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const handle = super.spawn(spec)
    const database = spec.env?.['BEADS_DIR']
    if (!this.armed && spec.argv[1] === 'init' && database !== undefined) {
      this.armed = true
      this.poll = setInterval(() => {
        if (!existsSync(database)) return
        clearInterval(this.poll)
        this.pending = setTimeout(() => { this.controller.abort() }, INTERRUPT_AFTER_DIRECTORY_MS)
      }, 5)
    }
    return handle
  }

  /** Clear the poll and the pending abort the test may leave behind. */
  stop(): void {
    clearInterval(this.poll)
    clearTimeout(this.pending)
  }
}

describe.skipIf(!available)('BeadsCli against a real bd', () => {
  let dir = ''
  let cli: BeadsCli
  const logs: string[] = []
  const cleanups: Array<() => Promise<void> | void> = []

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ketos-bd-real-'))
    cli = new BeadsCli(new LocalSubprocessRuntime(new Context()), options(dir, logs))
  }, 120_000)

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
    cleanups.length = 0
  })

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

  it('leaves no .beads after an init interrupted midway, and the next operation initializes a working database', async () => {
    const interruptedDir = await mkdtemp(join(tmpdir(), 'ketos-bd-real-interrupt-'))
    cleanups.push(() => rm(interruptedDir, { recursive: true, force: true }))
    const controller = new AbortController()
    const runtime = new InitInterruptingRuntime(new Context(), controller)
    cleanups.push(() => { runtime.stop() })
    const interrupted = new BeadsCli(runtime, options(interruptedDir, []))
    cleanups.push(() => interrupted.dispose())

    const error = await interrupted.createEpic('Покупки', controller.signal).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(BeadsCommandError)
    expect((error as Error).message).toMatch(/^bd init .* was aborted$/u)
    expect(existsSync(join(interruptedDir, '.beads'))).toBe(false)

    const signal = new AbortController().signal
    const epic = await interrupted.createEpic('Покупки', signal)
    const item = await interrupted.createItem(epic.id, 'Молоко', signal)
    await expect(interrupted.children(epic.id, signal)).resolves.toMatchObject([{ id: item.id, title: 'Молоко' }])
    expect(existsSync(join(interruptedDir, '.beads-init'))).toBe(false)
  }, 120_000)
})
