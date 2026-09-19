import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Hmr from '@deepseek-ai/cordis-plugin-hmr'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** Every per-test tree root, removed once the booted watcher has been disposed. */
const hmrRoots: string[] = []

async function bootHmr(dir: string, root: string[] = [], usePolling?: boolean): Promise<Context> {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(dir).href + '/'
  await ctx.plugin(Loader)
  await ctx.plugin(Timer)
  await ctx.plugin(Hmr, {
    root,
    ignored: [],
    debounce: 0,
    ...usePolling === undefined ? {} : { usePolling },
  })
  return ctx
}

// The coverage lane grants DSH_COVERAGE_TEST_TIMEOUT_MS (90000 ms in CI) as
// its per-test budget, and an explicit case timeout overrides that grant
// rather than yielding to it. Native watcher delivery is this file's
// nondeterministic boundary, so every case takes the lane budget and every
// wait polls the observable watcher signal under a deadline just below it,
// naming the awaited state on failure instead of relying on the case timeout.
const WATCHER_CASE_TIMEOUT_MS = 90_000
const WATCHER_WAIT_TIMEOUT_MS = 80_000

async function eventually(test: () => boolean, message: string, timeoutMs = WATCHER_WAIT_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!test()) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

describe('HMR exact config paths', { timeout: WATCHER_CASE_TIMEOUT_MS }, () => {
  afterEach(() => {
    for (const root of hmrRoots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('observes module changes when its watch base is a filesystem alias', async () => {
    const target = mkdtempSync(join(tmpdir(), 'dsh-hmr-module-canonical-'))
    const alias = `${target}-alias`
    const aliasFilename = join(alias, 'module.ts')
    symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
    writeFileSync(aliasFilename, 'export const generation = 0\n')
    // This acceptance owns alias-to-cache identity. Other cases below exercise
    // native events; polling keeps Windows fs.watch queue pressure out of it.
    const ctx = await bootHmr(alias, ['.'], true)
    const filename = join(await realpath(target), 'module.ts')
    const expected = pathToFileURL(filename).href
    const cacheHas = vi.spyOn(ctx.loader.internal!.loadCache, 'has').mockReturnValue(false)
    const observed: string[] = []
    ctx.on('hmr/change', (url) => { observed.push(url) })
    try {
      const deadline = Date.now() + WATCHER_WAIT_TIMEOUT_MS
      for (let generation = 1; !observed.includes(expected); generation += 1) {
        if (Date.now() >= deadline) {
          throw new Error(`HMR did not observe ${expected} through the alias; observed ${JSON.stringify(observed)}`)
        }
        // The watch base, not the writer spelling, is the alias under test.
        // Grow the file on every write: polling must not depend on timestamp
        // precision when several generations land inside one filesystem tick.
        writeFileSync(filename, `export const generation = ${generation}\n${' '.repeat(generation)}\n`)
        // Leave Chokidar's atomic-write window idle so one coalesced change can publish.
        await new Promise(resolve => setTimeout(resolve, 250))
      }
      expect(cacheHas).toHaveBeenCalledWith(expected)
    } finally {
      await ctx.fiber.dispose()
      unlinkSync(alias)
      rmSync(target, { recursive: true, force: true })
    }
  })

  it('collapses filesystem aliases before registering an exact watch', async () => {
    const target = mkdtempSync(join(tmpdir(), 'dsh-hmr-canonical-'))
    const alias = `${target}-alias`
    symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const ctx = await bootHmr(alias)
    try {
      await ctx.hmr.registerConfig('plugins.yml', () => {})
      await expect(ctx.hmr.registerConfig(join(await realpath(target), 'plugins.yml'), () => {}))
        .rejects.toThrow('config path already registered')
    } finally {
      await ctx.fiber.dispose()
      unlinkSync(alias)
      rmSync(target, { recursive: true, force: true })
    }
  })

  it('observes add, change, and unlink outside its module roots', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-hmr-config-'))
    hmrRoots.push(dir)
    const filename = join(dir, 'plugins.yml')
    const ctx = await bootHmr(dir)
    const observed: string[] = []
    try {
      await ctx.hmr.registerConfig(filename, () => {
        try {
          observed.push(readFileSync(filename, 'utf8'))
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          observed.push('missing')
        }
      })

      writeFileSync(filename, 'one', { flag: 'wx' })
      await eventually(() => observed.includes('one'), 'HMR did not observe config creation')
      writeFileSync(filename, 'two')
      await eventually(() => observed.includes('two'), 'HMR did not observe config change')
      unlinkSync(filename)
      await eventually(() => observed.includes('missing'), 'HMR did not observe config removal')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('observes creation when the config parent did not exist at registration', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-hmr-config-'))
    hmrRoots.push(root)
    const dir = join(root, 'later')
    const filename = join(dir, 'plugins.yml')
    // The watch is restored onto the deepest existing ancestor. Under
    // forked-worker load a native event for a file written immediately after
    // its directory appears can be lost before Chokidar adopts that directory,
    // and no deadline recovers it; polling keeps this case about the restored
    // watch root while the other cases keep native delivery covered.
    const ctx = await bootHmr(root, [], true)
    const observed: string[] = []
    try {
      await ctx.hmr.registerConfig(filename, () => {
        observed.push(readFileSync(filename, 'utf8'))
      })
      mkdirSync(dir)
      writeFileSync(filename, 'created')
      await eventually(() => observed.includes('created'), 'HMR did not observe config creation under a new parent')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('serializes refreshes and waits for them during disposal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-hmr-config-'))
    hmrRoots.push(dir)
    const filename = join(dir, 'plugins.yml')
    writeFileSync(filename, 'one')
    const ctx = await bootHmr(dir)
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const observed: string[] = []
    let active = 0
    let maxActive = 0
    try {
      const dispose = await ctx.hmr.registerConfig(filename, async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        observed.push(readFileSync(filename, 'utf8'))
        if (observed.length === 1) {
          started.resolve(undefined)
          await release.promise
        }
        active -= 1
      })
      await started.promise
      writeFileSync(filename, 'two')
      // Chokidar coalesces atomic writes for 100 ms by default. Wait beyond
      // that window so this edit is queued before registration disposal.
      await new Promise(resolve => setTimeout(resolve, 250))

      let disposed = false
      const disposal = dispose().then(() => { disposed = true })
      await Promise.resolve()
      expect(disposed).toBe(false)
      release.resolve(undefined)
      await disposal
      expect(maxActive).toBe(1)
      expect(observed).toEqual(['one', 'two'])
    } finally {
      release.resolve(undefined)
      await ctx.fiber.dispose()
    }
  })

  it('normalizes refresh failures and broadcasts them without escaping the watcher', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-hmr-config-'))
    hmrRoots.push(dir)
    const filename = join(dir, 'plugins.yml')
    // This case asserts failure normalization, not native event latency: a
    // single-shot native write can lose its watcher event under forked-worker
    // load (reproduced in the stage-11 verification with the 80 s deadline),
    // while polling makes the delivery itself deterministic. The remaining
    // cases keep native delivery covered.
    const ctx = await bootHmr(dir, [], true)
    let observedFailure: { filename: string; error: Error } | undefined
    let failureCount = 0
    try {
      ctx.on('hmr/config-update-failed', () => {
        throw new Error('observer failed')
      })
      ctx.on('hmr/config-update-failed', (failedFilename, error) => {
        failureCount += 1
        observedFailure = { filename: failedFilename, error }
      })
      await ctx.hmr.registerConfig(filename, () => { throw 42 })
      writeFileSync(filename, 'invalid')

      await eventually(() => observedFailure !== undefined, 'HMR did not broadcast the first refresh failure')
      const observed = observedFailure!
      expect(observed.filename).toBe(filename)
      expect(observed.error).toBeInstanceOf(Error)
      expect(observed.error.message).toBe('42')

      // Let Chokidar's atomic-write window close before requiring a distinct
      // second notification from the same path.
      await new Promise(resolve => setTimeout(resolve, 250))
      writeFileSync(filename, 'invalid again')
      await eventually(() => failureCount === 2, 'HMR stopped broadcasting after an observer rejected')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
