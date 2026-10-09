// @vitest-environment jsdom
/**
 * Keyboard target guards: which event targets keep Delete, Backspace, Enter,
 * and Space for themselves instead of the board's element shortcuts.
 */
import { describe, expect, it } from 'vitest'
import { isBoardEditingTarget, isBoardInteractiveTarget } from '../src/client/editing-target.ts'

/**
 * Build one element with attributes.
 * @param tag - tag name.
 * @param attributes - attributes to set.
 * @returns the element.
 */
function node(tag: string, attributes: Record<string, string> = {}): HTMLElement {
  const created = document.createElement(tag)
  for (const [name, value] of Object.entries(attributes)) created.setAttribute(name, value)
  return created
}

describe('isBoardInteractiveTarget', () => {
  it('accepts buttons, button roles, links, and anything inside them', () => {
    const button = node('button')
    const inner = node('span')
    button.append(inner)
    expect(isBoardInteractiveTarget(button)).toBe(true)
    expect(isBoardInteractiveTarget(inner)).toBe(true)
    expect(isBoardInteractiveTarget(node('div', { role: 'button' }))).toBe(true)
    expect(isBoardInteractiveTarget(node('div', { role: 'menuitem' }))).toBe(true)
    expect(isBoardInteractiveTarget(node('a', { href: '#x' }))).toBe(true)
  })

  it('rejects plain surfaces, groups, and non-elements', () => {
    expect(isBoardInteractiveTarget(node('div'))).toBe(false)
    expect(isBoardInteractiveTarget(node('div', { role: 'group' }))).toBe(false)
    expect(isBoardInteractiveTarget(document.body)).toBe(false)
    expect(isBoardInteractiveTarget(null)).toBe(false)
    expect(isBoardInteractiveTarget(window)).toBe(false)
  })

  it('stays distinct from the text-entry guard', () => {
    const input = node('input')
    expect(isBoardEditingTarget(input)).toBe(true)
    expect(isBoardInteractiveTarget(input)).toBe(false)
  })
})
