// The stable error codes, their HTTP statuses, and the private JSON answers
// every board route shares.
import { describe, expect, it } from 'vitest'
import { fail, ok, statusOf } from '../src/wire.ts'

describe('board wire answers', () => {
  it('maps every stable error code to its HTTP status', () => {
    expect(statusOf('ketos/invalid')).toBe(400)
    expect(statusOf('ketos/element-not-found')).toBe(404)
    expect(statusOf('ketos/element-foreign')).toBe(409)
    expect(statusOf('ketos/element-exists')).toBe(409)
    expect(statusOf('ketos/element-host-data')).toBe(403)
    expect(statusOf('ketos/limit')).toBe(409)
  })

  it('answers JSON with the private no-store header', async () => {
    const success = ok({ a: 1 })
    expect(success.status).toBe(200)
    expect(success.headers.get('cache-control')).toBe('no-store')
    expect(await success.json()).toEqual({ a: 1 })

    const failure = fail('ketos/element-foreign')
    expect(failure.status).toBe(409)
    expect(failure.headers.get('cache-control')).toBe('no-store')
    expect(await failure.json()).toEqual({ ok: false, error: 'ketos/element-foreign' })
  })
})
