// @vitest-environment jsdom
/** Board registration smoke: the plugin occupies the `board` panel and sidebar row and withdraws both on dispose. */
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, waitFor } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
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

/** The element a selector must resolve to; a miss fails at the call site. */
function element(root: ParentNode, selector: string): Element {
  const found = root.querySelector(selector)
  if (found === null) throw new Error(`missing element ${selector}`)
  return found
}

/** The HTML element a selector must resolve to. */
function htmlElement(root: ParentNode, selector: string): HTMLElement {
  const found = element(root, selector)
  if (!(found instanceof HTMLElement)) throw new Error(`element ${selector} is not an HTML element`)
  return found
}

/** Bench with the services the board injects; pass `declareSlots` false to declare the occupied slots after the plugin mounts. */
async function bench(declareSlots = true) {
  const runtime = await SlotTestRuntime.create()
  runtimes.add(runtime)
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('en')
  await runtime.mount({
    inject: ['slots'],
    apply(ctx: Context) {
      ctx.provide('locale', locale)
      ctx.slots.installLocale(locale)
    },
  })
  if (declareSlots) {
    await runtime.declare({
      main: { kind: 'keyed', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
    })
  }
  return { runtime, locale }
}

describe('board plugin registration', () => {
  it('occupies the board panel and sidebar row with its metadata, then withdraws both on dispose', async () => {
    const { runtime } = await bench()
    const board = await runtime.mount({ inject: [...inject], apply })

    expect(runtime.slots.entries('main').map(entry => entry.options.key)).toEqual(['board'])
    expect(runtime.slots.entries('sidebar.panellist').map(entry => entry.options.id)).toEqual(['board'])

    const panelEntry = runtime.slots.entries('main')[0]
    expect(panelEntry?.options.order).toBeUndefined()
    expect(panelEntry?.locale).toBe('board')
    expect(panelEntry?.store).toBeDefined()
    expect(panelEntry?.children).toBeUndefined()
    expect(runtime.slots.entries('sidebar.panellist')[0]?.options.order).toBe(15)

    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const row = runtime.renderSlot('sidebar.panellist', { size: 16, active: false }, { only: 'board' })
    expect(panel.container.querySelector('[data-surface="canvas"]')).not.toBeNull()
    expect(row.container.querySelector('svg')).not.toBeNull()

    await board.dispose()

    expect(runtime.slots.entries('main')).toEqual([])
    expect(runtime.slots.entries('sidebar.panellist')).toEqual([])
    // The declarations belong to the root frame, so they survive the board fiber.
    expect(runtime.slots.spec('main')).toEqual({ kind: 'keyed', scope: 'root' })
    expect(runtime.slots.spec('sidebar.panellist')).toEqual({ kind: 'list', scope: 'root' })
    await waitFor(() => {
      expect(panel.container.querySelector('[data-surface="canvas"]')).toBeNull()
      expect(row.container.querySelector('svg')).toBeNull()
    })
  })

  it('registers once the occupied slots are declared, and drops the entries when the declaration collapses', async () => {
    const { runtime } = await bench(false)
    const board = await runtime.mount({ inject: [...inject], apply })

    expect(runtime.slots.entries('main')).toEqual([])
    expect(runtime.slots.entries('sidebar.panellist')).toEqual([])

    await runtime.declare({
      main: { kind: 'keyed', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
    })
    expect(runtime.slots.entries('main').map(entry => entry.options.key)).toEqual(['board'])
    expect(runtime.slots.entries('sidebar.panellist').map(entry => entry.options.id)).toEqual(['board'])

    runtime.root.release()
    expect(runtime.slots.entries('main')).toEqual([])
    expect(runtime.slots.entries('sidebar.panellist')).toEqual([])
    expect(runtime.slots.spec('main')).toBeUndefined()

    await board.dispose()
  })

  it('renders the panel-sized canvas and the panel icon at the owner size', async () => {
    const { runtime } = await bench()
    await runtime.mount({ inject: [...inject], apply })

    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const surface = htmlElement(panel.container, '[data-surface="canvas"]')
    expect(surface.style.position).toBe('relative')
    expect(surface.style.width).toBe('100%')
    expect(surface.style.height).toBe('100%')
    expect(htmlElement(surface, '[data-surface="canvas"]').style.transform).toContain('scale')

    const row = runtime.renderSlot('sidebar.panellist', { size: 18, active: false }, { only: 'board' })
    const icon = element(row.container, 'svg')
    expect(icon.getAttribute('width')).toBe('18')
    expect(icon.getAttribute('height')).toBe('18')
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
