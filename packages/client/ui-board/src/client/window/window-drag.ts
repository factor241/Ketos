/**
 * Window drag: the header strip and the owner bezel's background share one
 * pointerdown handler, so the user grabs the window wherever the window chrome
 * is visible. The handler reads the canvas zoom where the gesture starts, and
 * it lives in a leaf component, so a pan or zoom re-renders only that leaf —
 * never the memoized frame.
 */
import { useCallback } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardStoreHandle } from '../store.ts'
import type { BoardWindowState } from '../contract/slots.ts'
import { useBoardPointerGesture } from '../pointer-gesture.ts'

/**
 * Build the pointerdown handler that drags one window.
 * @param cardWindow - the window the handler moves.
 * @param useStore - board store read seat; the handler reads the live zoom.
 * @param actions - board action face.
 * @returns the pointerdown handler for the window header and bezel background.
 */
export function useWindowDragStart(
  cardWindow: BoardWindowState,
  useStore: PropsStore<BoardStoreHandle>['useStore'],
  actions: PropsStore<BoardStoreHandle>['actions'],
): (event: ReactPointerEvent<HTMLElement>) => void {
  const zoom = useStore(s => s.zoom)
  const startGesture = useBoardPointerGesture()

  return useCallback((event: ReactPointerEvent<HTMLElement>) => {
    // Controls and bezel items own their pointerdowns; only the chrome's own
    // background starts a drag.
    if ((event.target as HTMLElement).closest('button, input, textarea, [data-board-bezel-item]') !== null) return
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    actions.focusWindow(cardWindow.id)

    const startClientX = event.clientX
    const startClientY = event.clientY
    const startX = cardWindow.x
    const startY = cardWindow.y

    startGesture(target, event.pointerId, {
      move: (moveEvt) => {
        const dx = (moveEvt.clientX - startClientX) / zoom
        const dy = (moveEvt.clientY - startClientY) / zoom
        actions.moveWindow(cardWindow.id, startX + dx, startY + dy, !moveEvt.shiftKey)
      },
    })
  }, [cardWindow.id, cardWindow.x, cardWindow.y, zoom, actions, startGesture])
}
