/** Ketos ru language pack, Host half: the no-op plugin the Loader contract requires. */
import { Context } from '@deepseek-ai/cordis'
import { describe, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('ketos ru language pack host half', () => {
  it('mounts and disposes as an ordinary no-op plugin', async () => {
    const ctx = new Context()
    const host = ctx.plugin({ apply })
    await host.await()
    await host.dispose()
  })
})
