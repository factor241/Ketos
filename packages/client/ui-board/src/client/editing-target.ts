/**
 * Key-target guards shared by the board's keyboard shortcuts: a focused editor
 * owns Space, Delete, and Escape, and a focused button or button role owns
 * Enter and Space, so canvas and window shortcuts defer to them.
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

/** Selector of elements whose own key handling takes Delete, Backspace, Enter, and Space. */
const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'summary',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="option"]',
].join(',')

/**
 * Whether a key event landed on a button, a link, or an element with a
 * button-like role (or inside one). Such a control activates on Enter and
 * Space and is not a board surface, so Delete, Backspace, Enter, and Space do
 * not act on the selected element and Space keeps its default action.
 * @param target - the event target.
 * @returns true when the target is or sits inside an interactive control.
 */
export function isBoardInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null
}
