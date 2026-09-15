// @vitest-environment jsdom
/**
 * The board in the shipped web client: the web-app bundle roster declares the
 * package, the row activates, and the assembled composition registers the board
 * panel and its sidebar row. The unit smoke in `apply.client.spec.tsx` mounts
 * the plugin by hand; this spec boots the roster the launcher composes.
 */
import { describe, expect } from 'vitest'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { createClientTest, webApp, type TestClient } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'

/** Package row the web-app bundle must declare for the panel to reach a browser. */
const BOARD = '@deepseek-ai/dsh-client-ui-board'
const it = createClientTest({ roster: webApp })
/** The whole roster's first boot pays the cold module transform of every plugin package. */
const COLD_BOOT_TIMEOUT_MS = 60_000

/** The board contributions a live roster must hold exactly once, and no more after a reload. */
function boardContributions(client: TestClient) {
  const { slots } = client.ctx
  return {
    panel: slots.entries('main').filter(entry => entry.options.key === 'board').length,
    canvas: slots.entriesOfSlot('board.canvas').length,
    windows: slots.entriesOfSlot('board.windows').length,
    frames: slots.entries('board.window').length,
    bodies: slots.entries('board.window.body').length,
    sidebar: slots.entries('sidebar.panellist').filter(entry => entry.options.id === 'board').length,
  }
}

describe('the board in the shipped web roster', () => {
  it('is declared by the web-app bundle roster', () => {
    // closure() keeps a named row plus everything it injects, and throws on a name outside the roster.
    expect(() => webApp.closure([BOARD])).not.toThrow()
  })

  it('activates the row and occupies the board panel and the sidebar row', async ({ start }) => {
    const client = await start()
    expect(client.ctx.slots.entries('main').map(entry => entry.options.key)).toContain('board')
    expect(client.ctx.slots.entries('sidebar.panellist').map(entry => entry.options.id)).toContain('board')
  }, COLD_BOOT_TIMEOUT_MS)

  it('rebuilds the row through the Loader without duplicating board contributions', async ({ start }) => {
    const client = await start()
    const before = boardContributions(client)
    expect(before).toEqual({ panel: 1, canvas: 1, windows: 1, frames: 6, bodies: 1, sidebar: 1 })

    // client-hmr's real rebuild path: tear the entry fiber down, then refresh the Loader entry.
    await client.reload(BOARD)
    await client.flush()

    expect(boardContributions(client)).toEqual(before)
  }, COLD_BOOT_TIMEOUT_MS)
})
