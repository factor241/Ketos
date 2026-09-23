// @vitest-environment jsdom
/** Board registration smoke: the plugin occupies the `board` panel and sidebar row and withdraws both on dispose. */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, waitFor } from '@testing-library/react'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import canvasCss from '../src/client/canvas/DashboardCanvas.module.css'
import { createBoardBench } from './fixtures.client.ts'
import { inject } from '../src/client/index.ts'

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

/** Resolve a CSS Module class; a class the stylesheet must define fails loudly at the call site. */
function classOf(classes: Record<string, string>, name: string): string {
  const found = classes[name]
  if (found === undefined) throw new Error(`class ${name} missing from the stylesheet`)
  return found
}

/** Bench with the services the board injects; pass `declareSlots` false to declare the occupied slots after the plugin mounts. */
async function bench(declareSlots = true) {
  const prepared = await createBoardBench({ declareSlots })
  runtimes.add(prepared.runtime)
  return prepared
}

describe('board plugin registration', () => {
  it('occupies the board panel and sidebar row with its metadata, then withdraws both on dispose', async () => {
    const { runtime, mountBoard } = await bench()
    const board = await mountBoard()

    expect(runtime.slots.entries('main').map(entry => entry.options.key)).toEqual(['board'])
    expect(runtime.slots.entries('sidebar.panellist').map(entry => entry.options.id)).toEqual(['board'])

    const panelEntry = runtime.slots.entries('main')[0]
    expect(panelEntry?.options.order).toBeUndefined()
    expect(panelEntry?.locale).toBe('board')
    expect(panelEntry?.store).toBeDefined()
    expect(Object.keys(panelEntry?.children ?? {})).toEqual([
      'board.canvas', 'board.dock', 'board.omnibar', 'board.minimap',
    ])
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
    // The board's own declarations collapse with the panel entry that made them.
    expect(runtime.slots.spec('board.canvas')).toBeUndefined()
    expect(runtime.slots.spec('board.windows')).toBeUndefined()
    expect(runtime.slots.spec('board.window')).toBeUndefined()
    expect(runtime.slots.spec('board.window.body')).toBeUndefined()
    expect(runtime.slots.entries('board.window')).toEqual([])
    await waitFor(() => {
      expect(panel.container.querySelector('[data-surface="canvas"]')).toBeNull()
      expect(row.container.querySelector('svg')).toBeNull()
    })
  })

  it('registers once the occupied slots are declared, and drops the entries when the declaration collapses', async () => {
    const prepared = await bench(false)
    const { runtime } = prepared
    const board = await prepared.mountBoard()

    expect(runtime.slots.entries('main')).toEqual([])
    expect(runtime.slots.entries('sidebar.panellist')).toEqual([])

    await runtime.declare({
      main: { kind: 'keyed', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
    })
    expect(runtime.slots.entries('main').map(entry => entry.options.key)).toEqual(['board'])
    expect(runtime.slots.entries('sidebar.panellist').map(entry => entry.options.id)).toEqual(['board'])
    // The deferred path registers the whole cascade, not only the panel entry.
    expect(runtime.slots.entriesOfSlot('board.canvas')).toHaveLength(1)
    expect(runtime.slots.entriesOfSlot('board.windows')).toHaveLength(1)
    expect(runtime.slots.entries('board.window')).toHaveLength(6)
    expect(runtime.slots.entries('board.window.body')).toHaveLength(4)

    runtime.root.release()
    expect(runtime.slots.entries('main')).toEqual([])
    expect(runtime.slots.entries('sidebar.panellist')).toEqual([])
    expect(runtime.slots.spec('main')).toBeUndefined()

    await board.dispose()
  })

  it('renders the panel-sized canvas and the panel icon at the owner size', async () => {
    const { runtime, mountBoard } = await bench()
    await mountBoard()

    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    // The board root frames the floating layers; the canvas occupant fills it.
    const surface = htmlElement(panel.container, '[data-surface="canvas"]')
    expect(surface.classList.contains(classOf(canvasCss, 'canvas'))).toBe(true)
    expect(htmlElement(surface, '[data-surface="canvas-layer"]').classList.contains(classOf(canvasCss, 'surface'))).toBe(true)
    expect(surface.style.getPropertyValue('--board-zoom')).toBe('1')

    const row = runtime.renderSlot('sidebar.panellist', { size: 18, active: false }, { only: 'board' })
    const icon = element(row.container, 'svg')
    expect(icon.getAttribute('width')).toBe('18')
    expect(icon.getAttribute('height')).toBe('18')
  })

  it('restores each stored window session from the adopted settings section', async () => {
    const prepared = await createBoardBench({
      session: { prompt: () => Promise.resolve({ ok: true, value: { accepted: true } }) },
      extraSessions: [{ id: 'session-2', displayTitle: 'Second chat' }],
      settingsView: {
        writable: true,
        hasDocument: true,
        namespaces: [{
          ns: 'ui-board',
          schema: {},
          value: {},
          applies: 'live',
          secrets: [],
          revision: 3,
          user: {
            version: 1,
            panX: 0,
            panY: 0,
            zoom: 1,
            bindings: { 'agent-1': 'session-1', 'agent-2': 'session-2' },
            windows: [
              { id: 'agent-1', kind: 'agent', bodyKind: 'conversation', ordinal: 1, x: 24, y: 24, width: 552, height: 648, zIndex: 10 },
              { id: 'agent-2', kind: 'agent', bodyKind: 'conversation', ordinal: 2, x: 624, y: 24, width: 552, height: 648, zIndex: 11 },
            ],
            windowOrder: ['agent-1', 'agent-2'],
            activeWindowId: 'agent-1',
            panelWindowId: '',
            panelCollapsed: true,
            panelWidth: 300,
            panelGroupBy: 'workspace',
            panelOrderBy: 'updated',
          },
        }],
      },
    })
    runtimes.add(prepared.runtime)

    await prepared.mountBoard()
    await prepared.runtime.flush()

    // Both restored windows reached their sessions before any window mounted.
    expect(prepared.runtime.sessions.calls
      .filter(call => call.method === 'open')
      .map(call => call.args[0])).toEqual(['session-1', 'session-2'])
  })

  it('resolves the panel-row label through the board dictionary and follows the active locale', async () => {
    const { runtime, locale, mountBoard } = await bench()
    await mountBoard()

    const [row] = runtime.slots.entries('sidebar.panellist')
    expect(resolveSlotLabel(row?.options.label)).toBe('Board')

    act(() => { locale.setLocale('zh') })
    expect(resolveSlotLabel(runtime.slots.entries('sidebar.panellist')[0]?.options.label)).toBe('看板')
  })
})

describe('board apply services', () => {
  it('declares the session remote namespace the model directory reads through', () => {
    // ui-model-selection resolves the host model catalog through the caller's
    // context: without this declaration the window's model directory fails and
    // the chip stays empty (the defect stage 10 recorded and stage 11 fixed).
    expect(inject).toContain('remote.session')
  })
})
