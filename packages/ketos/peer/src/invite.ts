/**
 * The one-time invitation code: `ketos1.<endpoint ticket>.<base32 secret>`.
 * The ticket names the node to dial; the secret admits exactly one unknown
 * node, so a leaked ticket alone cannot join the channel.
 * @module @ketos/peer/invite
 */

import { timingSafeEqual } from 'node:crypto'

/** Prefix of every invitation code this build mints. */
export const INVITE_PREFIX = 'ketos1'

/** Random bytes of the one-time secret. */
export const INVITE_SECRET_BYTES = 16

/** Characters the secret's base32 alphabet uses. */
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

/** Length of the encoded 16-byte secret. */
export const INVITE_SECRET_LENGTH = 26

/** Wrong secrets that burn one invitation: it survives four, and the fifth ends it. */
export const INVITE_MAX_FAILED_ATTEMPTS = 5

/** Largest accepted invitation code length, in characters. */
const INVITE_CODE_MAX = 512

/** The two halves one decoded invitation code carries. */
export interface ParsedInvite {
  /** The endpoint ticket of the node to dial. */
  readonly ticket: string
  /** The one-time base32 secret. */
  readonly secret: string
}

/**
 * Compare a presented secret with the pending one in constant time. The
 * length check comes first because `timingSafeEqual` throws on unequal
 * lengths; the secret length is public (26 characters), so it is no leak.
 * @param presented - the secret a connecting node sent.
 * @param expected - the pending invitation's secret.
 * @returns true when both are the same string.
 */
export function inviteSecretMatches(presented: string, expected: string): boolean {
  const presentedBytes = Buffer.from(presented, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')
  if (presentedBytes.byteLength !== expectedBytes.byteLength) return false
  return timingSafeEqual(presentedBytes, expectedBytes)
}

/**
 * Encode bytes as unpadded lowercase RFC 4648 base32.
 * @param bytes - bytes to encode.
 * @returns the encoded string.
 */
export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET.charAt((value >>> (bits - 5)) & 31)
      bits -= 5
    }
  }
  if (bits > 0) output += BASE32_ALPHABET.charAt((value << (5 - bits)) & 31)
  return output
}

/**
 * Mint one fresh 16-byte secret from the platform random generator.
 * @returns the secret bytes.
 */
export function mintInviteSecret(): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(INVITE_SECRET_BYTES))
}

/**
 * Build one invitation code.
 * @param ticket - endpoint ticket of the inviting node.
 * @param secret - encoded one-time secret.
 * @returns the code to show the user.
 */
export function formatInvite(ticket: string, secret: string): string {
  return `${INVITE_PREFIX}.${ticket}.${secret}`
}

/**
 * Parse one invitation code, refusing anything this build did not mint.
 * @param code - the pasted code.
 * @returns both halves, or undefined when the code is malformed.
 */
export function parseInvite(code: string): ParsedInvite | undefined {
  if (code.length === 0 || code.length > INVITE_CODE_MAX) return undefined
  const parts = code.split('.')
  if (parts.length < 3) return undefined
  if (parts[0] !== INVITE_PREFIX) return undefined
  const secret = parts.at(-1) as string
  const ticket = parts.slice(1, -1).join('.')
  if (ticket.length === 0) return undefined
  if (secret.length !== INVITE_SECRET_LENGTH) return undefined
  for (const character of secret) {
    if (!BASE32_ALPHABET.includes(character)) return undefined
  }
  return { ticket, secret }
}
