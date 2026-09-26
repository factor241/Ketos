/** Keyboard view commands: engaged only inside the board, never outside it. */
import { describe, expect, it } from 'vitest'
import { classifyBoardZoomKey } from '../src/client/keyboard-zoom.ts'

describe('classifyBoardZoomKey', () => {
  it('maps Cmd/Ctrl+0 to the view reset and Cmd/Ctrl+=/− to inverse zoom steps', () => {
    expect(classifyBoardZoomKey({ metaKey: true, ctrlKey: false, key: '0' }, true)).toEqual({ kind: 'reset' })
    expect(classifyBoardZoomKey({ metaKey: false, ctrlKey: true, key: '0' }, true)).toEqual({ kind: 'reset' })
    expect(classifyBoardZoomKey({ metaKey: true, ctrlKey: false, key: '=' }, true)).toEqual({ kind: 'zoom', factor: 1.25 })
    expect(classifyBoardZoomKey({ metaKey: true, ctrlKey: false, key: '+' }, true)).toEqual({ kind: 'zoom', factor: 1.25 })
    expect(classifyBoardZoomKey({ metaKey: false, ctrlKey: true, key: '-' }, true)).toEqual({ kind: 'zoom', factor: 0.8 })
    expect(classifyBoardZoomKey({ metaKey: false, ctrlKey: true, key: '_' }, true)).toEqual({ kind: 'zoom', factor: 0.8 })
  })

  it('takes nothing outside the board or without a command modifier', () => {
    expect(classifyBoardZoomKey({ metaKey: true, ctrlKey: false, key: '0' }, false)).toBeNull()
    expect(classifyBoardZoomKey({ metaKey: false, ctrlKey: false, key: '=' }, true)).toBeNull()
    expect(classifyBoardZoomKey({ metaKey: true, ctrlKey: false, key: 'a' }, true)).toBeNull()
  })
})
