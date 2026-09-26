/**
 * Safari pinch gestures: `gesturestart` opens one gesture, every
 * `gesturechange` applies the scale ratio since the previous report around the
 * gesture point, and `gestureend` closes it. Chromium reports a pinch as a
 * ctrl+wheel stream instead; the active flag lets the board's wheel handler
 * ignore that stream when one browser delivers both spellings of one pinch.
 */

/** Gesture fields the board reads from a Safari gesture event. */
export interface BoardPinchEvent {
  /** Gesture scale relative to the start; 1 while the fingers have not moved. */
  readonly scale: number
  /** Gesture point in screen pixels. */
  readonly clientX: number
  /** Gesture point in screen pixels. */
  readonly clientY: number
}

/** One pinch gesture in flight. */
export interface BoardPinchGesture {
  /** Whether a pinch is in flight. */
  active(): boolean
  /**
   * Open the gesture at the scale the browser reports.
   * @param event - the opening gesture event (scale is normally 1).
   */
  start(event: BoardPinchEvent): void
  /**
   * Apply the scale ratio since the previous report around the gesture point.
   * @param event - the gesture event carrying the new cumulative scale.
   */
  change(event: BoardPinchEvent): void
  /** Close the gesture. */
  end(): void
}

/**
 * Create the pinch state machine of one board root.
 * @param zoomBy - the store's pointer-anchored zoom, called with each ratio and
 * the gesture's screen-pixel point; the board root maps that point before use.
 * @returns the gesture controller.
 */
export function createBoardPinchGesture(
  zoomBy: (factor: number, pointerX: number, pointerY: number) => void,
): BoardPinchGesture {
  let previousScale = 1
  let inFlight = false
  return {
    active: () => inFlight,
    start: (event) => {
      inFlight = true
      previousScale = event.scale
    },
    change: (event) => {
      zoomBy(event.scale / previousScale, event.clientX, event.clientY)
      previousScale = event.scale
    },
    end: () => {
      inFlight = false
      previousScale = 1
    },
  }
}
