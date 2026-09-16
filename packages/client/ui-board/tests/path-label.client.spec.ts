/**
 * Working-directory label elision: the path keeps its tail and drops the middle
 * segments first, so the project name stays visible in a narrow chip.
 */
import { describe, expect, it } from 'vitest'
import { elideMiddlePath } from '../src/client/window/path-label.ts'

const PATH = '/Volumes/Projects/Ketos bot.worktrees/stage-04'
const HEAD_AND_TAIL = '/Volumes/…/Ketos bot.worktrees/stage-04'
const TAIL_ONLY = '…/Ketos bot.worktrees/stage-04'
const HEAD_AND_NAME = '/Volumes/…/stage-04'
const ELLIPSIS_NAME = '…/stage-04'

/** A fit predicate that accepts anything up to a length. */
const upTo = (limit: number) => (candidate: string): boolean => candidate.length <= limit

describe('elideMiddlePath', () => {
  it('keeps the full path while it fits', () => {
    expect(elideMiddlePath(PATH, () => true)).toBe(PATH)
  })

  it('drops the middle segments first, keeping the tail whole', () => {
    expect(elideMiddlePath(PATH, upTo(HEAD_AND_TAIL.length))).toBe(HEAD_AND_TAIL)
  })

  it('keeps both tail segments after the head marker stops fitting', () => {
    expect(elideMiddlePath(PATH, upTo(TAIL_ONLY.length))).toBe(TAIL_ONLY)
    expect(elideMiddlePath(PATH, upTo(HEAD_AND_NAME.length))).toBe(HEAD_AND_NAME)
    expect(elideMiddlePath(PATH, upTo(ELLIPSIS_NAME.length))).toBe(ELLIPSIS_NAME)
  })

  it('falls back to the project name when nothing else fits', () => {
    expect(elideMiddlePath(PATH, () => false)).toBe('stage-04')
  })

  it('leaves paths that are already short alone', () => {
    expect(elideMiddlePath('/tmp/x', () => false)).toBe('/tmp/x')
    expect(elideMiddlePath('stage-04', () => false)).toBe('stage-04')
  })

  it('elides along the separator a Windows path uses', () => {
    const windows = 'C:\\Users\\kir\\Ketos bot\\stage-04'
    expect(elideMiddlePath(windows, upTo(30))).toBe('C:\\Users\\…\\Ketos bot\\stage-04')
    expect(elideMiddlePath(windows, upTo(21))).toBe('…\\Ketos bot\\stage-04')
  })
})
