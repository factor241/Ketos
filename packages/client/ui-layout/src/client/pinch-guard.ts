/**
 * Page pinch-zoom guard of the app shell (decision R-2): page zoom stays on
 * the browser's `Cmd/Ctrl +/−/0` shortcuts, so an accidental trackpad pinch
 * must not scale the whole interface. The guard owns the frame root: it
 * prevents ctrl+wheel (Chromium's pinch) and Safari gesture events outside the
 * board, and leaves everything inside `[data-surface="board"]` alone, because
 * the board handles its own pinch.
 */

/** Board marker: the one surface that handles its own pinch. */
const BOARD_SURFACE = '[data-surface="board"]'

/** Whether one event target lies inside the board surface. */
function insideBoard(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(BOARD_SURFACE) !== null
}

/**
 * Install the page pinch-zoom guard on one app root.
 * @param root - the element the listeners attach to (the shell frame).
 * @param block - whether the guard is enabled; false installs nothing.
 * @returns a disposer removing every installed listener.
 */
export function installPagePinchGuard(root: HTMLElement, block: boolean): () => void {
  if (!block) return () => {}
  const onWheel = (event: WheelEvent): void => {
    if (!event.ctrlKey || insideBoard(event.target)) return
    event.preventDefault()
  }
  const onGesture = (event: Event): void => {
    if (insideBoard(event.target)) return
    event.preventDefault()
  }
  root.addEventListener('wheel', onWheel, { passive: false })
  root.addEventListener('gesturestart', onGesture)
  root.addEventListener('gesturechange', onGesture)
  root.addEventListener('gestureend', onGesture)
  return () => {
    root.removeEventListener('wheel', onWheel)
    root.removeEventListener('gesturestart', onGesture)
    root.removeEventListener('gesturechange', onGesture)
    root.removeEventListener('gestureend', onGesture)
  }
}
