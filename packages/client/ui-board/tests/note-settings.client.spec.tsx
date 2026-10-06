// @vitest-environment jsdom
/**
 * Note settings menu: one patch per choice with the exact fields, the scale
 * doubling the world rectangle, Escape and outside-click dismissal, and the
 * absent button for a foreign or undecodable note.
 */
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { BoardElement, ElementId, OwnerId } from '@ketos/board-doc/types'
import { NoteSettingsButton } from '../src/client/elements/NoteSettingsButton.tsx'
import { en, type BoardKey, type BoardTranslate } from '../src/client/locale.ts'

afterEach(() => { cleanup() })

const ID = brandString<ElementId>('00000000-0000-4000-8000-0000000000a1')

/** English-bound locale seat for the direct renders. */
const t: BoardTranslate = key => en[key as BoardKey]

/** One valid note element with test overrides. */
function element(overrides: Partial<BoardElement> = {}): BoardElement {
  return {
    id: ID,
    kind: 'note',
    ownerId: brandString<OwnerId>('demo-self'),
    x: 0,
    y: 0,
    w: 240,
    h: 160,
    z: 1,
    data: { text: 'hello', font: 'sans', size: 'm', scale: 1 },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

/**
 * Direct-render props for the settings button.
 * @param note - element to configure.
 * @param editable - whether the acting participant owns it.
 * @param patchElement - injected patch verb stub.
 * @returns the props.
 */
function props(note: BoardElement, editable: boolean, patchElement: ReturnType<typeof vi.fn>): never {
  return {
    element: note,
    editable,
    useStore: (selector: (state: unknown) => unknown): unknown => selector({
      boardLimits: { elementBytesMax: 262_144, noteTextMax: 20_000 },
      selfId: null,
    }),
    t,
    patchElement,
  } as never
}

/** Open the settings menu through its trigger. */
function openMenu(): void {
  fireEvent.click(screen.getByRole('button', { name: t('note.settings') }))
}

describe('note settings menu', () => {
  it('sends exactly one patch per choice with the selected fields', () => {
    const patchElement = vi.fn()
    render(createElement(NoteSettingsButton, props(element(), true, patchElement)))

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: t('note.font.serif') }))
    expect(patchElement).toHaveBeenCalledTimes(1)
    expect(patchElement).toHaveBeenLastCalledWith(ID, { data: { font: 'serif' } })
    expect(screen.queryByRole('menu')).toBeNull()

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: t('note.size.l') }))
    expect(patchElement).toHaveBeenCalledTimes(2)
    expect(patchElement).toHaveBeenLastCalledWith(ID, { data: { size: 'l' } })
    expect(screen.queryByRole('menu')).toBeNull()

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /^200\s*%$/u }))
    expect(patchElement).toHaveBeenCalledTimes(3)
    expect(patchElement).toHaveBeenLastCalledWith(ID, { w: 480, h: 320, data: { scale: 2 } })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('scales the world rectangle from any stored step', () => {
    const patchElement = vi.fn()
    render(createElement(NoteSettingsButton, props(element({ w: 300, h: 200, data: { text: 'x', font: 'sans', size: 'm', scale: 2 } }), true, patchElement)))
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /^50\s*%$/u }))
    expect(patchElement).toHaveBeenCalledWith(ID, { w: 75, h: 50, data: { scale: 0.5 } })
  })

  it('closes on Escape and on an outside pointerdown', () => {
    render(createElement(NoteSettingsButton, props(element(), true, vi.fn())))
    openMenu()
    expect(screen.getByRole('menu')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()

    openMenu()
    expect(screen.getByRole('menu')).not.toBeNull()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('offers no button for a foreign note', () => {
    render(createElement(NoteSettingsButton, props(element({ ownerId: brandString<OwnerId>('demo-legal') }), false, vi.fn())))
    expect(screen.queryByRole('button', { name: t('note.settings') })).toBeNull()
  })

  it('offers no button for data the decoder refuses', () => {
    render(createElement(NoteSettingsButton, props(element({ data: {} }), true, vi.fn())))
    expect(screen.queryByRole('button', { name: t('note.settings') })).toBeNull()
  })
})
