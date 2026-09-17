// @vitest-environment jsdom
/** Canvas layer and minimap: store-driven reads, the window-layer seat, and minimap projection. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { Minimap, type MinimapProps } from '../src/client/canvas/Minimap.tsx'
import { DashboardCanvas, type DashboardCanvasProps } from '../src/client/canvas/DashboardCanvas.tsx'
import minimapCss from '../src/client/canvas/Minimap.module.css'
import canvasCss from '../src/client/canvas/DashboardCanvas.module.css'
import type { BoardState } from '../src/client/store.ts'
import type { BoardWindowState, WindowId } from '../src/client/contract/slots.ts'

/**
 * Component props for one direct render: a fixed store seat over `state` plus
 * the supplied action face. The framework's global hooks (sessions, panel
 * info, resources) stay unexercised here — these specs cover canvas behavior,
 * so the seat is the only framework input they bind.
 */
function minimapProps(state: BoardState, actions: MinimapProps['actions']): MinimapProps {
  return {
    useStore: <S,>(selector: (value: BoardState) => S): S => selector(state),
    actions,
  } as unknown as MinimapProps
}

/** Canvas props with the same seat; `renderSlot` stands in for the window layer. */
function canvasProps(
  state: BoardState,
  actions: DashboardCanvasProps['actions'],
  renderSlot: DashboardCanvasProps['renderSlot'],
): DashboardCanvasProps {
  return {
    useStore: <S,>(selector: (value: BoardState) => S): S => selector(state),
    actions,
    renderSlot,
  }
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

/** Resolve a CSS Module class; a class the stylesheet must define fails loudly at the call site. */
function classOf(classes: Record<string, string>, name: string): string {
  const found = classes[name]
  if (found === undefined) throw new Error(`class ${name} missing from the stylesheet`)
  return found
}

const baseState: BoardState = {
  panX: 0,
  panY: 0,
  zoom: 1,
  viewportWidth: 1920,
  viewportHeight: 1080,
  windows: {},
  windowOrder: [],
  activeWindowId: null,
  fullscreenWindowId: null,
  panelWindowId: null,
  panelCollapsed: true,
  panelWidth: 300,
  panelGroupBy: 'workspace',
  panelOrderBy: 'updated',
  isSelectingElement: false,
}

describe('Minimap Component', () => {
  it('projects windows and the camera frustum, and centers the view on a click', () => {
    const win1: BoardWindowState = {
      id: 'agent-1' as WindowId,
      kind: 'agent',
      bodyKind: 'conversation',
      title: 'Agent 1',
      x: 100,
      y: 100,
      width: 400,
      height: 500,
      zIndex: 10,
    }
    const win2: BoardWindowState = {
      id: 'tool-1' as WindowId,
      kind: 'connectors',
      bodyKind: 'connectors',
      title: 'Connectors',
      x: 600,
      y: 100,
      width: 500,
      height: 400,
      zIndex: 11,
    }
    const state: BoardState = {
      ...baseState,
      windows: { 'agent-1': win1, 'tool-1': win2 },
      windowOrder: ['agent-1' as WindowId, 'tool-1' as WindowId],
      activeWindowId: 'agent-1' as WindowId,
    }
    const actions = { setPan: vi.fn(), centerOnWindow: vi.fn() } as unknown as MinimapProps['actions']

    const { container } = render(<Minimap {...minimapProps(state, actions)} />)

    expect(container.querySelector('svg')).not.toBeNull()

    const rects = container.querySelectorAll('rect')
    // 2 windows + 1 camera frustum = 3 rects
    expect(rects.length).toBe(3)
    // The agent rect carries the brand fill class and the tool rect the business
    // fill class; the actual colors live in tokens, not in this spec.
    expect(rects[0]?.classList.contains(classOf(minimapCss, 'agent'))).toBe(true)
    expect(rects[1]?.classList.contains(classOf(minimapCss, 'tool'))).toBe(true)
    expect(rects[0]?.classList.contains(classOf(minimapCss, 'idle'))).toBe(false)
    expect(rects[0]?.classList.contains(classOf(minimapCss, 'active'))).toBe(true)
    expect(rects[2]?.classList.contains(classOf(minimapCss, 'frustum'))).toBe(true)

    // Projection math: the world-to-minimap transform and the camera frustum.
    // scale = min(200/1960, 140/1120); window 1 starts at (100, 100), the frustum at the view origin.
    const attribute = (rect: Element | undefined, name: string) => Number(rect?.getAttribute(name))
    expect(attribute(rects[0], 'x')).toBeCloseTo(12.2449, 3)
    expect(attribute(rects[0], 'y')).toBeCloseTo(12.2449, 3)
    expect(attribute(rects[0], 'width')).toBeCloseTo(40.8163, 3)
    expect(attribute(rects[0], 'height')).toBeCloseTo(51.0204, 3)
    expect(attribute(rects[1], 'x')).toBeCloseTo(63.2653, 3)
    expect(attribute(rects[1], 'width')).toBeCloseTo(51.0204, 3)
    expect(attribute(rects[1], 'height')).toBeCloseTo(40.8163, 3)
    expect(attribute(rects[2], 'x')).toBeCloseTo(2.0408, 3)
    expect(attribute(rects[2], 'y')).toBeCloseTo(2.0408, 3)
    expect(attribute(rects[2], 'width')).toBeCloseTo(195.9184, 3)
    expect(attribute(rects[2], 'height')).toBeCloseTo(110.2041, 3)

    fireEvent.click(rects[1] as Element)
    expect(actions.centerOnWindow).toHaveBeenCalledWith('tool-1')
  })
})

describe('DashboardCanvas Component', () => {
  // jsdom implements no pointer capture; the pan gesture only needs its deltas.
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, configurable: true, writable: true })
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { value: () => {}, configurable: true, writable: true })
  })

  it('renders the transformed canvas surface and the window-layer seat', () => {
    // jsdom has no layout: pin the measured box so the published viewport is the production read.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800)
    const state: BoardState = { ...baseState, panX: 40, zoom: 1.5 }
    const actions = { setViewport: vi.fn(), setPan: vi.fn(), zoomTowardPointer: vi.fn() } as unknown as DashboardCanvasProps['actions']
    const renderSlot = vi.fn(() => <span data-testid="windows-layer" />)

    const { container } = render(
      <DashboardCanvas {...canvasProps(state, actions, renderSlot)} />,
    )

    // The canvas root and its transformed content layer carry distinct markers,
    // so a strict locator never binds two nodes.
    const surfaces = container.querySelectorAll<HTMLElement>('[data-surface="canvas"]')
    const layers = container.querySelectorAll<HTMLElement>('[data-surface="canvas-layer"]')
    expect(surfaces.length).toBe(1)
    expect(layers.length).toBe(1)
    expect(surfaces[0]?.classList.contains(classOf(canvasCss, 'canvas'))).toBe(true)
    expect(layers[0]?.classList.contains(classOf(canvasCss, 'surface'))).toBe(true)
    // Zoom and pan reach the stylesheet as component-local custom properties.
    expect(surfaces[0]?.style.getPropertyValue('--board-zoom')).toBe('1.5')
    expect(surfaces[0]?.style.getPropertyValue('--board-pan-x')).toBe('40px')
    expect(surfaces[0]?.style.getPropertyValue('--board-grid-size')).toBe('36px')
    expect(container.querySelector('[data-testid="windows-layer"]')).not.toBeNull()

    // The canvas publishes its measured box and renders the declared window layer.
    expect(actions.setViewport).toHaveBeenCalledWith(1000, 800)
    expect(renderSlot).toHaveBeenCalledWith('board.windows', {})
  })

  it('pans from the bare canvas and finishes the gesture through the shared cleanup', () => {
    const setPan = vi.fn<(x: number, y: number) => void>()
    const actions = { setViewport: vi.fn(), setPan, zoomTowardPointer: vi.fn() } as unknown as DashboardCanvasProps['actions']
    const { container } = render(
      <DashboardCanvas {...canvasProps({ ...baseState, panX: 30, panY: -20 }, actions, vi.fn(() => null))} />,
    )
    const canvas = container.querySelector('[data-surface="canvas"]') as HTMLElement
    const surface = container.querySelector('[data-surface="canvas-layer"]') as HTMLElement

    fireEvent.pointerDown(surface, { pointerId: 7, clientX: 100, clientY: 100, button: 0 })
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 140, clientY: 90 })
    expect(setPan).toHaveBeenCalledWith(70, -30)

    // A cancelled gesture releases the pointer and stops listening.
    fireEvent.pointerCancel(window, { pointerId: 7 })
    setPan.mockClear()
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 500, clientY: 500 })
    expect(setPan).not.toHaveBeenCalled()

    // A pointer down on the canvas root still pans; the chrome is not the canvas.
    fireEvent.pointerDown(canvas, { pointerId: 8, clientX: 10, clientY: 10, button: 0 })
    fireEvent.pointerMove(window, { pointerId: 8, clientX: 20, clientY: 20 })
    expect(setPan).toHaveBeenCalledWith(40, -10)
  })

  it('leaves a fullscreen window its identity transform instead of panning', () => {
    const setPan = vi.fn<(x: number, y: number) => void>()
    const actions = { setViewport: vi.fn(), setPan, zoomTowardPointer: vi.fn() } as unknown as DashboardCanvasProps['actions']
    const state: BoardState = { ...baseState, fullscreenWindowId: 'a1' as WindowId }
    const { container } = render(
      <DashboardCanvas {...canvasProps(state, actions, vi.fn(() => null))} />,
    )
    const canvas = container.querySelector('[data-surface="canvas"]') as HTMLElement
    fireEvent.pointerDown(canvas, { pointerId: 3, clientX: 50, clientY: 50, button: 0 })
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 90, clientY: 70 })
    fireEvent.pointerUp(window, { pointerId: 3 })
    // The mode's inset rectangle maps to the panel, so a pan would only hide
    // store state that reappears on exit.
    expect(setPan).not.toHaveBeenCalled()
  })

})
