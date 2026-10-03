// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PopoverHostProvider, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'

let bubbleSize: ResizeObserverSize
let automaticResize: boolean
const observers: TooltipResizeObserver[] = []

class TooltipResizeObserver implements ResizeObserver {
  private target: Element | undefined
  constructor(private readonly callback: ResizeObserverCallback) { observers.push(this) }
  observe(target: Element): void {
    this.target = target
    if (automaticResize) this.deliver()
  }
  unobserve(): void { this.target = undefined }
  disconnect(): void { this.target = undefined }
  deliver(): void {
    if (this.target === undefined) return
    this.callback([{
      target: this.target, borderBoxSize: [bubbleSize], contentBoxSize: [bubbleSize],
      devicePixelContentBoxSize: [bubbleSize],
      contentRect: new DOMRect(0, 0, bubbleSize.inlineSize, bubbleSize.blockSize),
    }], this)
  }
}

beforeEach(() => {
  bubbleSize = { inlineSize: 0, blockSize: 0 }
  automaticResize = true
  observers.length = 0
  vi.stubGlobal('ResizeObserver', TooltipResizeObserver)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Tooltip', () => {
  it('updates independent keycaps and the accessible combination while visible', () => {
    const view = render(<Tooltip label="Reload" shortcutKeys={['⌘', 'R']}><button>anchor</button></Tooltip>)
    fireEvent.focus(screen.getByText('anchor'))
    expect(Array.from(screen.getByRole('tooltip', { name: 'Reload ⌘ R' }).querySelectorAll('kbd'), key => key.textContent)).toEqual(['⌘', 'R'])
    view.rerender(<Tooltip label="Reload" shortcutKeys={['Ctrl', '+', 'R']}><button>anchor</button></Tooltip>)
    expect(Array.from(screen.getByRole('tooltip', { name: 'Reload Ctrl + R' }).querySelectorAll('kbd'), key => key.textContent)).toEqual(['Ctrl', '+', 'R'])
    view.rerender(<Tooltip label="Reload" shortcutKeys={[]}><button>anchor</button></Tooltip>)
    expect(screen.getByRole('tooltip').querySelector('kbd')).toBeNull()
    fireEvent.click(screen.getByText('anchor'))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('fits from observed sizes without synchronously measuring the bubble', () => {
    automaticResize = false
    const measured = vi.spyOn(Element.prototype, 'getBoundingClientRect')
    const view = render(<Tooltip label="Observed" side="bottom"><button>anchor</button></Tooltip>)
    const anchor = screen.getByText('anchor')
    fireEvent.mouseEnter(anchor)
    const bubble = view.container.querySelector<HTMLElement>('[role="tooltip"]')!
    expect(measured.mock.contexts).toEqual([anchor])
    expect(bubble.style.visibility).toBe('hidden')
    fireEvent(window, new Event('resize'))
    expect(bubble.style.visibility).toBe('hidden')
    expect(measured.mock.contexts).toEqual([anchor])
    bubbleSize = { inlineSize: 100, blockSize: 20 }
    act(() => { observers[0]!.deliver() })
    expect(screen.getByRole('tooltip').style.left).toBe('62px')
    fireEvent(window, new Event('resize'))
    expect(measured.mock.contexts).toEqual([anchor])
    const disconnect = vi.spyOn(observers[0]!, 'disconnect')
    view.unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('resolves lazy labels only after the bubble becomes visible', () => {
    vi.useFakeTimers()
    try {
      const label = vi.fn(() => 'Timing details')
      render(
        <Tooltip label={label} delayMs={500}>
          <button type="button">anchor</button>
        </Tooltip>,
      )
      expect(label).not.toHaveBeenCalled()
      fireEvent.mouseEnter(screen.getByText('anchor'))
      act(() => { vi.advanceTimersByTime(499) })
      expect(label).not.toHaveBeenCalled()
      act(() => { vi.advanceTimersByTime(1) })
      expect(screen.getByRole('tooltip').textContent).toBe('Timing details')
      expect(label).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('can delay pointer hover without delaying keyboard focus', () => {
    vi.useFakeTimers()
    try {
      render(
        <Tooltip label="Timing details" delayMs={500}>
          <button type="button">anchor</button>
        </Tooltip>,
      )
      const anchor = screen.getByText('anchor')
      fireEvent.mouseEnter(anchor)
      act(() => { vi.advanceTimersByTime(499) })
      expect(screen.queryByRole('tooltip')).toBeNull()
      fireEvent.mouseLeave(anchor)
      act(() => { vi.advanceTimersByTime(1) })
      expect(screen.queryByRole('tooltip')).toBeNull()
      fireEvent.mouseEnter(anchor)
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getByRole('tooltip').textContent).toBe('Timing details')
      fireEvent.mouseLeave(anchor)
      fireEvent.focus(anchor)
      expect(screen.getByRole('tooltip').textContent).toBe('Timing details')
    } finally {
      vi.useRealTimers()
    }
  })

  describe('keyboard focus delay', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      fireEvent.keyDown(document.body, { key: 'Tab' })
    })
    afterEach(() => {
      cleanup()
      vi.useRealTimers()
      fireEvent.keyDown(document.body, { key: 'Tab' })
    })

    it('shows at 500ms, but not at 499ms', () => {
      const label = vi.fn(() => 'Refresh')
      render(<Tooltip label={label} delayMs={500} focusDelayMs={500}><button>anchor</button></Tooltip>)
      fireEvent.focus(screen.getByText('anchor'))
      expect(screen.queryByRole('tooltip')).toBeNull()
      act(() => { vi.advanceTimersByTime(499) })
      expect(screen.queryByRole('tooltip')).toBeNull()
      expect(label).not.toHaveBeenCalled()
      act(() => { vi.advanceTimersByTime(1) })
      expect(screen.getByRole('tooltip').textContent).toBe('Refresh')
    })

    it.each(['blur', 'click', 'mouseLeave', 'disabled', 'unmount'] as const)(
      'cancels a pending focus bubble on %s', (cancel) => {
        const view = render(<Tooltip label="Refresh" focusDelayMs={500}><button>anchor</button></Tooltip>)
        const anchor = screen.getByText('anchor')
        const initialTimers = vi.getTimerCount()
        fireEvent.focus(anchor)
        expect(vi.getTimerCount()).toBe(initialTimers + 1)
        act(() => { vi.advanceTimersByTime(499) })
        if (cancel === 'disabled') {
          view.rerender(<Tooltip label="Refresh" focusDelayMs={500} disabled><button>anchor</button></Tooltip>)
        } else if (cancel === 'unmount') {
          view.unmount()
        } else {
          fireEvent[cancel](anchor)
        }
        expect(vi.getTimerCount()).toBe(initialTimers)
        act(() => { vi.advanceTimersByTime(500) })
        expect(screen.queryByRole('tooltip')).toBeNull()
        if (cancel === 'disabled') {
          view.rerender(<Tooltip label="Refresh" focusDelayMs={500}><button>anchor</button></Tooltip>)
          expect(screen.queryByRole('tooltip')).toBeNull()
        }
      },
    )

    it('keeps default focus immediate and cancels a pending hover delay', () => {
      render(<Tooltip label="Refresh" delayMs={500}><button>anchor</button></Tooltip>)
      const anchor = screen.getByText('anchor')
      const initialTimers = vi.getTimerCount()
      fireEvent.mouseEnter(anchor)
      act(() => { vi.advanceTimersByTime(499) })
      expect(screen.queryByRole('tooltip')).toBeNull()
      fireEvent.focus(anchor)
      expect(screen.getByRole('tooltip').textContent).toBe('Refresh')
      expect(vi.getTimerCount()).toBe(initialTimers)
    })

    it('does not schedule pointer-driven focus and resumes delay after a key press', () => {
      render(<Tooltip label="Refresh" focusDelayMs={500}><button>anchor</button></Tooltip>)
      const anchor = screen.getByText('anchor')
      const initialTimers = vi.getTimerCount()
      fireEvent.pointerDown(document.body)
      fireEvent.focus(anchor)
      expect(vi.getTimerCount()).toBe(initialTimers)
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.queryByRole('tooltip')).toBeNull()
      fireEvent.blur(anchor)
      fireEvent.keyDown(document.body, { key: 'Tab' })
      fireEvent.focus(anchor)
      act(() => { vi.advanceTimersByTime(499) })
      expect(screen.queryByRole('tooltip')).toBeNull()
      act(() => { vi.advanceTimersByTime(1) })
      expect(screen.getByRole('tooltip').textContent).toBe('Refresh')
    })
  })

  it('shows the bubble to the right on hover and hides it on leave', () => {
    render(
      <Tooltip label="Open sidebar">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    const anchor = screen.getByText('anchor')
    fireEvent.mouseEnter(anchor)
    const bubble = screen.getByRole('tooltip')
    expect(bubble.textContent).toBe('Open sidebar')
    expect(bubble.getAttribute('data-side')).toBe('right')
    expect(bubble.style.left).toBe('12px')
    expect(bubble.style.top).toBe('0px')
    fireEvent.mouseLeave(anchor)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('supports bottom placement and the focus/blur channel', () => {
    render(
      <Tooltip label="Below" side="bottom">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    const anchor = screen.getByText('anchor')
    fireEvent.focus(anchor)
    const bubble = screen.getByRole('tooltip')
    expect(bubble.getAttribute('data-side')).toBe('bottom')
    // Zero-width jsdom rect at x=0 clamps to the 12px edge margin.
    expect(bubble.style.left).toBe('12px')
    expect(bubble.style.top).toBe('8px')
    fireEvent.blur(anchor)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  // Anchor geometry and observed bubble sizes are independent browser inputs.
  const rect = (left: number, right: number): DOMRect =>
    ({ left, right, top: 0, bottom: 20, width: right - left, height: 20, x: left, y: 0, toJSON: () => ({}) })

  it('aligns the end of a bottom tooltip with the anchor right edge', () => {
    bubbleSize = { inlineSize: 100, blockSize: 20 }
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(100, 200))
    try {
      render(
        <Tooltip label="End aligned" side="bottom" align="end">
          <button type="button">anchor</button>
        </Tooltip>,
      )
      fireEvent.mouseEnter(screen.getByText('anchor'))
      const bubble = screen.getByRole('tooltip')
      expect(bubble.getAttribute('data-align')).toBe('end')
      expect(bubble.style.left).toBe('200px')
    } finally {
      spy.mockRestore()
    }
  })

  it('caps the bubble width where the label would otherwise slab across the surface', () => {
    render(
      <Tooltip label="A description long enough to need a cap" side="bottom" maxWidth={360}>
        <button type="button">anchor</button>
      </Tooltip>,
    )
    fireEvent.mouseEnter(screen.getByText('anchor'))

    // The stylesheet's half-viewport cap stays the default; this one overrides it.
    expect(screen.getByRole('tooltip').style.maxWidth).toBe('360px')
  })

  it('clamps a bubble overflowing the right viewport edge back inside', () => {
    bubbleSize = { inlineSize: 200, blockSize: 20 }
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(900, 1100))
    try {
      render(
        <Tooltip label="Wide" side="bottom">
          <button type="button">anchor</button>
        </Tooltip>,
      )
      fireEvent.mouseEnter(screen.getByText('anchor'))
      // pos.x = 1000 (anchor center); measured right edge 1100 overflows the
      // 1024 viewport's 12px safe margin (limit 1012) by 88, so the clamp
      // shifts left to 912.
      expect(screen.getByRole('tooltip').style.left).toBe('912px')
    } finally {
      spy.mockRestore()
    }
  })

  it('reclamps after label and viewport width changes', () => {
    const originalWidth = window.innerWidth
    bubbleSize = { inlineSize: 200, blockSize: 20 }
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(900, 1000))
    try {
      const view = render(
        <Tooltip label="Wide" side="bottom">
          <button type="button">anchor</button>
        </Tooltip>,
      )
      fireEvent.mouseEnter(screen.getByText('anchor'))
      expect(screen.getByRole('tooltip').style.left).toBe('912px')

      view.rerender(
        <Tooltip label="Short" side="bottom">
          <button type="button">anchor</button>
        </Tooltip>,
      )
      bubbleSize = { inlineSize: 100, blockSize: 20 }
      act(() => { observers[0]!.deliver() })
      expect(screen.getByRole('tooltip').style.left).toBe('950px')

      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 })
      fireEvent(window, new Event('resize'))
      expect(screen.getByRole('tooltip').style.left).toBe('838px')
      expect(observers).toHaveLength(1)
      expect(spy).toHaveBeenCalledOnce()
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
      spy.mockRestore()
    }
  })

  it('clamps a bubble past the left viewport edge back inside', () => {
    bubbleSize = { inlineSize: 100, blockSize: 20 }
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(-20, 80))
    try {
      render(
        <Tooltip label="Wide" side="bottom">
          <button type="button">anchor</button>
        </Tooltip>,
      )
      fireEvent.mouseEnter(screen.getByText('anchor'))
      // pos.x = 30 (anchor center); measured left edge -20 underflows the
      // 12px safe margin by 32, so the clamp shifts right to 62.
      expect(screen.getByRole('tooltip').style.left).toBe('62px')
    } finally {
      spy.mockRestore()
    }
  })

  const placed = (top: number, bottom: number, bubbleHeight: number) => {
    bubbleSize = { inlineSize: 100, blockSize: bubbleHeight }
    return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 100, right: 200, top, bottom, width: 100, height: bottom - top, x: 100, y: top, toJSON: () => ({}),
    })
  }

  it('supports top placement for anchors at the viewport bottom', () => {
    const spy = placed(700, 720, 20)
    try {
      render(
        <Tooltip label="Above" side="top">
          <button type="button">anchor</button>
        </Tooltip>,
      )
      fireEvent.mouseEnter(screen.getByText('anchor'))
      const bubble = screen.getByRole('tooltip')
      // There is room above, so the requested side stands: the bubble's own
      // top sits at the anchor's top less the 8px gutter.
      expect(bubble.getAttribute('data-side')).toBe('top')
      expect(bubble.style.top).toBe('692px')
      expect(bubble.style.left).toBe('150px')
    } finally {
      spy.mockRestore()
    }
  })

  it('flips a bottom bubble above an anchor with no room below', () => {
    // jsdom's viewport is 768 tall: a 300px bubble under an anchor ending at
    // 700 would run off, and there is room for it above.
    const spy = placed(600, 700, 300)
    try {
      render(
        <Tooltip label="Tall" side="bottom">
          <button type="button">anchor</button>
        </Tooltip>,
      )
      fireEvent.mouseEnter(screen.getByText('anchor'))
      const bubble = screen.getByRole('tooltip')
      expect(bubble.getAttribute('data-side')).toBe('top')
      expect(bubble.style.top).toBe('592px')
    } finally {
      spy.mockRestore()
    }
  })

  it('flips a top bubble below an anchor with no room above', () => {
    const spy = placed(10, 40, 100)
    try {
      render(
        <Tooltip label="Tall" side="top">
          <button type="button">anchor</button>
        </Tooltip>,
      )
      fireEvent.mouseEnter(screen.getByText('anchor'))
      const bubble = screen.getByRole('tooltip')
      expect(bubble.getAttribute('data-side')).toBe('bottom')
      expect(bubble.style.top).toBe('48px')
    } finally {
      spy.mockRestore()
    }
  })

  it.each(['bottom', 'top'] as const)('uses a custom gap to position and flip a %s tooltip', (side) => {
    const anchorBottom = side === 'bottom' ? window.innerHeight - 36 : 56
    const spy = placed(anchorBottom - 20, anchorBottom, 20)
    try {
      const view = render(<Tooltip label="Gap" side={side} gap={4}><button type="button">anchor</button></Tooltip>)
      fireEvent.mouseEnter(screen.getByText('anchor'))
      const bubble = screen.getByRole('tooltip')
      expect(bubble.getAttribute('data-side')).toBe(side)
      expect(bubble.style.top).toBe(`${side === 'bottom' ? anchorBottom + 4 : anchorBottom - 24}px`)
      view.rerender(<Tooltip label="Gap" side={side} gap={12}><button type="button">anchor</button></Tooltip>)
      expect(bubble.getAttribute('data-side')).toBe(side === 'bottom' ? 'top' : 'bottom')
      expect(bubble.style.top).toBe(`${side === 'bottom' ? anchorBottom - 32 : anchorBottom + 12}px`)
    } finally {
      spy.mockRestore()
    }
  })

  it('keeps the requested side when neither side fits', () => {
    // A bubble taller than the viewport has no home; oscillating between the
    // two would be worse than honouring the request.
    const spy = placed(300, 400, 900)
    try {
      render(
        <Tooltip label="Huge" side="bottom">
          <button type="button">anchor</button>
        </Tooltip>,
      )
      fireEvent.mouseEnter(screen.getByText('anchor'))
      expect(screen.getByRole('tooltip').getAttribute('data-side')).toBe('bottom')
    } finally {
      spy.mockRestore()
    }
  })

  it('hides the bubble when its anchor relocates under a still pointer', () => {
    const view = render(
      <Tooltip label="Open fullscreen">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    const anchor = screen.getByText('anchor')
    // The click focuses the anchor and the bubble shows.
    fireEvent.focus(anchor)
    expect(screen.getByRole('tooltip')).toBeTruthy()

    // The anchor's label flips and the layout moves it away from the pointer:
    // no mouseleave ever arrives for the old position.
    view.rerender(
      <Tooltip label="Exit fullscreen">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    expect(screen.getByRole('tooltip').textContent).toBe('Exit fullscreen')
    fireEvent.pointerMove(document.body, { pointerId: 1 })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })


  it('keeps the bubble while the pointer moves inside the anchor', () => {
    render(
      <Tooltip label="Inside">
        <button type="button">
          <span data-testid="icon">icon</span>
          anchor
        </button>
      </Tooltip>,
    )
    fireEvent.mouseEnter(screen.getByText('anchor'))
    expect(screen.getByRole('tooltip')).toBeTruthy()
    fireEvent.pointerMove(screen.getByTestId('icon'), { pointerId: 2 })
    expect(screen.getByRole('tooltip')).toBeTruthy()
    // Leaving through a later mouseleave still clears it, and the pointer
    // listener is gone with the bubble.
    fireEvent.mouseLeave(screen.getByText('anchor'))
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.pointerMove(document.body, { pointerId: 3 })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('pins an informational tooltip on click and preserves the anchor description', () => {
    const clicked = vi.fn()
    render(<>
      <p id="existing-description">Existing description</p>
      <Tooltip label="Plugin information" openOnClick portal>
        <button aria-describedby="existing-description" onClick={clicked}>anchor</button>
      </Tooltip>
    </>)
    const anchor = screen.getByText('anchor')
    fireEvent.pointerDown(anchor)
    fireEvent.focus(anchor)
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.click(anchor)
    expect(clicked).toHaveBeenCalledOnce()
    const bubble = screen.getByRole('tooltip')
    expect(bubble.textContent).toBe('Plugin information')
    expect(anchor.getAttribute('aria-describedby')).toBe(`existing-description ${bubble.id}`)
    fireEvent.mouseLeave(anchor)
    fireEvent.blur(anchor)
    expect(screen.getByRole('tooltip')).toBe(bubble)
    fireEvent.pointerDown(bubble)
    expect(screen.getByRole('tooltip')).toBe(bubble)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(anchor.getAttribute('aria-describedby')).toBe('existing-description')
    fireEvent.click(anchor)
    expect(screen.getByRole('tooltip')).toBeTruthy()
    fireEvent.click(anchor)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('shows informational tooltips on hover and focus, and consumes Escape only while open', () => {
    const onKeyDown = vi.fn()
    render(<div onKeyDown={onKeyDown}>
      <Tooltip label="Plugin information" openOnClick><button>anchor</button></Tooltip>
    </div>)
    const anchor = screen.getByText('anchor')
    fireEvent.mouseEnter(anchor)
    expect(screen.getByRole('tooltip').textContent).toBe('Plugin information')
    fireEvent.mouseLeave(anchor)
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.keyDown(anchor, { key: 'Tab' })
    fireEvent.focus(anchor)
    expect(screen.getByRole('tooltip')).toBeTruthy()
    fireEvent.keyDown(anchor, { key: 'a' })
    expect(screen.getByRole('tooltip')).toBeTruthy()
    onKeyDown.mockClear()
    expect(fireEvent.keyDown(anchor, { key: 'Escape' })).toBe(false)
    expect(onKeyDown).not.toHaveBeenCalled()
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.keyDown(anchor, { key: 'Escape' })
    expect(onKeyDown).toHaveBeenCalledOnce()
    fireEvent.click(anchor)
    expect(fireEvent.keyDown(anchor, { key: 'Tab' })).toBe(true)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('cancels a delayed hover when clicking to pin the information', () => {
    vi.useFakeTimers()
    try {
      render(<Tooltip label="Plugin information" openOnClick delayMs={300}><button>anchor</button></Tooltip>)
      const anchor = screen.getByText('anchor')
      fireEvent.mouseEnter(anchor)
      expect(screen.queryByRole('tooltip')).toBeNull()
      fireEvent.click(anchor)
      expect(screen.getByRole('tooltip')).toBeTruthy()
      fireEvent.mouseLeave(anchor)
      expect(screen.getByRole('tooltip')).toBeTruthy()
      fireEvent.keyDown(anchor, { key: 'Escape' })
      act(() => { vi.advanceTimersByTime(300) })
      expect(screen.queryByRole('tooltip')).toBeNull()
    } finally {
      cleanup()
      vi.useRealTimers()
    }
  })

  it('drops a click pin when disabled or when click opening is removed', () => {
    const view = render(<Tooltip label="Plugin information" openOnClick><button>anchor</button></Tooltip>)
    const anchor = screen.getByText('anchor')
    fireEvent.click(anchor)
    view.rerender(<Tooltip label="Plugin information" openOnClick disabled><button>anchor</button></Tooltip>)
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.click(anchor)
    expect(screen.queryByRole('tooltip')).toBeNull()
    view.rerender(<Tooltip label="Plugin information" openOnClick><button>anchor</button></Tooltip>)
    fireEvent.click(anchor)
    expect(screen.getByRole('tooltip')).toBeTruthy()
    view.rerender(<Tooltip label="Plugin information"><button>anchor</button></Tooltip>)
    fireEvent.mouseLeave(anchor)
    expect(screen.queryByRole('tooltip')).toBeNull()
    view.rerender(<Tooltip label="Plugin information" openOnClick><button>anchor</button></Tooltip>)
    fireEvent.click(anchor)
    view.unmount()
    expect(fireEvent.keyDown(document.body, { key: 'Escape' })).toBe(true)
  })


  it('a click on the anchor dismisses the bubble even while the anchor stays focused', () => {
    render(
      <Tooltip label="Pin session">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    const anchor = screen.getByText('anchor')
    // Pointer click: browsers focus the button first, then deliver the click.
    fireEvent.focus(anchor)
    fireEvent.mouseEnter(anchor)
    expect(screen.getByRole('tooltip')).toBeTruthy()
    fireEvent.click(anchor)
    expect(screen.queryByRole('tooltip')).toBeNull()
    // The retained focus alone must not resurrect it on mouse leave.
    fireEvent.mouseLeave(anchor)
    expect(screen.queryByRole('tooltip')).toBeNull()
    // A fresh hover shows the (possibly relabelled) bubble again.
    fireEvent.mouseEnter(anchor)
    expect(screen.getByRole('tooltip')).toBeTruthy()
  })

  it('focus arriving after a pointer interaction does not raise the bubble', () => {
    render(
      <Tooltip label="View options">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    const anchor = screen.getByText('anchor')
    // A closing menu refocuses its trigger after a mouse selection: the last
    // interaction was a pointerdown on the menu row, not a key press.
    fireEvent.pointerDown(document.body)
    fireEvent.focus(anchor)
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.blur(anchor)
    // The next key press restores focus-driven bubbles (keyboard selection).
    fireEvent.keyDown(document.body, { key: 'Tab' })
    fireEvent.focus(anchor)
    expect(screen.getByRole('tooltip')).toBeTruthy()
  })

  it('chains the anchor\'s own handlers ahead of the tooltip\'s', () => {
    const onMouseEnter = vi.fn()
    const onMouseLeave = vi.fn()
    const onClick = vi.fn()
    const onFocus = vi.fn()
    const onBlur = vi.fn()
    render(
      <Tooltip label="Chained">
        <button type="button" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onClick={onClick} onFocus={onFocus} onBlur={onBlur}>anchor</button>
      </Tooltip>,
    )
    const anchor = screen.getByText('anchor')
    fireEvent.mouseEnter(anchor)
    fireEvent.mouseLeave(anchor)
    fireEvent.click(anchor)
    fireEvent.focus(anchor)
    fireEvent.blur(anchor)
    expect(onMouseEnter).toHaveBeenCalledOnce()
    expect(onMouseLeave).toHaveBeenCalledOnce()
    expect(onClick).toHaveBeenCalledOnce()
    expect(onFocus).toHaveBeenCalledOnce()
    expect(onBlur).toHaveBeenCalledOnce()
  })

  it('suppresses the bubble while disabled without remounting the anchor', () => {
    const { rerender } = render(
      <Tooltip label="Rail" disabled>
        <button type="button">anchor</button>
      </Tooltip>,
    )
    const anchor = screen.getByText('anchor')
    fireEvent.mouseEnter(anchor)
    expect(screen.queryByRole('tooltip')).toBeNull()
    rerender(
      <Tooltip label="Rail">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    // Same DOM node: toggling disabled never remounted the anchor.
    expect(screen.getByText('anchor')).toBe(anchor)
    fireEvent.mouseEnter(anchor)
    expect(screen.getByRole('tooltip')).toBeTruthy()
  })

  it('mouse leave hides the bubble immediately, even while the anchor stays focused', () => {
    render(
      <Tooltip label="Sticky">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    const anchor = screen.getByText('anchor')
    // Focused AND hovered: leaving with the mouse drops the bubble at once.
    fireEvent.focus(anchor)
    fireEvent.mouseEnter(anchor)
    fireEvent.mouseLeave(anchor)
    expect(screen.queryByRole('tooltip')).toBeNull()
    // Re-entering shows it again; blurring while still hovered keeps it.
    fireEvent.mouseEnter(anchor)
    fireEvent.blur(anchor)
    expect(screen.getByRole('tooltip')).toBeTruthy()
    fireEvent.mouseLeave(anchor)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('forwards the anchor element to the child ref (object and callback)', () => {
    const objectRef = { current: null as HTMLButtonElement | null }
    const callbackRef = vi.fn()
    const { rerender } = render(
      <Tooltip label="Add">
        <button type="button" ref={objectRef}>anchor</button>
      </Tooltip>,
    )
    expect(objectRef.current).toBe(screen.getByText('anchor'))
    // Tooltip's own positioning still works through the merged ref.
    fireEvent.mouseEnter(screen.getByText('anchor'))
    expect(screen.getByRole('tooltip')).toBeTruthy()
    rerender(
      <Tooltip label="Add">
        <button type="button" ref={callbackRef}>anchor</button>
      </Tooltip>,
    )
    expect(callbackRef).toHaveBeenCalledWith(screen.getByText('anchor'))
  })

  it('never shows a bubble for a detached or hidden anchor', () => {
    // The whole subtree leaves the document while the component stays
    // mounted: the anchor is no longer connected.
    const host = document.createElement('div')
    document.body.appendChild(host)
    render(
      <Tooltip label="Gone">
        <button type="button">detached anchor</button>
      </Tooltip>,
      { container: host },
    )
    const detached = screen.getByText('detached anchor')
    host.remove()
    fireEvent.mouseEnter(detached)
    expect(screen.queryByRole('tooltip')).toBeNull()
    cleanup()

    render(
      <Tooltip label="Hidden">
        <button type="button" style={{ display: 'none' }}>hidden anchor</button>
      </Tooltip>,
    )
    fireEvent.mouseEnter(screen.getByText('hidden anchor'))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('hides the bubble when its anchor stops rendering', () => {
    const callbacks: ResizeObserverCallback[] = []
    class ResizeObserverStub {
      constructor(callback: ResizeObserverCallback) { callbacks.push(callback) }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    try {
      render(
        <Tooltip label="Soon hidden">
          <button type="button">anchor</button>
        </Tooltip>,
      )
      const anchor = screen.getByText('anchor')
      fireEvent.mouseEnter(anchor)
      // The bubble stays hidden until its measured box arrives; supply one so
      // the hide path below is observable through the accessible role.
      bubbleSize = { inlineSize: 100, blockSize: 20 }
      act(() => {
        callbacks[0]!([{
          target: anchor, borderBoxSize: [bubbleSize], contentBoxSize: [bubbleSize],
          devicePixelContentBoxSize: [bubbleSize],
          contentRect: new DOMRect(0, 0, bubbleSize.inlineSize, bubbleSize.blockSize),
        }], undefined as never)
      })
      expect(screen.getByRole('tooltip')).toBeTruthy()
      // A collapsed container fires no mouseleave: the observer's re-check is
      // the hide path.
      anchor.style.display = 'none'
      act(() => { for (const callback of callbacks) callback([], undefined as never) })
      expect(screen.queryByRole('tooltip')).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps one bubble open at a time: a second show closes the first', () => {
    render(
      <>
        <Tooltip label="First"><button type="button">first</button></Tooltip>
        <Tooltip label="Second"><button type="button">second</button></Tooltip>
      </>,
    )
    // Focus shows the first; hovering the second shows it while the first
    // stays focused — the registry replaces the open bubble.
    fireEvent.focus(screen.getByText('first'))
    expect(screen.getAllByRole('tooltip').map(element => element.textContent)).toEqual(['First'])
    fireEvent.mouseEnter(screen.getByText('second'))
    const bubbles = screen.getAllByRole('tooltip')
    expect(bubbles).toHaveLength(1)
    expect(bubbles[0]?.textContent).toBe('Second')
  })

  it('drops an already-visible bubble when disabled flips mid-hover', () => {
    const { rerender } = render(
      <Tooltip label="Rail">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    fireEvent.mouseEnter(screen.getByText('anchor'))
    expect(screen.getByRole('tooltip')).toBeTruthy()
    // e.g. clicking a rail control expands the sidebar: no mouseleave fires.
    rerender(
      <Tooltip label="Rail" disabled>
        <button type="button">anchor</button>
      </Tooltip>,
    )
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('withdraws the enclosing bubble while a nested tooltip shows its own', () => {
    render(
      <Tooltip label="Open sidebar">
        <button type="button">
          anchor
          <Tooltip label="Update — V1.2.3">
            <span data-testid="badge" />
          </Tooltip>
        </button>
      </Tooltip>,
    )
    const anchor = screen.getByText('anchor')
    const badge = screen.getByTestId('badge')
    fireEvent.mouseEnter(anchor)
    expect(screen.getByRole('tooltip').textContent).toBe('Open sidebar')

    // Entering the nested anchor withdraws the enclosing bubble instead of
    // stacking both; the enclosing anchor stays hovered, so nothing is lost.
    fireEvent.mouseEnter(badge)
    expect(screen.getAllByRole('tooltip').map(bubble => bubble.textContent)).toEqual(['Update — V1.2.3'])

    // Leaving the nested anchor for the enclosing one restores its bubble;
    // the pointer never left the enclosing anchor, so only the badge is left.
    fireEvent.mouseLeave(badge, { relatedTarget: anchor })
    expect(screen.getByRole('tooltip').textContent).toBe('Open sidebar')

    fireEvent.mouseLeave(anchor)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('releases the enclosing bubble when a shown nested tooltip unmounts', () => {
    const view = render(
      <Tooltip label="Open sidebar">
        <button type="button">
          anchor
          <Tooltip label="Update"><span data-testid="badge" /></Tooltip>
        </button>
      </Tooltip>,
    )
    fireEvent.mouseEnter(screen.getByText('anchor'))
    fireEvent.mouseEnter(screen.getByTestId('badge'))
    expect(screen.getAllByRole('tooltip').map(bubble => bubble.textContent)).toEqual(['Update'])

    view.rerender(
      <Tooltip label="Open sidebar">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    expect(screen.getByRole('tooltip').textContent).toBe('Open sidebar')
  })
})


it('keeps the anchor in its clipping container and portals only the tooltip', () => {
  const view = render(<div style={{ overflow: 'hidden', contain: 'layout' }}>
    <Tooltip portal label="Open in Music" side="bottom"><button type="button">File action</button></Tooltip>
  </div>)
  const anchor = screen.getByRole('button', { name: 'File action' })
  fireEvent.mouseEnter(anchor)
  const tooltip = screen.getByRole('tooltip')
  expect(tooltip.parentElement).toBe(document.body)
  expect(view.container.contains(anchor)).toBe(true)
  expect(view.container.contains(tooltip)).toBe(false)
  view.unmount()
  expect(screen.queryByRole('tooltip')).toBeNull()
})

describe('Tooltip with a popover host', () => {
  const rect = (left: number, right: number): DOMRect =>
    new DOMRect(left, 0, right - left, 20)

  it('portals the bubble into the host container at the host scale', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    try {
      render(
        <PopoverHostProvider container={container} scale={2}>
          <Tooltip label="Scaled">
            <button type="button">anchor</button>
          </Tooltip>
        </PopoverHostProvider>,
      )
      fireEvent.mouseEnter(screen.getByText('anchor'))
      const bubble = screen.getByRole('tooltip')
      expect(container.contains(bubble)).toBe(true)
      // Scaling about the anchor-facing edge keeps the 10px gutter visual.
      expect(bubble.style.transform).toBe('translateY(-50%) scale(2)')
      expect(bubble.style.transformOrigin).toBe('left center')
    } finally {
      container.remove()
    }
  })

  it('leaves the bubble in document.body when no host designates the container', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    try {
      render(
        <Tooltip portal label="Default">
          <button type="button">anchor</button>
        </Tooltip>,
      )
      fireEvent.mouseEnter(screen.getByText('anchor'))
      const bubble = screen.getByRole('tooltip')
      // Negative case: the container assertion only holds under a provider.
      expect(container.contains(bubble)).toBe(false)
      expect(bubble.parentElement).toBe(document.body)
    } finally {
      container.remove()
    }
  })

  it('clamps the bubble to the host boundary instead of the browser window', () => {
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return this.getAttribute('role') === 'tooltip' ? rect(250, 350) : rect(280, 300)
    })
    try {
      render(
        <PopoverHostProvider boundary={() => new DOMRect(0, 0, 250, 200)}>
          <Tooltip label="Wide" side="bottom">
            <button type="button">anchor</button>
          </Tooltip>
        </PopoverHostProvider>,
      )
      fireEvent.mouseEnter(screen.getByText('anchor'))
      // x = 290 (anchor center); the measured 250..350 bubble overflows the
      // boundary's 238 limit by 112, so it shifts to 178 — without the host
      // the 1024-wide window would leave it at 290.
      expect(screen.getByRole('tooltip').style.left).toBe('178px')
    } finally {
      spy.mockRestore()
    }
  })

  it('follows the anchor when the host reports a geometry change', () => {
    let anchor = rect(100, 120)
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return this.getAttribute('role') === 'tooltip' ? new DOMRect(0, 0, 0, 20) : anchor
    })
    let listener: (() => void) | null = null
    const subscribe = (l: () => void) => {
      listener = l
      return () => { listener = null }
    }
    try {
      render(
        <PopoverHostProvider subscribe={subscribe}>
          <Tooltip label="Follow" side="bottom">
            <button type="button">anchor</button>
          </Tooltip>
        </PopoverHostProvider>,
      )
      fireEvent.mouseEnter(screen.getByText('anchor'))
      expect(screen.getByRole('tooltip').style.left).toBe('122px')
      anchor = rect(200, 220)
      act(() => { listener?.() })
      expect(screen.getByRole('tooltip').style.left).toBe('222px')
    } finally {
      spy.mockRestore()
    }
  })
})
