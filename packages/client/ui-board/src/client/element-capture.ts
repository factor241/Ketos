/**
 * Deterministic capture of one board element: the `:nth-of-type` selector the
 * chip carries into the composer, and a language-neutral description of the
 * DOM facts the model can use to locate the element.
 */

/** One captured element's selector and description. */
export interface ElementCapture {
  /** Ordered, language-neutral summary of the element's stable facts. */
  readonly description: string
  /** `tag:nth-of-type(n)` path anchored at the board surface, or at `body`. */
  readonly selector: string
}

/** Longest collapsed text fragment the description carries. */
const TEXT_LIMIT = 60

/** The board root's attribute anchor. */
const BOARD_SURFACE = '[data-surface="board"]'

/** Lowercase tag name of one element. */
function tagOf(element: Element): string {
  return element.tagName.toLowerCase()
}

/** 1-based index of the element among its same-tag element siblings. */
function nthOfType(element: Element): number {
  let index = 1
  for (let sibling = element.previousElementSibling; sibling !== null; sibling = sibling.previousElementSibling) {
    if (sibling.tagName === element.tagName) index += 1
  }
  return index
}

/**
 * Build the deterministic selector: one `tag:nth-of-type(n)` segment per
 * ancestor step, anchored at the nearest board surface when there is one and
 * at `body` otherwise.
 * @param element - the element to address.
 * @returns the selector path.
 */
function selectorOf(element: Element): string {
  const parts: string[] = []
  for (let current: Element | null = element; current !== null; current = current.parentElement) {
    if (current.matches(BOARD_SURFACE)) {
      parts.unshift(BOARD_SURFACE)
      break
    }
    if (current === document.body) {
      parts.unshift('body')
      break
    }
    parts.unshift(`${tagOf(current)}:nth-of-type(${String(nthOfType(current))})`)
  }
  return parts.join(' > ')
}

/** Collapse whitespace runs, trim, and cap the fragment at the text limit. */
function textOf(element: Element): string {
  const collapsed = element.textContent.replace(/\s+/g, ' ').trim()
  return collapsed.length > TEXT_LIMIT ? collapsed.slice(0, TEXT_LIMIT) : collapsed
}

/**
 * Describe one board element from stable facts: its tag, the window it sits in
 * when there is one, its automation id, accessible name, tooltip, and a capped
 * text fragment, joined in that order. The description is language-neutral;
 * only the wrapping chip is localized.
 * @param element - the element to describe.
 * @returns the description and selector of the element.
 */
export function describeElement(element: Element): ElementCapture {
  const parts = [tagOf(element)]

  const windowElement = element.closest('[data-board-window]')
  if (windowElement !== null) {
    /* v8 ignore next -- closest() matched the attribute selector, so the value is present. */
    const kind = windowElement.getAttribute('data-board-window') ?? ''
    if (kind !== '') {
      // The frame carries the kind; the resolved title rides its header control
      // (or the frame itself in a stripped-down tree).
      const titleElement = windowElement.matches('[data-board-title]')
        ? windowElement
        : windowElement.querySelector('[data-board-title]')
      const title = titleElement?.getAttribute('data-board-title') ?? ''
      parts.push(title === '' ? `window ${kind}` : `window ${kind} ${title}`)
    }
  }

  for (const attribute of ['data-board-action', 'aria-label', 'title'] as const) {
    const value = element.getAttribute(attribute)
    if (value !== null && value !== '') parts.push(value)
  }

  const text = textOf(element)
  if (text !== '') parts.push(text)

  return { description: parts.join(' · '), selector: selectorOf(element) }
}
