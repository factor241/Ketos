// @vitest-environment jsdom
/**
 * Dictation session ownership: a recognition session that ends after the next
 * one started must not clear the live session's state, or the microphone would
 * keep recording with no control able to stop it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useDictation } from '../src/client/dictation.tsx'

/** One scripted recognition session the fake constructor hands out. */
interface FakeSession {
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  end: () => void
  error: () => void
}

const sessions: FakeSession[] = []

/** Install a recognition constructor whose sessions the test can end by hand. */
function installRecognition(): void {
  class FakeRecognition {
    lang = ''
    continuous = false
    interimResults = false
    onresult = null
    onend: (() => void) | null = null
    onerror: (() => void) | null = null
    start = vi.fn()
    stop = vi.fn()
    constructor() {
      const session: FakeSession = {
        start: this.start,
        stop: this.stop,
        end: () => { this.onend?.() },
        error: () => { this.onerror?.() },
      }
      sessions.push(session)
    }
  }
  ;(globalThis as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRecognition
}

afterEach(() => {
  cleanup()
  sessions.length = 0
  Reflect.deleteProperty(globalThis, 'SpeechRecognition')
})

describe('useDictation', () => {
  it('ignores a stopped session ending after the next one started', () => {
    installRecognition()
    const onText = vi.fn()
    const { result } = renderHook(() => useDictation(onText))

    act(() => { result.current.toggle() })
    expect(result.current.listening).toBe(true)
    expect(sessions).toHaveLength(1)

    act(() => { result.current.stop() })
    expect(result.current.listening).toBe(false)
    expect(sessions[0]?.stop).toHaveBeenCalledTimes(1)

    act(() => { result.current.toggle() })
    expect(result.current.listening).toBe(true)
    expect(sessions).toHaveLength(2)

    // The first session's engine reports its end late: the live session must
    // stay listening and stay stoppable.
    act(() => { sessions[0]?.end() })
    expect(result.current.listening).toBe(true)

    act(() => { result.current.toggle() })
    expect(result.current.listening).toBe(false)
    expect(sessions[1]?.stop).toHaveBeenCalledTimes(1)
  })

  it('clears the state when the live session ends by itself', () => {
    installRecognition()
    const { result } = renderHook(() => useDictation(vi.fn()))
    act(() => { result.current.toggle() })
    act(() => { sessions[0]?.error() })
    expect(result.current.listening).toBe(false)
  })

  it('reports an unsupported engine instead of pretending to listen', () => {
    const { result } = renderHook(() => useDictation(vi.fn()))
    expect(result.current.supported).toBe(false)
    act(() => { result.current.toggle() })
    expect(result.current.listening).toBe(false)
  })
})
