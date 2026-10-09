// @vitest-environment jsdom
/**
 * Access indicator: the people a `selected` window names are part of the
 * accessible name, so a keyboard or screen-reader user reads them without
 * the hover tooltip.
 */
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { AccessIndicator, type AccessPerson } from '../src/client/window/AccessIndicator.tsx'
import { en, type BoardKey, type BoardTranslate } from '../src/client/locale.ts'

afterEach(() => { cleanup() })

/** English-bound locale seat with parameter substitution. */
const t: BoardTranslate = (key, params) => en[key as BoardKey].replace(
  /\{(\w+)\}/gu,
  (_match, name: string) => {
    const value = params?.[name]
    return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  },
)

const PEOPLE: readonly AccessPerson[] = [
  { color: '1', label: 'Alice' },
  { color: '2', label: 'Bob' },
]

describe('access indicator names', () => {
  it('names the selected people on the trigger button', () => {
    render(createElement(AccessIndicator, { mode: 'selected', people: PEOPLE, t, onTriggerClick: vi.fn() }))
    const trigger = screen.getByRole('button')
    expect(trigger.getAttribute('aria-label')).toBe('Access: Selected people: Alice, Bob')
  })

  it('names the selected people on the informational caption', () => {
    render(createElement(AccessIndicator, { mode: 'selected', people: PEOPLE, t }))
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Selected people: Alice, Bob')
  })

  it('keeps the plain mode name for the other modes and for an empty selection', () => {
    render(createElement(AccessIndicator, { mode: 'selected', people: [], t }))
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Selected people')
    cleanup()
    render(createElement(AccessIndicator, { mode: 'all', people: [], t }))
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('All board participants')
  })
})
