/**
 * Wheel decision for the board root: one pure classifier says whether an event
 * zooms the canvas around the pointer, pans it, or keeps its own surface, and
 * the helpers below turn the gesture into the store's pan delta and zoom
 * factor. A trackpad pinch reaches the browser as ctrl+wheel; a plain wheel or
 * two-finger swipe is navigation (R-4: `wheelMode` selects what a plain wheel
 * does over the canvas and the floating chrome).
 */

/** Wheel fields the board's decision reads; a DOM `WheelEvent` satisfies it. */
export interface BoardWheelEvent {
  /** Whether the control key is held (a trackpad pinch in Chromium). */
  readonly ctrlKey: boolean
  /** Whether the meta key is held (a pinch reported through the command modifier). */
  readonly metaKey: boolean
  /** Horizontal wheel delta in the event's own unit. */
  readonly deltaX: number
  /** Vertical wheel delta in the event's own unit. */
  readonly deltaY: number
  /** Delta unit: 0 pixels, 1 lines, 2 pages. */
  readonly deltaMode: number
  /** Whether shift is held: a vertical wheel pans horizontally. */
  readonly shiftKey: boolean
}

/** What an unmodified wheel does over the canvas and the floating chrome. */
export type BoardWheelMode = 'pan' | 'zoom'

/** What the board root does with one wheel event. */
export type BoardWheelClassification = 'zoom' | 'pan' | 'native'

/** Surfaces whose own scrolling keeps an unmodified wheel event. */
const NATIVE_WHEEL_TARGETS = '[data-board-window], [data-board-panel], [role="menu"]'

/** Board root marker: events outside it never reach the board's listener. */
const BOARD_SURFACE = '[data-surface="board"]'

/** Largest normalized wheel delta one event contributes, in CSS pixels. */
const WHEEL_DELTA_CLAMP = 50

/** Height of one text line for `deltaMode` 1 (lines), in CSS pixels. */
const WHEEL_LINE_HEIGHT = 16

/**
 * Classify one wheel event over the board root. Events outside the board stay
 * native; ctrl/meta inside it always zooms, windows, an open chats panel, and
 * scrollable menus included; a plain event over those scrolling surfaces stays
 * native and over the canvas or the floating chrome follows `mode`.
 * @param event - the wheel event's modifier fields.
 * @param target - the wheel event's target.
 * @param mode - what an unmodified wheel does over the canvas and floating chrome.
 * @returns what the board does with the event.
 */
export function classifyBoardWheel(
  event: BoardWheelEvent,
  target: EventTarget | null,
  mode: BoardWheelMode,
): BoardWheelClassification {
  if (!(target instanceof Element) || target.closest(BOARD_SURFACE) === null) return 'native'
  if (event.ctrlKey || event.metaKey) return 'zoom'
  if (target.closest(NATIVE_WHEEL_TARGETS) !== null) return 'native'
  return mode === 'zoom' ? 'zoom' : 'pan'
}

/** What the board root does with one wheel event. */
export interface BoardWheelDecision {
  /** The classifier's verdict. */
  readonly classification: BoardWheelClassification
  /** Whether the handler prevents the browser default. */
  readonly preventDefault: boolean
  /** Whether the board applies the pan or zoom. */
  readonly apply: boolean
}

/**
 * Resolve the handler's full decision for one wheel event.
 * @param event - the wheel event's modifier fields.
 * @param target - the wheel event's target.
 * @param mode - what an unmodified wheel does over the canvas and floating chrome.
 * @returns the classification, whether to prevent the default, and whether to apply it.
 */
export function resolveBoardWheel(
  event: BoardWheelEvent,
  target: EventTarget | null,
  mode: BoardWheelMode,
): BoardWheelDecision {
  const classification = classifyBoardWheel(event, target, mode)
  if (classification === 'native') return { classification, preventDefault: false, apply: false }
  return { classification, preventDefault: true, apply: true }
}

/** Screen-pixel pan the board applies for one wheel event. */
export interface BoardWheelPan {
  /** Horizontal pan in screen pixels. */
  readonly x: number
  /** Vertical pan in screen pixels. */
  readonly y: number
}

/**
 * The screen-pixel delta one panning wheel event moves the board by. Shift
 * turns a vertical wheel into horizontal panning, as canvas apps do.
 * @param event - the wheel event's delta and shift fields.
 * @returns the delta the board subtracts from its pan.
 */
export function wheelPanDelta(event: Pick<BoardWheelEvent, 'deltaX' | 'deltaY' | 'shiftKey'>): BoardWheelPan {
  if (!event.shiftKey) return { x: event.deltaX, y: event.deltaY }
  return { x: event.deltaY, y: event.deltaX }
}

/**
 * The proportional zoom factor one wheel event applies: `exp(−Δ·k)` over the
 * delta normalized to CSS pixels (`deltaMode` 0 pixels, 1 lines ×16, 2 pages ×
 * the board height) and clamped to ±{@link WHEEL_DELTA_CLAMP} per event, so an
 * inertial tail cannot cross the whole zoom range in one flick.
 * @param event - the wheel event's vertical delta and its unit.
 * @param boardHeight - the board box height in CSS pixels, the unit of page deltas.
 * @param sensitivity - the configured `k`; larger values zoom faster.
 * @returns the factor the store multiplies the current zoom by.
 */
export function wheelZoomFactor(
  event: Pick<BoardWheelEvent, 'deltaY' | 'deltaMode'>,
  boardHeight: number,
  sensitivity: number,
): number {
  let delta: number
  switch (event.deltaMode) {
    case 1: delta = event.deltaY * WHEEL_LINE_HEIGHT; break
    case 2: delta = event.deltaY * boardHeight; break
    // A nonstandard unit is treated as pixels: the only fallback browsers use.
    default: delta = event.deltaY
  }
  const clamped = Math.min(WHEEL_DELTA_CLAMP, Math.max(-WHEEL_DELTA_CLAMP, delta))
  return Math.exp(-clamped * sensitivity)
}
