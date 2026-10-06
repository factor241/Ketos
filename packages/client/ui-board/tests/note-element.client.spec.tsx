// @vitest-environment jsdom
/**
 * Note body: the font, size, and scale variables the owner's data selects, the
 * scaled content coordinate system, the native-wheel marker, and the neutral
 * fallback for data that fails the decoder.
 */
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { BoardElement, ElementId, OwnerId } from '@ketos/board-doc/types'
import { NoteElement } from '../src/client/elements/NoteElement.tsx'
import { en, type BoardKey, type BoardTranslate } from '../src/client/locale.ts'

afterEach(() => { cleanup() })

const ID = brandString<ElementId>('00000000-0000-4000-8000-0000000000a1')

/** English-bound locale seat for the direct renders. */
const t: BoardTranslate = key => en[key as BoardKey]

/** One note element with test overrides. */
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
 * Direct-render props: the owner share plus a store seat reading the limits.
 * @param note - the element to render.
 * @param noteTextMax - the published text bound; null renders before a snapshot.
 * @returns the props.
 */
function props(note: BoardElement, noteTextMax: number | null = 20_000): never {
  return {
    element: note,
    selected: false,
    editable: true,
    useStore: (selector: (state: unknown) => unknown): unknown => selector({
      boardLimits: noteTextMax === null ? null : { elementBytesMax: 262_144, noteTextMax },
    }),
    t,
  } as never
}

describe('note element body', () => {
  it('selects each font through the content attribute', () => {
    for (const font of ['sans', 'serif', 'mono']) {
      const { container, unmount } = render(createElement(NoteElement, props(element({ data: { text: 'x', font, size: 'm', scale: 1 } }))))
      expect(container.querySelector('[data-board-note-content]')?.getAttribute('data-board-note-font'), font).toBe(font)
      unmount()
    }
  })

  it('selects each text size through the content attribute', () => {
    for (const size of ['s', 'm', 'l']) {
      const { container, unmount } = render(createElement(NoteElement, props(element({ data: { text: 'x', font: 'sans', size, scale: 1 } }))))
      expect(container.querySelector('[data-board-note-content]')?.getAttribute('data-board-note-size'), size).toBe(size)
      unmount()
    }
  })

  it('draws the scaled content at w/scale × h/scale', () => {
    const { container } = render(createElement(NoteElement, props(element({ w: 240, h: 160, data: { text: 'x', font: 'sans', size: 'm', scale: 2 } }))))
    const content = container.querySelector('[data-board-note-content]') as HTMLElement
    expect(content.style.width).toBe('120px')
    expect(content.style.height).toBe('80px')
    expect(content.style.transform).toBe('scale(2)')
  })

  it('keeps the native wheel on the scroll area', () => {
    const { container } = render(createElement(NoteElement, props(element())))
    expect(container.querySelector('[data-board-note]')?.getAttribute('data-board-wheel')).toBe('native')
  })

  it('renders the neutral body for data the decoder refuses', () => {
    for (const data of [
      {},
      { text: 'x', font: 'cursive', size: 'm', scale: 1 },
      { text: 'x', font: 'sans', size: 'm', scale: 0.6 },
      { text: 'x', font: 'sans', size: 'm', scale: 1, extra: 1 },
      { text: 'x'.repeat(20_001), font: 'sans', size: 'm', scale: 1 },
    ]) {
      const { container, unmount } = render(createElement(NoteElement, props(element({ data }))))
      expect(container.querySelector('[data-board-element-neutral="note"]'), JSON.stringify(data).slice(0, 40)).not.toBeNull()
      expect(container.querySelector('[data-board-note]')).toBeNull()
      unmount()
    }
  })

  it('renders the neutral body until the snapshot publishes the limits', () => {
    const { container } = render(createElement(NoteElement, props(element(), null)))
    expect(container.querySelector('[data-board-element-neutral="note"]')).not.toBeNull()
  })
})
