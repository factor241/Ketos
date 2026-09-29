/**
 * Chrome-element self-measurement for the board safe area. Each floating
 * chrome element declares the board edge it is anchored to and publishes its
 * own depth from that edge through this hook; the element and the board box
 * are observed, so a resize, a moved dock, or a chrome element that mounts or
 * unmounts later updates the insets without a central query.
 */
import { useEffect, useId } from 'react'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardStoreHandle } from './store.ts'
import { chromeInsetDepth, type BoardRect, type ChromeEdge } from './chrome-insets.ts'

/** The board surface one chrome element measures itself against. */
const BOARD_SURFACE = '[data-surface="board"]'

/**
 * Publish one chrome element's inset contribution for its declared edge. The
 * contribution is cleared when the element unmounts or its ref changes, so a
 * hidden chrome element stops reserving space in the same commit (Т1.15).
 * @param edge - the board edge the element is anchored to.
 * @param element - the mounted element, or null before its ref attaches.
 * @param actions - board store actions receiving the contribution.
 */
export function useBoardChromeInset(
  edge: ChromeEdge,
  element: HTMLElement | null,
  actions: PropsStore<BoardStoreHandle>['actions'],
): void {
  const key = useId()
  useEffect(() => {
    if (element === null) return
    const root = element.closest(BOARD_SURFACE)
    const publish = (): void => {
      if (!(root instanceof HTMLElement)) return
      const board = root.getBoundingClientRect()
      const rect = element.getBoundingClientRect()
      const boardRect: BoardRect = { left: board.left, top: board.top, right: board.right, bottom: board.bottom }
      const elementRect: BoardRect = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
      actions.publishChromeInset(key, edge, chromeInsetDepth(boardRect, elementRect, edge))
    }
    publish()
    // jsdom implements no ResizeObserver; the mount-time publish is the read.
    if (typeof ResizeObserver === 'undefined') return () => { actions.clearChromeInset(key) }
    const observer = new ResizeObserver(publish)
    observer.observe(element)
    if (root instanceof HTMLElement) observer.observe(root)
    return () => {
      observer.disconnect()
      actions.clearChromeInset(key)
    }
  }, [key, edge, element, actions])
}
