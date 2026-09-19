/** Layout document capture and repair: broken documents never reach the store. */
import { describe, expect, it } from 'vitest'
import {
  BOARD_LAYOUT_COORD_LIMIT, BOARD_LAYOUT_MAX_WINDOWS, BOARD_SETTINGS_VERSION, BOARD_ZOOM_MAX, BOARD_ZOOM_MIN,
} from '../src/board-settings.ts'
import { captureBoardLayout, sanitizeBoardLayout } from '../src/client/board-layout.ts'
import { createBoardStore, MIN_WINDOW_SIZE, WINDOW_Z_BASE } from '../src/client/store.ts'
import type { BoardLayoutWindow } from '../src/board-settings.ts'
import type { WindowId } from '../src/client/contract/slots.ts'

/** One wire window, overridable field by field. */
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
    zIndex: WINDOW_Z_BASE,
    ...overrides,
  }
}

/** One wire document, overridable field by field. */
function document(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: BOARD_SETTINGS_VERSION,
    panX: 12,
    panY: -34,
    zoom: 1.5,
    windows: [window()],
    windowOrder: ['agent-1'],
    activeWindowId: 'agent-1',
    panelWindowId: '',
    panelCollapsed: true,
    panelWidth: 300,
    panelGroupBy: 'workspace',
    panelOrderBy: 'updated',
    ...overrides,
  }
}

/** The window record of a sanitized document, failing when it was dropped. */
function firstWindow(layout: ReturnType<typeof sanitizeBoardLayout>): BoardLayoutWindow {
  const found = layout?.windows[0]
  if (found === undefined) throw new Error('the layout has no first window')
  return found
}

describe('captureBoardLayout', () => {
  it('captures pan, zoom, windows in order, and the panel fields', () => {
    const instance = createBoardStore().create()
    instance.actions.addWindow({
      id: 'agent-1' as WindowId,
      kind: 'agent',
      bodyKind: 'conversation',
      ordinal: 1,
      x: 10,
      y: 20,
      width: 552,
      height: 648,
      zIndex: WINDOW_Z_BASE,
    })
    instance.actions.setZoom(1.5)
    instance.actions.setPan(7, 8)
    instance.actions.openWindowPanel('agent-1' as WindowId)
    instance.actions.setPanelWidth(330)

    const layout = captureBoardLayout(instance.getSnapshot())
    expect(layout).toMatchObject({
      version: 1,
      panX: 7,
      panY: 8,
      zoom: 1.5,
      windowOrder: ['agent-1'],
      activeWindowId: 'agent-1',
      panelWindowId: 'agent-1',
      panelCollapsed: false,
      panelWidth: 330,
      panelGroupBy: 'workspace',
      panelOrderBy: 'updated',
    })
    expect(layout.windows).toHaveLength(1)
    expect(layout.windows[0]).toMatchObject({ id: 'agent-1', kind: 'agent', ordinal: 1 })
  })

  it('captures a custom title only while one is set', () => {
    const instance = createBoardStore().create()
    instance.actions.addWindow({
      id: 'agent-1' as WindowId,
      kind: 'agent',
      bodyKind: 'conversation',
      ordinal: 1,
      x: 0,
      y: 0,
      width: 552,
      height: 648,
      zIndex: WINDOW_Z_BASE,
    })
    expect(captureBoardLayout(instance.getSnapshot()).windows[0]).not.toHaveProperty('customTitle')
    instance.actions.setWindowCustomTitle('agent-1' as WindowId, 'Research')
    expect(captureBoardLayout(instance.getSnapshot()).windows[0]).toMatchObject({ customTitle: 'Research' })
  })
})

describe('sanitizeBoardLayout', () => {
  it('adopts a complete document unchanged', () => {
    const layout = sanitizeBoardLayout(document())
    expect(layout).toMatchObject({ panX: 12, panY: -34, zoom: 1.5, activeWindowId: 'agent-1' })
    expect(firstWindow(layout)).toMatchObject({ x: 24, y: 48, width: 552, height: 648 })
  })

  it('ignores a document of another version or a non-document value', () => {
    expect(sanitizeBoardLayout({ ...document(), version: 2 })).toBeUndefined()
    expect(sanitizeBoardLayout(document({ version: undefined }))).toBeUndefined()
    expect(sanitizeBoardLayout('not a document')).toBeUndefined()
    expect(sanitizeBoardLayout(null)).toBeUndefined()
    expect(sanitizeBoardLayout([])).toBeUndefined()
  })

  it('drops a window without an id, unknown kinds, and duplicate identities', () => {
    const layout = sanitizeBoardLayout(document({
      windows: [
        window({ id: '' }),
        window({ id: 'agent-2', kind: 'not-a-kind' }),
        window({ id: 'agent-3', bodyKind: 'not-a-kind' }),
        window({ id: 'agent-4' }),
        window({ id: 'agent-4', x: 999 }),
        'not a window',
      ],
      windowOrder: ['agent-4', 'agent-2'],
    }))
    expect(layout?.windows.map(entry => entry.id)).toEqual(['agent-4'])
    expect(layout?.windows[0]?.x).toBe(24)
    expect(layout?.windowOrder).toEqual(['agent-4'])
  })

  it('repairs negative sizes and non-finite placement', () => {
    const layout = sanitizeBoardLayout(document({
      windows: [window({ width: -700, height: -20, x: Number.NaN, y: 'high', ordinal: 0 })],
    }))
    expect(firstWindow(layout)).toMatchObject({
      width: 700,
      height: MIN_WINDOW_SIZE.height,
      x: 0,
      y: 0,
      ordinal: 1,
    })
  })

  it('bounds placement, zoom, and the panel width, and defaults unknown panel modes', () => {
    const layout = sanitizeBoardLayout(document({
      panX: BOARD_LAYOUT_COORD_LIMIT * 2,
      panY: -BOARD_LAYOUT_COORD_LIMIT * 2,
      zoom: BOARD_ZOOM_MAX * 10,
      windows: [window({ x: BOARD_LAYOUT_COORD_LIMIT * 3, y: -BOARD_LAYOUT_COORD_LIMIT * 3 })],
      panelWindowId: 'agent-1',
      panelCollapsed: false,
      panelWidth: 10_000,
      panelGroupBy: 'bogus',
      panelOrderBy: 'bogus',
    }))
    expect(layout).toMatchObject({
      panX: BOARD_LAYOUT_COORD_LIMIT,
      panY: -BOARD_LAYOUT_COORD_LIMIT,
      zoom: BOARD_ZOOM_MAX,
      panelWidth: 420,
      panelGroupBy: 'workspace',
      panelOrderBy: 'updated',
    })
    expect(firstWindow(layout)).toMatchObject({ x: BOARD_LAYOUT_COORD_LIMIT, y: -BOARD_LAYOUT_COORD_LIMIT })
    expect(sanitizeBoardLayout(document({ zoom: BOARD_ZOOM_MIN / 2 }))?.zoom).toBe(BOARD_ZOOM_MIN)
  })

  it('renormalizes the paint order from windowOrder and drops dangling windows', () => {
    const layout = sanitizeBoardLayout(document({
      windows: [window({ id: 'agent-1' }), window({ id: 'agent-2' }), window({ id: 'agent-3' })],
      windowOrder: ['agent-2', 'ghost', 'agent-3'],
    }))
    expect(layout?.windowOrder).toEqual(['agent-2', 'agent-3', 'agent-1'])
    expect(layout?.windows.map(entry => entry.zIndex)).toEqual([
      WINDOW_Z_BASE, WINDOW_Z_BASE + 1, WINDOW_Z_BASE + 2,
    ])
  })

  it('caps a crowded document at the restore limit, keeping the topmost windows', () => {
    const windows = Array.from({ length: BOARD_LAYOUT_MAX_WINDOWS + 5 }, (_value, index) =>
      window({ id: `agent-${index}` }))
    const windowOrder = windows.map(entry => entry.id)
    const layout = sanitizeBoardLayout(document({ windows, windowOrder }))
    expect(layout?.windows).toHaveLength(BOARD_LAYOUT_MAX_WINDOWS)
    expect(layout?.windowOrder[0]).toBe('agent-5')
    expect(layout?.windows.at(-1)?.zIndex).toBe(WINDOW_Z_BASE + BOARD_LAYOUT_MAX_WINDOWS - 1)
  })

  it('reads a collapsed panel without its window as closed and drops a dangling owner', () => {
    const closed = sanitizeBoardLayout(document({ panelWindowId: '', panelCollapsed: true }))
    expect(closed).toMatchObject({ panelWindowId: '', panelCollapsed: true })

    const dangling = sanitizeBoardLayout(document({ panelWindowId: 'ghost', panelCollapsed: false }))
    expect(dangling).toMatchObject({ panelWindowId: '', panelCollapsed: true })

    const open = sanitizeBoardLayout(document({ panelWindowId: 'agent-1', panelCollapsed: false }))
    expect(open).toMatchObject({ panelWindowId: 'agent-1', panelCollapsed: false })
  })

  it('resolves the active window only while it is in the restored set', () => {
    expect(sanitizeBoardLayout(document({ activeWindowId: 'ghost' }))?.activeWindowId).toBe('')
    expect(sanitizeBoardLayout(document({ activeWindowId: '' }))?.activeWindowId).toBe('')
  })

  it('round-trips a captured layout with twenty windows', () => {
    const instance = createBoardStore().create()
    for (let index = 0; index < 20; index += 1) {
      instance.actions.openWindow({
        id: `agent-${index}` as WindowId,
        kind: 'agent',
        bodyKind: 'conversation',
        ordinal: index + 1,
        width: 552,
        height: 648,
      })
    }
    instance.actions.openWindowPanel('agent-19' as WindowId)
    const captured = captureBoardLayout(instance.getSnapshot())
    const restored = sanitizeBoardLayout(captured)
    // Sanitize resolves the full stored section; the capture is the layout
    // patch and deliberately carries no session bindings.
    expect(restored).toEqual({ ...captured, bindings: {} })
    expect(restored?.windows).toHaveLength(20)

    // The restore path itself: a second store adopts the repaired document
    // with every window, its order, its z-band, and the panel state intact.
    const target = createBoardStore().create()
    if (restored === undefined) throw new Error('the captured layout must sanitize')
    target.actions.hydrate(restored)
    const state = target.getSnapshot()
    expect(Object.keys(state.windows)).toHaveLength(20)
    expect(state.windowOrder).toHaveLength(20)
    expect(state.windowOrder[0]).toBe('agent-0')
    expect(state.windowOrder[19]).toBe('agent-19')
    expect(state.windows['agent-19']?.zIndex).toBe(WINDOW_Z_BASE + 19)
    expect(state.activeWindowId).toBe('agent-19')
    expect(state.panelWindowId).toBe('agent-19')
    expect(state.panelCollapsed).toBe(false)
  })
})

describe('defaultPreset round trip', () => {
  it('captures the store default and repairs a stored value', () => {
    const instance = createBoardStore().create()
    instance.actions.setDefaultPreset('ptc')
    expect(captureBoardLayout(instance.getSnapshot()).defaultPreset).toBe('ptc')

    expect(sanitizeBoardLayout(document({ defaultPreset: '  ptc  ' }))?.defaultPreset).toBe('ptc')
    // A non-string value falls back to the deployment default (empty).
    expect(sanitizeBoardLayout(document({ defaultPreset: 42 }))?.defaultPreset).toBe('')
    expect(sanitizeBoardLayout(document())?.defaultPreset).toBe('')
  })

  it('hydrates the default preset from a stored document', () => {
    const instance = createBoardStore().create()
    const layout = sanitizeBoardLayout(document({ defaultPreset: 'ptc' }))
    if (layout === undefined) throw new Error('document did not sanitize')
    instance.actions.hydrate(layout)
    expect(instance.getSnapshot().defaultPreset).toBe('ptc')
  })
})
