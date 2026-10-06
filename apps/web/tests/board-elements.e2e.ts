// Browser behavior of the board's element layer (stage 28.8): an element
// created through the host route in one tab appears in the other within the
// one-second budget, a window still wins the hit test where it overlaps an
// element, and a drag or Delete performed in the second tab shows up in the
// first.
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
})
