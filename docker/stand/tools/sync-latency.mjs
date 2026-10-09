#!/usr/bin/env node
/**
 * Board synchronization latency probe for the two-Ketos stand.
 *
 * Two modes, meant to run against the two Ketos of the stand:
 *
 *   node sync-latency.mjs receive --base http://127.0.0.1:3081 --token <token> [--count 20] [--timeout 60000] [--offset-ms 0]
 *   node sync-latency.mjs send    --base http://127.0.0.1:3080 --token <token> [--count 20] [--interval 1000]
 *
 * `send` runs `count` rounds one `interval` apart. Each round creates a note
 * whose `data.text` is the sender's `Date.now()`, patches the text to a second
 * timestamp, then writes an `r<timestamp>` marker and removes the note right
 * after. `receive` follows `/api/ketos.board.events` and measures, for notes
 * owned by the OTHER Ketos only (the receiver's own `selfId` from the snapshot
 * is ignored), the arrival latency of the create, the patch, and the remove,
 * as `Date.now() - timestamp + --offset-ms`.
 *
 * `receive` stops after `count` complete rounds or after `--timeout` ms and
 * reports per kind how many changes were expected and how many arrived, so a
 * lost change shows up as a loss instead of a shorter sample list. A removal
 * that arrives merged with its marker (a catch-up after a reconnect delivers
 * the current state, not each change) counts as received but unmeasured; a
 * create merged with its patch is measured once, against the patch stamp. The clocks
 * of both sides must be synchronized (NTP) or `--offset-ms` must carry the
 * measured offset of the sender's clock ahead of the receiver's; on the same
 * machine the offset is 0. The residual offset belongs in the report.
 *
 * The tool uses only Node built-ins. The token is the one `ketos web` prints;
 * the probe logs in with it once and reuses the session cookie.
 */

import { pathToFileURL } from 'node:url'

const DEFAULT_COUNT = 20
const DEFAULT_INTERVAL_MS = 1000
const DEFAULT_TIMEOUT_MS = 60_000
const MAX_PLAUSIBLE_MS = 300_000
const KINDS = ['create', 'patch', 'remove']

/**
 * Parse one command line into flags.
 * @param {string[]} argv - arguments after the mode.
 * @returns {{ base: string, token: string, count: number, interval: number, timeout: number, offsetMs: number }}
 */
export function parseArguments(argv) {
  const flags = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    if (!key.startsWith('--')) throw new Error(`unexpected argument ${key}`)
    flags.set(key.slice(2), argv[index + 1])
  }
  const base = flags.get('base')
  const token = flags.get('token')
  if (base === undefined || token === undefined) throw new Error('--base and --token are required')
  const number = (name, fallback) => {
    if (!flags.has(name)) return fallback
    const value = Number(flags.get(name))
    if (!Number.isFinite(value)) throw new Error(`--${name} must be a number`)
    return value
  }
  return {
    base: base.replace(/\/$/u, ''),
    token,
    count: number('count', DEFAULT_COUNT),
    interval: number('interval', DEFAULT_INTERVAL_MS),
    timeout: number('timeout', DEFAULT_TIMEOUT_MS),
    offsetMs: number('offset-ms', 0),
  }
}

/**
 * Log in with the web token and return the session cookie.
 * @param {string} base - base URL of the Ketos web server.
 * @param {string} token - token from the printed address.
 * @returns {Promise<string>} the `Cookie` header value.
 */
async function login(base, token) {
  const response = await fetch(`${base}/?token=${encodeURIComponent(token)}`, { redirect: 'manual' })
  const cookies = response.headers.getSetCookie()
  const cookie = cookies.map(value => value.split(';')[0]).filter(Boolean).join('; ')
  if (cookie === '') throw new Error(`login answered ${response.status} without a session cookie`)
  return cookie
}

/** Pause for one duration. */
function sleep(ms) {
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

/**
 * Post one operation batch to the local board.
 * @param {string} base - base URL.
 * @param {string} cookie - session cookie.
 * @param {object} op - one board operation.
 * @returns {Promise<boolean>} whether the host accepted it.
 */
async function postOp(base, cookie, op) {
  const response = await fetch(`${base}/api/ketos.board.ops`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ ops: [op] }),
  })
  if (!response.ok) console.error(`${op.op} refused with ${response.status}`)
  return response.ok
}

/**
 * `send` mode: per round create a timestamped note, patch it, mark and remove it.
 * @param {{ base: string, token: string, count: number, interval: number }} options - parsed flags.
 */
async function runSend(options) {
  const cookie = await login(options.base, options.token)
  console.log(`sending ${options.count} rounds every ${options.interval} ms to ${options.base}`)
  for (let index = 0; index < options.count; index += 1) {
    const id = crypto.randomUUID()
    const data = (text) => ({ text, font: 'sans', size: 'm', scale: 1 })
    const created = await postOp(options.base, cookie, {
      op: 'create', id, kind: 'note', x: 24 * (index % 8), y: 24 * Math.floor(index / 8), w: 240, h: 160,
      data: data(String(Date.now())),
    })
    await sleep(options.interval / 3)
    const patched = created && await postOp(options.base, cookie, { op: 'patch', id, data: { text: String(Date.now()) } })
    await sleep(options.interval / 3)
    if (patched) {
      await postOp(options.base, cookie, { op: 'patch', id, data: { text: `r${String(Date.now())}` } })
      await postOp(options.base, cookie, { op: 'remove', id })
    }
    console.log(`round ${index + 1}/${options.count} ${id}`)
    if (index < options.count - 1) await sleep(options.interval / 3)
  }
}

/**
 * Decode one server-sent-event frame.
 * @param {string} frame - one complete SSE frame without its terminator.
 * @returns {{ name: string, payload: any } | undefined} the event, or undefined when it carries no JSON data.
 */
export function decodeFrame(frame) {
  let name = ''
  const data = []
  for (const line of frame.split(/\r?\n/u)) {
    if (line === '' || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    const raw = colon === -1 ? '' : line.slice(colon + 1)
    const value = raw.startsWith(' ') ? raw.slice(1) : raw
    if (field === 'event') name = value
    else if (field === 'data') data.push(value)
  }
  if (data.length === 0) return undefined
  try {
    return { name, payload: JSON.parse(data.join('\n')) }
  } catch {
    return undefined
  }
}

/**
 * Collects the latencies of changes made by the other Ketos only.
 */
export class Tracker {
  /**
   * @param {string} selfId - this Ketos's own owner id; its notes are not measured.
   * @param {number} offsetMs - how far the sender clock runs ahead of the receiver clock; added to every latency, because the stamp is that much later than the true send time.
   * @param {() => number} now - clock, replaceable in tests.
   */
  constructor(selfId, offsetMs, now = Date.now) {
    this.selfId = selfId
    this.offsetMs = offsetMs
    this.now = now
    this.samples = { create: [], patch: [], remove: [] }
    this.unmeasured = { create: 0, patch: 0, remove: 0 }
    this.seen = new Set()
    this.lastText = new Map()
    this.removedIds = new Set()
    this.known = new Set()
  }

  /** Record one latency when the timestamp is plausible. */
  record(kind, sentAt) {
    const latency = this.now() - sentAt + this.offsetMs
    if (Math.abs(latency) <= MAX_PLAUSIBLE_MS) this.samples[kind].push(latency)
  }

  /**
   * Apply one patch event.
   * @param {{ upserts?: any[], removes?: string[] }} patch - decoded patch payload.
   */
  patch(patch) {
    for (const element of patch.upserts ?? []) {
      if (element.kind !== 'note' || element.ownerId === this.selfId) continue
      const text = element.data?.text
      if (typeof text !== 'string') continue
      if (/^r\d+$/u.test(text)) {
        this.lastText.set(element.id, Number(text.slice(1)))
        continue
      }
      if (!/^\d+$/u.test(text)) continue
      const key = `${element.id}:${text}`
      if (this.seen.has(key)) continue
      this.seen.add(key)
      this.record(this.known.has(element.id) ? 'patch' : 'create', Number(text))
      this.known.add(element.id)
    }
    for (const id of patch.removes ?? []) {
      if (this.removedIds.has(id) || !this.known.has(id)) continue
      this.removedIds.add(id)
      const marker = this.lastText.get(id)
      if (marker !== undefined) this.record('remove', marker)
      else this.unmeasured.remove += 1
    }
  }

  /**
   * Summarize every kind against the expected count.
   * @param {number} expected - rounds the sender was asked to run.
   * @returns {Record<string, { expected: number, received: number, unmeasured: number, lost: number, median_ms: number | null, max_ms: number | null, samples_ms: number[] }>}
   */
  summary(expected) {
    return Object.fromEntries(KINDS.map((kind) => {
      const sorted = [...this.samples[kind]].sort((left, right) => left - right)
      const received = sorted.length + this.unmeasured[kind]
      const median = sorted.length === 0 ? null
        : sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2]
          : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
      return [kind, {
        expected,
        received,
        unmeasured: this.unmeasured[kind],
        lost: Math.max(0, expected - received),
        median_ms: median,
        max_ms: sorted.length === 0 ? null : sorted[sorted.length - 1],
        samples_ms: this.samples[kind],
      }]
    }))
  }
}

/**
 * `receive` mode: follow the board event stream and report arrival latencies.
 * @param {{ base: string, token: string, count: number, timeout: number, offsetMs: number }} options - parsed flags.
 */
async function runReceive(options) {
  const cookie = await login(options.base, options.token)
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, options.timeout)
  const response = await fetch(`${options.base}/api/ketos.board.events`, {
    headers: { accept: 'text/event-stream', cookie },
    signal: controller.signal,
  })
  if (!response.ok || response.body === null) throw new Error(`event stream answered ${response.status}`)
  console.log(`listening on ${options.base}, waiting up to ${options.timeout} ms for ${options.count} rounds`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let tracker
  let buffer = ''
  try {
    while (tracker === undefined || tracker.samples.remove.length < options.count) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = /\r?\n\r?\n/.exec(buffer)
      while (boundary !== null) {
        const event = decodeFrame(buffer.slice(0, boundary.index))
        buffer = buffer.slice(boundary.index + boundary[0].length)
        if (event?.name === 'snapshot') tracker = new Tracker(event.payload.selfId, options.offsetMs)
        else if (event?.name === 'patch' && tracker !== undefined) tracker.patch(event.payload)
        boundary = /\r?\n\r?\n/.exec(buffer)
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error
  } finally {
    clearTimeout(timer)
    await reader.cancel().catch(() => {})
  }
  if (tracker === undefined) throw new Error('no snapshot arrived before the timeout')
  console.log(JSON.stringify({ timedOut: controller.signal.aborted, offset_ms: options.offsetMs, ...tracker.summary(options.count) }))
}

/** Run the CLI. */
async function main() {
  const [mode, ...rest] = process.argv.slice(2)
  try {
    const options = parseArguments(rest)
    if (mode === 'send') await runSend(options)
    else if (mode === 'receive') await runReceive(options)
    else throw new Error(`unknown mode ${String(mode)}; expected send or receive`)
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error))
    process.exit(1)
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
