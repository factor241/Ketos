// The invitation code: base32 encoding, secret minting, and the parse rules
// that refuse anything this build did not mint.
import { describe, expect, it } from 'vitest'
import {
  INVITE_MAX_FAILED_ATTEMPTS, INVITE_SECRET_BYTES, INVITE_SECRET_LENGTH, encodeBase32, formatInvite,
  inviteSecretMatches, mintInviteSecret, parseInvite,
} from '../src/invite.ts'

describe('base32 encoding', () => {
  it('matches RFC 4648 vectors', () => {
    expect(encodeBase32(new Uint8Array([]))).toBe('')
    expect(encodeBase32(new TextEncoder().encode('f'))).toBe('my')
    expect(encodeBase32(new TextEncoder().encode('fo'))).toBe('mzxq')
    expect(encodeBase32(new TextEncoder().encode('foo'))).toBe('mzxw6')
    expect(encodeBase32(new TextEncoder().encode('foobar'))).toBe('mzxw6ytboi')
  })

  it('mints 16 random bytes encoded to 26 characters', () => {
    const secret = mintInviteSecret()
    expect(secret.byteLength).toBe(INVITE_SECRET_BYTES)
    expect(encodeBase32(secret)).toHaveLength(INVITE_SECRET_LENGTH)
    expect(encodeBase32(mintInviteSecret())).not.toBe(encodeBase32(secret))
  })
})

describe('invitation parsing', () => {
  it('round-trips a formatted code', () => {
    const code = formatInvite('endpointabc123', 'abcdefghijklmnopqrstuvwxyz')
    expect(parseInvite(code)).toEqual({ ticket: 'endpointabc123', secret: 'abcdefghijklmnopqrstuvwxyz' })
  })

  it('keeps a ticket that itself carries dots', () => {
    const code = formatInvite('endpoint.a.b', 'abcdefghijklmnopqrstuvwxyz')
    expect(parseInvite(code)).toEqual({ ticket: 'endpoint.a.b', secret: 'abcdefghijklmnopqrstuvwxyz' })
  })

  it('refuses malformed codes', () => {
    const good = formatInvite('ticket', 'abcdefghijklmnopqrstuvwxyz')
    const cases: string[] = [
      '',
      'ketos1.ticket',
      'ketos2.ticket.abcdefghijklmnopqrstuvwxyz',
      'ketos1..abcdefghijklmnopqrstuvwxyz',
      'ketos1.ticket.short',
      'ketos1.ticket.abcdefghijklmnopqrstuvwxy1',
      'ketos1.ticket.ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      `${good}.extra`,
    ]
    for (const code of cases) expect(parseInvite(code)).toBeUndefined()
    expect(parseInvite('x'.repeat(600))).toBeUndefined()
  })
})

describe('secret comparison', () => {
  const secret = 'abcdefghijklmnopqrstuvwxyz'

  it('accepts only the exact secret', () => {
    expect(inviteSecretMatches(secret, secret)).toBe(true)
    expect(inviteSecretMatches('abcdefghijklmnopqrstuvwxy2', secret)).toBe(false)
  })

  it('refuses a secret of another length without throwing', () => {
    expect(inviteSecretMatches('abc', secret)).toBe(false)
    expect(inviteSecretMatches(`${secret}a`, secret)).toBe(false)
  })

  it('counts five wrong secrets before an invitation burns', () => {
    expect(INVITE_MAX_FAILED_ATTEMPTS).toBe(5)
  })
})
