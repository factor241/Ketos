/**
 * The `bd` CLI wrapper: every Beads call Ketos makes goes through this class.
 * It resolves the executable once, creates the Ketos Beads directory
 * owner-only, runs one call at a time through a queue, retries the Dolt
 * exclusive lock, disables telemetry and interaction in every child
 * environment, checks the CLI version before the first operation, and parses
 * only the documented `schema_version: 1` JSON envelope.
 *
 * A non-zero exit, a timeout, or a malformed answer becomes one of the typed
 * errors, so callers never inspect raw streams.
 * @module @ketos/board-todo/beads
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { isBeadsIssueId, TODO_STATUSES } from '@ketos/board-doc/data'
import type { BeadsIssueId, TodoStatus } from '@ketos/board-doc/types'
import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'

/** Milliseconds a `bd` child gets to exit after termination starts; a fixed lifecycle constant. */
const TERMINATE_GRACE_MS = 2_000

/** Bytes of stderr retained for diagnostics and the lock-retry decision. */
const STDERR_TAIL_BYTES = 16 * 1024

/** Pause before retrying a call the Dolt lock refused, in milliseconds. */
const LOCK_RETRY_DELAY_MS = 250

/** How many times a call the Dolt lock refused is retried. */
const LOCK_RETRIES = 3

/** Smallest `bd` release this wrapper's protocol is written against. */
const MINIMUM_VERSION: readonly [number, number, number] = [1, 2, 2]

/** The `bd` executable is missing, unsupported, or cannot be started. */
export class BeadsUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BeadsUnavailableError'
  }
}

/** `bd` exited non-zero, was killed, or exceeded the call timeout. */
export class BeadsCommandError extends Error {
  constructor(
    /** Exit code, or null when the child was terminated before exiting. */
    readonly exitCode: number | null,
    /** Retained stderr tail; never sent to a browser. */
    readonly stderrTail: string,
    message: string,
  ) {
    super(message)
    this.name = 'BeadsCommandError'
  }
}

/** `bd` answered outside the documented JSON envelope. */
export class BeadsProtocolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BeadsProtocolError'
  }
}

/** One Beads issue as the wrapper reads it out of a `bd` JSON answer. */
export interface BeadsIssue {
  /** Issue id as `bd` reports it. */
  readonly id: BeadsIssueId
  /** Issue title as `bd` reports it. */
  readonly title: string
  /** Issue status from the Beads vocabulary. */
  readonly status: TodoStatus
  /** `created_at` as `bd` wrote it; used only for ordering. */
  readonly createdAt: string
}

/** Deployment facts one wrapper instance reads from its plugin's Config. */
export interface BeadsCliOptions {
  /** Directory holding the `.beads` database directory; working directory of every call. */
  readonly beadsDir: string
  /** Executable name or absolute path resolved on first use. */
  readonly bdCommand: string
  /** Issue prefix passed to `bd init`. */
  readonly beadsPrefix: string
  /** Per-call timeout in milliseconds. */
  readonly bdTimeoutMs: number
  /** Largest stdout retained per call, in bytes. */
  readonly bdOutputMaxBytes: number
  /** Largest title sent to `bd`, in UTF-16 code units. */
  readonly todoTitleMaxChars: number
  /** Host journal sink for the version and lock-retry facts. */
  readonly logger: (message: string) => void
}

/** One settled `bd` call: the raw streams and the exit code. */
interface BeadsResult {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  /** True when stdout exceeded the output cap. */
  readonly stdoutLossy: boolean
}

/**
 * Reduce one title to what `bd` receives: control characters and line breaks
 * become single spaces, the result is trimmed, and it is cut to the
 * deployment's limit.
 * @param raw - caller-supplied title.
 * @param maxChars - largest number of UTF-16 code units that survives.
 * @returns the sanitized title.
 */
export function sanitizeBeadsTitle(raw: string, maxChars: number): string {
  return raw.replace(/[\p{Cc}\p{Cf}]+/gu, ' ').trim().slice(0, maxChars)
}

/**
 * Whether a decoded value is a plain object.
 * @param value - decoded value.
 * @returns true when the value is a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse one JSON document, answering undefined instead of throwing.
 * @param text - text to parse.
 * @returns the decoded value, or undefined when the text is not JSON.
 */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // The text is not JSON; the caller decides what that means.
    return undefined
  }
}

/**
 * Build the command error of one failed call.
 * @param what - operation label for the message.
 * @param result - settled call.
 * @returns the typed command error.
 */
function commandFailure(what: string, result: BeadsResult): BeadsCommandError {
  const code = result.exitCode === null ? 'no exit code' : `exit code ${String(result.exitCode)}`
  return new BeadsCommandError(result.exitCode, result.stderr, `${what}: bd answered ${code}`)
}

/**
 * Require a successful call and return the `data` of its version-1 envelope.
 * @param what - operation label for messages.
 * @param result - settled call.
 * @returns the envelope's `data` value.
 */
function parseAnswer(what: string, result: BeadsResult): unknown {
  if (result.exitCode !== 0) throw commandFailure(what, result)
  if (result.stdoutLossy) throw new BeadsProtocolError(`${what}: bd output exceeded the retained limit`)
  const value = parseJson(result.stdout)
  if (!isRecord(value) || value['schema_version'] !== 1 || !('data' in value)) {
    throw new BeadsProtocolError(`${what}: bd answered outside the schema_version 1 envelope`)
  }
  return value['data']
}

/**
 * Parse one issue as `bd` reports it, requiring the four fields the board
 * stores and a known status.
 * @param what - operation label for messages.
 * @param value - decoded issue value.
 * @returns the typed issue.
 */
function parseIssue(what: string, value: unknown): BeadsIssue {
  if (!isRecord(value)) throw new BeadsProtocolError(`${what}: an issue is not a JSON object`)
  const { id, title, status, created_at: createdAt } = value
  if (!isBeadsIssueId(id)) throw new BeadsProtocolError(`${what}: issue id is outside the Beads shape`)
  if (typeof title !== 'string' || title.length === 0) throw new BeadsProtocolError(`${what}: issue title is empty`)
  if (typeof status !== 'string' || !(TODO_STATUSES as readonly string[]).includes(status)) {
    throw new BeadsProtocolError(`${what}: issue status ${JSON.stringify(status)} is outside the Beads vocabulary`)
  }
  if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) {
    throw new BeadsProtocolError(`${what}: issue created_at is not a timestamp`)
  }
  return { id, title, status: status as TodoStatus, createdAt }
}

/**
 * Whether a failed `show` answered the documented "no issues found" JSON.
 * @param result - settled call.
 * @returns true when bd reported the epic as missing.
 */
function reportsMissing(result: BeadsResult): boolean {
  const value = parseJson(result.stdout)
  return isRecord(value) && isRecord(value['data']) && typeof value['data']['error'] === 'string'
}

/**
 * Whether one parsed version string is on the supported 1.x line at or above
 * {@link MINIMUM_VERSION}.
 * @param parts - parsed `[major, minor, patch]`.
 * @returns true when the version is supported.
 */
function versionSupported(parts: readonly [number, number, number]): boolean {
  const [major, minor, patch] = parts
  if (major !== MINIMUM_VERSION[0]) return false
  if (minor !== MINIMUM_VERSION[1]) return minor > MINIMUM_VERSION[1]
  return patch >= MINIMUM_VERSION[2]
}

/**
 * The `bd` CLI as one queued, owner-scoped, strict-parsing wrapper.
 */
export class BeadsCli {
  private readonly env: Readonly<Record<string, string>>
  private executable: Promise<string> | undefined
  private ready: Promise<void> | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private readonly lifetime = new AbortController()

  /**
   * @param subprocess - runtime that spawns `bd`.
   * @param options - deployment's Beads directory and call bounds.
   * @param ambientEnv - the host environment whose `BEADS_*` and `BD_*` entries are blanked for the child; defaults to `process.env`.
   */
  constructor(
    private readonly subprocess: SubprocessRuntime,
    private readonly options: BeadsCliOptions,
    ambientEnv: Readonly<NodeJS.ProcessEnv> = process.env,
  ) {
    // An empty value reads as unset in `bd`, so an ambient BEADS_DB or
    // BEADS_DOLT_SERVER_* cannot redirect the wrapper to another database.
    const blanked = Object.fromEntries(
      Object.keys(ambientEnv).filter(key => /^(?:BEADS|BD)_/iu.test(key)).map(key => [key, '']),
    )
    this.env = {
      ...blanked,
      BEADS_DIR: join(options.beadsDir, '.beads'),
      BD_JSON_ENVELOPE: '1',
      BD_DISABLE_METRICS: '1',
      DO_NOT_TRACK: '1',
      BD_NON_INTERACTIVE: '1',
      NO_COLOR: '1',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'beads.role',
      GIT_CONFIG_VALUE_0: 'maintainer',
      GIT_TERMINAL_PROMPT: '0',
    }
  }

  /**
   * Stop the wrapper: abort the running `bd` call, reject queued and later
   * calls, and wait until the queue has settled.
   * @returns when no `bd` call is running.
   */
  async dispose(): Promise<void> {
    this.lifetime.abort()
    await this.queue
  }

  /**
   * Create the epic of one list.
   * @param title - list title.
   * @param signal - caller's cancellation signal.
   * @returns the created epic.
   */
  createEpic(title: string, signal: AbortSignal): Promise<BeadsIssue> {
    return this.operate(signal, async () => {
      const result = await this.runOnce([
        'create',
        `--title=${sanitizeBeadsTitle(title, this.options.todoTitleMaxChars)}`,
        '-t', 'epic',
        '--actor', 'ketos',
        '--json',
      ], signal)
      return parseIssue('bd create', parseAnswer('bd create', result))
    })
  }

  /**
   * Create one item under an epic.
   * @param epicId - parent epic id.
   * @param title - item title.
   * @param signal - caller's cancellation signal.
   * @returns the created item.
   */
  createItem(epicId: BeadsIssueId, title: string, signal: AbortSignal): Promise<BeadsIssue> {
    return this.operate(signal, async () => {
      const result = await this.runOnce([
        'create',
        `--title=${sanitizeBeadsTitle(title, this.options.todoTitleMaxChars)}`,
        '-t', 'task',
        '--parent', epicId,
        '--actor', 'ketos',
        '--json',
      ], signal)
      return parseIssue('bd create', parseAnswer('bd create', result))
    })
  }

  /**
   * Set one item's done state; the call is idempotent, so setting the same
   * state twice is one successful call each time.
   * @param id - item issue id.
   * @param done - true closes the item, false opens it.
   * @param signal - caller's cancellation signal.
   * @returns the updated issue.
   */
  setDone(id: BeadsIssueId, done: boolean, signal: AbortSignal): Promise<BeadsIssue> {
    return this.operate(signal, async () => {
      const result = await this.runOnce(['update', id, '--status', done ? 'closed' : 'open', '--actor', 'ketos', '--json'], signal)
      const data = parseAnswer('bd update', result)
      if (!Array.isArray(data) || data.length !== 1) throw new BeadsProtocolError('bd update: expected exactly one issue')
      return parseIssue('bd update', data[0])
    })
  }

  /**
   * Read an epic's child items, ordered by creation time then id.
   * @param epicId - parent epic id.
   * @param signal - caller's cancellation signal.
   * @returns the typed items.
   */
  children(epicId: BeadsIssueId, signal: AbortSignal): Promise<BeadsIssue[]> {
    return this.operate(signal, async () => {
      const result = await this.runOnce(['list', '--parent', epicId, '--all', '--limit', '0', '--json'], signal)
      const data = parseAnswer('bd list', result)
      if (!Array.isArray(data)) throw new BeadsProtocolError('bd list: expected an issue array')
      const items: BeadsIssue[] = []
      for (const entry of data) {
        if (!isRecord(entry) || entry['parent'] !== epicId) {
          throw new BeadsProtocolError(`bd list: an item does not belong to epic ${epicId}`)
        }
        items.push(parseIssue('bd list', entry))
      }
      return items.sort((left, right) => {
        const byTime = Date.parse(left.createdAt) - Date.parse(right.createdAt)
        return byTime !== 0 ? byTime : left.id.localeCompare(right.id)
      })
    })
  }

  /**
   * Read one epic. A missing epic is a result, not a failure: the wrapper
   * answers undefined when `bd` reports that no issue matches.
   * @param epicId - epic id.
   * @param signal - caller's cancellation signal.
   * @returns the epic, or undefined when `bd` no longer finds it.
   */
  show(epicId: BeadsIssueId, signal: AbortSignal): Promise<BeadsIssue | undefined> {
    return this.operate(signal, async () => {
      const result = await this.runOnce(['show', epicId, '--json'], signal)
      if (result.exitCode !== 0) {
        if (reportsMissing(result)) return undefined
        throw commandFailure('bd show', result)
      }
      const data = parseAnswer('bd show', result)
      if (Array.isArray(data)) return data.length === 0 ? undefined : parseIssue('bd show', data[0])
      if (isRecord(data) && typeof data['error'] === 'string') return undefined
      return parseIssue('bd show', data)
    })
  }

  /**
   * Run one operation through the queue, ensure readiness first, and retry
   * the Dolt exclusive lock around the complete operation, parsing included.
   * @param signal - caller's cancellation signal.
   * @param task - operation to run.
   * @returns the operation's result.
   */
  private operate<T>(callerSignal: AbortSignal, task: () => Promise<T>): Promise<T> {
    if (this.lifetime.signal.aborted) return Promise.reject(new BeadsUnavailableError('bd wrapper was disposed'))
    const signal = AbortSignal.any([callerSignal, this.lifetime.signal])
    return this.enqueue(() => this.withRetries(signal, async () => {
      if (this.lifetime.signal.aborted) throw new BeadsUnavailableError('bd wrapper was disposed')
      await this.ensureReady(signal)
      return task()
    }))
  }

  /**
   * Append one task to the wrapper's queue, so two `bd` calls never overlap.
   * @param task - operation to run after every earlier one settled.
   * @returns the task's own result.
   */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  /**
   * Retry one task when the Dolt lock refused it, with a pause between tries.
   * @param signal - caller's cancellation signal.
   * @param task - task to run.
   * @returns the task's result.
   */
  private async withRetries<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await task()
      } catch (error) {
        if (!(error instanceof BeadsCommandError) || !/exclusive lock/iu.test(error.stderrTail) || attempt >= LOCK_RETRIES) {
          throw error
        }
        this.options.logger(`bd is busy (exclusive lock); retry ${String(attempt + 1)} of ${String(LOCK_RETRIES)}`)
        await delay(LOCK_RETRY_DELAY_MS, undefined, { signal })
      }
    }
  }

  /**
   * Ensure the database exists and the CLI is supported, once per wrapper.
   * @param signal - caller's cancellation signal.
   * @returns when `bd init` has settled successfully.
   */
  private ensureReady(signal: AbortSignal): Promise<void> {
    this.ready ??= this.prepare(signal).catch((error: unknown) => {
      this.ready = undefined
      throw error
    })
    return this.ready
  }

  /**
   * Create the beads directory, check the CLI version, and initialize the
   * database if it is missing.
   * @param signal - caller's cancellation signal.
   * @returns when the database is ready.
   */
  private async prepare(signal: AbortSignal): Promise<void> {
    await mkdir(this.options.beadsDir, { recursive: true, mode: 0o700 })
    const versionResult = await this.runOnce(['version', '--json'], signal)
    const versionData = parseAnswer('bd version', versionResult)
    if (!isRecord(versionData) || typeof versionData['version'] !== 'string') {
      throw new BeadsProtocolError('bd version: no version string in the answer')
    }
    const raw = versionData['version']
    const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(raw)
    if (match === null) throw new BeadsProtocolError(`bd version: ${raw} is not a three-part version`)
    const parts: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])]
    if (!versionSupported(parts)) {
      throw new BeadsUnavailableError(`bd ${raw} is not supported; Ketos needs ${MINIMUM_VERSION.join('.')} or newer on the 1.x line`)
    }
    const initResult = await this.runOnce([
      'init',
      '--prefix', this.options.beadsPrefix,
      '--quiet',
      '--skip-hooks',
      '--skip-agents',
      '--non-interactive',
      '--init-if-missing',
    ], signal)
    if (initResult.exitCode !== 0) throw commandFailure('bd init', initResult)
    this.options.logger(`bd ${raw} is ready at ${await this.resolveExecutable(signal)}`)
  }

  /**
   * Resolve the executable once and keep the answer for the wrapper's life.
   * @param signal - caller's cancellation signal.
   * @returns the resolved executable path.
   */
  private resolveExecutable(signal: AbortSignal): Promise<string> {
    this.executable ??= this.locate(signal).catch((error: unknown) => {
      this.executable = undefined
      throw error
    })
    return this.executable
  }

  /**
   * Resolve the configured command through the subprocess seam.
   * @param signal - caller's cancellation signal.
   * @returns the resolved executable path.
   */
  private async locate(signal: AbortSignal): Promise<string> {
    try {
      return await this.subprocess.resolveExecutable(this.options.bdCommand, undefined, signal)
    } catch (error: unknown) {
      if (error instanceof SubprocessExecutableNotFoundError) {
        throw new BeadsUnavailableError(`bd was not found: ${error.message}`, { cause: error })
      }
      throw new BeadsUnavailableError(`bd could not be resolved: ${String(error)}`, { cause: error })
    }
  }

  /**
   * Spawn one `bd` call with the fixed environment, timeout, and stdio caps.
   * @param args - `bd` arguments without the executable.
   * @param signal - caller's cancellation signal.
   * @returns the settled call.
   */
  private async runOnce(args: readonly string[], signal: AbortSignal): Promise<BeadsResult> {
    const executable = await this.resolveExecutable(signal)
    const timeout = AbortSignal.timeout(this.options.bdTimeoutMs)
    const combined = AbortSignal.any([signal, timeout])
    const spec: SubprocessSpawnSpec = {
      argv: [executable, ...args],
      cwd: this.options.beadsDir,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: this.options.bdOutputMaxBytes },
        stderr: { maxBytes: STDERR_TAIL_BYTES },
      },
      graceMs: TERMINATE_GRACE_MS,
      signal: combined,
      env: this.env,
    }
    let handle: SubprocessHandle
    try {
      handle = this.subprocess.spawn(spec)
    } catch (error: unknown) {
      throw new BeadsUnavailableError(`bd could not be started: ${String(error)}`, { cause: error })
    }
    const outcome = await handle.done
    if (combined.aborted) {
      throw new BeadsCommandError(null, '', timeout.aborted
        ? `bd ${args.join(' ')} timed out after ${String(this.options.bdTimeoutMs)}ms`
        : `bd ${args.join(' ')} was aborted`)
    }
    const stdout = handle.collected.stdout?.readFrom(0) ?? { text: '', lossy: false }
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    return { exitCode: outcome.exitCode, stdout: stdout.text, stderr, stdoutLossy: stdout.lossy }
  }
}
