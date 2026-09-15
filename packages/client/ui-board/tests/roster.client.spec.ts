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
import { createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'

/** Package row the web-app bundle must declare for the panel to reach a browser. */
const BOARD = '@deepseek-ai/dsh-client-ui-board'
const it = createClientTest({ roster: webApp })
/** The whole roster's first boot pays the cold module transform of every plugin package. */
const COLD_BOOT_TIMEOUT_MS = 60_000

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
})
