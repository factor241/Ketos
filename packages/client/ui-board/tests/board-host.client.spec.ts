/** Board host half: the durable layout namespace registers, validates, and disposes with its fiber. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { BoardLayoutDocument } from '../src/board-settings.ts'
import { BOARD_SETTINGS_NAMESPACE, BOARD_SETTINGS_VERSION } from '../src/board-settings.ts'
import { apply } from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

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
    panelWindowId: null,
    panelCollapsed: true,
    panelWidth: 300,
    panelGroupBy: 'workspace',
    panelOrderBy: 'updated',
    ...overrides,
  }
}

describe('ui-board host half', () => {
  it('registers the durable layout namespace, validates writes, and disposes with its fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()

    expect(ctx.settings.describe().map(row => row.ns)).toContain(BOARD_SETTINGS_NAMESPACE)
    expect(ctx.settings.get(BOARD_SETTINGS_NAMESPACE)).toMatchObject({
      version: BOARD_SETTINGS_VERSION,
      panX: 0,
      zoom: 1,
      windows: [],
      bindings: {},
    })

    await ctx.settings.update(BOARD_SETTINGS_NAMESPACE, layout())
    expect(ctx.settings.get(BOARD_SETTINGS_NAMESPACE)).toMatchObject({ panX: 24, zoom: 1.25 })
    expect((ctx.settings.get(BOARD_SETTINGS_NAMESPACE) as BoardLayoutDocument).windows).toHaveLength(1)

    // The bridge's map and the board's layout writes share one section: a
    // layout update merges and must leave the bindings the bridge wrote.
    await ctx.settings.update(BOARD_SETTINGS_NAMESPACE, { bindings: { 'agent-1': 'session-1' } })
    await ctx.settings.update(BOARD_SETTINGS_NAMESPACE, layout({ panX: 48 }))
    expect(ctx.settings.get(BOARD_SETTINGS_NAMESPACE)).toMatchObject({
      panX: 48,
      bindings: { 'agent-1': 'session-1' },
    })
    await expect(ctx.settings.update(BOARD_SETTINGS_NAMESPACE, { bindings: { 'agent-1': 7 } })).rejects.toThrow()

    await expect(ctx.settings.update(BOARD_SETTINGS_NAMESPACE, { zoom: 5 })).rejects.toThrow()
    await expect(ctx.settings.update(BOARD_SETTINGS_NAMESPACE, { version: 2 })).rejects.toThrow()
    await expect(ctx.settings.update(BOARD_SETTINGS_NAMESPACE, {
      windows: [window({ bodyKind: 'not-a-kind' })],
    })).rejects.toThrow()

    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(BOARD_SETTINGS_NAMESPACE)
  })

  it('registers nothing without a settings provider', async () => {
    const ctx = new Context()
    await ctx.plugin({ apply }).await()
    expect(ctx.get('settings')).toBeUndefined()
  })
})
