// @vitest-environment jsdom
/** Element capture: deterministic selector paths and the language-neutral description. */
import { afterEach, describe, expect, it } from 'vitest'
import { describeElement } from '../src/client/element-capture.ts'

afterEach(() => { document.body.innerHTML = '' })

describe('describeElement selector', () => {
  it('anchors at the board surface and counts same-tag siblings', () => {
    document.body.innerHTML = [
      '<div data-surface="board">',
      '<div data-board-window="agent"></div>',
      '<section><p>other</p></section>',
      '<section><p>one</p><p id="target">two</p></section>',
      '</div>',
    ].join('')
    const capture = describeElement(document.querySelector('#target') as Element)
    expect(capture.selector).toBe('[data-surface="board"] > section:nth-of-type(2) > p:nth-of-type(2)')
  })

  it('uses the board surface itself as the literal anchor', () => {
    document.body.innerHTML = '<div data-surface="board"><span></span></div>'
    const board = document.querySelector('[data-surface="board"]') as Element
    expect(describeElement(board).selector).toBe('[data-surface="board"]')
  })

  it('anchors at body when no board surface wraps the element', () => {
    document.body.innerHTML = '<main><div>a</div><div id="target"></div><div>b</div></main>'
    const capture = describeElement(document.querySelector('#target') as Element)
    expect(capture.selector).toBe('body > main:nth-of-type(1) > div:nth-of-type(2)')
  })

  it('keeps the element path for a detached element', () => {
    const host = document.createElement('div')
    const first = document.createElement('p')
    const second = document.createElement('p')
    host.append(first, second)
    expect(describeElement(second).selector).toBe('div:nth-of-type(1) > p:nth-of-type(2)')
  })
})

describe('describeElement description', () => {
  it('joins the window, action, accessible name, tooltip, and text in order', () => {
    document.body.innerHTML = [
      '<div data-board-window="dashboard" data-board-title="Ops">',
      '<button data-board-action="window-chats" aria-label="Chats" title="Open chats">',
      'Two <em>words</em>',
      '</button>',
      '</div>',
    ].join('')
    const capture = describeElement(document.querySelector('button') as Element)
    expect(capture.description).toBe('button · window dashboard Ops · window-chats · Chats · Open chats · Two words')
  })

  it('names the window kind alone when the window carries no title', () => {
    document.body.innerHTML = '<div data-board-window="agent"><span>hi</span></div>'
    expect(describeElement(document.querySelector('span') as Element).description).toBe('span · window agent · hi')

    document.body.innerHTML = '<div data-board-window="agent" data-board-title=""><span>hi</span></div>'
    expect(describeElement(document.querySelector('span') as Element).description).toBe('span · window agent · hi')
  })

  it('omits absent and empty facts', () => {
    document.body.innerHTML = '<div data-board-window=""><span data-board-action="" title=""></span></div>'
    expect(describeElement(document.querySelector('span') as Element).description).toBe('span')
  })

  it('collapses whitespace and truncates text at 60 characters', () => {
    const spaced = document.createElement('div')
    spaced.textContent = '  spaced\n\t text  '
    expect(describeElement(spaced).description).toBe('div · spaced text')

    const long = document.createElement('div')
    long.textContent = 'x'.repeat(80)
    const capture = describeElement(long)
    expect(capture.description).toBe(`div · ${'x'.repeat(60)}`)
    expect(capture.description).toHaveLength('div · '.length + 60)
  })
})
