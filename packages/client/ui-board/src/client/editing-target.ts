/**
 * Text-entry guard shared by the board's keyboard shortcuts: a focused editor
 * owns Space, Delete, and Escape, so canvas and window shortcuts defer to it.
 */

/**
 * Whether a key or pointer event landed on a text editor (input, textarea, or
 * a contenteditable surface).
 * @param target - the event target.
 * @returns true when the target edits text.
 */
export function isBoardEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
}
