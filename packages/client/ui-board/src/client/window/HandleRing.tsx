/**
 * Screen-space resize ring of the active window. The frame's own handles ride
 * its border inside the canvas, so the floating chrome above the canvas covers
 * a handle whose window edge sits under it. This ring draws the same eight
 * handles in the board root above the chrome (z-index 150, below the
 * element-selection overlay), using the canvas transform to stay on the
 * window's border at any zoom. Non-active windows keep the frame handles they
 * have always had.
 */
import { useCallback, useMemo } from 'react'
import clsx from 'clsx'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardWindowState } from '../contract/slots.ts'
import type { BoardStoreHandle } from '../store.ts'
import { useBoardPointerGesture } from '../pointer-gesture.ts'
import { isWindowVisible } from '../canvas/culling.ts'
import { windowScreenRect, type ScreenBox } from '../canvas/window-screen.ts'
import { startWindowResizeGesture } from './resize-gesture.ts'
import type { ResizeDirection } from './resize.ts'
import css from './HandleRing.module.css'

export type HandleRingProps = PropsStore<BoardStoreHandle>

/**
 * One handle of the ring: a screen-space strip over the active window's border.
 * @param props - store seat plus the window, its direction, and its rectangle.
 */
function RingHandle({
  cardWindow, direction, rect, className, useStore, actions,
}: {
  readonly cardWindow: BoardWindowState
  readonly direction: ResizeDirection
  readonly rect: ScreenBox
  readonly className: string | undefined
  readonly useStore: PropsStore<BoardStoreHandle>['useStore']
  readonly actions: PropsStore<BoardStoreHandle>['actions']
}) {
  const zoom = useStore(s => s.zoom)
  const start = useBoardPointerGesture()
  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    startWindowResizeGesture({
      event,
      window: cardWindow,
      direction,
      zoom,
      actions,
      start: (element, pointerId, handlers) => { start(element, pointerId, handlers) },
    })
  }, [cardWindow, direction, zoom, actions, start])

  return (
    <div
      data-board-handle={direction}
      onPointerDown={handlePointerDown}
      className={clsx(css.handle, className)}
      style={{ left: rect.left, top: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top }}
    />
  )
}

export function HandleRing({ useStore, actions }: HandleRingProps) {
  // The ring positions itself from the same transform the canvas surface
  // applies, so it follows pans and zooms without touching the frame; it stands
  // down with its window when that window is fullscreen or culled away.
  const box = useStore((s) => {
    if (s.activeWindowId === null || s.fullscreenWindowId !== null) return null
    const active = s.windows[s.activeWindowId as string]
    if (active === undefined || !isWindowVisible(s, active)) return null
    return windowScreenRect(s, active)
  })
  const activeWindowId = useStore(s => s.activeWindowId)
  const windows = useStore(s => s.windows)
  const cardWindow = activeWindowId === null ? undefined : windows[activeWindowId as string]
  const edges = useMemo(
    () => box === null ? [] : ringEdges(box),
    [box],
  )
  if (cardWindow === undefined || box === null) return null
  return (
    <div data-board-handle-ring="" className={css.ring}>
      {edges.map(([direction, className, rect]) => (
        <RingHandle
          key={direction}
          cardWindow={cardWindow}
          direction={direction}
          rect={rect}
          className={className}
          useStore={useStore}
          actions={actions}
        />
      ))}
    </div>
  )
}

/**
 * The eight handle rectangles around one window box: edge strips (6px) along
 * the borders, corner squares (14px) at their ends — the frame's own handle
 * geometry in panel pixels.
 * @param box - the window's box in panel pixels.
 * @returns direction, cursor class, and rectangle of each handle.
 */
function ringEdges(box: ScreenBox): readonly (readonly [ResizeDirection, string | undefined, ScreenBox])[] {
  const { left, top, right, bottom } = box
  return [
    ['n', css.n, { left: left + 14, top: top - 3, right: right - 14, bottom: top + 3 }],
    ['s', css.s, { left: left + 14, top: bottom - 3, right: right - 14, bottom: bottom + 3 }],
    ['w', css.w, { left: left - 3, top: top + 14, right: left + 3, bottom: bottom - 14 }],
    ['e', css.e, { left: right - 3, top: top + 14, right: right + 3, bottom: bottom - 14 }],
    ['nw', css.nw, { left: left - 4, top: top - 4, right: left + 10, bottom: top + 10 }],
    ['ne', css.ne, { left: right - 10, top: top - 4, right: right + 4, bottom: top + 10 }],
    ['sw', css.sw, { left: left - 4, top: bottom - 10, right: left + 10, bottom: bottom + 4 }],
    ['se', css.se, { left: right - 10, top: bottom - 10, right: right + 4, bottom: bottom + 4 }],
  ]
}
