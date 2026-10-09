/**
 * Browser client of the foreign-transcript route: one POST that asks the host
 * to read the latest messages of a window another Ketos published.
 *
 * The success answer is validated before it reaches the card, and every
 * failure collapses to one of the stable codes the card names. A code counts
 * only when the response status is the one the host pairs it with.
 */
import type { TranscriptMessage, TranscriptResponse } from '@ketos/peer/types'
import { isRecord } from './board-doc-api.ts'
import type { BoardTranscriptFailureCode, BoardTranscriptOutcome } from './contract/slots.ts'
import { ketosRoute } from './ketos-route.ts'

/** Path of the transcript route on the host. */
export const TRANSCRIPT_PATH = '/api/ketos.peer.transcript'

/** Host status paired with each stable transcript code. */
const CODE_STATUS = {
  'ketos/transcript-closed': 403,
  'ketos/window-not-found': 404,
  'ketos/peer-offline': 503,
  'ketos/peer-timeout': 504,
} as const satisfies Record<Exclude<BoardTranscriptFailureCode, 'ketos/unreachable'>, number>

/** Whether a decoded value is one transcript message with a parseable time. */
function isTranscriptMessage(value: unknown): value is TranscriptMessage {
  if (!isRecord(value)) return false
  return (value['role'] === 'user' || value['role'] === 'agent')
    && typeof value['text'] === 'string'
    && typeof value['at'] === 'string' && Number.isFinite(Date.parse(value['at']))
}

/**
 * Decode one success answer.
 * @param value - decoded JSON value.
 * @returns whether the value is a complete transcript answer.
 */
export function isTranscriptResponse(value: unknown): value is TranscriptResponse {
  return isRecord(value) && Array.isArray(value['messages']) && value['messages'].every(isTranscriptMessage)
}

/**
 * Read one failure's stable code from a failed response.
 * @param response - the failed response.
 * @returns the host's code when body and status agree, the unreachable code otherwise.
 */
async function failureCode(response: Response): Promise<BoardTranscriptFailureCode> {
  const payload: unknown = await response.json().catch(() => undefined)
  if (!isRecord(payload)) return 'ketos/unreachable'
  for (const [code, status] of Object.entries(CODE_STATUS)) {
    if (payload['error'] === code && response.status === status) return code as keyof typeof CODE_STATUS
  }
  return 'ketos/unreachable'
}

/**
 * Read the latest messages of one foreign chat window.
 * @param windowId - the foreign window whose transcript is read.
 * @param signal - aborts the request and its response read.
 * @returns the messages, oldest first, or the stable failure code.
 */
export async function fetchTranscript(windowId: string, signal?: AbortSignal): Promise<BoardTranscriptOutcome> {
  try {
    const response = await fetch(ketosRoute(TRANSCRIPT_PATH.slice(1)), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ windowId }),
      ...(signal === undefined ? {} : { signal }),
    })
    if (!response.ok) return { ok: false, code: await failureCode(response) }
    const payload: unknown = await response.json().catch(() => undefined)
    if (!isTranscriptResponse(payload)) return { ok: false, code: 'ketos/unreachable' }
    return { ok: true, messages: payload.messages }
  } catch {
    return { ok: false, code: 'ketos/unreachable' }
  }
}
