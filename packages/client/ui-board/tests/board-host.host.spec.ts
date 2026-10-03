/** Board host half: the durable layout is the plugin entry's live configuration. */
import { describe, expect, it } from 'vitest'
import type { BoardSettings } from '../src/board-settings.ts'
import { BOARD_SETTINGS_VERSION } from '../src/board-settings.ts'
import { Config, apply } from '../src/index.ts'

/** One valid stored window. */
function window(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'agent-1',
    kind: 'agent',
    bodyKind: 'conversation',
    ordinal: 1,
    x: 24,
    y: 48,
    width: 552,
    height: 648,
    zIndex: 10,
    ...overrides,
  }
}

/** One valid stored document. */
function layout(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: BOARD_SETTINGS_VERSION,
    panX: 24,
    panY: -12,
    zoom: 1.25,
    windows: [window()],
    windowOrder: ['agent-1'],
    activeWindowId: 'agent-1',
    panelGroupBy: 'workspace',
    panelOrderBy: 'updated',
    ...overrides,
  }
}

describe('ui-board host half', () => {
  it('exposes the layout as a live configurable entry: writes merge, replace drops, invalid values reject', async () => {
    const { configurationFixture } = await import('../../../settings/settings/tests/configuration-fixture.ts')
    const { ctx } = await configurationFixture({ schema: Config, apply })
    const read = (): BoardSettings =>
      ctx.settings.describe().find(row => row.ns === 'first')!.value as BoardSettings

    expect(read()).toMatchObject({
      version: BOARD_SETTINGS_VERSION,
      panX: 0,
      zoom: 1,
      windows: [],
      bindings: {},
    })

    await ctx.settings.update('first', layout())
    expect(read()).toMatchObject({ panX: 24, zoom: 1.25 })
    expect(read().windows).toHaveLength(1)

    // The bridge's map and the board's layout writes share one section: a
    // layout update merges and must leave the bindings the bridge wrote.
    await ctx.settings.update('first', { bindings: { 'agent-1': 'session-1' } })
    await ctx.settings.update('first', layout({ panX: 48 }))
    expect(read()).toMatchObject({ panX: 48, bindings: { 'agent-1': 'session-1' } })

    // The board writes the complete section with `replace`, because only a
    // wholesale write can drop a pair whose window closed: `update` deep-merges
    // and would keep every bindings key the section ever held.
    await ctx.settings.replace('first', {
      ...layout(),
      bindings: { 'agent-1': 'session-1', 'agent-2': 'session-2' },
    })
    await ctx.settings.replace('first', { ...layout(), bindings: {} })
    expect(read().bindings).toEqual({})

    await expect(ctx.settings.update('first', { zoom: 5 })).rejects.toThrow()
    await expect(ctx.settings.update('first', { version: 2 })).rejects.toThrow()
    await expect(ctx.settings.update('first', {
      windows: [window({ bodyKind: 'not-a-kind' })],
    })).rejects.toThrow()
    await expect(ctx.settings.update('first', { bindings: { 'agent-1': 7 } })).rejects.toThrow()
  })

  it('runs without a settings service: the optional injection stays inactive', async () => {
    const { Context } = await import('@deepseek-ai/cordis')
    const ctx = new Context()
    const fiber = ctx.plugin({ apply, Config })
    await fiber.await()
    expect(ctx.get('settings')).toBeUndefined()
    await fiber.dispose()
  })
})
