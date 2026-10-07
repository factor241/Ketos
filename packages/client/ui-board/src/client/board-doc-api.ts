/**
 * Browser client of the board document routes: the snapshot read, the atomic
 * operation post, and the event stream the store follows.
 *
 * The stream answers one `snapshot` event, then one `patch` event per committed
 * batch and a `: ping` heartbeat; a dropped connection reconnects with a
 * growing pause and a fresh snapshot, and a tab hidden longer than its budget
 * closes the stream until it returns (HTTP/1.1 keeps six connections per
 * origin). Every decoded value is validated before it reaches the store.
 */
import { brandNumber } from '@deepseek-ai/dsh-brand'
import { UUID_PATTERN, isElementData, isElementId } from '@ketos/board-doc/data'
import { isBoardElementKind } from '@ketos/board-doc/kinds'
import type {
  BoardElement, BoardErrorCode, BoardOp, BoardPatch, BoardRevision, BoardSnapshot,
} from '@ketos/board-doc/types'
import { ketosRoute } from './ketos-route.ts'

/** Path of the snapshot route on the host. */
export const BOARD_DOC_PATH = '/api/ketos.board'

/** Path of the operation route on the host. */
export const BOARD_DOC_OPS_PATH = '/api/ketos.board.ops'

/** Path of the event-stream route on the host. */
export const BOARD_DOC_EVENTS_PATH = '/api/ketos.board.events'

/** Failure of one operation post: a host code or the client's own unreachable code. */
export type BoardFailureCode = BoardErrorCode | 'ketos/unreachable'

/** Outcome of one operation post. */
export type BoardOpsOutcome =
  | { readonly ok: true; readonly revision: BoardRevision }
  | { readonly ok: false; readonly code: BoardFailureCode }

/** One event the stream delivers after decoding. */
export type BoardStreamEvent =
  | { readonly type: 'snapshot'; readonly snapshot: BoardSnapshot }
  | { readonly type: 'patch'; readonly patch: BoardPatch }

/** Deployment timing of the stream. */
export interface BoardStreamOptions {
  /** Shortest reconnect pause, in milliseconds. */
  readonly retryMinMs: number
  /** Longest reconnect pause, in milliseconds. */
  readonly retryMaxMs: number
  /** How long a hidden tab may keep its stream before closing it. */
  readonly hiddenCloseMs: number
}

/** Whether a decoded value is a plain JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a decoded value is a finite number. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Whether a decoded value is a UUID string. */
function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

/**
 * Decode one element the host promised.
 * @param value - decoded JSON value.
 * @returns whether the value is a complete element.
 */
export function isBoardElement(value: unknown): value is BoardElement {
  if (!isRecord(value)) return false
  return isElementId(value['id'])
    && isBoardElementKind(value['kind'])
    && typeof value['ownerId'] === 'string' && value['ownerId'] !== ''
    && isFiniteNumber(value['x']) && isFiniteNumber(value['y'])
    && isFiniteNumber(value['w']) && value['w'] > 0
    && isFiniteNumber(value['h']) && value['h'] > 0
    && isFiniteNumber(value['z'])
    && isElementData(value['data'])
    && isFiniteNumber(value['createdAt'])
    && isFiniteNumber(value['updatedAt'])
}

/**
 * Decode one full document snapshot.
 * @param value - decoded JSON value.
 * @returns whether the value is a complete snapshot.
 */
export function isBoardSnapshot(value: unknown): value is BoardSnapshot {
  if (!isRecord(value)) return false
  const limits = value['limits']
  return isUuid(value['docId'])
    && isUuid(value['selfId'])
    && isFiniteNumber(value['revision']) && value['revision'] >= 0
    && Array.isArray(value['elements']) && value['elements'].every(isBoardElement)
    && isRecord(limits) && isFiniteNumber(limits['elementBytesMax']) && limits['elementBytesMax'] > 0
    && isFiniteNumber(limits['noteTextMax']) && limits['noteTextMax'] > 0
    && isFiniteNumber(limits['strokePointsMax']) && limits['strokePointsMax'] >= 2
}

/**
 * Decode one stream patch.
 * @param value - decoded JSON value.
 * @returns whether the value is a complete patch.
 */
export function isBoardPatch(value: unknown): value is BoardPatch {
  if (!isRecord(value)) return false
  return isFiniteNumber(value['revision']) && value['revision'] >= 0
    && Array.isArray(value['upserts']) && value['upserts'].every(isBoardElement)
    && Array.isArray(value['removes']) && value['removes'].every(isElementId)
}

/** Whether a decoded value is one of the host's stable board codes. */
function isBoardErrorCode(value: unknown): value is BoardErrorCode {
  return value === 'ketos/invalid'
    || value === 'ketos/element-not-found'
    || value === 'ketos/element-foreign'
    || value === 'ketos/element-exists'
    || value === 'ketos/limit'
}

/**
 * Read the current document snapshot.
 * @returns the decoded snapshot, or undefined when the host is unreachable or answers something else.
 */
export async function fetchBoardSnapshot(): Promise<BoardSnapshot | undefined> {
  try {
    const response = await fetch(ketosRoute(BOARD_DOC_PATH.slice(1)), { headers: { accept: 'application/json' } })
    if (!response.ok) return undefined
    const payload: unknown = await response.json()
    return isBoardSnapshot(payload) ? payload : undefined
  } catch {
    return undefined
  }
}

/** Options of one operation post. */
export interface BoardOpsPostOptions {
  /**
   * Post the batch as a page-lifetime request, so a flush during `pagehide` or
   * a hidden tab still leaves the browser. The board's own batches stay under
   * the 64 KiB keepalive body bound.
   */
  readonly keepalive?: boolean
}

/**
 * Post one atomic operation batch.
 * @param ops - the operations to apply.
 * @param options - keepalive posting for a page-lifetime flush.
 * @returns the committed revision or the stable failure code.
 */
export async function postBoardOps(ops: readonly BoardOp[], options: BoardOpsPostOptions = {}): Promise<BoardOpsOutcome> {
  try {
    const response = await fetch(ketosRoute(BOARD_DOC_OPS_PATH.slice(1)), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ops }),
      keepalive: options.keepalive ?? false,
    })
    const payload: unknown = await response.json().catch(() => undefined)
    if (!response.ok) {
      if (isRecord(payload) && isBoardErrorCode(payload['error'])) return { ok: false, code: payload['error'] }
      return { ok: false, code: 'ketos/unreachable' }
    }
    if (!isRecord(payload) || payload['ok'] !== true || !isFiniteNumber(payload['revision'])) {
      return { ok: false, code: 'ketos/unreachable' }
    }
    return { ok: true, revision: brandNumber<BoardRevision>(payload['revision']) }
  } catch {
    return { ok: false, code: 'ketos/unreachable' }
  }
}

/**
 * Follow the document's event stream until the signal aborts. The stream
 * reconnects after a failure with an exponentially growing pause, closes while
 * the tab stays hidden past its budget, and reopens when the tab returns.
 * @param signal - aborts the stream and its pending reconnect.
 * @param onEvent - receives each decoded snapshot and patch.
 * @param options - reconnect and hidden-tab timing.
 */
export function openBoardEvents(
  signal: AbortSignal,
  onEvent: (event: BoardStreamEvent) => void,
  options: BoardStreamOptions,
): void {
  let attempt = 0
  let connection: AbortController | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let hiddenTimer: ReturnType<typeof setTimeout> | undefined
  const lifecycle = { stopped: false }

  /** Whether the caller's signal already stopped this stream. */
  function isStopped(): boolean {
    return lifecycle.stopped
  }

  function stopConnection(): void {
    connection?.abort()
    connection = undefined
  }

  function scheduleRetry(): void {
    if (isStopped()) return
    const delay = Math.min(options.retryMaxMs, options.retryMinMs * 2 ** attempt)
    attempt += 1
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      void connect()
    }, delay)
  }

  async function connect(): Promise<void> {
    if (isStopped() || document.visibilityState === 'hidden') return
    const controller = new AbortController()
    connection = controller
    const abortOnOuter = (): void => { controller.abort() }
    signal.addEventListener('abort', abortOnOuter)
    try {
      const response = await fetch(ketosRoute(BOARD_DOC_EVENTS_PATH.slice(1)), { signal: controller.signal })
      const body = response.body
      if (!response.ok || body === null) throw new Error(`board events: status ${String(response.status)}`)
      // A connected stream reconnects from the short pause: the snapshot event
      // of the next connection is the full state, so a closed backlog stream
      // recovers without an immediate reconnect loop.
      attempt = 0
      await readBoardEvents(body, onEvent)
    } catch {
      // Offline, refused, aborted, or a stream the host closed: reconnect below
      // unless this connection was stopped on purpose.
    } finally {
      signal.removeEventListener('abort', abortOnOuter)
      // No second connection starts while this one is awaited, so the field
      // belongs to this attempt until it settles.
      connection = undefined
    }
    if (isStopped()) return
    if (signal.aborted) return
    scheduleRetry()
  }

  function onVisibilityChange(): void {
    if (isStopped()) return
    if (document.visibilityState === 'hidden') {
      hiddenTimer = setTimeout(() => {
        hiddenTimer = undefined
        stopConnection()
      }, options.hiddenCloseMs)
      return
    }
    if (hiddenTimer !== undefined) {
      clearTimeout(hiddenTimer)
      hiddenTimer = undefined
    }
    if (connection === undefined && retryTimer === undefined) void connect()
  }

  function stop(): void {
    lifecycle.stopped = true
    stopConnection()
    if (retryTimer !== undefined) clearTimeout(retryTimer)
    if (hiddenTimer !== undefined) clearTimeout(hiddenTimer)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    signal.removeEventListener('abort', stop)
  }

  signal.addEventListener('abort', stop, { once: true })
  document.addEventListener('visibilitychange', onVisibilityChange)
  void connect()
}

/**
 * Read one event stream to its end, dispatching every complete frame.
 * @param body - the streaming response body.
 * @param onEvent - receives each decoded event.
 */
async function readBoardEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: BoardStreamEvent) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      let boundary = /\r?\n\r?\n/.exec(buffer)
      while (boundary !== null) {
        const frame = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary[0].length)
        dispatchFrame(frame, onEvent)
        boundary = /\r?\n\r?\n/.exec(buffer)
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}

/**
 * Decode one server-sent-event frame: comments (the heartbeat) and unknown
 * events are ignored, multi-line `data:` joins with newlines, and a payload
 * that fails its decoder is dropped.
 * @param frame - one complete frame without its blank-line terminator.
 * @param onEvent - receives the decoded event.
 */
function dispatchFrame(frame: string, onEvent: (event: BoardStreamEvent) => void): void {
  let name = ''
  const data: string[] = []
  for (const line of frame.split(/\r?\n/)) {
    if (line === '' || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    const raw = colon === -1 ? '' : line.slice(colon + 1)
    const value = raw.startsWith(' ') ? raw.slice(1) : raw
    if (field === 'event') name = value
    else if (field === 'data') data.push(value)
  }
  if (data.length === 0) return
  let payload: unknown
  try {
    payload = JSON.parse(data.join('\n'))
  } catch {
    return
  }
  if (name === 'snapshot' && isBoardSnapshot(payload)) {
    onEvent({ type: 'snapshot', snapshot: payload })
  } else if (name === 'patch' && isBoardPatch(payload)) {
    onEvent({ type: 'patch', patch: payload })
  }
}
