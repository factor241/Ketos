/**
 * React entry views for the Spatial Board slot registrations.
 *
 * The root owns the board's layer ladder: the canvas grid and its windows
 * (z-index 10–99, see `WINDOW_Z_MAX`), the floating chrome — dock, omnibar,
 * minimap — at 100, the element-selection overlay at 500, and the fullscreen
 * frame (with an overlay chats panel) at 1000. `isolation: isolate` contains
 * that ladder inside the board box, so an app-level overlay above the box
 * stays above every board layer instead of losing hit-testing to the chrome.
 */
import { useEffect, useRef } from 'react'
import type { PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardStoreHandle } from './store.ts'
import { ElementSelectionOverlay } from './ElementSelectionOverlay.tsx'
import { HandleRing } from './window/HandleRing.tsx'
import { wheelZoomsBoard } from './canvas/wheel-zoom.ts'
import css from './BoardViews.module.css'

/** Props of the board main-panel body: the child render share, the store share, and the locale seat. */
export type BoardRootProps =
  PropsRuntime<'main'>
  & PropsRenderSlots<'board.canvas' | 'board.dock' | 'board.omnibar' | 'board.minimap'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>

export function BoardRoot({ renderSlot, useStore, actions, t }: BoardRootProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const selecting = useStore(s => s.isSelectingElement)
  // A fullscreen window fills the panel, so its chrome stands down. An open
  // chats panel is a management surface: the dock and minimap would otherwise
  // cover its outer edge and resize handle.
  const fullscreen = useStore(s => s.fullscreenWindowId !== null)
  const panelOpen = useStore(s => s.panelWindowId !== null)

  // Wheel zoom toward the pointer. React's `onWheel` is a passive listener,
  // so zooming logs a preventDefault error through it; a native non-passive
  // listener on the root also covers the floating chrome, which sits beside
  // the canvas rather than inside it.
  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    const onWheel = (event: WheelEvent): void => {
      if (fullscreen || !wheelZoomsBoard(event.target)) return
      event.preventDefault()
      const box = root.getBoundingClientRect()
      actions.zoomTowardPointer(event.deltaY, event.clientX - box.left, event.clientY - box.top)
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => { root.removeEventListener('wheel', onWheel) }
  }, [fullscreen, actions])

  return (
    <div ref={rootRef} data-surface="board" className={css.root}>
      {renderSlot('board.canvas', {})}
      {!fullscreen && !panelOpen && renderSlot('board.dock', {})}
      {!fullscreen && renderSlot('board.omnibar', {})}
      {!fullscreen && !panelOpen && renderSlot('board.minimap', {})}
      {/* The active window's handle ring rides above the chrome, so a resize
          handle stays grabbable when its window edge sits under a floating
          layer; the selection overlay still paints above both. */}
      {!fullscreen && <HandleRing useStore={useStore} actions={actions} />}
      <ElementSelectionOverlay
        t={t}
        active={selecting}
        onCancel={() => { actions.setSelectingElement(false) }}
      />
    </div>
  )
}

export function BoardIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={css.icon}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="21" x2="9" y2="9" />
    </svg>
  )
}
