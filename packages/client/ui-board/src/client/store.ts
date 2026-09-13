/**
 * Spatial multi-window board store.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { BoardWindowState, WindowId } from './contract/slots.ts'

type BoardActions = {
  setPan: (draft: BoardState, panX: number, panY: number) => void
  setZoom: (draft: BoardState, zoom: number) => void
  zoomTowardPointer: (draft: BoardState, delta: number, pointerX: number, pointerY: number) => void
  addWindow: (draft: BoardState, window: BoardWindowState) => void
  moveWindow: (draft: BoardState, id: WindowId, x: number, y: number, snap: boolean) => void
  resizeWindow: (draft: BoardState, id: WindowId, width: number, height: number, snap: boolean) => void
  focusWindow: (draft: BoardState, id: WindowId) => void
  closeWindow: (draft: BoardState, id: WindowId) => void
  setSelectingElement: (draft: BoardState, selecting: boolean) => void
}

/** Pan, zoom, window, and selection state of the board canvas. */
export interface BoardState {
  panX: number
  panY: number
  zoom: number
  windows: Record<string, BoardWindowState>
  windowOrder: WindowId[]
  activeWindowId: WindowId | null
  isSelectingElement: boolean
}

/**
 * Create the board canvas view store handle.
 * @param opts - persist key naming the localStorage entry backing the layout; omitted keeps the layout session-only.
 * @returns a handle instantiated once per scope by the renderer's store seat.
 */
export function createBoardStore(opts?: { persist?: string }): EngineStoreHandle<BoardState, BoardActions> {
  return defineStore({
    ...(opts?.persist ? { persist: opts.persist } : {}),
    init: (): BoardState => ({
      panX: 0,
      panY: 0,
      zoom: 1,
      windows: {},
      windowOrder: [],
      activeWindowId: null,
      isSelectingElement: false,
    }),
    actions: {
      setPan: (draft, panX: number, panY: number) => {
        draft.panX = panX
        draft.panY = panY
      },
      setZoom: (draft, zoom: number) => {
        draft.zoom = Math.min(2.0, Math.max(0.2, zoom))
      },
      zoomTowardPointer: (draft, delta: number, pointerX: number, pointerY: number) => {
        const factor = delta < 0 ? 1.1 : 0.9
        const newZoom = Math.min(2.0, Math.max(0.2, draft.zoom * factor))
        if (newZoom === draft.zoom) return
        draft.panX = pointerX - (pointerX - draft.panX) * (newZoom / draft.zoom)
        draft.panY = pointerY - (pointerY - draft.panY) * (newZoom / draft.zoom)
        draft.zoom = newZoom
      },
      addWindow: (draft, window: BoardWindowState) => {
        draft.windows[window.id as string] = window
        if (!draft.windowOrder.includes(window.id)) {
          draft.windowOrder.push(window.id)
        }
        draft.activeWindowId = window.id
      },
      moveWindow: (draft, id: WindowId, x: number, y: number, snap: boolean) => {
        const win = draft.windows[id as string]
        if (!win) return
        win.x = snap ? Math.round(x / 24) * 24 : Math.round(x)
        win.y = snap ? Math.round(y / 24) * 24 : Math.round(y)
      },
      resizeWindow: (draft, id: WindowId, width: number, height: number, snap: boolean) => {
        const win = draft.windows[id as string]
        if (!win) return
        const minW = 320
        const minH = 200
        const w = Math.max(minW, width)
        const h = Math.max(minH, height)
        win.width = snap ? Math.round(w / 24) * 24 : Math.round(w)
        win.height = snap ? Math.round(h / 24) * 24 : Math.round(h)
      },
      focusWindow: (draft, id: WindowId) => {
        if (!draft.windows[id as string]) return
        draft.activeWindowId = id
        draft.windowOrder = draft.windowOrder.filter(wId => wId !== id)
        draft.windowOrder.push(id)
        draft.windowOrder.forEach((wId, idx) => {
          const w = draft.windows[wId as string]
          if (w) w.zIndex = 10 + idx
        })
      },
      closeWindow: (draft, id: WindowId) => {
        // Immer draft: removing the window entry on close; WindowId is
        // opaque, so the record key is only reachable dynamically.
        Reflect.deleteProperty(draft.windows, id)
        draft.windowOrder = draft.windowOrder.filter(wId => wId !== id)
        if (draft.activeWindowId === id) {
          draft.activeWindowId = draft.windowOrder[draft.windowOrder.length - 1] ?? null
        }
      },
      setSelectingElement: (draft, selecting: boolean) => {
        draft.isSelectingElement = selecting
      },
    },
  })
}
