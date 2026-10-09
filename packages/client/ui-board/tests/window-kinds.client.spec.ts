// The documented-kind copies the browser layout and the host document each
// hold must stay identical: the host validates what the browser publishes.
import { describe, expect, it } from 'vitest'
import {
  BOARD_WINDOW_BODY_KINDS as DOC_BODY_KINDS, BOARD_WINDOW_KINDS as DOC_KINDS,
  BOARD_WINDOW_STATUSES as DOC_STATUSES,
} from '@ketos/board-doc/kinds'
import {
  BOARD_WINDOW_BODY_KINDS as LAYOUT_BODY_KINDS, BOARD_WINDOW_KINDS as LAYOUT_KINDS,
} from '../src/board-settings.ts'
import { WINDOW_STATUS_DOT } from '../src/client/window-status.ts'

describe('board window kind parity', () => {
  it('keeps the host copies equal to the client layout vocabulary', () => {
    expect(DOC_KINDS).toEqual(LAYOUT_KINDS)
    expect(DOC_BODY_KINDS).toEqual(LAYOUT_BODY_KINDS)
    expect([...DOC_STATUSES].sort()).toEqual(Object.keys(WINDOW_STATUS_DOT).sort())
  })
})
