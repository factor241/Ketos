/** Safari pinch state machine: ratios since the previous report around the gesture point. */
import { describe, expect, it, vi } from 'vitest'
import { createBoardPinchGesture } from '../src/client/pinch.ts'

describe('createBoardPinchGesture', () => {
  it('applies each change as a ratio from the previous scale and reports the gesture in flight', () => {
    const zoomBy = vi.fn()
    const pinch = createBoardPinchGesture(zoomBy)
    expect(pinch.active()).toBe(false)

    pinch.start({ scale: 1, clientX: 10, clientY: 20 })
    expect(pinch.active()).toBe(true)

    pinch.change({ scale: 2, clientX: 30, clientY: 40 })
    expect(zoomBy).toHaveBeenLastCalledWith(2, 30, 40)

    // The second report is relative to the first, not to the gesture start.
    pinch.change({ scale: 3, clientX: 30, clientY: 40 })
    expect(zoomBy).toHaveBeenLastCalledWith(1.5, 30, 40)
    expect(zoomBy).toHaveBeenCalledTimes(2)

    pinch.end()
    expect(pinch.active()).toBe(false)
  })

  it('starts a later gesture from the scale the browser opens it with', () => {
    const zoomBy = vi.fn()
    const pinch = createBoardPinchGesture(zoomBy)
    pinch.end()
    pinch.start({ scale: 1.5, clientX: 1, clientY: 2 })
    pinch.change({ scale: 3, clientX: 1, clientY: 2 })
    expect(zoomBy).toHaveBeenLastCalledWith(2, 1, 2)
  })
})
