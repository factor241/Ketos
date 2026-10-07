// Browser behavior of the board's element layer (stage 28.8): an element
// created through the host route in one tab appears in the other within the
// one-second budget, a window still wins the hit test where it overlaps an
// element, and a drag or Delete performed in the second tab shows up in the
// first.
//
// Stage 30.4 adds the brush cases: real mouse strokes drawn at zoom 0.5 and 2,
// after a pan, and through a mid-stroke ctrl+wheel zoom must land under the
// cursor (every sampled mouse point within 0.5 screen px of the stored
// polyline), and the strokes must survive a reload.
//
// The scenario seeds one session and a deterministic localStorage layout
// (`dsh.board.layout`) with one window over the first element, then drives the
// second tab with real pointer gestures.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const FIXTURE = createChatScrollFixture({ markerPrefix: 'BOARD_ELEMENTS', title: 'BOARD_ELEMENTS window', turns: 1 })

/** The seeded window sits over the overlap element. */
const WINDOW = 'agent-elements-a'

const VIEWPORT = { width: 1440, height: 900 }

/** Element under the seeded window: hit tests must still reach the window. */
const ELEMENT_OVERLAP = '11111111-1111-4111-8111-111111111111'

/** Element in free canvas: the drag and Delete gestures act on it. */
const ELEMENT_MOVE = '22222222-2222-4222-8222-222222222222'

/** How long an element may take to appear in the other tab. */
const SYNC_BUDGET_MS = 1_000

/** Wait two animation frames so React commits and the browser paints. */
function settle(page: Page): Promise<void> {
  return page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => { resolve() }))
  }))
}

/** Open the board panel through the sidebar switch and wait for the canvas. */
async function openBoard(page: Page): Promise<void> {
  if (await page.locator('[data-surface="board"]').count() > 0) return
  await page.locator('[data-board-action="open-board"]').click()
  await page.locator('[data-surface="board"]').waitFor({ timeout: 30_000 })
}

/** One element selector by id. */
function elementSelector(id: string): string {
  return `[data-board-element-id="${id}"]`
}

/** Create one note element through the authenticated board route. */
async function createElement(page: Page, id: string, x: number, y: number): Promise<void> {
  await page.evaluate(async ({ id: elementId, x: left, y: top }) => {
    const response = await fetch('/api/ketos.board.ops', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ops: [{
          op: 'create',
          id: elementId,
          kind: 'note',
          x: left,
          y: top,
          w: 240,
          h: 160,
          data: { text: '', font: 'sans', size: 'm', scale: 1 },
        }],
      }),
    })
    if (!response.ok) throw new Error(`board ops refused: ${String(response.status)}`)
  }, { id, x, y })
}

/** The board view as the canvas layer's transform reports it. */
interface BoardView {
  readonly scale: number
  readonly panX: number
  readonly panY: number
}

/** Read the board view from the composed canvas transform. */
function readView(page: Page): Promise<BoardView> {
  return page.evaluate(() => {
    const layer = document.querySelector('[data-surface="canvas-layer"]')
    if (layer === null) throw new Error('board canvas layer is missing')
    const matrix = new DOMMatrixReadOnly(getComputedStyle(layer).transform)
    return { scale: matrix.a, panX: matrix.e, panY: matrix.f }
  })
}

/** One stroke the document stores, with its points in world units. */
interface StoredStroke {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly points: ReadonlyArray<readonly number[]>
}

/** Every stroke element the document holds. */
async function readStrokes(page: Page): Promise<StoredStroke[]> {
  return page.evaluate(async () => {
    const response = await fetch('/api/ketos.board')
    const body = await response.json() as {
      elements: Array<{ id: string; kind: string; x: number; y: number; data: { points?: number[][] } }>
    }
    return body.elements
      .filter(element => element.kind === 'stroke' && Array.isArray(element.data.points))
      .map(element => ({ id: element.id, x: element.x, y: element.y, points: element.data.points as number[][] }))
  })
}

/** One recorded mouse sample with the view in force when it was taken. */
interface RecordedSample {
  readonly x: number
  readonly y: number
  readonly view: BoardView
}

/** One world point; the distance helper's input. */
interface WorldPoint {
  readonly x: number
  readonly y: number
}

/** Closest distance from one world point to a world polyline. */
function pointToPolyline(point: WorldPoint, line: readonly WorldPoint[]): number {
  let closest = Number.POSITIVE_INFINITY
  for (let index = 1; index < line.length; index += 1) {
    const from = line[index - 1] as WorldPoint
    const to = line[index] as WorldPoint
    const ux = to.x - from.x
    const uy = to.y - from.y
    const lengthSquared = ux * ux + uy * uy
    const t = lengthSquared === 0
      ? 0
      : Math.min(1, Math.max(0, ((point.x - from.x) * ux + (point.y - from.y) * uy) / lengthSquared))
    closest = Math.min(closest, Math.hypot(point.x - (from.x + t * ux), point.y - (from.y + t * uy)))
  }
  return closest
}

/** Activate the brush from the dock. */
async function armBrush(page: Page): Promise<void> {
  const brush = page.locator('[data-board-action="dock-brush"]')
  if (await brush.getAttribute('aria-pressed') !== 'true') await brush.click()
  await settle(page)
}

/** Zoom with real ctrl+wheel strokes until the scale is within 2% of the target. */
async function zoomTo(page: Page, target: number, anchor: { readonly x: number; readonly y: number }): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const view = await readView(page)
    if (Math.abs(view.scale - target) <= target * 0.02) return
    // One event's delta is clamped to ±50, so a distant zoom converges over
    // several recomputed strokes.
    const delta = Math.min(50, Math.max(-50, Math.log(view.scale / target) / 0.0023))
    await page.mouse.move(anchor.x, anchor.y)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, delta)
    await page.keyboard.up('Control')
    await settle(page)
  }
  throw new Error('brush zoom did not converge')
}

/** Pan the empty canvas with the middle button, in screen pixels. */
async function panBy(page: Page, dx: number, dy: number): Promise<void> {
  const canvas = await page.locator('[data-surface="canvas"]').boundingBox()
  if (canvas === null) throw new Error('board canvas is missing')
  const startX = canvas.x + canvas.width - 300
  const startY = canvas.y + canvas.height - 200
  await page.mouse.move(startX, startY)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(startX + dx, startY + dy, { steps: 10 })
  await page.mouse.up({ button: 'middle' })
  await settle(page)
}

/**
 * Draw one stroke through screen points with the real mouse, recording every
 * sample with the live view. `between` runs after the first move, which is how
 * the mid-stroke zoom case changes the view inside one gesture.
 */
async function drawStroke(
  page: Page,
  points: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  between?: () => Promise<void>,
): Promise<RecordedSample[]> {
  const recorded: RecordedSample[] = []
  const record = async (x: number, y: number): Promise<void> => {
    recorded.push({ x, y, view: await readView(page) })
  }
  const first = points[0] as { x: number; y: number }
  await page.mouse.move(first.x, first.y)
  await page.mouse.down()
  await record(first.x, first.y)
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index] as { x: number; y: number }
    await page.mouse.move(point.x, point.y)
    await record(point.x, point.y)
    if (index === 1 && between !== undefined) await between()
  }
  await page.mouse.up()
  await settle(page)
  return recorded
}

/** Wait for one stroke the document did not hold before. */
async function waitForNewStroke(page: Page, known: ReadonlySet<string>): Promise<StoredStroke> {
  let found: StoredStroke | undefined
  await expect.poll(async () => {
    found = (await readStrokes(page)).find(stroke => !known.has(stroke.id))
    return found !== undefined
  }, { timeout: 5_000 }).toBe(true)
  if (found === undefined) throw new Error('new stroke is missing')
  return found
}

/**
 * Assert every recorded mouse sample maps onto the stored stroke within 0.5
 * screen pixels: each sample is translated with the view it was taken under,
 * and the distance is measured against the stored world polyline.
 */
function assertUnderCursor(
  samples: readonly RecordedSample[],
  stroke: StoredStroke,
  canvas: { readonly x: number; readonly y: number },
): void {
  const stored = stroke.points.map(point => ({
    x: stroke.x + (point[0] as number),
    y: stroke.y + (point[1] as number),
  }))
  expect(stored.length).toBeGreaterThanOrEqual(2)
  for (const sample of samples) {
    const world = {
      x: (sample.x - canvas.x - sample.view.panX) / sample.view.scale,
      y: (sample.y - canvas.y - sample.view.panY) / sample.view.scale,
    }
    expect(pointToPolyline(world, stored) * sample.view.scale).toBeLessThanOrEqual(0.5)
  }
}

describe('web e2e: board elements', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let pageA: Page
  let pageB: Page
  let tripwireA: ReturnType<typeof watchConsole>
  let tripwireB: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    const session = await seedSession(scaffold, FIXTURE.log, 'board-elements-a')
    browser = await chromium.launch()
    pageA = await newEnglishPage(browser, VIEWPORT.height)
    tripwireA = watchConsole(pageA)
    await pageA.setViewportSize(VIEWPORT)
    // The first-frame cache is the board's deterministic initial layout.
    await pageA.addInitScript((payload: string) => {
      localStorage.setItem('dsh.board.layout', payload)
    }, JSON.stringify({
      revision: 0,
      layout: {
        version: 1,
        panX: 0,
        panY: 0,
        zoom: 1,
        windows: [
          { id: WINDOW, kind: 'agent', bodyKind: 'conversation', ordinal: 1, x: 0, y: 0, width: 552, height: 648, zIndex: 10 },
        ],
        windowOrder: [WINDOW],
        activeWindowId: WINDOW,
        panelWindowId: '',
        panelCollapsed: true,
        panelWidth: 300,
        panelGroupBy: 'workspace',
        panelOrderBy: 'updated',
        defaultPreset: '',
      },
      bindings: { [WINDOW]: String(session) },
    }))
    await pageA.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await pageA.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openBoard(pageA)
    await pageA.locator(`[data-board-window-id="${WINDOW}"]`).waitFor({ timeout: 30_000 })

    pageB = await newEnglishPage(browser, VIEWPORT.height)
    tripwireB = watchConsole(pageB)
    await pageB.setViewportSize(VIEWPORT)
    await pageB.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await pageB.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openBoard(pageB)
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('shows an element created in the other tab within one second', async () => {
    const started = Date.now()
    await createElement(pageA, ELEMENT_OVERLAP, 100, 100)
    await pageB.locator(elementSelector(ELEMENT_OVERLAP)).waitFor({ timeout: 5_000 })
    expect(Date.now() - started).toBeLessThanOrEqual(SYNC_BUDGET_MS)
    await settle(pageB)
  }, 30_000)

  it('keeps the window on top where it overlaps the element', async () => {
    const box = await pageA.locator(elementSelector(ELEMENT_OVERLAP)).boundingBox()
    if (box === null) throw new Error('overlap element is missing')
    const hit = await pageA.evaluate(({ x, y }) => {
      const top = document.elementFromPoint(x, y)
      return {
        insideWindow: top?.closest('[data-board-window-id]') !== null && top?.closest('[data-board-window-id]') !== undefined,
        insideElement: top?.closest('[data-board-element-id]') !== null && top?.closest('[data-board-element-id]') !== undefined,
      }
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
    expect(hit).toEqual({ insideWindow: true, insideElement: false })
  }, 30_000)

  it('propagates a drag from the second tab to the first', async () => {
    await createElement(pageB, ELEMENT_MOVE, 800, 100)
    await pageA.locator(elementSelector(ELEMENT_MOVE)).waitFor({ timeout: 5_000 })
    const frame = pageB.locator(elementSelector(ELEMENT_MOVE))
    const box = await frame.boundingBox()
    if (box === null) throw new Error('movable element is missing')
    const startX = box.x + box.width / 2
    const startY = box.y + box.height / 2
    await pageB.mouse.move(startX, startY)
    await pageB.mouse.down()
    await pageB.mouse.move(startX + 120, startY, { steps: 6 })
    await pageB.mouse.up()
    await settle(pageB)
    await expect.poll(async () => await pageA.evaluate((id) => {
      const element = document.querySelector(`[data-board-element-id="${id}"]`)
      return element === null ? null : (element as HTMLElement).style.left
      // 800 + 120 screen pixels snaps to the 24-unit grid at 912.
    }, ELEMENT_MOVE), { timeout: 5_000 }).toBe('912px')
  }, 30_000)

  it('propagates Delete from the second tab to the first', async () => {
    const frame = pageB.locator(elementSelector(ELEMENT_MOVE))
    const box = await frame.boundingBox()
    if (box === null) throw new Error('deletable element is missing')
    await pageB.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await settle(pageB)
    await pageB.keyboard.press('Delete')
    await expect.poll(async () => await pageA.locator(elementSelector(ELEMENT_MOVE)).count(), { timeout: 5_000 }).toBe(0)
    expect(tripwireA.warnings).toEqual([])
    expect(tripwireA.pageErrors).toEqual([])
    expect(tripwireB.warnings).toEqual([])
    expect(tripwireB.pageErrors).toEqual([])
  }, 30_000)

  it('creates a note from the + menu at two zooms, edits it, and restores it after reload', async () => {
    const board = pageA.locator('[data-surface="board"]')
    const boardBox = await board.boundingBox()
    if (boardBox === null) throw new Error('board is missing')
    const centerX = boardBox.x + boardBox.width / 2
    const centerY = boardBox.y + boardBox.height / 2

    /** Zoom the board with ctrl+wheel, then create one note and return its frame. */
    const createNote = async (wheelDelta: number): Promise<void> => {
      await pageA.mouse.move(centerX, centerY)
      await pageA.keyboard.down('Control')
      for (let step = 0; step < 3; step++) await pageA.mouse.wheel(0, wheelDelta)
      await pageA.keyboard.up('Control')
      await settle(pageA)
      await pageA.locator('[data-board-action="dock-add"]').click()
      await pageA.getByRole('menuitem', { name: 'Note' }).click()
      await pageA.locator('[data-board-note-editor]').waitFor({ timeout: 10_000 })
      await settle(pageA)
      const frame = pageA.locator('[data-board-element-kind="note"]').last()
      const box = await frame.boundingBox()
      if (box === null) throw new Error('created note is missing')
      // The note is centered in the visible safe area: its center sits at the
      // board center within the chrome and the resize step.
      expect(Math.abs(box.x + box.width / 2 - centerX)).toBeLessThan(60)
      expect(Math.abs(box.y + box.height / 2 - centerY)).toBeLessThan(80)
      await expect.poll(
        async () => await pageA.evaluate(() => document.activeElement?.hasAttribute('data-board-note-editor') === true),
        { timeout: 5_000 },
      ).toBe(true)
    }

    // Zoomed out and zoomed in: the placement follows the visible area, not a
    // fixed world point.
    await createNote(600)
    await createNote(-600)

    await pageA.locator('[data-board-note-editor]').last().pressSequentially('Hello e2e note')
    await pageA.locator('[data-board-note-editor]').last().press('Escape')
    await pageA.locator('[data-board-note-content]', { hasText: 'Hello e2e note' }).waitFor({ timeout: 10_000 })

    await pageA.reload({ waitUntil: 'load' })
    await openBoard(pageA)
    await pageA.locator('[data-board-note-content]', { hasText: 'Hello e2e note' }).waitFor({ timeout: 30_000 })
    expect(tripwireA.warnings).toEqual([])
    expect(tripwireA.pageErrors).toEqual([])
  }, 120_000)

  it('draws under the cursor at two zooms, through pan and a mid-stroke zoom, and restores the strokes', async () => {
    const canvas = await pageA.locator('[data-surface="canvas"]').boundingBox()
    if (canvas === null) throw new Error('board canvas is missing')
    // The drawing area stays clear of the seeded window at every view below.
    const center = { x: canvas.x + canvas.width * 0.75, y: canvas.y + canvas.height * 0.7 }
    await armBrush(pageA)

    /** Draw one stroke at the current view and assert it under the cursor. */
    const drawAndAssert = async (
      points: ReadonlyArray<{ readonly x: number; readonly y: number }>,
      between?: () => Promise<void>,
    ): Promise<void> => {
      const known = new Set((await readStrokes(pageA)).map(stroke => stroke.id))
      const samples = await drawStroke(pageA, points, between)
      const stroke = await waitForNewStroke(pageA, known)
      assertUnderCursor(samples, stroke, canvas)
    }

    // 1. Zoomed out to 0.5.
    await zoomTo(pageA, 0.5, center)
    await drawAndAssert([
      { x: center.x - 120, y: center.y - 60 },
      { x: center.x - 20, y: center.y + 10 },
      { x: center.x + 80, y: center.y - 40 },
    ])

    // 2. Zoomed in to 2.
    await zoomTo(pageA, 2, center)
    await drawAndAssert([
      { x: center.x - 100, y: center.y - 80 },
      { x: center.x + 40, y: center.y + 30 },
      { x: center.x + 110, y: center.y - 50 },
    ])

    // 3. After a pan, with the window pushed away from the drawing area.
    await panBy(pageA, -200, 200)
    await drawAndAssert([
      { x: center.x - 90, y: center.y - 70 },
      { x: center.x + 60, y: center.y + 40 },
    ])

    // 4. Ctrl+wheel inside one stroke: the samples before the zoom keep their
    //    view, so the stored points still land under the cursor.
    await drawAndAssert([
      { x: center.x - 80, y: center.y - 60 },
      { x: center.x + 30, y: center.y + 20 },
      { x: center.x + 100, y: center.y - 30 },
    ], async () => {
      await pageA.keyboard.down('Control')
      await pageA.mouse.wheel(0, -60)
      await pageA.keyboard.up('Control')
      await settle(pageA)
    })

    // 5. Every stroke survives a reload.
    const ids = (await readStrokes(pageA)).map(stroke => stroke.id)
    expect(ids.length).toBeGreaterThanOrEqual(4)
    await pageA.reload({ waitUntil: 'load' })
    await openBoard(pageA)
    for (const id of ids) {
      await pageA.locator(elementSelector(id)).waitFor({ timeout: 30_000 })
    }
    expect(tripwireA.warnings).toEqual([])
    expect(tripwireA.pageErrors).toEqual([])
  }, 180_000)

  it('selects, moves, and deletes a drawn stroke and ignores its empty box', async () => {
    // Normalize the view so the seeded window stays clear of the drawing area.
    await pageA.locator('[data-board-action="dock-reset-view"]').click()
    await settle(pageA)
    const canvas = await pageA.locator('[data-surface="canvas"]').boundingBox()
    if (canvas === null) throw new Error('board canvas is missing')
    const center = { x: canvas.x + canvas.width * 0.7, y: canvas.y + canvas.height * 0.6 }
    await armBrush(pageA)
    const known = new Set((await readStrokes(pageA)).map(stroke => stroke.id))
    // A "/" diagonal leaves both box corners empty for the miss case.
    const samples = await drawStroke(pageA, [
      { x: center.x - 120, y: center.y + 80 },
      { x: center.x + 120, y: center.y - 80 },
    ])
    const stroke = await waitForNewStroke(pageA, known)
    await pageA.keyboard.press('Escape')
    await settle(pageA)

    const frame = pageA.locator(elementSelector(stroke.id))
    const box = await frame.boundingBox()
    if (box === null) throw new Error('drawn stroke is missing')

    // The empty corner of the box does not select: the line is a diagonal.
    await pageA.mouse.click(box.x + 4, box.y + 4)
    await settle(pageA)
    expect(await frame.getAttribute('data-board-element-selected')).toBeNull()

    // The line itself selects.
    const first = samples[0] as { x: number; y: number }
    const last = samples[samples.length - 1] as { x: number; y: number }
    const middle = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 }
    await pageA.mouse.click(middle.x, middle.y)
    await expect.poll(async () => await frame.getAttribute('data-board-element-selected'), { timeout: 5_000 }).toBe('')

    // A drag moves it with a patch that keeps its points.
    const before = (await readStrokes(pageA)).find(candidate => candidate.id === stroke.id)
    if (before === undefined) throw new Error('stroke left the document')
    await pageA.mouse.move(middle.x, middle.y)
    await pageA.mouse.down()
    await pageA.mouse.move(middle.x + 72, middle.y + 24, { steps: 8 })
    await pageA.mouse.up()
    await expect.poll(async () => {
      const moved = (await readStrokes(pageA)).find(candidate => candidate.id === stroke.id)
      return moved === undefined ? 'gone' : `${String(moved.x)},${String(moved.y)}`
    }, { timeout: 5_000 }).not.toBe(`${String(before.x)},${String(before.y)}`)
    const moved = (await readStrokes(pageA)).find(candidate => candidate.id === stroke.id)
    expect(moved?.points).toEqual(before.points)

    // Delete removes the selected stroke.
    await pageA.keyboard.press('Delete')
    await expect.poll(
      async () => (await readStrokes(pageA)).some(candidate => candidate.id === stroke.id),
      { timeout: 5_000 },
    ).toBe(false)
    expect(tripwireA.warnings).toEqual([])
    expect(tripwireA.pageErrors).toEqual([])
  }, 120_000)
})
