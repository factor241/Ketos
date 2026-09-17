/**
 * Spatial multi-window board store.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { BoardWindowState, WindowBodyKind, WindowId, WindowKind } from './contract/slots.ts'
import { PANEL_DEFAULT_WIDTH, PANEL_MAX_WIDTH, PANEL_MIN_WIDTH } from './window/panel-geometry.ts'
import type { BoardPanelGroupBy, BoardPanelOrderBy } from './window/chat-list-model.ts'

/** Store handle handed to every board registration; one live root-scope instance backs them all. */
export type BoardStoreHandle = EngineStoreHandle<BoardState, BoardActions>

/** A window the board opens from its own chrome: everything except the placement it computes. */
export type OpenWindowSpec = Omit<BoardWindowState, 'x' | 'y' | 'zIndex'>

type BoardActions = {
  setPan: (draft: BoardState, panX: number, panY: number) => void
  setZoom: (draft: BoardState, zoom: number) => void
  zoomTowardPointer: (draft: BoardState, delta: number, pointerX: number, pointerY: number) => void
  setViewport: (draft: BoardState, width: number, height: number) => void
  addWindow: (draft: BoardState, window: BoardWindowState) => void
  openWindow: (draft: BoardState, spec: OpenWindowSpec) => void
  moveWindow: (draft: BoardState, id: WindowId, x: number, y: number, snap: boolean) => void
  resizeWindow: (draft: BoardState, id: WindowId, width: number, height: number, snap: boolean) => void
  setWindowBodyKind: (draft: BoardState, id: WindowId, bodyKind: WindowBodyKind) => void
  focusWindow: (draft: BoardState, id: WindowId) => void
  centerOnWindow: (draft: BoardState, id: WindowId) => void
  setWindowFullscreen: (draft: BoardState, id: WindowId) => void
  exitFullscreen: (draft: BoardState) => void
  openWindowPanel: (draft: BoardState, id: WindowId) => void
  closeWindowPanel: (draft: BoardState) => void
  setPanelCollapsed: (draft: BoardState, collapsed: boolean) => void
  setPanelWidth: (draft: BoardState, width: number) => void
  setPanelGroupBy: (draft: BoardState, groupBy: BoardPanelGroupBy) => void
  setPanelOrderBy: (draft: BoardState, orderBy: BoardPanelOrderBy) => void
  closeWindow: (draft: BoardState, id: WindowId) => void
  setSelectingElement: (draft: BoardState, selecting: boolean) => void
}

/** Pan, zoom, window, and selection state of the board canvas. */
export interface BoardState {
  panX: number
  panY: number
  zoom: number
  /** Canvas box the minimap and window placement measure against; written by the canvas layer. */
  viewportWidth: number
  viewportHeight: number
  windows: Record<string, BoardWindowState>
  windowOrder: WindowId[]
  activeWindowId: WindowId | null
  /**
   * The window filling the board panel, or null. A fullscreen window keeps its
   * stored rectangle and its controls; the frames skip drag and resize while it
   * is fullscreen, so the rectangle survives the mode.
   */
  fullscreenWindowId: WindowId | null
  /**
   * The window whose chats panel is open, or null. One panel is open at a
   * time; it keeps the window's stored rectangle and only decorates it.
   */
  panelWindowId: WindowId | null
  /** Whether the window's chats panel is collapsed to its rail. */
  panelCollapsed: boolean
  /** Width the user last dragged the chats panel to. */
  panelWidth: number
  /** How the chats panel arranges its list. */
  panelGroupBy: BoardPanelGroupBy
  /** How the chats panel orders chats inside a group. */
  panelOrderBy: BoardPanelOrderBy
  isSelectingElement: boolean
}

/**
 * Size and body of the windows the board's own chrome opens. The chat window
 * takes 552×648: the base design's 480×560 grown with the window UI scale and
 * kept on the 24px grid.
 */
export const BOARD_WINDOW_TEMPLATES = {
  agent: { kind: 'agent', bodyKind: 'conversation', width: 552, height: 648 },
} as const satisfies Record<string, Pick<BoardWindowState, 'kind' | 'bodyKind' | 'width' | 'height'>>

/**
 * The smallest window the board opens: the default chat size. A window never
 * shrinks below it — the composer's rows cannot lay out in less — and grows
 * freely in width, height, or proportionally.
 */
export const MIN_WINDOW_SIZE = {
  width: BOARD_WINDOW_TEMPLATES.agent.width,
  height: BOARD_WINDOW_TEMPLATES.agent.height,
} as const

/** Grid step the snap rounds to while dragging without Shift. */
const GRID_STEP = 24

/**
 * Bottom of the window z-index band. Windows paint above the canvas grid and
 * below every floating layer of the board: the chrome (dock, omnibar, minimap)
 * sits at 100, the element-selection overlay at 500, and the fullscreen frame
 * and an overlay chats panel at 1000. The band tops out below the chrome, so a
 * window can never paint over it however many windows are open.
 */
export const WINDOW_Z_BASE = 10

/** Top of the window z-index band; the chrome above it starts at 100. */
export const WINDOW_Z_MAX = 99

/**
 * Snap one position component to the board grid.
 * @param value - world coordinate.
 * @param snap - whether grid snapping is on.
 * @returns the rounded coordinate.
 */
export function snapPosition(value: number, snap: boolean): number {
  return snap ? Math.round(value / GRID_STEP) * GRID_STEP : Math.round(value)
}

/**
 * Apply grid snapping and the minimum-size floor to one requested window size.
 * The floor is applied after snapping, so a snapped value can never land below
 * the layout's minimum.
 * @param width - requested width in world units.
 * @param height - requested height in world units.
 * @param snap - whether grid snapping is on.
 * @returns the size the window takes.
 */
export function clampWindowSize(
  width: number,
  height: number,
  snap: boolean,
): { width: number; height: number } {
  const snapped = (value: number): number => snapPosition(value, snap)
  return {
    width: Math.max(MIN_WINDOW_SIZE.width, snapped(width)),
    height: Math.max(MIN_WINDOW_SIZE.height, snapped(height)),
  }
}

/**
 * Mint an id for one board window. The id is a board-local identity unique per
 * window; the kind is a readable prefix, not part of the identity.
 * @param kind - window category the id is prefixed with.
 * @returns the fresh window id.
 */
export function mintWindowId(kind: WindowKind): WindowId {
  const entropy = Math.random().toString(36).slice(2, 8)
  return `${kind}-${Date.now().toString(36)}-${entropy}` as WindowId
}

/** Center a new window in the current viewport (world coordinates). */
function placeWindow(draft: BoardState, width: number, height: number): { x: number; y: number } {
  return {
    x: (-draft.panX + draft.viewportWidth / 2 - width / 2) / draft.zoom,
    y: (-draft.panY + draft.viewportHeight / 2 - height / 2) / draft.zoom,
  }
}

/** The highest z-index among the windows other than `except`. */
function topWindowZ(draft: BoardState, except: WindowId): number {
  let top = WINDOW_Z_BASE - 1
  for (const [key, window] of Object.entries(draft.windows)) {
    if (key === except) continue
    top = Math.max(top, window.zIndex)
  }
  return top
}

/**
 * Rewrite every window's z-index from the current paint order. The band is
 * finite so windows never reach the floating chrome above it; past the last
 * distinct slot (more than {@link WINDOW_Z_MAX} windows) windows share the top
 * value and DOM order — window order — keeps the stack exact.
 */
function renormalizeWindowZ(draft: BoardState): void {
  draft.windowOrder.forEach((wId, idx) => {
    const window = draft.windows[wId as string]
    if (window) window.zIndex = Math.min(WINDOW_Z_BASE + idx, WINDOW_Z_MAX)
  })
}

/**
 * Insert one window on top of the stack and make it active. The stored z-index
 * is clamped into the band whatever the caller passed, so no insertion path —
 * including a restored layout — can place a window over the floating chrome.
 */
function insertWindow(draft: BoardState, window: BoardWindowState): void {
  const placed: BoardWindowState = {
    ...window,
    zIndex: Math.min(Math.max(window.zIndex, WINDOW_Z_BASE), WINDOW_Z_MAX),
  }
  draft.windows[placed.id as string] = placed
  if (!draft.windowOrder.includes(placed.id)) {
    draft.windowOrder.push(placed.id)
  }
  draft.activeWindowId = placed.id
}

/**
 * Raise one window to the top of the z-order and make it active. Only the
 * raised window's z-index moves — focusing is not a re-layout of the stack —
 * and when the band is exhausted the whole band is renormalized in the current
 * order instead of overflowing into the chrome above it.
 */
function raiseWindow(draft: BoardState, id: WindowId): void {
  const window = draft.windows[id as string]
  if (!window) return
  draft.activeWindowId = id
  draft.windowOrder = draft.windowOrder.filter(wId => wId !== id)
  draft.windowOrder.push(id)
  const top = topWindowZ(draft, id)
  if (window.zIndex > top) return
  if (top >= WINDOW_Z_MAX) {
    renormalizeWindowZ(draft)
    return
  }
  window.zIndex = top + 1
}

/**
 * Create the board canvas view store handle.
 * @param opts - persist key naming the localStorage entry backing the layout; omitted keeps the layout session-only.
 * @returns a handle instantiated once per scope by the renderer's store seat.
 */
export function createBoardStore(opts?: { persist?: string }): BoardStoreHandle {
  return defineStore({
    ...(opts?.persist ? { persist: opts.persist } : {}),
    init: (): BoardState => ({
      panX: 0,
      panY: 0,
      zoom: 1,
      viewportWidth: 1920,
      viewportHeight: 1080,
      windows: {},
      windowOrder: [],
      activeWindowId: null,
      fullscreenWindowId: null,
      panelWindowId: null,
      panelCollapsed: true,
      panelWidth: PANEL_DEFAULT_WIDTH,
      panelGroupBy: 'workspace',
      panelOrderBy: 'updated',
      isSelectingElement: false,
    }),
    actions: {
      setPan: (draft, panX, panY) => {
        draft.panX = panX
        draft.panY = panY
      },
      setZoom: (draft, zoom) => {
        draft.zoom = Math.min(2.0, Math.max(0.2, zoom))
      },
      zoomTowardPointer: (draft, delta, pointerX, pointerY) => {
        const factor = delta < 0 ? 1.1 : 0.9
        const newZoom = Math.min(2.0, Math.max(0.2, draft.zoom * factor))
        if (newZoom === draft.zoom) return
        draft.panX = pointerX - (pointerX - draft.panX) * (newZoom / draft.zoom)
        draft.panY = pointerY - (pointerY - draft.panY) * (newZoom / draft.zoom)
        draft.zoom = newZoom
      },
      setViewport: (draft, width, height) => {
        draft.viewportWidth = width
        draft.viewportHeight = height
      },
      addWindow: (draft, window) => {
        insertWindow(draft, window)
      },
      openWindow: (draft, spec) => {
        // Every window kind opens at its template size or above: the floor is
        // the composer's minimum, applied to tool windows as well.
        const size = clampWindowSize(spec.width, spec.height, false)
        insertWindow(draft, {
          ...spec,
          ...size,
          ...placeWindow(draft, size.width, size.height),
          // Seeded at the band top and then placed above the current stack;
          // renaming the whole band keeps a crowded board exact.
          zIndex: WINDOW_Z_MAX,
        })
        const placed = draft.windows[spec.id as string]
        if (!placed) return
        const top = topWindowZ(draft, spec.id)
        if (top >= WINDOW_Z_MAX) renormalizeWindowZ(draft)
        else placed.zIndex = top + 1
      },
      moveWindow: (draft, id, x, y, snap) => {
        const win = draft.windows[id as string]
        if (!win) return
        win.x = snapPosition(x, snap)
        win.y = snapPosition(y, snap)
      },
      resizeWindow: (draft, id, width, height, snap) => {
        const win = draft.windows[id as string]
        if (!win) return
        const size = clampWindowSize(width, height, snap)
        win.width = size.width
        win.height = size.height
      },
      setWindowBodyKind: (draft, id, bodyKind) => {
        const win = draft.windows[id as string]
        if (!win) return
        win.bodyKind = bodyKind
      },
      focusWindow: (draft, id) => {
        raiseWindow(draft, id)
      },
      centerOnWindow: (draft, id) => {
        const win = draft.windows[id as string]
        if (!win) return
        raiseWindow(draft, id)
        draft.panX = -(win.x + win.width / 2 - draft.viewportWidth / (2 * draft.zoom)) * draft.zoom
        draft.panY = -(win.y + win.height / 2 - draft.viewportHeight / (2 * draft.zoom)) * draft.zoom
      },
      setWindowFullscreen: (draft, id) => {
        if (!draft.windows[id as string]) return
        draft.fullscreenWindowId = id
        raiseWindow(draft, id)
      },
      exitFullscreen: (draft) => {
        draft.fullscreenWindowId = null
      },
      openWindowPanel: (draft, id) => {
        if (!draft.windows[id as string]) return
        draft.panelWindowId = id
        draft.panelCollapsed = false
      },
      closeWindowPanel: (draft) => {
        draft.panelWindowId = null
        draft.panelCollapsed = true
      },
      setPanelCollapsed: (draft, collapsed) => {
        draft.panelCollapsed = collapsed
      },
      setPanelWidth: (draft, width) => {
        draft.panelWidth = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Math.round(width)))
      },
      setPanelGroupBy: (draft, groupBy) => {
        draft.panelGroupBy = groupBy
      },
      setPanelOrderBy: (draft, orderBy) => {
        draft.panelOrderBy = orderBy
      },
      closeWindow: (draft, id) => {
        // Immer draft: removing the window entry on close; WindowId is
        // opaque, so the record key is only reachable dynamically.
        Reflect.deleteProperty(draft.windows, id)
        draft.windowOrder = draft.windowOrder.filter(wId => wId !== id)
        if (draft.fullscreenWindowId === id) {
          draft.fullscreenWindowId = null
        }
        if (draft.panelWindowId === id) {
          draft.panelWindowId = null
        }
        if (draft.activeWindowId === id) {
          draft.activeWindowId = draft.windowOrder[draft.windowOrder.length - 1] ?? null
        }
      },
      setSelectingElement: (draft, selecting) => {
        draft.isSelectingElement = selecting
      },
    },
  })
}
