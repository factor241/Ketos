/**
 * Board popover layer: the screen-space mount for every tooltip and menu the
 * board opens.
 *
 * The layer sits outside the canvas transform (rendered by `BoardViews.tsx`),
 * so a portaled card keeps screen coordinates while scaling with the surface
 * that owns it. `BoardPopoverProvider` turns the nearest surface into a
 * `PopoverHost` for one window (`windowId`) or for screen-space chrome (no
 * `windowId`, scale 1) and publishes a dismissal token that window menus
 * watch: moving, resizing, culling, or closing the window closes an open menu,
 * while pan and zoom only move it.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { PopoverHostProvider, usePopoverHost } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardState, BoardStoreHandle } from './store.ts'
import type { WindowId } from './contract/slots.ts'
import { isWindowHidden } from './culling.ts'

/** Screen-pixel rectangle board popovers stay inside: the board box less this inset. */
const BOUNDARY_INSET = 12

/** Elements the board's popovers mount into and measure against. */
export interface BoardPopoverSurface {
  /** Portal target: the popover layer, outside the canvas transform. */
  readonly layer: HTMLElement
  /** Board root, whose box every hosted boundary derives from. */
  readonly root: HTMLElement
}

/** Nearest board popover surface, or null while the board root is not mounted. */
export const BoardPopoverSurfaceContext = createContext<BoardPopoverSurface | null>(null)

/**
 * Read the nearest board popover surface.
 * @returns the surface, or null outside the board root.
 */
export function useBoardPopoverSurface(): BoardPopoverSurface | null {
  return useContext(BoardPopoverSurfaceContext)
}

/**
 * Build the boundary function for the nearest board root: its box less
 * {@link BOUNDARY_INSET}, or the browser window outside a board.
 * @returns a stable function returning the current screen-pixel boundary.
 */
export function useBoardPopoverBoundary(): () => DOMRect {
  const surface = useBoardPopoverSurface()
  return useCallback((): DOMRect => {
    if (surface === null) return new DOMRect(0, 0, window.innerWidth, window.innerHeight)
    const box = surface.root.getBoundingClientRect()
    return new DOMRect(
      box.left + BOUNDARY_INSET,
      box.top + BOUNDARY_INSET,
      Math.max(0, box.width - 2 * BOUNDARY_INSET),
      Math.max(0, box.height - 2 * BOUNDARY_INSET),
    )
  }, [surface])
}

/**
 * Token that changes whenever an open window menu must close: the window moved
 * or resized, left the visible canvas, crossed the detail threshold, or
 * closed. Pan and zoom inside one detail mode keep the token stable, so menus
 * follow those gestures instead of dismissing for them.
 * @param state - board state holding the window map and zoom.
 * @param windowId - the window whose menus watch the token.
 * @param detailZoomThreshold - zoom below which the window shows its simplified card.
 * @returns the current dismissal token.
 */
export function windowMenuDismissToken(state: BoardState, windowId: WindowId, detailZoomThreshold: number): string {
  const card = state.windows[windowId as string]
  if (card === undefined) return 'closed'
  const visibility = isWindowHidden(state, card) ? 'hidden' : 'shown'
  const detail = state.zoom < detailZoomThreshold ? 'simplified' : 'detailed'
  return `${visibility}:${detail}:${String(card.x)}:${String(card.y)}:${String(card.width)}:${String(card.height)}`
}

/** Per-window dismissal token for open menus; null outside a window host. */
const WindowMenuDismissContext = createContext<string | null>(null)

/**
 * Close the calling owner's menu when its window's dismissal token changes
 * (move, resize, culling, or close). The token observed at mount
 * never closes anything; only a change does, so opening a menu is not
 * immediately undone by the host.
 * @param onClose - the owner's menu close callback.
 */
export function useBoardMenuDismiss(onClose: () => void): void {
  const token = useContext(WindowMenuDismissContext)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose })
  const previous = useRef(token)
  useEffect(() => {
    if (previous.current === token) return
    previous.current = token
    close.current()
  }, [token])
}

/**
 * Mount one dock popover through the nearest popover host. The dock rail
 * scrolls horizontally, so a popover rendered inside it would be clipped by
 * that overflow; the host (the board's screen-space popover layer at scale 1,
 * or the browser body without a board root) sits outside every scroller and
 * above the canvas.
 * @param props - the popover subtree to mount.
 * @returns the portaled subtree.
 */
export function BoardPopoverPortal({ children }: { readonly children: ReactNode }) {
  const host = usePopoverHost()
  return createPortal(children, host.container)
}

/** Props for {@link BoardPopoverProvider}: the store seat and the window whose geometry scopes the host. */
export interface BoardPopoverProviderProps {
  /** Board store read seat; the provider subscribes to pan, zoom, and the window rectangle. */
  readonly useStore: PropsStore<BoardStoreHandle>['useStore']
  /** Window whose scale and menu lifecycle scope the host; omit for screen-space chrome (dock, omnibar). */
  readonly windowId?: WindowId
  /**
   * Zoom below which the window shows its simplified card; crossing it closes
   * the window's open menus (Д6.1). Omitted for screen-space chrome.
   */
  readonly detailZoomThreshold?: number
  /** Hosted subtree. */
  readonly children: ReactNode
}

/**
 * Host the popovers of one board surface. Window hosts scale with the zoom (1
 * at the board zoom) and dismiss menus on window lifecycle changes; a host without
 * `windowId` renders at scale 1 for the screen-space chrome. Until the board
 * root publishes its layer, children render without a host.
 * @param props - the store seat, the optional window id, and the subtree to host.
 * @returns the hosted subtree.
 */
export function BoardPopoverProvider({ useStore, windowId, detailZoomThreshold, children }: BoardPopoverProviderProps) {
  const surface = useBoardPopoverSurface()
  const boundary = useBoardPopoverBoundary()
  const zoom = useStore(s => s.zoom)
  const panX = useStore(s => s.panX)
  const panY = useStore(s => s.panY)
  const geometry = useStore((s) => {
    if (windowId === undefined) return ''
    const card = s.windows[windowId as string]
    return card === undefined ? '' : `${String(card.x)}:${String(card.y)}:${String(card.width)}:${String(card.height)}`
  })
  const token = useStore(s => windowId === undefined
    ? null
    : windowMenuDismissToken(s, windowId, detailZoomThreshold ?? 0))

  const listeners = useRef(new Set<() => void>())
  const subscribe = useCallback((listener: () => void) => {
    listeners.current.add(listener)
    return () => { listeners.current.delete(listener) }
  }, [])
  const notify = useCallback((): void => {
    for (const listener of listeners.current) listener()
  }, [])

  // Pan, zoom, and window-rectangle changes move the anchors; notify after the
  // commit so listeners measure the transformed DOM, not the previous frame.
  useLayoutEffect(() => { notify() }, [notify, panX, panY, zoom, geometry])
  useEffect(() => {
    window.addEventListener('resize', notify)
    return () => { window.removeEventListener('resize', notify) }
  }, [notify])

  if (surface === null) return <>{children}</>
  return (
    <PopoverHostProvider
      container={surface.layer}
      scale={windowId === undefined ? 1 : zoom}
      boundary={boundary}
      subscribe={subscribe}
    >
      <WindowMenuDismissContext.Provider value={token}>{children}</WindowMenuDismissContext.Provider>
    </PopoverHostProvider>
  )
}
