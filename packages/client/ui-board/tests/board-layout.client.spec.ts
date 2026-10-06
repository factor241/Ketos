/** Layout document capture and repair: broken documents never reach the store. */
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  BOARD_ACCESS_MAX_PEOPLE, BOARD_LAYOUT_COORD_LIMIT, BOARD_LAYOUT_MAX_WINDOWS, BOARD_SETTINGS_VERSION,
  BOARD_ZOOM_MAX, BOARD_ZOOM_MIN,
} from '../src/board-settings.ts'
import { captureBoardLayout, sanitizeBoardLayout } from '../src/client/board-layout.ts'
import { createBoardStore, MIN_WINDOW_SIZE, WINDOW_Z_BASE } from '../src/client/store.ts'
import type { BoardLayoutWindow } from '../src/board-settings.ts'
import { DEMO_SELF_ID, type OwnerId } from '../src/client/owners.ts'
import type { CloneId } from '@ketos/clone-core/types'
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
  it('captures pan, zoom, windows in order, and the list view fields', () => {
    const instance = createBoardStore().create()
    instance.actions.addWindow({
      id: 'agent-1' as WindowId,
      kind: 'agent',
      bodyKind: 'conversation',
      ordinal: 1,
      ownerId: DEMO_SELF_ID,
      access: { mode: 'owner', people: [] },
      x: 10,
      y: 20,
      width: 552,
      height: 648,
      zIndex: WINDOW_Z_BASE,
    })
    instance.actions.setZoom(1.5)
    instance.actions.setPan(7, 8)

    const layout = captureBoardLayout(instance.getSnapshot())
    expect(layout).toMatchObject({
      version: 1,
      panX: 7,
      panY: 8,
      zoom: 1.5,
      windowOrder: ['agent-1'],
      activeWindowId: 'agent-1',
      panelGroupBy: 'workspace',
      panelOrderBy: 'updated',
    })
    // The removed global panel's fields are never captured again; the schema
    // still accepts them from old documents (see sanitizeBoardLayout).
    expect(layout).not.toHaveProperty('panelWindowId')
    expect(layout).not.toHaveProperty('panelCollapsed')
    expect(layout).not.toHaveProperty('panelWidth')
    expect(layout.windows).toHaveLength(1)
    expect(layout.windows[0]).toMatchObject({ id: 'agent-1', kind: 'agent', ordinal: 1 })
  })

  it('captures the clone a clone window edits and restores it branded', () => {
    const instance = createBoardStore().create()
    instance.actions.openWindow({
      id: 'clone-1' as WindowId,
      kind: 'clone',
      bodyKind: 'clone',
      cloneId: 'clone-1' as CloneId,
      ordinal: 1,
      width: 648,
      height: 768,
    })
    const captured = captureBoardLayout(instance.getSnapshot()).windows[0]
    expect(captured).toMatchObject({ kind: 'clone', bodyKind: 'clone', cloneId: 'clone-1' })

    const repaired = sanitizeBoardLayout(document({ windows: [captured], windowOrder: ['clone-1'] }))
    instance.actions.hydrate(repaired as ReturnType<typeof sanitizeBoardLayout> & object)
    expect(instance.getSnapshot().windows['clone-1']?.cloneId).toBe('clone-1')
  })

  it('captures a custom title only while one is set', () => {
    const instance = createBoardStore().create()
    instance.actions.addWindow({
      id: 'agent-1' as WindowId,
      kind: 'agent',
      bodyKind: 'conversation',
      ordinal: 1,
      ownerId: DEMO_SELF_ID,
      access: { mode: 'owner', people: [] },
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

  it('keeps a clone id only while it is a non-empty string', () => {
    const kept = sanitizeBoardLayout(document({
      windows: [window({ kind: 'clone', bodyKind: 'clone', cloneId: 'clone-1' })],
    }))
    expect(firstWindow(kept)).toMatchObject({ cloneId: 'clone-1' })
    const dropped = sanitizeBoardLayout(document({
      windows: [window({ kind: 'clone', bodyKind: 'clone', cloneId: '' })],
    }))
    expect(firstWindow(dropped)).not.toHaveProperty('cloneId')
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

  it('captures the dock and clone orders, appending windows the live order misses', () => {
    const instance = createBoardStore().create()
    instance.actions.addWindow({
      id: 'agent-1' as WindowId, kind: 'agent', bodyKind: 'conversation', ordinal: 1,
      ownerId: DEMO_SELF_ID, access: { mode: 'owner', people: [] },
      x: 0, y: 0, width: 552, height: 648, zIndex: WINDOW_Z_BASE,
    })
    instance.actions.addWindow({
      id: 'clone-2' as WindowId, kind: 'clone', bodyKind: 'clone', cloneId: 'clone-b' as CloneId, ordinal: 2,
      ownerId: DEMO_SELF_ID, access: { mode: 'owner', people: [] },
      x: 0, y: 0, width: 648, height: 768, zIndex: WINDOW_Z_BASE,
    })
    instance.actions.addWindow({
      id: 'clone-1' as WindowId, kind: 'clone', bodyKind: 'clone', cloneId: 'clone-a' as CloneId, ordinal: 3,
      ownerId: DEMO_SELF_ID, access: { mode: 'owner', people: [] },
      x: 0, y: 0, width: 648, height: 768, zIndex: WINDOW_Z_BASE,
    })
    // The user put clone-a first; clone-b was never dragged, so it keeps the
    // end of the order it was opened in.
    instance.actions.reorderDock('clone-1' as WindowId, 'agent-1' as WindowId)
    instance.actions.reorderClones('clone-a' as CloneId, null)

    const captured = captureBoardLayout(instance.getSnapshot())
    expect(captured.dockOrder).toEqual(['clone-1', 'agent-1', 'clone-2'])
    expect(captured.cloneOrder).toEqual(['clone-a', 'clone-b'])
  })

  it('fills the orders of an old document from the window ordinals (A6)', () => {
    const layout = sanitizeBoardLayout(document({
      windows: [
        window({ id: 'late', ordinal: 5 }),
        window({ id: 'early', ordinal: 1 }),
      ],
      windowOrder: ['late', 'early'],
    }))
    // The document carries no dock order: the repair appends every window by
    // ordinal, so an old layout restores in its creation order.
    expect(layout?.dockOrder).toEqual(['early', 'late'])
    expect(layout?.cloneOrder).toEqual([])
  })

  it('drops unknown ids from a stored order and appends the missing windows', () => {
    const layout = sanitizeBoardLayout(document({
      windows: [window({ id: 'agent-1', ordinal: 2 }), window({ id: 'agent-2', ordinal: 1 })],
      windowOrder: ['agent-1', 'agent-2'],
      dockOrder: ['ghost', 'agent-1'],
      cloneOrder: ['clone-ghost'],
    }))
    expect(layout?.dockOrder).toEqual(['agent-1', 'agent-2'])
    expect(layout?.cloneOrder).toEqual([])
  })

  it('keeps stored sizes below the old default that still clear the floor', () => {
    const layout = sanitizeBoardLayout(document({
      windows: [window({ width: 480, height: 500 })],
    }))
    expect(firstWindow(layout)).toMatchObject({ width: 480, height: 500 })
  })

  it('bounds placement and zoom, and defaults unknown list modes', () => {
    const layout = sanitizeBoardLayout(document({
      panX: BOARD_LAYOUT_COORD_LIMIT * 2,
      panY: -BOARD_LAYOUT_COORD_LIMIT * 2,
      zoom: BOARD_ZOOM_MAX * 10,
      windows: [window({ x: BOARD_LAYOUT_COORD_LIMIT * 3, y: -BOARD_LAYOUT_COORD_LIMIT * 3 })],
      panelGroupBy: 'bogus',
      panelOrderBy: 'bogus',
    }))
    expect(layout).toMatchObject({
      panX: BOARD_LAYOUT_COORD_LIMIT,
      panY: -BOARD_LAYOUT_COORD_LIMIT,
      zoom: BOARD_ZOOM_MAX,
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

  it('accepts the removed global panel fields without reading them', () => {
    // A version-1 document still carries the fields; the repair ignores the
    // stored values and the schema restores their defaults, so an old document
    // parses while the running board never resurrects the removed panel.
    const stored = sanitizeBoardLayout(document({ panelWindowId: 'agent-1', panelCollapsed: false, panelWidth: 10_000 }))
    expect(stored).toMatchObject({ panelWindowId: '', panelCollapsed: true, panelWidth: 300 })
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
    const captured = captureBoardLayout(instance.getSnapshot())
    const restored = sanitizeBoardLayout(captured)
    // Sanitize resolves the full stored section; the capture is the layout
    // patch and deliberately carries no session bindings.
    expect(restored).toMatchObject({ ...captured, bindings: {} })
    expect(restored?.windows).toHaveLength(20)

    // The restore path itself: a second store adopts the repaired document
    // with every window, its order, and its z-band intact.
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
  })
})

describe('window panel round trip', () => {
  it('captures and repairs the two per-window panel fields (Т3.12)', () => {
    const instance = createBoardStore().create()
    instance.actions.openWindow({
      id: 'agent-1' as never, kind: 'agent', bodyKind: 'conversation', ordinal: 1, width: 552, height: 648,
    })
    instance.actions.setWindowPanel('agent-1' as never, 'left', true)
    instance.actions.setWindowPanel('agent-1' as never, 'right', true)
    instance.actions.setWindowPanelWidth('agent-1' as never, 'left', 300)
    instance.actions.setWindowPanelWidth('agent-1' as never, 'right', 520)
    const captured = captureBoardLayout(instance.getSnapshot()).windows[0]
    expect(captured).toMatchObject({
      leftPanelOpen: true, leftPanelWidth: 300, rightPanelOpen: true, rightPanelWidth: 520,
    })

    // An old document without the fields repairs to the defaults (closed).
    const repaired = firstWindow(sanitizeBoardLayout(document()))
    expect(repaired).toMatchObject({
      leftPanelOpen: false, leftPanelWidth: 260, rightPanelOpen: false, rightPanelWidth: 360,
    })
    // Out-of-range widths clamp into their side's range.
    const clamped = firstWindow(sanitizeBoardLayout(document({
      windows: [{ ...window(), leftPanelOpen: true, leftPanelWidth: 900, rightPanelWidth: 10 }],
    })))
    expect(clamped.leftPanelWidth).toBe(360)
    expect(clamped.rightPanelWidth).toBe(280)
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

describe('window owner and access repair', () => {
  it('reads a window without owner and access as the current participant with owner-only access', () => {
    expect(firstWindow(sanitizeBoardLayout(document()))).toMatchObject({
      ownerId: 'demo-self',
      access: { mode: 'owner', people: [] },
    })
    // The schema default is the empty string, which the repair also resolves.
    expect(firstWindow(sanitizeBoardLayout(document({ windows: [window({ ownerId: '' })] }))).ownerId)
      .toBe('demo-self')
  })

  it('keeps a well-formed owner id the demo roster does not know', () => {
    const repaired = firstWindow(sanitizeBoardLayout(document({ windows: [window({ ownerId: 'real-42' })] })))
    expect(repaired.ownerId).toBe('real-42')
  })

  it('repairs access by format: unknown mode falls back, duplicates and the owner are dropped', () => {
    const repaired = firstWindow(sanitizeBoardLayout(document({
      windows: [window({
        ownerId: 'real-1',
        access: { mode: 'bogus', people: ['real-2', 'real-2', 'real-1', '', 7, 'real-3'] },
      })],
    })))
    expect(repaired.access).toEqual({ mode: 'owner', people: ['real-2', 'real-3'] })
  })

  it('caps the selected people at the access limit', () => {
    const people = Array.from(
      { length: BOARD_ACCESS_MAX_PEOPLE + 1 },
      (_value, index) => `person-${index}`,
    )
    const repaired = firstWindow(sanitizeBoardLayout(document({
      windows: [window({ ownerId: 'real-owner', access: { mode: 'selected', people } })],
    })))
    expect(repaired.access.mode).toBe('selected')
    expect(repaired.access.people).toHaveLength(BOARD_ACCESS_MAX_PEOPLE)
    expect(repaired.access.people.at(-1)).toBe(`person-${BOARD_ACCESS_MAX_PEOPLE - 1}`)
  })

  it('captures and restores the owner and access of a window', () => {
    const instance = createBoardStore().create()
    instance.actions.openWindow({
      id: 'agent-1' as WindowId,
      kind: 'agent',
      bodyKind: 'conversation',
      ordinal: 1,
      width: 552,
      height: 648,
      ownerId: brandString<OwnerId>('real-1'),
      access: { mode: 'selected', people: [brandString<OwnerId>('real-2')] },
    })
    const captured = captureBoardLayout(instance.getSnapshot()).windows[0]
    expect(captured).toMatchObject({
      ownerId: 'real-1',
      access: { mode: 'selected', people: ['real-2'] },
    })

    const restored = sanitizeBoardLayout(document({ windows: [captured], windowOrder: ['agent-1'] }))
    expect(firstWindow(restored)).toMatchObject({
      ownerId: 'real-1',
      access: { mode: 'selected', people: ['real-2'] },
    })
  })
})
