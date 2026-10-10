// @vitest-environment jsdom
/**
 * Window culling: a window that leaves the visible canvas is hidden, not
 * unmounted, so its lane, draft, attachments, and panel keep their state.
 */
import { describe, expect, it } from 'vitest'
import { brandNumber } from '@deepseek-ai/dsh-brand'
import type { BoardRevision } from '@ketos/board-doc/types'
import { CULL_MARGIN, isWindowHidden, isWindowVisible } from '../src/client/culling.ts'
import { DEMO_SELF_ID } from '../src/client/owners.ts'
import type { BoardState } from '../src/client/store.ts'
import type { BoardWindowState, WindowId } from '../src/client/contract/slots.ts'

const WINDOW: BoardWindowState = {
  id: 'w1' as WindowId,
  kind: 'agent',
  bodyKind: 'conversation',
  ordinal: 1,
  ownerId: DEMO_SELF_ID,
  access: { mode: 'owner', people: [] },
  x: 0,
  y: 0,
  width: 552,
  height: 648,
  zIndex: 10,
}

function state(overrides: Partial<BoardState> = {}): BoardState {
  return {
    panX: 0,
    panY: 0,
    zoom: 1,
    viewportWidth: 1000,
    viewportHeight: 800,
    chromeInsetSources: {},
    windows: { w1: WINDOW },
    windowOrder: ['w1' as WindowId],
    dockOrder: ['w1' as WindowId],
    cloneOrder: [],
    activeWindowId: 'w1' as WindowId,
    expandedWindowId: null,
    panelGroupBy: 'workspace',
    panelOrderBy: 'updated',
    panelExpandedGroups: [],
    defaultPreset: '',
    tool: 'select',
    brushWidth: 'm',
    eraserPreview: null,
    isSelectingElement: false,
    composerIntents: [],
    composerIntentSeq: 0,
    returnWindowId: null,
    highlightWindowId: null,
    cloneEdits: {},
    rightPanels: {},
    boardElements: {},
    boardElementsRevision: brandNumber<BoardRevision>(0),
    boardDocId: null,
    boardLimits: null,
    selfId: null,
    boardParticipants: [],
    windowRecords: {},
    peerSelf: null,
    peerStates: [],
    peerAvailable: false,
    peerMissing: false,
    peerSharedFolder: null,
    boardMounted: false,
    layoutSource: null,
    selectedBoardElementId: null,
    editingBoardElementId: null,
    pendingBoardElementOps: [],
    elementNotice: null,
    drafts: {},
    ...overrides,
  }
}

describe('isWindowVisible', () => {
  it('keeps a window that intersects the view and culls one past the margin', () => {
    expect(isWindowVisible(state(), WINDOW)).toBe(true)
    expect(isWindowVisible(state({ panX: -50, panY: -50 }), WINDOW)).toBe(true)
    expect(isWindowVisible(state({ panX: -10_000, panY: 0 }), WINDOW)).toBe(false)
    expect(isWindowVisible(state({ panX: 0, panY: -10_000 }), WINDOW)).toBe(false)
  })

  it('keeps a window whose open panel is the only visible part (Т3.12)', () => {
    // The frame sits past the margin while its open left panel reaches into
    // the visible canvas: culling follows the whole footprint.
    const framed = { ...WINDOW, x: -1800, leftPanelOpen: true, leftPanelWidth: 300 }
    expect(isWindowVisible(state(), framed)).toBe(false)
    const panelInside = { ...framed, x: -700 }
    expect(isWindowVisible(state(), panelInside)).toBe(true)
  })

  it('keeps the culling margin so a window just outside does not pop', () => {
    // One pixel beyond the view, still inside the margin: rendered.
    expect(isWindowVisible(state({ panX: -(WINDOW.width + 1) }), WINDOW)).toBe(true)
    expect(isWindowVisible(state({ panX: -(WINDOW.width + CULL_MARGIN + 1) }), WINDOW)).toBe(false)
  })

  it('follows pan and zoom like the canvas transform', () => {
    // Zoomed out, the same view covers more world: the window stays in.
    expect(isWindowVisible(state({ panX: -100, zoom: 0.2 }), WINDOW)).toBe(true)
    // Zoomed in with the view far to the right of the window: it leaves.
    expect(isWindowVisible(state({ panX: -3000, zoom: 2 }), WINDOW)).toBe(false)
  })
})

describe('isWindowHidden', () => {

  it('reads the live window rectangle from the store', () => {
    const moved = state({ windows: { w1: { ...WINDOW, x: 20_000 } } })
    expect(isWindowHidden(moved, WINDOW)).toBe(true)
  })
})
