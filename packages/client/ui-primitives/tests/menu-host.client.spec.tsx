// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Menu, PopoverHostProvider } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)

const items: readonly MenuItem[] = [
  { id: 'alpha', label: 'Alpha' },
  { id: 'beta', label: 'Beta' },
]

const submenuItems: readonly MenuItem[] = [
  { id: 'parent', label: 'Parent', submenu: [{ id: 'nested', label: 'Nested' }] },
]

const boundary = (width: number, height: number) => () => new DOMRect(0, 0, width, height)

const rect = (left: number, right: number, top: number, bottom: number): DOMRect =>
  new DOMRect(left, top, right - left, bottom - top)

/** Temporarily report one visual card size; returns the descriptor restore. */
function stubCardSize(width: number, height: number): () => void {
  const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!
  const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => width })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => height })
  return () => {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidth)
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight)
  }
}

/** Detached portal target appended to the document for the duration of a test. */
function hostContainer(): { container: HTMLDivElement; dispose: () => void } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return { container, dispose: () => { container.remove() } }
}

const rowsAt = (row: DOMRect) =>
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.className.includes('itemWrap')) return row
    return rect(0, 0, 0, 0)
  })

describe('Menu with a popover host', () => {
  it('portals the list into the host container at the host scale', () => {
    const { container, dispose } = hostContainer()
    try {
      render(
        <PopoverHostProvider container={container} scale={2} boundary={boundary(600, 400)}>
          <Menu portal open anchor={<span>trigger</span>} items={items} onSelect={() => {}} onClose={() => {}} />
        </PopoverHostProvider>,
      )
      const menu = screen.getByRole('menu')
      expect(container.contains(menu)).toBe(true)
      expect(menu.parentElement).toBe(container)
      expect(menu.style.transform).toBe('scale(2)')
    } finally {
      dispose()
    }
  })

  it('leaves the portal in document.body when no host provides a container', () => {
    const { container, dispose } = hostContainer()
    try {
      render(
        <Menu portal open anchor={<span>trigger</span>} items={items} onSelect={() => {}} onClose={() => {}} />,
      )
      const menu = screen.getByRole('menu')
      // Negative case: the container assertion only holds under a provider.
      expect(container.contains(menu)).toBe(false)
      expect(menu.parentElement).toBe(document.body)
    } finally {
      dispose()
    }
  })

  it('clamps a scaled list by its visual size inside the host boundary', () => {
    const restore = stubCardSize(100, 40)
    const rects = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(280, 300, 0, 20))
    const { container, dispose } = hostContainer()
    try {
      render(
        <PopoverHostProvider container={container} scale={2} boundary={boundary(300, 400)}>
          <Menu portal open anchor={<span>trigger</span>} items={items} onSelect={() => {}} onClose={() => {}} />
        </PopoverHostProvider>,
      )
      const menu = screen.getByRole('menu')
      // 100x40 at scale 2: right limit 300 - 12 - 200, below-anchor top 24.
      expect(menu.style.left).toBe('88px')
      expect(menu.style.top).toBe('24px')
      // The height cap is the boundary in layout pixels: (400 - 24) / 2.
      expect(menu.style.maxHeight).toBe('188px')
    } finally {
      rects.mockRestore()
      restore()
      dispose()
    }
  })

  it('opens a submenu to the left when the right side has no room', () => {
    const restore = stubCardSize(150, 100)
    const rects = rowsAt(rect(230, 390, 100, 140))
    const { container, dispose } = hostContainer()
    try {
      render(
        <PopoverHostProvider container={container} boundary={boundary(400, 400)}>
          <Menu portal open anchor={<span>trigger</span>} items={submenuItems} onSelect={() => {}} onClose={() => {}} />
        </PopoverHostProvider>,
      )
      fireEvent.click(screen.getByRole('menuitem', { name: 'Parent' }))
      const submenu = document.querySelector<HTMLElement>('[data-placement]')!
      // Right candidate 394 + 150 overflows the 388 limit; left is 230 - 4 - 150.
      expect(submenu.getAttribute('data-placement')).toBe('left-bottom')
      expect(submenu.style.left).toBe('76px')
      expect(submenu.style.top).toBe('100px')
    } finally {
      rects.mockRestore()
      restore()
      dispose()
    }
  })

  it('opens a submenu above a row with no room below', () => {
    const restore = stubCardSize(150, 100)
    const rects = rowsAt(rect(230, 390, 300, 340))
    const { container, dispose } = hostContainer()
    try {
      render(
        <PopoverHostProvider container={container} boundary={boundary(400, 400)}>
          <Menu portal open anchor={<span>trigger</span>} items={submenuItems} onSelect={() => {}} onClose={() => {}} />
        </PopoverHostProvider>,
      )
      fireEvent.click(screen.getByRole('menuitem', { name: 'Parent' }))
      const submenu = document.querySelector<HTMLElement>('[data-placement]')!
      // 300 + 100 overflows 388 and 340 - 100 fits above.
      expect(submenu.getAttribute('data-placement')).toBe('left-top')
      expect(submenu.style.top).toBe('240px')
    } finally {
      rects.mockRestore()
      restore()
      dispose()
    }
  })

  it('marks a selected submenu row like a top-level selection', () => {
    const { container, dispose } = hostContainer()
    try {
      render(
        <PopoverHostProvider container={container} boundary={boundary(400, 400)}>
          <Menu
            portal
            open
            anchor={<span>trigger</span>}
            items={submenuItems}
            selectedIds={['nested']}
            onSelect={() => {}}
            onClose={() => {}}
          />
        </PopoverHostProvider>,
      )
      fireEvent.click(screen.getByRole('menuitem', { name: 'Parent' }))
      const nested = screen.getByRole('menuitem', { name: 'Nested' })
      // The selection check is the only glyph a plain text row carries.
      expect(nested.querySelector('svg')).not.toBeNull()
    } finally {
      dispose()
    }
  })

  it('caps a long submenu by the host boundary and scrolls it in a viewport', () => {
    const restore = stubCardSize(150, 900)
    const rects = rowsAt(rect(230, 390, 100, 140))
    const { container, dispose } = hostContainer()
    try {
      render(
        <PopoverHostProvider container={container} boundary={boundary(400, 400)}>
          <Menu portal open anchor={<span>trigger</span>} items={submenuItems} onSelect={() => {}} onClose={() => {}} />
        </PopoverHostProvider>,
      )
      fireEvent.click(screen.getByRole('menuitem', { name: 'Parent' }))
      const submenu = document.querySelector<HTMLElement>('[data-placement]')!
      expect(submenu.style.maxHeight).toBe('376px')
      expect(submenu.querySelector('div[class*="viewport"]')).not.toBeNull()
      expect(screen.getByRole('menuitem', { name: 'Nested' })).toBeTruthy()
    } finally {
      rects.mockRestore()
      restore()
      dispose()
    }
  })

  it('keeps the submenu open when the pointer moves from the row into its portal', () => {
    render(
      <Menu open anchor={<span>trigger</span>} items={submenuItems} onSelect={() => {}} onClose={() => {}} />,
    )
    const parent = screen.getByRole('menuitem', { name: 'Parent' })
    const row = parent.parentElement as HTMLElement
    fireEvent.click(parent)
    const nested = screen.getByRole('menuitem', { name: 'Nested' })
    const submenu = nested.closest('[role="menu"]') as HTMLElement
    // The portal stays the row's React child, so this crossing is not a leave.
    fireEvent.mouseOut(row, { relatedTarget: submenu })
    expect(screen.queryByRole('menuitem', { name: 'Nested' })).not.toBeNull()
    // Moving to a node outside the row's React subtree still closes it.
    fireEvent.mouseOut(row, { relatedTarget: document.body })
    expect(screen.queryByRole('menuitem', { name: 'Nested' })).toBeNull()
  })

  it('dismisses a portaled list whose anchor left the host boundary', () => {
    const anchorRect = { current: rect(20, 100, 0, 20) }
    const onClose = vi.fn()
    const { container, dispose } = hostContainer()
    try {
      render(
        <PopoverHostProvider container={container} boundary={boundary(400, 400)}>
          <Menu
            portal
            open
            anchor={<span>trigger</span>}
            getAnchorRect={() => anchorRect.current}
            items={items}
            onSelect={() => {}}
            onClose={onClose}
          />
        </PopoverHostProvider>,
      )
      expect(onClose).not.toHaveBeenCalled()
      anchorRect.current = rect(500, 580, 0, 20)
      fireEvent(window, new Event('resize'))
      expect(onClose).toHaveBeenCalledTimes(1)
    } finally {
      dispose()
    }
  })

  it('ignores a zero-size anchor when deciding a dismissal', () => {
    const anchorRect = { current: rect(0, 0, 0, 0) }
    const onClose = vi.fn()
    const { container, dispose } = hostContainer()
    try {
      render(
        <PopoverHostProvider container={container} boundary={boundary(400, 400)}>
          <Menu
            portal
            open
            anchor={<span>trigger</span>}
            getAnchorRect={() => anchorRect.current}
            items={items}
            onSelect={() => {}}
            onClose={onClose}
          />
        </PopoverHostProvider>,
      )
      // jsdom's default rects and a hidden anchor are never a measurement: the
      // list stays for a real one.
      fireEvent(window, new Event('resize'))
      expect(onClose).not.toHaveBeenCalled()
    } finally {
      dispose()
    }
  })
})
