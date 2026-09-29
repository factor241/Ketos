/**
 * Page pinch-zoom guard of the app shell (decision R-2): page zoom stays on
 * the browser's `Cmd/Ctrl +/−/0` shortcuts, so an accidental trackpad pinch
 * must not scale the whole interface. The guard listens on the shell frame's
 * document — menus, tooltips, and dialogs that portal into `document.body`
 * sit outside the frame's subtree, so a frame-bound listener would miss them
 * (П-37) — and prevents ctrl+wheel (Chromium's pinch) and Safari gesture events
 * outside the board, while everything inside `[data-surface="board"]` keeps its
 * own pinch handling.
 */

/** Board marker: the one surface that handles its own pinch. */
const BOARD_SURFACE = '[data-surface="board"]'

/** Whether one event target lies inside the board surface. */
function insideBoard(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(BOARD_SURFACE) !== null
}

/**
 * Install the page pinch-zoom guard for one app root.
 * @param root - the shell frame element; listeners attach to its document so body-level portals are covered.
 * @param block - whether the guard is enabled; false installs nothing.
 * @returns a disposer removing every installed listener.
 */
export function installPagePinchGuard(root: HTMLElement, block: boolean): () => void {
  if (!block) return () => {}
  const doc = root.ownerDocument
  const onWheel = (event: WheelEvent): void => {
    if (!event.ctrlKey || insideBoard(event.target)) return
    event.preventDefault()
  }
  const onGesture = (event: Event): void => {
    if (insideBoard(event.target)) return
    event.preventDefault()
  }
  doc.addEventListener('wheel', onWheel, { passive: false })
  doc.addEventListener('gesturestart', onGesture)
  doc.addEventListener('gesturechange', onGesture)
  doc.addEventListener('gestureend', onGesture)
  return () => {
    doc.removeEventListener('wheel', onWheel)
    doc.removeEventListener('gesturestart', onGesture)
    doc.removeEventListener('gesturechange', onGesture)
    doc.removeEventListener('gestureend', onGesture)
  }
}
