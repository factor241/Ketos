// @vitest-environment jsdom
/**
 * Board pointer gestures: one owner per gesture, ended by pointerup,
 * pointercancel, or the owner's unmount — never a listener left behind.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { useEffect } from 'react'
import { startBoardPointerGesture, useBoardPointerGesture } from '../src/client/pointer-gesture.ts'

/** Minimal element with the two capture verbs the gesture touches. */
/** Capture verbs of one fake element, kept as spies for assertions. */
interface ElementSpies {
  readonly node: HTMLElement
  readonly releasePointerCapture: ReturnType<typeof vi.fn<(pointerId: number) => void>>
}

function element(): ElementSpies {
  const node = document.createElement('div')
  const releasePointerCapture = vi.fn<(pointerId: number) => void>()
  node.setPointerCapture = vi.fn()
  node.releasePointerCapture = releasePointerCapture
  return { node, releasePointerCapture }
}

describe('startBoardPointerGesture', () => {
  it('forwards moves and finishes on pointerup', () => {
    const { node, releasePointerCapture } = element()
    const move = vi.fn()
    const end = vi.fn()
    startBoardPointerGesture(node, 4, { move, end })

    fireEvent.pointerMove(window, { pointerId: 4, clientX: 10 })
    expect(move).toHaveBeenCalledTimes(1)

    fireEvent.pointerUp(window, { pointerId: 4 })
    expect(end).toHaveBeenCalledWith(expect.objectContaining({ pointerId: 4 }))
    expect(releasePointerCapture).toHaveBeenCalledWith(4)

    // The listeners are gone: a later move reaches nothing.
    fireEvent.pointerMove(window, { pointerId: 4, clientX: 40 })
    expect(move).toHaveBeenCalledTimes(1)
  })

  it('finishes on pointercancel like a pointerup', () => {
    const { node } = element()
    const move = vi.fn()
    const end = vi.fn()
    startBoardPointerGesture(node, 5, { move, end })

    fireEvent.pointerCancel(window, { pointerId: 5 })
    expect(end).toHaveBeenCalledWith(expect.objectContaining({ pointerId: 5 }))
    fireEvent.pointerMove(window, { pointerId: 5, clientX: 99 })
    expect(move).not.toHaveBeenCalled()
  })

  it('ignores events from any other pointer while the gesture is live', () => {
    const { node } = element()
    const move = vi.fn()
    const end = vi.fn()
    startBoardPointerGesture(node, 21, { move, end })

    // A second finger's move and lift reach nothing.
    fireEvent.pointerMove(window, { pointerId: 22, clientX: 10 })
    fireEvent.pointerUp(window, { pointerId: 22 })
    fireEvent.pointerCancel(window, { pointerId: 22 })
    expect(move).not.toHaveBeenCalled()
    expect(end).not.toHaveBeenCalled()

    // The owning pointer still drives and ends the same gesture.
    fireEvent.pointerMove(window, { pointerId: 21, clientX: 30 })
    fireEvent.pointerUp(window, { pointerId: 21 })
    expect(move).toHaveBeenCalledTimes(1)
    expect(end).toHaveBeenCalledWith(expect.objectContaining({ pointerId: 21 }))
  })

  it('finishes once when disposed twice, and reports disposal as a null end', () => {
    const { node } = element()
    const end = vi.fn()
    const dispose = startBoardPointerGesture(node, 6, { end })
    dispose()
    dispose()
    expect(end).toHaveBeenCalledTimes(1)
    expect(end).toHaveBeenCalledWith(null)
  })

  it('swallows a capture release miss when the pointer is already gone', () => {
    const { node } = element()
    node.releasePointerCapture = vi.fn(() => { throw new Error('no capture') })
    expect(() => {
      startBoardPointerGesture(node, 7, {})()
    }).not.toThrow()
  })
})

describe('useBoardPointerGesture', () => {
  it('ends the live gesture when its owner unmounts', () => {
    const move = vi.fn()
    const end = vi.fn()
    const { node } = element()

    function Owner() {
      const start = useBoardPointerGesture()
      useEffect(() => {
        start(node, 8, { move, end })
      }, [start])
      return null
    }

    const { unmount } = render(<Owner />)
    fireEvent.pointerMove(window, { pointerId: 8, clientX: 12 })
    expect(move).toHaveBeenCalledTimes(1)

    unmount()
    expect(end).toHaveBeenCalledWith(null)
    fireEvent.pointerMove(window, { pointerId: 8, clientX: 80 })
    expect(move).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('ends the previous gesture when the owner starts a new one', () => {
    const { node: nodeA } = element()
    const { node: nodeB } = element()
    const endA = vi.fn()
    const endB = vi.fn()

    function Owner() {
      const start = useBoardPointerGesture()
      useEffect(() => {
        start(nodeA, 9, { end: endA })
        start(nodeB, 10, { end: endB })
      }, [start])
      return null
    }

    render(<Owner />)
    expect(endA).toHaveBeenCalledWith(null)
    fireEvent.pointerUp(window, { pointerId: 10 })
    expect(endB).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('keeps the first gesture unended while nothing replaces it', () => {
    const { node } = element()
    const end = vi.fn()

    function Owner() {
      const start = useBoardPointerGesture()
      useEffect(() => { start(node, 11, { end }) }, [start])
      return null
    }
    const { rerender } = render(<Owner />)
    rerender(<Owner />)
    expect(end).not.toHaveBeenCalled()
    cleanup()
  })
})
