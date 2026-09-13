// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { Minimap } from '../src/client/canvas/Minimap.tsx'
import { DashboardCanvas } from '../src/client/canvas/DashboardCanvas.tsx'
import { createBoardStore } from '../src/client/store.ts'
import type { BoardWindowState, WindowId } from '../src/client/contract/slots.ts'

describe('Minimap Component', () => {
  it('renders SVG rectangles for board windows and camera frustum', () => {
    const win1: BoardWindowState = {
      id: 'agent-1' as WindowId,
      kind: 'agent',
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
      title: 'Connectors',
      x: 600,
      y: 100,
      width: 500,
      height: 400,
      zIndex: 11,
    }

    const state = {
      panX: 0,
      panY: 0,
      zoom: 1,
      windows: { 'agent-1': win1, 'tool-1': win2 },
      windowOrder: ['agent-1' as WindowId, 'tool-1' as WindowId],
      activeWindowId: 'agent-1' as WindowId,
      isSelectingElement: false,
    }

    const onPanChange = vi.fn()
    const onFocusWindow = vi.fn()

    const { container } = render(
      <Minimap
        state={state}
        viewportWidth={1920}
        viewportHeight={1080}
        onPanChange={onPanChange}
        onFocusWindow={onFocusWindow}
      />,
    )

    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()

    const rects = container.querySelectorAll('rect')
    // 2 windows + 1 camera frustum = 3 rects
    expect(rects.length).toBe(3)

    // Agent rect uses terracotta fill (#B8532F)
    expect(rects[0]?.getAttribute('fill')).toBe('#B8532F')
    // Tool rect uses blue fill (#3266AD)
    expect(rects[1]?.getAttribute('fill')).toBe('#3266AD')
  })
})

describe('DashboardCanvas Component', () => {
  it('renders GPU canvas with dot grid and window layers', () => {
    const { store, actions } = createBoardStore().create()
    const win: BoardWindowState = {
      id: 'agent-1' as WindowId,
      kind: 'agent',
      title: 'Autonomous Expert',
      x: 200,
      y: 150,
      width: 480,
      height: 560,
      zIndex: 10,
      status: 'done',
      statusText: 'All routine tasks completed.',
      contextUsed: { usedTokens: 32900, maxTokens: 200000, percent: 16.4 },
    }
    actions.addWindow(win)

    const { container, getByText } = render(
      <DashboardCanvas state={store.getSnapshot()} actions={actions} />,
    )

    // Canvas surface exists
    const canvas = container.querySelector('[data-surface="canvas"]')
    expect(canvas).not.toBeNull()

    // Agent window title and status rendered
    expect(getByText('Autonomous Expert')).not.toBeNull()
    expect(getByText('✓ Done')).not.toBeNull()
    expect(getByText('All routine tasks completed.')).not.toBeNull()

    // Context usage pill rendered
    expect(getByText('16.4%')).not.toBeNull()

    // Omnibox and SessionRail rendered
    expect(container.querySelector('input[placeholder="Ask me anything..."]')).not.toBeNull()
  })
})
