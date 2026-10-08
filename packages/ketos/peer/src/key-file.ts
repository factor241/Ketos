/**
 * The node's stored secret key: loaded from a 32-byte file, or generated once
 * on first use. The file and its directory are owner-only, and a file of any
 * other length refuses to load instead of silently minting a new identity.
 *
 * The generator is a parameter so this module stays free of the native iroh
 * import; the transport supplies `SecretKey.generate().toBytes()`.
 * @module @ketos/peer/key-file
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Length of an ed25519 secret key in bytes. */
export const PEER_KEY_BYTES = 32

/**
 * Read the node's secret key, creating it on first use.
 * @param path - key file path; its parent directory is created owner-only.
 * @param generate - produces a fresh 32-byte key when the file is absent.
 * @returns the stored or freshly generated key.
 */
export async function loadOrCreateSecretKey(
  path: string,
  generate: () => Uint8Array | Promise<Uint8Array>,
): Promise<Uint8Array> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const stored = await readStoredKey(path)
  if (stored !== undefined) return stored
  const key = await generate()
  if (key.byteLength !== PEER_KEY_BYTES) {
    throw new Error(`peer key generator produced ${key.byteLength} bytes, expected ${PEER_KEY_BYTES}`)
  }
  try {
    await writeFile(path, key, { mode: 0o600, flag: 'wx' })
    return key
  } catch (error: unknown) {
    if (!isAlreadyExists(error)) throw error
    // Another process created the key between the read and the write; the
    // stored file is the identity both processes must share.
    const raced = await readStoredKey(path)
    if (raced === undefined) throw error
    return raced
  }
}

/**
 * Read the key file, or report its absence.
 * @param path - key file path.
 * @returns the key, or undefined when the file does not exist.
 */
async function readStoredKey(path: string): Promise<Uint8Array | undefined> {
  let contents: Buffer
  try {
    contents = await readFile(path)
  } catch (error: unknown) {
    if (isNotFound(error)) return undefined
    throw error
  }
  if (contents.byteLength !== PEER_KEY_BYTES) {
    throw new Error(`peer key file ${path} must hold ${PEER_KEY_BYTES} bytes, got ${contents.byteLength}`)
  }
  return new Uint8Array(contents)
}

/**
 * Whether an error is a missing-file failure.
 * @param error - a caught error.
 * @returns true for `ENOENT`.
 */
function isNotFound(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT'
}

/**
 * Whether an error is an exclusive-create collision.
 * @param error - a caught error.
 * @returns true for `EEXIST`.
 */
function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'EEXIST'
}
