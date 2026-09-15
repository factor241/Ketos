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

/** Size and body of the windows the board's own chrome opens. */
export const BOARD_WINDOW_TEMPLATES = {
  agent: { kind: 'agent', bodyKind: 'conversation', width: 480, height: 560 },
  connectors: { kind: 'connectors', bodyKind: 'connectors', width: 520, height: 480 },
} as const satisfies Record<string, Pick<BoardWindowState, 'kind' | 'bodyKind' | 'width' | 'height'>>

/**
 * Mint an id for one board window. Board window ids are board-local identities,
 * unique per window and never derived from the type or position.
 * @param kind - window category the id is namespaced by.
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
        win.x = snap ? Math.round(x / 24) * 24 : Math.round(x)
        win.y = snap ? Math.round(y / 24) * 24 : Math.round(y)
      },
      resizeWindow: (draft, id, width, height, snap) => {
        const win = draft.windows[id as string]
        if (!win) return
        const minW = 320
        const minH = 200
        const w = Math.max(minW, width)
        const h = Math.max(minH, height)
        win.width = snap ? Math.round(w / 24) * 24 : Math.round(w)
        win.height = snap ? Math.round(h / 24) * 24 : Math.round(h)
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
