// Opt-in browser benchmark for the board's stroke rendering (stage 30): 20
// windows, 20 notes, and 50 strokes of 500-2000 points, then a Space-drag pan
// and 12 ctrl+wheel zoom steps while a requestAnimationFrame counter and a
// long-task observer measure the frames. It reports measurements without
// timing assertions; structural assertions keep the seeded cardinality from
// silently shrinking.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, webSnapshotMode } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const VIEWPORT = { width: 1440, height: 900 }
const WINDOW_COUNT = 20
const NOTE_COUNT = 20
const STROKE_COUNT = 50
const WHEEL_STEPS = 12
const WHEEL_DELTA = -25
const BOARD_ZOOM_K = 0.0023

/** Frames and long tasks one gesture window measured. */
interface FrameStats {
  readonly fps: number
  readonly worstFrameMs: number
  readonly frames: number
  readonly seconds: number
  readonly longTasks: number
}

/** The probe state the page keeps between start and stop. */
interface ProbeState {
  frames: number[]
  longTasks: number
  running: boolean
  last: number
  observer: PerformanceObserver | undefined
}

/** Wait two animation frames so React commits and the browser paints. */
function settle(page: Page): Promise<void> {
  return page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => { resolve() }))
  }))
}

/** The 20-window first-frame layout the bench boots with. */
function layoutPayload(): string {
  const windows = Array.from({ length: WINDOW_COUNT }, (_entry, index) => ({
    id: `perf-window-${String(index)}`,
    kind: 'agent',
    bodyKind: 'conversation',
    ordinal: index + 1,
    x: (index % 5) * 720,
    y: Math.floor(index / 5) * 840,
    width: 552,
    height: 648,
    zIndex: 10 + index,
  }))
  return JSON.stringify({
    revision: 0,
    layout: {
      version: 1,
      panX: 0,
      panY: 0,
      zoom: 1,
      windows,
      windowOrder: windows.map(window => window.id),
      activeWindowId: windows[0]?.id ?? '',
      panelWindowId: '',
      panelCollapsed: true,
      panelWidth: 300,
      panelGroupBy: 'workspace',
      panelOrderBy: 'updated',
      defaultPreset: '',
    },
    bindings: {},
  })
}

/** Seed the notes and the strokes through the authenticated board route. */
async function seedElements(page: Page): Promise<void> {
  await page.evaluate(async ({ noteCount, strokeCount }) => {
    const post = async (ops: unknown[]): Promise<void> => {
      const response = await fetch('/api/ketos.board.ops', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ops }),
      })
      if (!response.ok) throw new Error(`board ops refused: ${String(response.status)}`)
    }
    const id = (index: number, prefix: string): string =>
      `${prefix}${String(index).padStart(7, '0')}-0000-4000-8000-000000000000`
    const noteOps = Array.from({ length: noteCount }, (_entry, index) => ({
      op: 'create',
      id: id(index, '1'),
      kind: 'note',
      x: 200 + (index % 5) * 320,
      y: 3400 + Math.floor(index / 5) * 260,
      w: 240,
      h: 160,
      data: { text: `perf note ${String(index)}`, font: 'sans', size: 'm', scale: 1 },
    }))
    await post(noteOps)
    // Five strokes per request: a 2000-point stroke is tens of KiB, and the
    // request bound is 1 MiB.
    for (let start = 0; start < strokeCount; start += 5) {
      const ops = []
      for (let index = start; index < Math.min(strokeCount, start + 5); index += 1) {
        const count = 500 + (index * 37) % 1501
        const points: number[][] = []
        for (let point = 0; point < count; point += 1) {
          const t = point / (count - 1)
          points.push([
            Math.round((40 + t * 520 + Math.sin(t * 12.9 + index) * 30) * 10) / 10,
            Math.round((140 + Math.sin(t * 9.7 + index * 2) * 90) * 10) / 10,
            0.5,
          ])
        }
        ops.push({
          op: 'create',
          id: id(index, '2'),
          kind: 'stroke',
          x: 300 + (index % 10) * 640,
          y: 300 + Math.floor(index / 10) * 320,
          w: 620,
          h: 300,
          data: { points, width: 'm', pen: false },
        })
      }
      await post(ops)
    }
  }, { noteCount: NOTE_COUNT, strokeCount: STROKE_COUNT })
}

/** Read the board view from the composed canvas transform. */
function readView(page: Page): Promise<{ scale: number; panX: number; panY: number }> {
  return page.evaluate(() => {
    const layer = document.querySelector('[data-surface="canvas-layer"]')
    if (layer === null) throw new Error('board canvas layer is missing')
    const matrix = new DOMMatrixReadOnly(getComputedStyle(layer).transform)
    return { scale: matrix.a, panX: matrix.e, panY: matrix.f }
  })
}

/** Converge the zoom to the target with synthetic ctrl+wheel events. */
async function zoomTo(page: Page, target: number): Promise<void> {
  const canvas = await page.locator('[data-surface="canvas"]').boundingBox()
  if (canvas === null) throw new Error('board canvas is missing')
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const view = await readView(page)
    if (Math.abs(view.scale - target) <= target * 0.01) return
    const delta = Math.min(50, Math.max(-50, Math.log(view.scale / target) / BOARD_ZOOM_K))
    await page.evaluate(({ deltaY, clientX, clientY }) => {
      document.querySelector('[data-surface="canvas"]')?.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, cancelable: true, ctrlKey: true, deltaY, clientX, clientY,
      }))
    }, { deltaY: delta, clientX: canvas.x + canvas.width / 2, clientY: canvas.y + canvas.height / 2 })
    await settle(page)
  }
  throw new Error('board zoom did not converge')
}

/** Install the rAF frame counter and the long-task observer. */
async function startProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state: ProbeState = {
      frames: [],
      longTasks: 0,
      running: true,
      last: performance.now(),
      observer: undefined,
    }
    const tick = (now: number): void => {
      state.frames.push(now - state.last)
      state.last = now
      if (state.running) requestAnimationFrame(tick)
    }
    try {
      const observer = new PerformanceObserver((list) => { state.longTasks += list.getEntries().length })
      observer.observe({ entryTypes: ['longtask'] })
      state.observer = observer
    } catch {
      // An engine without the longtask entry type leaves the count at zero.
    }
    ;(globalThis as typeof globalThis & { __boardStrokeProbe?: ProbeState }).__boardStrokeProbe = state
    requestAnimationFrame(tick)
  })
}

/** Stop the probe and reduce its frames. */
async function stopProbe(page: Page): Promise<FrameStats> {
  return await page.evaluate(() => {
    const state = (globalThis as typeof globalThis & { __boardStrokeProbe?: ProbeState }).__boardStrokeProbe
    if (state === undefined) throw new Error('board stroke probe is missing')
    state.running = false
    state.observer?.disconnect()
    const total = state.frames.reduce((sum, delta) => sum + delta, 0)
    return {
      fps: total === 0 ? 0 : Math.round((state.frames.length / total) * 1000 * 10) / 10,
      worstFrameMs: state.frames.length === 0 ? 0 : Math.round(Math.max(...state.frames) * 10) / 10,
      frames: state.frames.length,
      seconds: Math.round(total) / 1000,
      longTasks: state.longTasks,
    }
  })
}

/** Space-drag the canvas across the board. */
async function spaceDrag(page: Page): Promise<void> {
  const canvas = await page.locator('[data-surface="canvas"]').boundingBox()
  if (canvas === null) throw new Error('board canvas is missing')
  const startX = canvas.x + canvas.width - 260
  const startY = canvas.y + canvas.height - 180
  await page.mouse.move(startX, startY)
  await page.keyboard.down('Space')
  await page.mouse.down()
  for (let step = 1; step <= 30; step += 1) {
    await page.mouse.move(startX - step * 18, startY - step * 8)
  }
  await page.mouse.up()
  await page.keyboard.up('Space')
}

/** Twelve ctrl+wheel steps around the canvas centre (zoom 1 to about 2). */
async function wheelZoom(page: Page): Promise<void> {
  const canvas = await page.locator('[data-surface="canvas"]').boundingBox()
  if (canvas === null) throw new Error('board canvas is missing')
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
  await page.keyboard.down('Control')
  for (let step = 0; step < WHEEL_STEPS; step += 1) await page.mouse.wheel(0, WHEEL_DELTA)
  await page.keyboard.up('Control')
}

/** Measure one gesture with the frame probe. */
async function measure(page: Page, gesture: () => Promise<void>): Promise<FrameStats> {
  await startProbe(page)
  await gesture()
  await settle(page)
  return await stopProbe(page)
}

describe('manual web performance: board strokes', () => {
  let browser: Browser

  beforeAll(async () => {
    if (webSnapshotMode() === 'record') {
      throw new Error('manual web performance runs only with deterministic replay')
    }
    browser = await chromium.launch()
  })

  afterAll(async () => {
    await browser?.close()
  })

  it('measures pan and zoom with 20 windows, 20 notes, and 50 strokes', async () => {
    const scaffold = await launchWebScaffold()
    const page = await newEnglishPage(browser, VIEWPORT.height)
    const tripwire = watchConsole(page)
    try {
      await page.setViewportSize(VIEWPORT)
      await page.addInitScript((payload: string) => {
        localStorage.setItem('dsh.board.layout', payload)
      }, layoutPayload())
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      await page.evaluate(() => document.querySelector<HTMLElement>('[data-board-action="open-board"]')?.click())
      await page.waitForSelector('[data-surface="board"]', { timeout: 30_000 })
      await seedElements(page)
      // Fit every window and element, so the structural check sees them all.
      await page.locator('[data-board-action="dock-reset-view"]').click()
      await settle(page)
      const counts = await page.evaluate(() => ({
        windows: document.querySelectorAll('[data-board-window]').length,
        notes: document.querySelectorAll('[data-board-element-kind="note"]').length,
        strokes: document.querySelectorAll('[data-board-element-kind="stroke"]').length,
      }))
      expect(counts.windows).toBe(WINDOW_COUNT)
      expect(counts.notes).toBe(NOTE_COUNT)
      expect(counts.strokes).toBe(STROKE_COUNT)

      await zoomTo(page, 1)
      const pan = await measure(page, () => spaceDrag(page))
      await zoomTo(page, 1)
      const zoom = await measure(page, () => wheelZoom(page))
      const end = await readView(page)
      console.info(`WEB_PERF_RESULT ${JSON.stringify({
        scenario: 'board-strokes',
        fixture: {
          windows: counts.windows,
          notes: counts.notes,
          strokes: counts.strokes,
          strokePoints: '500-2000',
        },
        pan,
        zoom,
        endZoom: Math.round(end.scale * 100) / 100,
      }, null, 2)}`)
      expect(pan.fps).toBeGreaterThan(0)
      expect(zoom.fps).toBeGreaterThan(0)
      expect(tripwire.warnings).toEqual([])
      expect(tripwire.pageErrors).toEqual([])
    } finally {
      await scaffold.close()
    }
  }, 600_000)
})
