/**
 * Syncthing device ids in the one form Ketos accepts: the canonical text
 * Syncthing prints, eight groups of seven characters of the base32 alphabet
 * `A–Z2–7` joined by `-`. The 56 characters are four runs of 13 data
 * characters, each followed by one check character computed with the
 * Luhn mod N algorithm over that alphabet (N = 32): going from the first data
 * character to the last, the factor starts at 1 and alternates between 1 and
 * 2. The 52 data characters hold 260 bits for the 32 bytes of the id, so the
 * last data character carries one data bit followed by four padding bits,
 * which are zero: that character is `A` or `Q`. Syncthing itself also
 * accepts lowercase, the digit typos 0/1/8, the 52-character form without
 * check characters, and set padding bits, which decode to the same bytes as
 * the id Syncthing prints; the peer channel accepts none of them, so every id
 * that crosses it is exactly what Syncthing reports.
 * @module @ketos/peer/syncthing-device-id
 */

import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** One Syncthing device id in canonical form. */
export type SyncthingDeviceId = Branded<'SyncthingDeviceId'>

/** The base32 alphabet of device ids; a character's index is its code point. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Data characters one check character covers. */
const DATA_RUN = 13

/** Eight dash-separated groups of seven alphabet characters. */
const CANONICAL_PATTERN = /^[A-Z2-7]{7}(?:-[A-Z2-7]{7}){7}$/u

/** Position of the last data character among the 56 characters without dashes. */
const LAST_DATA_INDEX = 54

/** The four low bits of a character's value; zero in the last data character. */
const PADDING_BITS = 0b01111

/**
 * The Luhn mod 32 check character of one data run.
 * @param run - 13 characters of {@link ALPHABET}.
 * @returns the check character.
 */
function luhn32(run: string): string {
  let factor = 1
  let sum = 0
  for (const char of run) {
    const addend = factor * ALPHABET.indexOf(char)
    factor = factor === 1 ? 2 : 1
    sum += Math.floor(addend / ALPHABET.length) + (addend % ALPHABET.length)
  }
  return ALPHABET[(ALPHABET.length - (sum % ALPHABET.length)) % ALPHABET.length] as string
}

/**
 * Validate one device id read from a Syncthing response or a peer frame.
 * @param value - the candidate.
 * @returns the branded id, or undefined unless the value is a canonical id
 * whose four check characters match and whose padding bits are zero.
 */
export function parseSyncthingDeviceId(value: unknown): SyncthingDeviceId | undefined {
  if (typeof value !== 'string' || !CANONICAL_PATTERN.test(value)) return undefined
  const raw = value.replaceAll('-', '')
  for (let start = 0; start < raw.length; start += DATA_RUN + 1) {
    if (luhn32(raw.slice(start, start + DATA_RUN)) !== raw[start + DATA_RUN]) return undefined
  }
  if ((ALPHABET.indexOf(raw[LAST_DATA_INDEX] as string) & PADDING_BITS) !== 0) return undefined
  return brandString<SyncthingDeviceId>(value)
}
