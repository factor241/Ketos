// @vitest-environment jsdom
/** Board registration smoke: the plugin owns the `board` main panel and its sidebar panel-list row, and withdraws both on dispose. */
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../src/client/index.ts'

const runtimes = new Set<SlotTestRuntime>()

afterEach(async () => {
  try {
    for (const runtime of runtimes) await runtime.dispose()
  } finally {
    runtimes.clear()
    cleanup()
  }
})

/** Bench with the services the board injects and the two slots it occupies declared. */
async function bench() {
  const runtime = await SlotTestRuntime.create()
  runtimes.add(runtime)
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('en')
  const layout = {
    beginNavigation: vi.fn(() => new AbortController().signal),
    toggleSidebar: vi.fn(),
    selectPanel: vi.fn(),
    openRightbar: vi.fn(),
    closeRightbar: vi.fn(),
  } satisfies ILayout
  await runtime.mount({
    inject: ['slots'],
    apply(ctx: Context) {
      ctx.provide('layout', layout)
      ctx.provide('locale', locale)
      ctx.slots.installLocale(locale)
    },
  })
  await runtime.declare({
    main: { kind: 'keyed', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' },
  })
  return { runtime, locale }
}

describe('board plugin registration', () => {
  it('occupies the board main panel and sidebar panel row, then withdraws both', async () => {
    const { runtime } = await bench()
    const board = await runtime.mount({ inject: [...inject], apply })

    expect(runtime.slots.entries('main').map(entry => entry.options.key)).toEqual(['board'])
    expect(runtime.slots.entries('sidebar.panellist').map(entry => entry.options.id)).toEqual(['board'])

    await board.dispose()

    expect(runtime.slots.entries('main')).toEqual([])
    expect(runtime.slots.entries('sidebar.panellist')).toEqual([])
  })

  it('renders the canvas in the board panel and the panel icon at the owner size', async () => {
    const { runtime } = await bench()
    await runtime.mount({ inject: [...inject], apply })

    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    expect(panel.container.querySelector('[data-surface="canvas"]')).not.toBeNull()

    const row = runtime.renderSlot('sidebar.panellist', { size: 18, active: false })
    const icon = row.container.querySelector('svg')
    expect(icon?.getAttribute('width')).toBe('18')
    expect(icon?.getAttribute('height')).toBe('18')
  })

  it('resolves the panel-row label through the board dictionary and follows the active locale', async () => {
    const { runtime, locale } = await bench()
    await runtime.mount({ inject: [...inject], apply })

    const [row] = runtime.slots.entries('sidebar.panellist')
    expect(resolveSlotLabel(row?.options.label)).toBe('Board')

    act(() => { locale.setLocale('zh') })
    expect(resolveSlotLabel(runtime.slots.entries('sidebar.panellist')[0]?.options.label)).toBe('看板')
  })
})
