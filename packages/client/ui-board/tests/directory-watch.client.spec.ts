// @vitest-environment jsdom
/**
 * Directory observation of the right panel's files tab over a scripted Remote:
 * frames reach `changed`, only the host stream's end reaches `failed` (logged
 * with the host error), a throwing listener is reported without ending the
 * observation, and nothing reaches the listener after stop.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import {
  observeWorkspaceDirectory, type DirectoryWatchRemote, type DirectoryWatchStreamOptions,
} from '../src/client/directory-watch.ts'
import type { BoardDirectoryWatchListener } from '../src/client/contract/slots.ts'
import { benchRemoteStream, createWatchDouble } from './fixtures.client.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

const SESSION = 'session-1' as SessionId

/** Observe `/work` over the bench supervisor, recording the end classification. */
function observe(listener: Partial<BoardDirectoryWatchListener> = {}) {
  const watches = createWatchDouble()
  const endedWith: boolean[] = []
  const remote: DirectoryWatchRemote = {
    $stream: <Item>(options: DirectoryWatchStreamOptions<Item>) => benchRemoteStream<Item>({
      open: options.open,
      ended: (accepted) => {
        endedWith.push(accepted)
        return options.ended(accepted)
      },
    }),
    workspaceFiles: { changes: watches.changes },
  }
  const changed = vi.fn(listener.changed ?? (() => {}))
  const failed = vi.fn(listener.failed ?? (() => {}))
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const stop = observeWorkspaceDirectory(remote, SESSION, '/work', { changed, failed })
  return { watches, endedWith, changed, failed, warn, error, stop }
}

describe('observeWorkspaceDirectory', () => {
  it('hears the opening frame and every change of the requested directory', async () => {
    const h = observe()
    expect(h.watches.opened.map(watch => [watch.sessionId, watch.path])).toEqual([[SESSION, '/work']])
    const watch = h.watches.of('/work')
    watch.push({ kind: 'ready' })
    await vi.waitFor(() => { expect(h.changed).toHaveBeenCalledTimes(1) })
    watch.push({ kind: 'change', change: { absolutePath: '/work/a.txt', version: 'v1' } })
    await vi.waitFor(() => { expect(h.changed).toHaveBeenCalledTimes(2) })
    expect(h.failed).not.toHaveBeenCalled()
    await h.stop()
  })

  it('reports a host failure once, with the host error logged', async () => {
    const h = observe()
    const refusal = new RemoteError('workspace-file/watch-unsupported', 'no watcher', { path: '/work' })
    h.watches.of('/work').fail(refusal)
    await vi.waitFor(() => { expect(h.failed).toHaveBeenCalledTimes(1) })
    expect(h.changed).not.toHaveBeenCalled()
    expect(h.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('/work'), refusal)
    await h.stop()
    expect(h.failed).toHaveBeenCalledTimes(1)
  })

  it('reports a normal end of the host stream as a failure after the accepted opening frame', async () => {
    const h = observe()
    const watch = h.watches.of('/work')
    watch.push({ kind: 'ready' })
    watch.end()
    await vi.waitFor(() => { expect(h.failed).toHaveBeenCalledTimes(1) })
    expect(h.endedWith).toEqual([true])
    expect(h.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('/work'), expect.any(Error))
    await h.stop()
  })

  it('reports a throwing listener without calling it a host failure, and keeps observing', async () => {
    const defect = new Error('panel defect')
    const h = observe({ changed: () => { throw defect } })
    const watch = h.watches.of('/work')
    watch.push({ kind: 'ready' })
    await vi.waitFor(() => { expect(h.error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('/work'), defect) })
    watch.push({ kind: 'change', change: { absolutePath: '/work/a.txt', version: 'v1' } })
    await vi.waitFor(() => { expect(h.changed).toHaveBeenCalledTimes(2) })
    expect(h.failed).not.toHaveBeenCalled()
    expect(h.warn).not.toHaveBeenCalled()
    await h.stop()
  })

  it('lets no frame and no failure in transit reach the listener after stop', async () => {
    const late = observe()
    const watch = late.watches.of('/work')
    // Both were sent before stop and are delivered after it.
    watch.push({ kind: 'change', change: { absolutePath: '/work/a.txt', version: 'v1' } })
    await late.stop()
    expect(watch.signal.aborted).toBe(true)
    expect(watch.delivered()).toBe(1)
    expect(watch.closed()).toBe(true)
    expect(late.changed).not.toHaveBeenCalled()

    const failing = observe()
    const failingWatch = failing.watches.of('/work')
    failingWatch.fail(new RemoteError('workspace-file/not-found', 'gone', { path: '/work' }))
    await failing.stop()
    expect(failingWatch.closed()).toBe(true)
    expect(failing.failed).not.toHaveBeenCalled()
    expect(failing.warn).not.toHaveBeenCalled()
  })
})
