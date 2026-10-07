// The bd wrapper: title sanitizing, argv escaping, the fixed child
// environment, the readiness gate, the one-call-at-a-time queue, the lock
// retry, and the strict schema_version 1 parsing of both bd releases.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SubprocessExecutableNotFoundError, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessCollectedOutputs, SubprocessHandle, SubprocessOutcome, SubprocessOutputReader,
  SubprocessSpawnSpec, SubprocessTerminalEnvironment,
} from '@deepseek-ai/dsh-subprocess'
import type { BeadsIssueId } from '@ketos/board-doc/types'
import {
  BeadsCli, BeadsCommandError, BeadsProtocolError, BeadsUnavailableError, sanitizeBeadsTitle,
} from '../src/beads.ts'
import type { BeadsCliOptions } from '../src/beads.ts'

/** One scripted child the fake subprocess serves, in spawn order. */
interface ScriptedRun {
  readonly stdout?: string
  readonly stderr?: string
  readonly exitCode?: number | null
  /** Keeps the child alive until the test releases it. */
  readonly gate?: Promise<void>
  /** Marks stdout as exceeding the collection cap. */
  readonly lossy?: boolean
  /** Drops both collected readers, as a truncated collection does. */
  readonly dropReaders?: boolean
  /** Makes spawn itself fail, as a refused spawn does. */
  readonly spawnError?: Error
}

/** Reader over one fixed scripted stream. */
class FakeReader implements SubprocessOutputReader {
  constructor(private readonly text: string, private readonly lossy: boolean) {}

  readFrom(_fromByte: number): { text: string; nextOffset: number; lossy: boolean } {
    return { text: this.text, nextOffset: this.text.length, lossy: this.lossy }
  }
}

/** One scripted handle: settles when its gate resolves or its signal aborts. */
class FakeHandle implements SubprocessHandle {
  readonly control = undefined
  readonly stdin = undefined
  readonly stdout = undefined
  readonly stderr = undefined
  readonly collected: SubprocessCollectedOutputs
  readonly done: Promise<SubprocessOutcome>
  terminated = false

  constructor(spec: SubprocessSpawnSpec, run: ScriptedRun) {
    this.collected = run.dropReaders === true ? {} : {
      stdout: new FakeReader(run.stdout ?? '', run.lossy === true),
      stderr: new FakeReader(run.stderr ?? '', false),
    }
    let settle: (outcome: SubprocessOutcome) => void = () => {}
    this.done = new Promise((resolve) => { settle = resolve })
    const outcome: SubprocessOutcome = { exitCode: run.exitCode === undefined ? 0 : run.exitCode, signal: null }
    if (run.gate === undefined) settle(outcome)
    else void run.gate.then(() => { settle(outcome) })
    const abort = (): void => {
      this.terminated = true
      settle({ exitCode: null, signal: 'SIGTERM' })
    }
    if (spec.signal?.aborted === true) abort()
    else spec.signal?.addEventListener('abort', abort)
  }

  terminate(): void {
    this.terminated = true
  }

  waitForExit(): Promise<boolean> {
    return Promise.resolve(true)
  }
}

/** The subprocess seam double serving one scripted run per spawn. */
class ScriptedSubprocess extends SubprocessRuntime {
  readonly spawns: SubprocessSpawnSpec[] = []
  readonly scripts: ScriptedRun[] = []
  resolveError: Error | undefined
  resolutions = 0

  override resolveExecutable(command: string): Promise<string> {
    this.resolutions += 1
    if (this.resolveError !== undefined) return Promise.reject(this.resolveError)
    return Promise.resolve(`/usr/local/bin/${command}`)
  }

  override terminalEnvironment(): Promise<SubprocessTerminalEnvironment> {
    return Promise.resolve({ platform: 'posix' })
  }

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.spawns.push(spec)
    const run = this.scripts.shift() ?? { exitCode: 0, stdout: '' }
    if (run.spawnError !== undefined) throw run.spawnError
    return new FakeHandle(spec, run)
  }

  override spawnTerminal(): Promise<never> {
    throw new Error('the bd wrapper spawns no terminals')
  }
}

const EPIC = brandString<BeadsIssueId>('kt-219')
const ITEM = brandString<BeadsIssueId>('kt-219.1')
const EXECUTABLE = '/usr/local/bin/bd'

/** One version-1 envelope over an arbitrary payload. */
function envelope(data: unknown): string {
  return JSON.stringify({ data, schema_version: 1 })
}

/** One side of a deferred the test controls. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

/** Let the queued microtasks run. */
async function tick(): Promise<void> {
  await new Promise((resolve) => { setTimeout(resolve, 0) })
}

/**
 * Read one recorded bd answer.
 * @param version - fixture directory.
 * @param name - fixture file name.
 * @returns the fixture text.
 */
async function fixture(version: '1.2.2' | '1.3.1', name: string): Promise<string> {
  return readFile(new URL(`./fixtures/bd/${version}/${name}`, import.meta.url), 'utf8')
}

/** One successful version answer. */
function versionRun(version: string): ScriptedRun {
  return { stdout: envelope({ version, branch: 'v', build: 'b' }), exitCode: 0 }
}

/** The successful `bd init` answer. */
const INIT: ScriptedRun = { exitCode: 0 }

/** One issue answer with the fields the wrapper reads. */
function issueRun(id: string, title: string, status = 'open', createdAt = '2026-10-05T23:32:37Z'): ScriptedRun {
  return { stdout: envelope({ id, title, status, created_at: createdAt }), exitCode: 0 }
}

/** One `bd update` answer: the envelope carries exactly one-element arrays. */
function updateRun(id: string, status = 'open'): ScriptedRun {
  return { stdout: envelope([{ id, title: 'item', status, created_at: '2026-10-05T23:32:37Z' }]), exitCode: 0 }
}

describe('BeadsCli', () => {
  let dir = ''
  let logs: string[] = []
  const cleanups: Array<() => Promise<void> | void> = []

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ketos-bd-'))
    logs = []
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
  })

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
    cleanups.length = 0
  })

  /**
   * Build one wrapper over a scripted subprocess.
   * @param scripts - child answers in spawn order.
   * @param overrides - options to replace.
   * @returns the wrapper and the double.
   */
  function build(scripts: ScriptedRun[], overrides: Partial<BeadsCliOptions> = {}): { cli: BeadsCli; subprocess: ScriptedSubprocess } {
    const subprocess = new ScriptedSubprocess(new Context())
    subprocess.scripts.push(...scripts)
    const cli = new BeadsCli(subprocess, {
      beadsDir: dir,
      bdCommand: 'bd',
      beadsPrefix: 'kt',
      bdTimeoutMs: 15_000,
      bdOutputMaxBytes: 1_048_576,
      todoTitleMaxChars: 200,
      logger: (message) => { logs.push(message) },
      ...overrides,
    })
    return { cli, subprocess }
  }

  describe('title sanitizing', () => {
    it('replaces control characters and line breaks, trims, and clamps the length', () => {
      expect(sanitizeBeadsTitle('  Молоко\nХлеб\u0000  ', 200)).toBe('Молоко Хлеб')
      expect(sanitizeBeadsTitle('abcdef', 3)).toBe('abc')
    })
  })

  describe('argv and child environment', () => {
    it('creates epics and items with --title= and never a shell string', async () => {
      const { cli, subprocess } = build([versionRun('1.3.1'), INIT, issueRun('kt-219', 'Список'), issueRun('kt-219.1', '-h')])
      await cli.createEpic('Список', new AbortController().signal)
      await cli.createItem(EPIC, '-h', new AbortController().signal)
      expect(subprocess.spawns[2]?.argv).toEqual([
        EXECUTABLE, 'create', '--title=Список', '-t', 'epic', '--actor', 'ketos', '--json',
      ])
      expect(subprocess.spawns[3]?.argv).toEqual([
        EXECUTABLE, 'create', '--title=-h', '-t', 'task', '--parent', 'kt-219', '--actor', 'ketos', '--json',
      ])
    })

    it('keeps a hostile-looking title inside one argument', async () => {
      const { cli, subprocess } = build([versionRun('1.3.1'), INIT, issueRun('kt-219.1', '--parent=evil')])
      await cli.createItem(EPIC, '--parent=evil', new AbortController().signal)
      expect(subprocess.spawns[2]?.argv).toContain('--title=--parent=evil')
      expect(subprocess.spawns[2]?.argv).not.toContain('--parent=evil')
    })

    it('runs every call from the beads directory with telemetry off and capped stdio', async () => {
      const { cli, subprocess } = build([versionRun('1.3.1'), INIT, updateRun(ITEM, 'closed')])
      await cli.setDone(ITEM, true, new AbortController().signal)
      expect(subprocess.spawns).toHaveLength(3)
      for (const spec of subprocess.spawns) {
        expect(spec.cwd).toBe(dir)
        expect(spec.env).toMatchObject({
          BEADS_DIR: join(dir, '.beads'),
          BD_JSON_ENVELOPE: '1',
          BD_DISABLE_METRICS: '1',
          DO_NOT_TRACK: '1',
          BD_NON_INTERACTIVE: '1',
          NO_COLOR: '1',
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'beads.role',
          GIT_CONFIG_VALUE_0: 'maintainer',
          GIT_TERMINAL_PROMPT: '0',
        })
        expect(spec.stdio).toEqual({
          stdin: 'ignore',
          stdout: { maxBytes: 1_048_576 },
          stderr: { maxBytes: 16_384 },
        })
        expect(spec.graceMs).toBe(2_000)
      }
      expect(logs).toEqual([`bd 1.3.1 is ready at ${EXECUTABLE}`])
    })

    it('resolves the executable once and reuses it', async () => {
      const { cli, subprocess } = build([versionRun('1.3.1'), INIT, updateRun(ITEM, 'closed'), updateRun(ITEM, 'open')])
      await cli.setDone(ITEM, true, new AbortController().signal)
      await cli.setDone(ITEM, false, new AbortController().signal)
      expect(subprocess.resolutions).toBe(1)
    })
  })

  describe('readiness', () => {
    it('checks the version, initializes once, and keeps the init flags fixed', async () => {
      const { cli, subprocess } = build([versionRun('1.3.1'), INIT, updateRun(ITEM, 'closed'), updateRun(ITEM, 'closed')])
      await cli.setDone(ITEM, true, new AbortController().signal)
      await cli.setDone(ITEM, true, new AbortController().signal)
      expect(subprocess.spawns[1]?.argv).toEqual([
        EXECUTABLE, 'init', '--prefix', 'kt', '--quiet', '--skip-hooks', '--skip-agents', '--non-interactive', '--init-if-missing',
      ])
      expect(subprocess.spawns.filter(spec => spec.argv[1] === 'init')).toHaveLength(1)
      expect(subprocess.spawns.filter(spec => spec.argv[1] === 'version')).toHaveLength(1)
    })

    it('accepts 1.2.2 and both ends of the supported line', async () => {
      for (const version of ['1.2.2', '1.2.10', '1.3.1', '1.99.0']) {
        const { cli, subprocess } = build([versionRun(version), INIT, issueRun('kt-219', 'Список')])
        await expect(cli.createEpic('Список', new AbortController().signal)).resolves.toMatchObject({ id: 'kt-219' })
        expect(subprocess.spawns).toHaveLength(3)
      }
    })

    it('refuses versions below the minimum and other major lines', async () => {
      for (const version of ['1.2.1', '1.1.0', '2.0.0']) {
        const { cli, subprocess } = build([versionRun(version), INIT])
        await expect(cli.createEpic('Список', new AbortController().signal)).rejects.toBeInstanceOf(BeadsUnavailableError)
        expect(subprocess.spawns).toHaveLength(1)
      }
    })

    it('refuses a version answer without a three-part version', async () => {
      const bad = build([{ stdout: envelope({ version: 3 }), exitCode: 0 }])
      await expect(bad.cli.createEpic('x', new AbortController().signal)).rejects.toBeInstanceOf(BeadsProtocolError)
      const odd = build([versionRun('1.3'), INIT])
      await expect(odd.cli.createEpic('x', new AbortController().signal)).rejects.toThrow(/three-part/u)
      const noData = build([{ stdout: JSON.stringify({ schema_version: 1 }), exitCode: 0 }])
      await expect(noData.cli.createEpic('x', new AbortController().signal)).rejects.toBeInstanceOf(BeadsProtocolError)
    })

    it('reports a version answer outside the envelope', async () => {
      const { cli } = build([{ stdout: 'not json', exitCode: 0 }])
      await expect(cli.createEpic('x', new AbortController().signal)).rejects.toBeInstanceOf(BeadsProtocolError)
    })

    it('reports a missing executable and a refused resolution', async () => {
      const missing = build([])
      missing.subprocess.resolveError = new SubprocessExecutableNotFoundError('bd was not found on PATH')
      await expect(missing.cli.createEpic('x', new AbortController().signal)).rejects.toBeInstanceOf(BeadsUnavailableError)
      expect(missing.subprocess.spawns).toHaveLength(0)

      const refused = build([])
      refused.subprocess.resolveError = new Error('relative path')
      await expect(refused.cli.createEpic('x', new AbortController().signal)).rejects.toBeInstanceOf(BeadsUnavailableError)
    })

    it('retries resolution after a transient failure', async () => {
      const { cli, subprocess } = build([versionRun('1.3.1'), INIT, issueRun('kt-219', 'Список')])
      subprocess.resolveError = new Error('temporarily unavailable')
      await expect(cli.createEpic('x', new AbortController().signal)).rejects.toBeInstanceOf(BeadsUnavailableError)
      subprocess.resolveError = undefined
      await expect(cli.createEpic('Список', new AbortController().signal)).resolves.toMatchObject({ id: 'kt-219' })
      expect(subprocess.resolutions).toBe(2)
    })

    it('fails a refused spawn as unavailable', async () => {
      const { cli } = build([{ spawnError: new Error('spawn bd EACCES') }])
      await expect(cli.createEpic('x', new AbortController().signal)).rejects.toBeInstanceOf(BeadsUnavailableError)
    })

    it('fails a refused init as a command error', async () => {
      const { cli, subprocess } = build([versionRun('1.3.1'), { stdout: '', stderr: 'init failed', exitCode: 1 }])
      await expect(cli.createEpic('x', new AbortController().signal)).rejects.toThrow(/bd init/u)
      expect(subprocess.spawns).toHaveLength(2)
    })
  })

  describe('queue', () => {
    it('never runs two bd calls at the same time', async () => {
      const gate = deferred()
      const { cli, subprocess } = build([
        { ...versionRun('1.3.1'), gate: gate.promise },
        INIT,
        updateRun(ITEM, 'closed'),
        updateRun(ITEM, 'closed'),
      ])
      const first = cli.setDone(ITEM, true, new AbortController().signal)
      const second = cli.setDone(ITEM, true, new AbortController().signal)
      await tick()
      expect(subprocess.spawns).toHaveLength(1)
      gate.resolve()
      await Promise.all([first, second])
      expect(subprocess.spawns).toHaveLength(4)
    })

    it('keeps the queue running after a failed call', async () => {
      const { cli } = build([
        versionRun('1.3.1'), INIT,
        { stdout: '', stderr: 'boom', exitCode: 1 },
        issueRun('kt-219', 'Список'),
      ])
      await expect(cli.createEpic('x', new AbortController().signal)).rejects.toBeInstanceOf(BeadsCommandError)
      await expect(cli.createEpic('Список', new AbortController().signal)).resolves.toMatchObject({ id: 'kt-219' })
    })
  })

  describe('retries and failures', () => {
    it('retries a call the Dolt lock refused and logs each retry', async () => {
      const { cli, subprocess } = build([
        versionRun('1.3.1'), INIT,
        { stdout: '', stderr: 'another process holds the exclusive lock', exitCode: 1 },
        { stdout: '', stderr: 'database is locked: exclusive lock held', exitCode: 1 },
        issueRun('kt-219', 'Список'),
      ])
      await expect(cli.createEpic('Список', new AbortController().signal)).resolves.toMatchObject({ id: 'kt-219' })
      expect(subprocess.spawns).toHaveLength(5)
      expect(logs.filter(message => message.includes('exclusive lock'))).toHaveLength(2)
    })

    it('gives up after three lock retries', async () => {
      const locked: ScriptedRun = { stdout: '', stderr: 'exclusive lock', exitCode: 1 }
      const { cli, subprocess } = build([versionRun('1.3.1'), INIT, locked, locked, locked, locked])
      await expect(cli.createEpic('Список', new AbortController().signal)).rejects.toBeInstanceOf(BeadsCommandError)
      expect(subprocess.spawns).toHaveLength(6)
    })

    it('reports a non-zero exit with the retained stderr tail', async () => {
      const { cli } = build([versionRun('1.3.1'), INIT, { stdout: '', stderr: 'Error: title required', exitCode: 1 }])
      const error = await cli.createEpic('  ', new AbortController().signal).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(BeadsCommandError)
      expect(error).toMatchObject({ exitCode: 1, stderrTail: 'Error: title required' })
    })

    it('reports a non-JSON success answer as a protocol failure', async () => {
      const { cli } = build([versionRun('1.3.1'), INIT, { stdout: '', stderr: 'kt-219.2 is already open', exitCode: 0 }])
      await expect(cli.setDone(brandString<BeadsIssueId>('kt-219.2'), false, new AbortController().signal))
        .rejects.toBeInstanceOf(BeadsProtocolError)
    })

    it('reports an envelope outside schema_version 1', async () => {
      const { cli } = build([{ stdout: JSON.stringify({ data: { version: '1.3.1' }, schema_version: 2 }), exitCode: 0 }])
      await expect(cli.createEpic('x', new AbortController().signal)).rejects.toBeInstanceOf(BeadsProtocolError)
      const noEnvelope = build([{ stdout: JSON.stringify(['1.3.1']), exitCode: 0 }])
      await expect(noEnvelope.cli.createEpic('x', new AbortController().signal)).rejects.toBeInstanceOf(BeadsProtocolError)
    })

    it('reports truncated stdout', async () => {
      const { cli } = build([versionRun('1.3.1'), INIT, { stdout: envelope([]), lossy: true, exitCode: 0 }])
      await expect(cli.createEpic('x', new AbortController().signal)).rejects.toThrow(/retained limit/u)
    })

    it('times out a hanging call and terminates it', async () => {
      const never = deferred()
      const { cli, subprocess } = build([{ ...versionRun('1.3.1'), gate: never.promise }], { bdTimeoutMs: 20 })
      const error = await cli.createEpic('x', new AbortController().signal).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(BeadsCommandError)
      expect((error as Error).message).toMatch(/timed out after 20ms/u)
      await tick()
      expect(subprocess.spawns).toHaveLength(1)
    })

    it('reports a caller abort without treating it as a timeout', async () => {
      const never = deferred()
      const { cli } = build([{ ...versionRun('1.3.1'), gate: never.promise }])
      const controller = new AbortController()
      const pending = cli.createEpic('x', controller.signal).catch((caught: unknown) => caught)
      controller.abort()
      const error = await pending
      expect(error).toBeInstanceOf(BeadsCommandError)
      expect((error as Error).message).toMatch(/was aborted/u)
    })

    it('tolerates a dropped collected stream', async () => {
      const { cli } = build([versionRun('1.3.1'), INIT, { dropReaders: true, exitCode: 0 }])
      await expect(cli.createEpic('x', new AbortController().signal)).rejects.toBeInstanceOf(BeadsProtocolError)
    })
  })

  describe('answers of both releases', () => {
    it('parses the create and close answers of 1.2.2', async () => {
      const create = await fixture('1.2.2', 'create-epic.envelope.json')
      const close = await fixture('1.2.2', 'close.envelope.json')
      const { cli } = build([versionRun('1.2.2'), INIT, { stdout: create, exitCode: 0 }, { stdout: close, exitCode: 0 }])
      const epic = await cli.createEpic('Покупки 2', new AbortController().signal)
      expect(epic).toMatchObject({ id: 'kt-7gq', title: 'Покупки 2', status: 'open' })
      await expect(cli.setDone(brandString<BeadsIssueId>('kt-1ry.1'), true, new AbortController().signal))
        .resolves.toMatchObject({ id: 'kt-1ry.1', status: 'closed' })
    })

    it('parses the update and show answers of 1.3.1', async () => {
      const update = await fixture('1.3.1', 'update-status-closed.envelope.json')
      const show = await fixture('1.3.1', 'show-epic.envelope.json')
      const { cli } = build([versionRun('1.3.1'), INIT, { stdout: update, exitCode: 0 }, { stdout: show, exitCode: 0 }])
      await expect(cli.setDone(brandString<BeadsIssueId>('kt-219.2'), true, new AbortController().signal))
        .resolves.toMatchObject({ id: 'kt-219.2', status: 'closed' })
      await expect(cli.show(EPIC, new AbortController().signal)).resolves.toMatchObject({ id: 'kt-219', title: 'Покупки' })
    })

    it('sorts the 1.2.2 children by created_at then id', async () => {
      const children = await fixture('1.2.2', 'children.envelope.json')
      const { cli } = build([versionRun('1.2.2'), INIT, { stdout: children, exitCode: 0 }])
      const items = await cli.children(brandString<BeadsIssueId>('kt-1ry'), new AbortController().signal)
      expect(items.map(issue => issue.id)).toEqual(['kt-1ry.1', 'kt-1ry.2', 'kt-1ry.3', 'kt-1ry.4'])
    })

    it('keeps the recorded order of 1.3.1 children', async () => {
      const children = await fixture('1.3.1', 'list-parent-all.envelope.json')
      const { cli } = build([versionRun('1.3.1'), INIT, { stdout: children, exitCode: 0 }])
      const items = await cli.children(EPIC, new AbortController().signal)
      expect(items.map(issue => issue.title)).toEqual(['Молоко', '-h', '--parent=evil', 'Хлеб'])
    })

    it('answers undefined when show reports a missing epic', async () => {
      const missing = await fixture('1.3.1', 'error-show-missing.stdout')
      const { cli } = build([versionRun('1.3.1'), INIT, { stdout: missing, exitCode: 1 }])
      await expect(cli.show(EPIC, new AbortController().signal)).resolves.toBeUndefined()
    })

    it('answers undefined for the older missing shape and an empty array', async () => {
      const missing = await fixture('1.2.2', 'error-show-missing.stdout')
      const older = build([versionRun('1.2.2'), INIT, { stdout: missing, exitCode: 1 }])
      await expect(older.cli.show(EPIC, new AbortController().signal)).resolves.toBeUndefined()
      const empty = build([versionRun('1.3.1'), INIT, { stdout: envelope([]), exitCode: 0 }])
      await expect(empty.cli.show(EPIC, new AbortController().signal)).resolves.toBeUndefined()
      const errorObject = build([versionRun('1.3.1'), INIT, { stdout: envelope({ error: 'gone' }), exitCode: 0 }])
      await expect(errorObject.cli.show(EPIC, new AbortController().signal)).resolves.toBeUndefined()
    })

    it('treats a non-missing show failure as a command error', async () => {
      const { cli } = build([versionRun('1.3.1'), INIT, { stdout: 'not json', stderr: 'boom', exitCode: 1 }])
      await expect(cli.show(EPIC, new AbortController().signal)).rejects.toBeInstanceOf(BeadsCommandError)
      const killed = build([versionRun('1.3.1'), INIT, { exitCode: null, stderr: 'killed' }])
      await expect(killed.cli.show(EPIC, new AbortController().signal)).rejects.toThrow(/no exit code/u)
    })

    it('refuses a show answer that is neither an array nor an issue', async () => {
      const { cli } = build([versionRun('1.3.1'), INIT, { stdout: envelope({ id: 7 }), exitCode: 0 }])
      await expect(cli.show(EPIC, new AbortController().signal)).rejects.toBeInstanceOf(BeadsProtocolError)
    })
  })

  describe('answer shape rules', () => {
    it('refuses update answers that are not exactly one issue', async () => {
      const notArray = build([versionRun('1.3.1'), INIT, { stdout: envelope({ id: 'kt-219.1' }), exitCode: 0 }])
      await expect(notArray.cli.setDone(ITEM, true, new AbortController().signal)).rejects.toBeInstanceOf(BeadsProtocolError)
      const two = build([versionRun('1.3.1'), INIT, { stdout: envelope([{ id: 'kt-219.1' }, { id: 'kt-219.2' }]), exitCode: 0 }])
      await expect(two.cli.setDone(ITEM, true, new AbortController().signal)).rejects.toBeInstanceOf(BeadsProtocolError)
    })

    it('refuses a list answer that is not an array or holds a foreign item', async () => {
      const notArray = build([versionRun('1.3.1'), INIT, { stdout: envelope({ id: 'kt-219' }), exitCode: 0 }])
      await expect(notArray.cli.children(EPIC, new AbortController().signal)).rejects.toBeInstanceOf(BeadsProtocolError)
      const foreign = build([versionRun('1.3.1'), INIT, { stdout: envelope([{ id: 'kt-219.1', title: 'x', status: 'open', created_at: '2026-10-05T23:32:37Z', parent: 'kt-else' }]), exitCode: 0 }])
      await expect(foreign.cli.children(EPIC, new AbortController().signal)).rejects.toThrow(/belong/u)
      const nonRecord = build([versionRun('1.3.1'), INIT, { stdout: envelope(['nope']), exitCode: 0 }])
      await expect(nonRecord.cli.children(EPIC, new AbortController().signal)).rejects.toBeInstanceOf(BeadsProtocolError)
    })

    it('refuses issues outside the four stored fields', async () => {
      const cases: unknown[] = [
        7,
        { id: 'KT-1', title: 'x', status: 'open', created_at: '2026-10-05T23:32:37Z' },
        { id: 'kt-1', title: '', status: 'open', created_at: '2026-10-05T23:32:37Z' },
        { id: 'kt-1', title: 7, status: 'open', created_at: '2026-10-05T23:32:37Z' },
        { id: 'kt-1', title: 'x', status: 'doing', created_at: '2026-10-05T23:32:37Z' },
        { id: 'kt-1', title: 'x', status: 7, created_at: '2026-10-05T23:32:37Z' },
        { id: 'kt-1', title: 'x', status: 'open', created_at: 'yesterday' },
        { id: 'kt-1', title: 'x', status: 'open', created_at: 7 },
      ]
      for (const data of cases) {
        const { cli } = build([versionRun('1.3.1'), INIT, { stdout: envelope(data), exitCode: 0 }])
        await expect(cli.createEpic('x', new AbortController().signal)).rejects.toBeInstanceOf(BeadsProtocolError)
      }
    })
  })
})
