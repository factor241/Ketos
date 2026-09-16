/**
 * Spatial multi-window board store.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { BoardWindowState, WindowBodyKind, WindowId, WindowKind } from './contract/slots.ts'

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

/** Insert one window on top of the stack and make it active. */
function insertWindow(draft: BoardState, window: BoardWindowState): void {
  draft.windows[window.id as string] = window
  if (!draft.windowOrder.includes(window.id)) {
    draft.windowOrder.push(window.id)
  }
  draft.activeWindowId = window.id
}

/** Raise one window to the top of the z-order and make it active. */
function raiseWindow(draft: BoardState, id: WindowId): void {
  if (!draft.windows[id as string]) return
  draft.activeWindowId = id
  draft.windowOrder = draft.windowOrder.filter(wId => wId !== id)
  draft.windowOrder.push(id)
  draft.windowOrder.forEach((wId, idx) => {
    const w = draft.windows[wId as string]
    if (w) w.zIndex = 10 + idx
  })
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
        insertWindow(draft, {
          ...spec,
          ...placeWindow(draft, spec.width, spec.height),
          zIndex: 10 + draft.windowOrder.length,
        })
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
      closeWindow: (draft, id) => {
        // Immer draft: removing the window entry on close; WindowId is
        // opaque, so the record key is only reachable dynamically.
        Reflect.deleteProperty(draft.windows, id)
        draft.windowOrder = draft.windowOrder.filter(wId => wId !== id)
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
