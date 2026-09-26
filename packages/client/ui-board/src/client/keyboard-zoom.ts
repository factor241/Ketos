/**
 * Keyboard view commands of the board: `Cmd/Ctrl + 0`, `+=`, and `−` resolve
 * to board commands only while the pointer or keyboard focus is inside the
 * board root, so the browser keeps its page-zoom shortcuts everywhere else.
 */

/** Key fields a board zoom shortcut reads; a DOM `KeyboardEvent` satisfies it. */
export interface BoardZoomKey {
  /** Whether the meta key is held. */
  readonly metaKey: boolean
  /** Whether the control key is held. */
  readonly ctrlKey: boolean
  /** The key value the browser reports. */
  readonly key: string
}

/** A board view command one keyboard shortcut asks for. */
export type BoardZoomCommand =
  | { readonly kind: 'reset' }
  | { readonly kind: 'zoom'; readonly factor: number }

/** Zoom factor one zoom-in key press applies; zoom-out applies its reciprocal. */
const KEYBOARD_ZOOM_STEP = 1.25

/**
 * Resolve one keydown into a board view command.
 * @param event - the keydown's modifier and key fields.
 * @param insideBoard - whether the pointer or focus is inside the board root.
 * @returns the board command, or null when the key is not a board zoom shortcut or the board is not engaged.
 */
export function classifyBoardZoomKey(event: BoardZoomKey, insideBoard: boolean): BoardZoomCommand | null {
  if (!insideBoard || !(event.metaKey || event.ctrlKey)) return null
  switch (event.key) {
    case '0': return { kind: 'reset' }
    case '=':
    case '+': return { kind: 'zoom', factor: KEYBOARD_ZOOM_STEP }
    case '-':
    case '_': return { kind: 'zoom', factor: 1 / KEYBOARD_ZOOM_STEP }
    // Any other key is an ordinary keydown; the browser keeps it.
    default: return null
  }
}
