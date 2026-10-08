/**
 * The known-peer file: the durable list of nodes this Ketos has admitted or
 * dialed, so later connections need no invitation code. The file is written
 * owner-only through a temporary file and a rename, and a file that does not
 * match this build's record shape refuses to load instead of silently
 * dropping a peer.
 * @module @ketos/peer/peers-file
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { OwnerId } from '@ketos/board-doc/types'
import { isPeerColor } from './color.ts'
import type { KetosPeerId } from './types.ts'

/** Largest accepted peer id and ticket string in a stored record. */
const RECORD_STRING_MAX = 512

/** Fields one stored record may carry; any other field refuses the file. */
const RECORD_FIELDS: readonly string[] = ['peerId', 'selfId', 'name', 'color', 'ticket', 'lastSeen']

/** One peer this Ketos knows, as `peers.json` stores it. */
export interface KnownPeer {
  /** Identity of the peer's iroh node. */
  readonly peerId: KetosPeerId
  /** The peer's board participant id. */
  readonly selfId: OwnerId
  /** The peer's participant name at the last handshake. */
  readonly name: string
  /** The peer's palette color at the last handshake. */
  readonly color: number
  /**
   * The peer's endpoint ticket when this side dialed it; the accepting side
   * stores the record without a ticket and waits for the peer's redial.
   */
  readonly ticket?: string
  /** Time of the last completed handshake, ISO 8601. */
  readonly lastSeen: string
}

/**
 * Read the known-peer file.
 * @param path - the `peers.json` path.
 * @returns the stored records, empty when the file does not exist.
 */
export async function loadKnownPeers(path: string): Promise<readonly KnownPeer[]> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error: unknown) {
    if (isNotFound(error)) return []
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`peer file ${path} is not JSON`)
  }
  if (!Array.isArray(parsed)) throw new Error(`peer file ${path} must hold an array`)
  const records = new Map<string, KnownPeer>()
  for (const entry of parsed) {
    const record = parseKnownPeer(entry, path)
    records.set(record.peerId, record)
  }
  return [...records.values()]
}

/**
 * Write the known-peer file owner-only through a temporary file and a rename,
 * so a crash never leaves a half-written list.
 * @param path - the `peers.json` path.
 * @param peers - the complete list to store.
 */
export async function saveKnownPeers(path: string, peers: readonly KnownPeer[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid.toString()}.${Math.random().toString(16).slice(2, 10)}.tmp`
  await writeFile(temporary, `${JSON.stringify(peers, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

/**
 * Validate one decoded record at the file boundary.
 * @param value - decoded record.
 * @param path - file path for the error message.
 * @returns the typed record.
 */
function parseKnownPeer(value: unknown, path: string): KnownPeer {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`peer file ${path} holds a record that is not an object`)
  }
  const source = value as Record<string, unknown>
  for (const key of Object.keys(source)) {
    if (!RECORD_FIELDS.includes(key)) throw new Error(`peer file ${path} record carries unknown field ${JSON.stringify(key)}`)
  }
  if (!isRecordString(source.peerId)) throw new Error(`peer file ${path} record peerId must be a non-empty string`)
  if (!isRecordString(source.selfId)) throw new Error(`peer file ${path} record selfId must be a non-empty string`)
  if (!isRecordString(source.name)) throw new Error(`peer file ${path} record name must be a non-empty string`)
  if (!isPeerColor(source.color)) throw new Error(`peer file ${path} record color must be an integer from 1 to 10`)
  if (source.ticket !== undefined && !isRecordString(source.ticket)) {
    throw new Error(`peer file ${path} record ticket must be a non-empty string when present`)
  }
  if (!isRecordString(source.lastSeen)) throw new Error(`peer file ${path} record lastSeen must be a non-empty string`)
  return {
    peerId: brandString<KetosPeerId>(source.peerId),
    selfId: brandString<OwnerId>(source.selfId),
    name: source.name,
    color: source.color,
    ...source.ticket === undefined ? {} : { ticket: source.ticket },
    lastSeen: source.lastSeen,
  }
}

/**
 * Whether a decoded value is a bounded non-empty record string.
 * @param value - decoded value.
 * @returns true when the value fits the record string bound.
 */
function isRecordString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= RECORD_STRING_MAX
}

/**
 * Whether an error is a missing-file failure.
 * @param error - a caught error.
 * @returns true for `ENOENT`.
 */
function isNotFound(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT'
}
