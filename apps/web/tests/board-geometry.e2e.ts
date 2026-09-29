// Browser geometry of the spatial Board (Д0.2 of docs/ketos/board-audit-plan.md).
//
// Every problem the audit measured in a browser is reproduced here: a problem
// still open keeps an expected-failing assertion (`it.fails`), so the suite
// stays green while the behaviour is broken, and the stage that fixes it flips
// the marker to a plain `it`. The Д2 popover problems (П-09 … П-15, П-36) are
// plain assertions; the Д2.4 sweep additionally measures the close tooltip
// and the model menu at zoom 0.5/1/2 near all four board edges. The
// measurements use the built dist through `launchWebScaffold`, seeded
// sessions, and a deterministic localStorage layout (`dsh.board.layout`), so
// the seeded windows mount their conversation bodies before anything is
// measured.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const FIXTURE_A = createChatScrollFixture({ markerPrefix: 'BOARD_GEOM_A', title: 'BOARD_GEOMETRY window A', turns: 2 })
const FIXTURE_B = createChatScrollFixture({ markerPrefix: 'BOARD_GEOM_B', title: 'BOARD_GEOMETRY window B', turns: 2 })
const FIXTURE_C = createChatScrollFixture({ markerPrefix: 'BOARD_GEOM_C', title: 'BOARD_GEOMETRY window C', turns: 2 })

/** Window identities the seeded layout carries. */
const WINDOW_A = 'agent-e2e-a'
const WINDOW_B = 'agent-e2e-b'
/** Third window: seeded off the board's left edge and taller than the board, for П-13 and П-31. */
const WINDOW_C = 'agent-e2e-c'

/** Board panel used by the audit (1440×900) and the narrow case (1100×700). */
const WIDE_VIEWPORT = { width: 1440, height: 900 }
const NARROW_VIEWPORT = { width: 1100, height: 700 }

/** A pointer park far from board controls: hovering here clears every tooltip. */
const NEUTRAL_POINTER = { x: 1435, y: 5 }

/**
 * A provider catalog long enough that the model submenu overflows the board:
 * the shipped catalogue is only two models, so П-15 cannot reproduce without
 * it. `replayProvidersOnly` mounts the catalog from a call-free header fixture.
 */
const PROVIDER_MODELS = [
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek-V4-Flash',
    contextWindow: 128_000,
    reasoningEfforts: ['off', 'low', 'high', 'max'],
    defaultReasoningEffort: 'high',
  },
  ...Array.from({ length: 24 }, (_, index) => ({
    id: `board-model-${String(index)}`,
    name: `Board Model ${String(index)}`,
    contextWindow: 128_000,
  })),
]

/** Pan and zoom as the transformed canvas layer renders them. */
interface Transform {
  scale: number
  panX: number
  panY: number
}

/** A viewport rectangle in CSS pixels. */
interface Rect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/** One wheel target on the board, resolved in the page by selector and index. */
interface WheelTarget {
  selector: string
  index: number
}

/** WheelEvent fields the scenario sets; anything omitted stays at its zero value. */
interface WheelInit {
  deltaX?: number
  deltaY?: number
  deltaMode?: number
  ctrlKey?: boolean
  clientX?: number
  clientY?: number
}

/** What one tooltip measurement reports. */
interface TooltipMeasurement {
  side: string
  gap: number
  axisOffset: number
  adjacent: boolean
  axisAligned: boolean
  insideBoard: boolean
}

/** The open menu's geometry beside its trigger chip and the board. */
interface MenuMeasurement {
  scale: number
  ratio: number
  insideBoard: boolean
  chip: Rect
  menu: Rect
  offsetHeight: number
  board: Rect
}

/** Read the canvas layer's pan and zoom from its computed transform matrix. */
function readTransform(page: Page): Promise<Transform> {
  return page.evaluate(() => {
    const layer = document.querySelector('[data-surface="canvas-layer"]')
    if (layer === null) throw new Error('board canvas layer is missing')
    const matrix = new DOMMatrixReadOnly(getComputedStyle(layer).transform)
    return { scale: matrix.a, panX: matrix.e, panY: matrix.f }
  })
}

/** Wait two animation frames so React commits and the browser paints a measurement. */
function settle(page: Page): Promise<void> {
  return page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => { resolve() }))
  }))
}

/**
 * Dispatch one wheel event on a resolved target and report whether the board
 * prevented it plus the resulting transform.
 */
async function dispatchWheel(
  page: Page,
  target: WheelTarget,
  init: WheelInit,
): Promise<{ prevented: boolean; before: Transform; after: Transform }> {
  const before = await readTransform(page)
  const prevented = await page.evaluate(({ selector, index, init }) => {
    const element = document.querySelectorAll(selector)[index]
    if (element === undefined) throw new Error(`wheel target is missing: ${selector}[${String(index)}]`)
    return !element.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaX: 0, deltaY: 0, deltaMode: 0, ...init,
    }))
  }, { selector: target.selector, index: target.index, init })
  await settle(page)
  return { prevented, before, after: await readTransform(page) }
}

/** Index of a window in the board's paint order, shared by its frame and its rail. */
async function windowIndex(page: Page, windowId: string): Promise<number> {
  const index = await page.evaluate((id) => {
    const frames = [...document.querySelectorAll('[data-board-window-id]')]
    return frames.findIndex(frame => frame.getAttribute('data-board-window-id') === id)
  }, windowId)
  if (index < 0) throw new Error(`board window is missing: ${windowId}`)
  return index
}

/** Wheel target over one window frame (header and body share the frame element). */
function frameTarget(windowId: string): WheelTarget {
  return { selector: `[data-board-window-id="${windowId}"]`, index: 0 }
}

/**
 * Wheel target over one window's collapsed chats rail. Rails carry no window
 * id, so the rail list is paired with the frame list by the shared paint order.
 */
async function railTarget(page: Page, windowId: string): Promise<WheelTarget> {
  const counts = await page.evaluate(() => ({
    frames: document.querySelectorAll('[data-board-window-id]').length,
    rails: document.querySelectorAll('[data-board-panel-rail]').length,
  }))
  if (counts.frames !== counts.rails) {
    throw new Error(`rail/frame association is ambiguous: ${String(counts.frames)} frames, ${String(counts.rails)} rails`)
  }
  return { selector: '[data-board-panel-rail]', index: await windowIndex(page, windowId) }
}

/** Build the DOMRect of a resolved target for rail assertions. */
function measureWindowParts(page: Page, windowId: string): Promise<{ frame: Rect; rail: Rect }> {
  return page.evaluate((id) => {
    const frames = [...document.querySelectorAll('[data-board-window-id]')]
    const index = frames.findIndex(frame => frame.getAttribute('data-board-window-id') === id)
    if (index < 0) throw new Error(`board window is missing: ${id}`)
    const rails = [...document.querySelectorAll('[data-board-panel-rail]')]
    const railElement = rails[index]
    if (railElement === undefined) throw new Error(`chats rail is missing for window: ${id}`)
    const frameRect = frames[index]!.getBoundingClientRect()
    const railRect = railElement.getBoundingClientRect()
    const rect = (source: DOMRect): Rect => ({
      left: source.left, top: source.top, right: source.right, bottom: source.bottom,
      width: source.width, height: source.height,
    })
    return { frame: rect(frameRect), rail: rect(railRect) }
  }, windowId)
}

/** Click the dock's reset-view control and settle. */
async function clickResetView(page: Page): Promise<void> {
  await page.locator('[data-board-action="dock-reset-view"]').click()
  await settle(page)
}

/**
 * Drive ctrl+wheel strokes over the empty canvas until the board scale reaches
 * the target within one wheel step; a handler that never takes ctrl+wheel (the
 * П-01 symptom) fails loud here instead of silently skipping the measurement.
 */
async function setZoom(page: Page, target: number): Promise<void> {
  const canvas = await page.locator('[data-surface="canvas"]').boundingBox()
  if (canvas === null) throw new Error('board canvas is missing')
  const clientX = canvas.x + canvas.width * 0.75
  const clientY = canvas.y + canvas.height * 0.5
  for (let stroke = 0; stroke < 30; stroke += 1) {
    const current = await readTransform(page)
    if (Math.abs(current.scale - target) <= 0.03) return
    await page.evaluate(({ clientX: x, clientY: y, delta }) => {
      const element = document.querySelector('[data-surface="canvas"]')
      if (element === null) throw new Error('board canvas is missing')
      element.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, cancelable: true, ctrlKey: true, deltaX: 0, deltaY: delta, deltaMode: 0,
        clientX: x, clientY: y,
      }))
    }, { clientX, clientY, delta: current.scale < target ? -100 : 100 })
    await settle(page)
  }
  throw new Error(`board zoom did not converge to ${String(target)}`)
}

/** Drag the empty canvas with the middle button, in screen pixels. */
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

/** Resize the viewport and wait for the board box to settle at the new width. */
async function resizeViewport(page: Page, viewport: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(viewport)
  await page.locator('[data-surface="board"]').evaluate(async (board) => {
    const deadline = performance.now() + 5_000
    let previous = board.getBoundingClientRect().width
    let stable = 0
    while (performance.now() < deadline) {
      await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve() }) })
      const current = board.getBoundingClientRect().width
      stable = Math.abs(current - previous) < 0.01 ? stable + 1 : 0
      if (stable >= 3) return
      previous = current
    }
    throw new Error('board box did not settle after the viewport changed')
  })
}

/**
 * Hover an anchor and measure the tooltip the primitives render: gap along the
 * declared side, misalignment on the perpendicular axis, and whether the
 * bubble lands inside the board box.
 */
async function measureTooltip(page: Page, selector: string): Promise<TooltipMeasurement> {
  await page.mouse.move(NEUTRAL_POINTER.x, NEUTRAL_POINTER.y)
  await settle(page)
  await page.locator(selector).first().hover()
  await page.locator('[role="tooltip"]').first().waitFor({ state: 'visible', timeout: 10_000 })
  const measurement = await page.evaluate((targetSelector) => {
    const anchor = document.querySelector(targetSelector)
    const bubble = document.querySelector('[role="tooltip"]')
    if (anchor === null || bubble === null) throw new Error(`tooltip measurement target is missing: ${targetSelector}`)
    const a = anchor.getBoundingClientRect()
    const t = bubble.getBoundingClientRect()
    const board = document.querySelector('[data-surface="board"]')?.getBoundingClientRect()
    const side = bubble.getAttribute('data-side') ?? ''
    const centerX = (rect: DOMRect): number => rect.left + rect.width / 2
    const centerY = (rect: DOMRect): number => rect.top + rect.height / 2
    let gap = Number.NaN
    let axisOffset = Number.NaN
    if (side === 'right') {
      gap = t.left - a.right
      axisOffset = Math.abs(centerY(t) - centerY(a))
    } else if (side === 'bottom') {
      gap = t.top - a.bottom
      axisOffset = Math.abs(centerX(t) - centerX(a))
    } else if (side === 'top') {
      gap = a.top - t.bottom
      axisOffset = Math.abs(centerX(t) - centerX(a))
    }
    return {
      side,
      gap,
      axisOffset,
      adjacent: gap >= 4 && gap <= 16,
      axisAligned: axisOffset <= 24,
      insideBoard: board === undefined ? false
        : t.left >= board.left && t.right <= board.right && t.top >= board.top && t.bottom <= board.bottom,
    }
  }, selector)
  await page.mouse.move(NEUTRAL_POINTER.x, NEUTRAL_POINTER.y)
  await settle(page)
  return measurement
}

/** The tooltip verdict an assertion compares, without the raw pixel diagnostics. */
function tooltipVerdict(
  measurement: TooltipMeasurement,
): Pick<TooltipMeasurement, 'side' | 'adjacent' | 'axisAligned' | 'insideBoard'> {
  return {
    side: measurement.side,
    adjacent: measurement.adjacent,
    axisAligned: measurement.axisAligned,
    insideBoard: measurement.insideBoard,
  }
}

/**
 * Open one window's composer model menu. A real mouse click opens the menu a
 * user clicks; the programmatic fallback exists for chips the canvas clips
 * (window C off the left edge) and for chips a pan moved above the board.
 */
async function openWindowMenu(page: Page, windowId: string, options: { programmatic?: boolean } = {}): Promise<void> {
  const selector = `[data-board-window-id="${windowId}"] [data-board-action="composer-model"]`
  if (options.programmatic !== true) {
    const chip = await page.locator(selector).boundingBox()
    if (chip === null) throw new Error(`model chip is missing: ${windowId}`)
    await page.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2)
    await page.waitForTimeout(400)
    await page.mouse.click(chip.x + chip.width / 2, chip.y + chip.height / 2)
    try {
      await page.locator('[role="menu"]').first().waitFor({ state: 'visible', timeout: 3_000 })
      return
    } catch {
      // The trusted click can miss a chip React re-renders mid-gesture; the
      // element's own click still opens the same menu at the same anchor rect.
    }
  }
  await page.evaluate((targetSelector) => {
    const chip = document.querySelector(targetSelector)
    if (chip === null) throw new Error(`model chip is missing: ${targetSelector}`)
    ;(chip as HTMLElement).click()
  }, selector)
  await page.locator('[role="menu"]').first().waitFor({ state: 'visible', timeout: 5_000 })
}

/** Close every open menu and clear the pointer hover state. */
async function closeMenus(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await page.mouse.move(NEUTRAL_POINTER.x, NEUTRAL_POINTER.y)
  await settle(page)
  await expect.poll(async () => await page.locator('[role="menu"]').count(), { timeout: 5_000 }).toBe(0)
}

/** Measure the open menu, its trigger chip, and the board box. */
function measureMenu(page: Page, windowId: string): Promise<MenuMeasurement> {
  return page.evaluate((id) => {
    const chip = document.querySelector(`[data-board-window-id="${id}"] [data-board-action="composer-model"]`)
    const menu = document.querySelector('[role="menu"]')
    const canvas = document.querySelector('[data-surface="canvas-layer"]')
    const board = document.querySelector('[data-surface="board"]')
    if (chip === null || menu === null || canvas === null || board === null) {
      throw new Error('menu measurement elements are missing')
    }
    const chipRect = chip.getBoundingClientRect()
    const menuRect = menu.getBoundingClientRect()
    const boardRect = board.getBoundingClientRect()
    const html = menu as HTMLElement
    const rect = (source: DOMRect): Rect => ({
      left: source.left, top: source.top, right: source.right, bottom: source.bottom,
      width: source.width, height: source.height,
    })
    return {
      scale: new DOMMatrixReadOnly(getComputedStyle(canvas).transform).a,
      ratio: html.offsetHeight === 0 ? 0 : menuRect.height / html.offsetHeight,
      insideBoard: menuRect.left >= boardRect.left && menuRect.right <= boardRect.right
        && menuRect.top >= boardRect.top && menuRect.bottom <= boardRect.bottom,
      chip: rect(chipRect),
      menu: rect(menuRect),
      offsetHeight: html.offsetHeight,
      board: rect(boardRect),
    }
  }, windowId)
}

/** The shortest distance between the open menu and its chip: 0 while they touch. */
function menuAttachmentDistance(page: Page, windowId: string): Promise<number> {
  return page.evaluate((id) => {
    const chip = document.querySelector(`[data-board-window-id="${id}"] [data-board-action="composer-model"]`)
    const menu = document.querySelector('[role="menu"]')
    if (chip === null || menu === null) throw new Error('menu attachment elements are missing')
    const c = chip.getBoundingClientRect()
    const m = menu.getBoundingClientRect()
    const dx = Math.max(m.left - c.right, c.left - m.right, 0)
    const dy = Math.max(m.top - c.bottom, c.top - m.bottom, 0)
    return Math.hypot(dx, dy)
  }, windowId)
}

/** The bounding rectangle of the open submenu card (the nested `[role=menu]`). */
function measureSubmenu(page: Page): Promise<Rect | null> {
  return page.evaluate(() => {
    const submenu = document.querySelector('[role="menu"][class*="_submenu"]')
    if (submenu === null) return null
    const r = submenu.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
  })
}

/** Rectangles of the board box and every floating/window layer the audit checks. */
interface SafeAreaRects {
  board: Rect | null
  dock: Rect | null
  omnibar: Rect | null
  minimap: Rect | null
  a: Rect | null
  b: Rect | null
  c: Rect | null
}

/** Measure the board box, its floating layers, and each seeded window. */
function measureSafeArea(page: Page): Promise<SafeAreaRects> {
  return page.evaluate(() => {
    const rect = (selector: string): Rect | null => {
      const element = document.querySelector(selector)
      if (element === null) return null
      const r = element.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
    }
    return {
      board: rect('[data-surface="board"]'),
      dock: rect('[data-board-layer="dock"]'),
      omnibar: rect('[data-board-layer="omnibar"]'),
      minimap: rect('[data-board-minimap]'),
      a: rect('[data-board-window-id="agent-e2e-a"]'),
      b: rect('[data-board-window-id="agent-e2e-b"]'),
      c: rect('[data-board-window-id="agent-e2e-c"]'),
    }
  })
}

/** Whether two rectangles overlap on both axes. */
function intersects(left: Rect, right: Rect): boolean {
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top
}

/** Whether the inner rectangle lies within the outer rectangle. */
function contains(outer: Rect, inner: Rect): boolean {
  return inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom
}

/** One board edge a popover anchor is parked next to. */
type BoardEdge = 'left' | 'right' | 'top' | 'bottom'

/** Selector of one window's header close button. */
function closeButtonSelector(windowId: string): string {
  return `[data-board-window-id="${windowId}"] [data-board-action="window-close"]`
}

/** Selector of one window composer's model chip. */
function modelChipSelector(windowId: string): string {
  return `[data-board-window-id="${windowId}"] [data-board-action="composer-model"]`
}

/** Screen rectangle of one element; a miss fails at the call site. */
function elementRect(page: Page, selector: string): Promise<Rect> {
  return page.evaluate((target) => {
    const element = document.querySelector(target)
    if (element === null) throw new Error(`missing element: ${target}`)
    const r = element.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
  }, selector)
}

/**
 * Where an anchor is parked for one edge: clear of the floating chrome, so a
 * hover or click reaches the anchor and not the dock, the omnibar, or the
 * minimap.
 */
function edgeAnchorTarget(board: Rect, edge: BoardEdge): { x: number; y: number } {
  switch (edge) {
    case 'left': return { x: board.left + 40, y: board.top + 60 }
    case 'right': return { x: board.right - 40, y: board.top + 60 }
    case 'top': return { x: board.left + board.width / 2, y: board.top + 40 }
    case 'bottom': return { x: board.left + 180, y: board.bottom - 40 }
  }
}

/** Pan the board until the anchor's centre sits at the target, then settle. */
async function placeAnchor(page: Page, selector: string, target: { x: number; y: number }): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const rect = await elementRect(page, selector)
    const deltaX = rect.left + rect.width / 2 - target.x
    const deltaY = rect.top + rect.height / 2 - target.y
    if (Math.abs(deltaX) < 2 && Math.abs(deltaY) < 2) return
    await dispatchWheel(page, { selector: '[data-surface="canvas"]', index: 0 }, { deltaX, deltaY })
  }
  throw new Error(`anchor did not reach the target: ${selector}`)
}

/** Write the call-free session header that mounts the scenario's provider catalog. */
function writeProviderFixture(dir: string): string {
  const path = join(dir, 'board-geometry-providers.jsonl')
  writeFileSync(path, `${JSON.stringify({
    type: 'session',
    version: SESSION_FORMAT_VERSION,
    id: 'board-geometry-providers',
    createdAt: Date.now() - 60_000,
    cwd: '/tmp',
    isSeeded: false,
    delegationDepth: 0,
  })}\n`)
  return path
}

describe('web e2e: spatial board geometry', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let fixtureDir: string
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'board-geometry-providers-'))
    scaffold = await launchWebScaffold({
      replayFixture: writeProviderFixture(fixtureDir),
      replayProvidersOnly: true,
      replayProviders: [{ id: 'deepseek-official', name: 'DeepSeek', models: PROVIDER_MODELS }],
    })
    const sessionA = await seedSession(scaffold, FIXTURE_A.log, 'board-geometry-a')
    const sessionB = await seedSession(scaffold, FIXTURE_B.log, 'board-geometry-b')
    const sessionC = await seedSession(scaffold, FIXTURE_C.log, 'board-geometry-c')
    browser = await chromium.launch()
    page = await newEnglishPage(browser, WIDE_VIEWPORT.height)
    tripwire = watchConsole(page)
    await page.setViewportSize(WIDE_VIEWPORT)
    // The first-frame cache is the board's deterministic initial layout; the
    // server document is empty on a fresh scaffold, so the cache wins.
    await page.addInitScript((payload: string) => {
      localStorage.setItem('dsh.board.layout', payload)
    }, JSON.stringify({
      revision: 0,
      layout: {
        version: 1,
        panX: 0,
        panY: 0,
        zoom: 1,
        windows: [
          { id: WINDOW_A, kind: 'agent', bodyKind: 'conversation', ordinal: 1, x: 0, y: 0, width: 552, height: 648, zIndex: 10 },
          { id: WINDOW_B, kind: 'agent', bodyKind: 'conversation', ordinal: 2, x: 700, y: 0, width: 552, height: 648, zIndex: 11 },
          // Off the left edge and taller than the 900px board: the geometry the
          // menu-clamping (П-13) and fit-on-center (П-31) problems need.
          { id: WINDOW_C, kind: 'agent', bodyKind: 'conversation', ordinal: 3, x: -700, y: 0, width: 552, height: 1000, zIndex: 12 },
        ],
        windowOrder: [WINDOW_A, WINDOW_B, WINDOW_C],
        activeWindowId: WINDOW_A,
        panelWindowId: '',
        panelCollapsed: true,
        panelWidth: 300,
        panelGroupBy: 'workspace',
        panelOrderBy: 'updated',
        defaultPreset: '',
      },
      bindings: {
        [WINDOW_A]: String(sessionA),
        [WINDOW_B]: String(sessionB),
        [WINDOW_C]: String(sessionC),
      },
    }))
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.getByRole('button', { name: 'Board' }).click()
    await page.locator('[data-surface="board"]').waitFor({ timeout: 30_000 })
    await page.locator(`[data-board-window-id="${WINDOW_C}"] [data-board-action="composer-model"]`)
      .waitFor({ timeout: 30_000 })
    await page.waitForTimeout(1_000)
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    rmSync(fixtureDir, { recursive: true, force: true })
  })

  it('opens the board with the three seeded windows bound to their sessions', async () => {
    await clickResetView(page)
    const shape = await page.evaluate(({ a, b, c }) => {
      const board = document.querySelector('[data-surface="board"]')?.getBoundingClientRect()
      const windowIds = [...document.querySelectorAll('[data-board-window-id]')]
        .map(element => element.getAttribute('data-board-window-id'))
      return {
        boardPresent: board !== undefined && board.width > 0 && board.height > 0,
        windowIds,
        hasModelChip: [a, b, c].every(id => document.querySelector(
          `[data-board-window-id="${id}"] [data-board-action="composer-model"]`) !== null),
        dockRows: document.querySelectorAll('[data-board-dock-row]').length,
      }
    }, { a: WINDOW_A, b: WINDOW_B, c: WINDOW_C })
    expect(shape.boardPresent).toBe(true)
    expect(shape.windowIds).toEqual([WINDOW_A, WINDOW_B, WINDOW_C])
    expect(shape.hasModelChip).toBe(true)
    expect(shape.dockRows).toBe(3)
  }, 60_000)

  it('control: an empty-canvas pinch already zooms the board and is prevented', async () => {
    // The correct subset of П-01 the board already implements: ctrl+wheel over
    // the bare canvas zooms the board and prevents the page zoom.
    await clickResetView(page)
    const canvas = await dispatchWheel(page, { selector: '[data-surface="canvas"]', index: 0 }, { ctrlKey: true, deltaY: -100 })
    await clickResetView(page)
    const rail = await dispatchWheel(page, await railTarget(page, WINDOW_A), { ctrlKey: true, deltaY: -100 })
    await clickResetView(page)
    const dock = await dispatchWheel(page, { selector: '[data-board-layer="dock"]', index: 0 }, { ctrlKey: true, deltaY: -100 })
    await clickResetView(page)
    expect({
      canvasPrevented: canvas.prevented,
      canvasZoomed: canvas.after.scale > canvas.before.scale,
      railPrevented: rail.prevented,
      railZoomed: rail.after.scale > rail.before.scale,
      dockPrevented: dock.prevented,
      dockZoomed: dock.after.scale > dock.before.scale,
    }).toEqual({
      canvasPrevented: true,
      canvasZoomed: true,
      railPrevented: true,
      railZoomed: true,
      dockPrevented: true,
      dockZoomed: true,
    })
  }, 60_000)

  it('П-01: a pinch over a window zooms the board instead of the page (R3 wheel whitelist)', async () => {
    await clickResetView(page)
    const overWindow = await dispatchWheel(page, frameTarget(WINDOW_A), { ctrlKey: true, deltaY: -100 })
    await clickResetView(page)
    // Ctrl+wheel anywhere inside the board belongs to the board, a window
    // frame included, so the pinch never reaches the browser's page zoom.
    expect({
      prevented: overWindow.prevented,
      boardZoomed: overWindow.after.scale > overWindow.before.scale,
    }).toEqual({ prevented: true, boardZoomed: true })
  }, 60_000)

  it('П-07: a pinch over the app sidebar is blocked app-wide (decision R-2)', async () => {
    await clickResetView(page)
    const sidebar = await dispatchWheel(page, { selector: 'nav[aria-label="Global panels"]', index: 0 }, { ctrlKey: true, deltaY: -100 })
    await clickResetView(page)
    // The shell's page-pinch guard prevents the browser's page zoom outside
    // the board while the board scale stays put.
    expect({
      prevented: sidebar.prevented,
      boardScaleUnchanged: sidebar.after.scale === sidebar.before.scale,
    }).toEqual({ prevented: true, boardScaleUnchanged: true })
  }, 60_000)

  it('П-02: a two-finger swipe pans the board and only ctrl+wheel zooms (R3 sign-only zoom)', async () => {
    await clickResetView(page)
    const canvas = await page.locator('[data-surface="canvas"]').boundingBox()
    if (canvas === null) throw new Error('board canvas is missing')
    const center = { clientX: canvas.x + canvas.width / 2, clientY: canvas.y + canvas.height / 2 }
    const swipe = await dispatchWheel(page, { selector: '[data-surface="canvas"]', index: 0 }, { deltaX: 40, clientX: center.clientX, clientY: center.clientY })
    await clickResetView(page)
    const scroll = await dispatchWheel(page, { selector: '[data-surface="canvas"]', index: 0 }, { deltaY: 2, clientX: center.clientX, clientY: center.clientY })
    await clickResetView(page)
    // A plain wheel pans: the horizontal swipe moves panX, the vertical one
    // moves panY, and neither touches the scale.
    expect({
      swipePannedX: Math.abs(swipe.after.panX - swipe.before.panX) > 1,
      swipeKeptScale: Math.abs(swipe.after.scale - swipe.before.scale) < 1e-9,
      scrollPannedY: Math.abs(scroll.after.panY - scroll.before.panY) > 0.5,
      scrollKeptScale: Math.abs(scroll.after.scale - scroll.before.scale) < 1e-9,
    }).toEqual({ swipePannedX: true, swipeKeptScale: true, scrollPannedY: true, scrollKeptScale: true })
  }, 60_000)

  it('П-03: the zoom step is proportional to the gesture (R3 fixed ±10%)', async () => {
    await clickResetView(page)
    const canvas = await page.locator('[data-surface="canvas"]').boundingBox()
    if (canvas === null) throw new Error('board canvas is missing')
    const center = { clientX: canvas.x + canvas.width / 2, clientY: canvas.y + canvas.height / 2 }
    const small = await dispatchWheel(page, { selector: '[data-surface="canvas"]', index: 0 }, { ctrlKey: true, deltaY: -2, ...center })
    await clickResetView(page)
    const large = await dispatchWheel(page, { selector: '[data-surface="canvas"]', index: 0 }, { ctrlKey: true, deltaY: -40, ...center })
    await clickResetView(page)
    const smallDelta = Math.abs(small.after.scale - small.before.scale)
    const largeDelta = Math.abs(large.after.scale - large.before.scale)
    // The factor is exp(−Δ·k): a 2px delta stays under one percent and a
    // larger gesture moves the scale further.
    expect({
      smallUnderOnePercent: smallDelta < 0.01,
      largeOverSmall: largeDelta > smallDelta,
    }).toEqual({ smallUnderOnePercent: true, largeOverSmall: true })
  }, 60_000)

  it('П-09: window tooltips sit beside their button at zoom 1 and 0.5 (R1 fixed inside the canvas)', async () => {
    await clickResetView(page)
    const zoom1 = await measureTooltip(page, `[data-board-window-id="${WINDOW_A}"] [data-board-action="window-close"]`)
    try {
      await setZoom(page, 0.5)
      const zoomHalf = await measureTooltip(page, `[data-board-window-id="${WINDOW_A}"] [data-board-action="window-close"]`)
      expect({
        zoom1: tooltipVerdict(zoom1),
        zoomHalf: tooltipVerdict(zoomHalf),
      }).toEqual({
        zoom1: { side: 'bottom', adjacent: true, axisAligned: true, insideBoard: true },
        zoomHalf: { side: 'bottom', adjacent: true, axisAligned: true, insideBoard: true },
      })
    } finally {
      await clickResetView(page)
    }
  }, 60_000)

  it('control: a tooltip outside every transformed ancestor stays adjacent', async () => {
    await clickResetView(page)
    // The sidebar toggle is outside the canvas and outside the transformed
    // dock/omnibar containers, so its tooltip is the honest control group.
    const toggle = await measureTooltip(page, 'button[aria-label="Collapse sidebar"], button[aria-label="Open sidebar"]')
    expect({ adjacent: toggle.adjacent, axisAligned: toggle.axisAligned }).toEqual({ adjacent: true, axisAligned: true })
  }, 60_000)

  it('П-09: the audit control group is not clean — dock and omnibar tooltips are displaced too', async () => {
    await clickResetView(page)
    // The audit calls the dock and omnibar tooltips correct because they are
    // outside the canvas, but each anchor container carries its own transform
    // (`translateY(-50%)` on the dock, `translateX(-50%)` on the omnibar),
    // which is a containing block for the fixed bubble exactly like the canvas.
    const dock = await measureTooltip(page, '[data-board-action="dock-reset-view"]')
    const omnibar = await measureTooltip(page, '[data-board-action="omnibar-action-menu"]')
    expect({
      dockAdjacent: dock.adjacent,
      dockAligned: dock.axisAligned,
      omnibarAdjacent: omnibar.adjacent,
      omnibarAligned: omnibar.axisAligned,
    }).toEqual({ dockAdjacent: true, dockAligned: true, omnibarAdjacent: true, omnibarAligned: true })
  }, 60_000)

  it('П-10: a window menu renders at the window scale (R2 page-scale portal)', async () => {
    await clickResetView(page)
    await openWindowMenu(page, WINDOW_A)
    const zoom1 = await measureMenu(page, WINDOW_A)
    await closeMenus(page)
    try {
      await setZoom(page, 0.5)
      await openWindowMenu(page, WINDOW_A)
      const zoomHalf = await measureMenu(page, WINDOW_A)
      await closeMenus(page)
      const scaled = (measurement: MenuMeasurement): boolean =>
        Math.abs(measurement.ratio - measurement.scale) <= 0.15 * measurement.scale
      expect({ zoom1: scaled(zoom1), zoomHalf: scaled(zoomHalf) }).toEqual({ zoom1: true, zoomHalf: true })
    } finally {
      await clickResetView(page)
    }
  }, 90_000)

  it('П-11: an open menu follows its button when the board moves (R2 place-once)', async () => {
    await clickResetView(page)
    await openWindowMenu(page, WINDOW_A)
    const before = await menuAttachmentDistance(page, WINDOW_A)
    const canvas = await page.locator('[data-surface="canvas"]').boundingBox()
    if (canvas === null) throw new Error('board canvas is missing')
    await dispatchWheel(page, { selector: '[data-surface="canvas"]', index: 0 }, {
      deltaY: -100, clientX: canvas.x + canvas.width / 2, clientY: canvas.y + canvas.height / 2,
    })
    const after = await menuAttachmentDistance(page, WINDOW_A)
    await closeMenus(page)
    await clickResetView(page)
    // The menu repositions only on scroll/resize, so a wheel gesture that moves
    // the chip leaves the menu behind (4px before, hundreds after).
    expect({ attachedBefore: before <= 8, attachedAfter: after <= 8 }).toEqual({ attachedBefore: true, attachedAfter: true })
  }, 60_000)

  it('П-13: a window menu is clamped to the board, not the browser viewport (R2)', async () => {
    await clickResetView(page)
    try {
      // Window C starts off the board's left edge. Pan until its model chip is
      // mostly outside the board while a sliver stays on it — the boundary
      // dismissal keeps a fully outside anchor from opening at all — and the
      // menu must clamp to the board box instead of landing over the sidebar.
      const board = (await measureSafeArea(page)).board
      if (board === null) throw new Error('board box is missing')
      await placeAnchor(page, modelChipSelector(WINDOW_C), { x: board.left - 8, y: board.bottom - 60 })
      await openWindowMenu(page, WINDOW_C, { programmatic: true })
      const measurement = await measureMenu(page, WINDOW_C)
      await closeMenus(page)
      expect(measurement.insideBoard, `menu left ${String(measurement.menu.left)} vs board left ${String(measurement.board.left)}`)
        .toBe(true)
    } finally {
      await clickResetView(page)
    }
  }, 60_000)

  it('П-14: a submenu flips to stay on screen at small board offsets (R2 CSS-only direction)', async () => {
    await clickResetView(page)
    // Pan the board up so window A's composer chip hangs partly past the top
    // edge — a fully outside anchor now dismisses its menu — and the effort
    // submenu, pinned "up and to the right" by CSS, would overflow the top.
    try {
      await panBy(page, 0, -570)
      await openWindowMenu(page, WINDOW_A, { programmatic: true })
      await page.getByRole('menuitem', { name: 'Reasoning effort' }).hover()
      await settle(page)
      const submenu = await measureSubmenu(page)
      const board = (await measureSafeArea(page)).board
      if (board === null) throw new Error('board box is missing')
      const inside = submenu !== null && contains(board, submenu)
      expect({ submenuPresent: submenu !== null, insideBoard: inside }).toEqual({ submenuPresent: true, insideBoard: true })
    } finally {
      await closeMenus(page)
      await clickResetView(page)
    }
  }, 60_000)

  it('П-15: a menu with submenus caps its height and scrolls (R2 scrollable guard)', async () => {
    await clickResetView(page)
    await openWindowMenu(page, WINDOW_A)
    await page.getByRole('menuitem', { name: 'Model', exact: true }).hover()
    await settle(page)
    const submenu = await measureSubmenu(page)
    const main = await measureMenu(page, WINDOW_A)
    await closeMenus(page)
    await clickResetView(page)
    // The list of 25 models renders 1008px tall; the submenu-bearing menu
    // skips the height cap because the overflow clip would crop the submenu.
    expect({
      mainMenuWithinBoard: main.menu.height <= main.board.height - 24,
      modelListWithinBoard: submenu !== null && submenu.height <= main.board.height - 24,
    }).toEqual({ mainMenuWithinBoard: true, modelListWithinBoard: true })
  }, 60_000)

  it.fails('П-16: the chats rail stays on the window left edge at every zoom (R4 side from open-panel room)', async () => {
    await clickResetView(page)
    const railLeftOfFrame = async (): Promise<boolean> => {
      const parts = await measureWindowParts(page, WINDOW_A)
      return parts.rail.right <= parts.frame.left + 1
    }
    const atZoom1 = await railLeftOfFrame()
    let atZoomHalf = false
    let atZoom2 = false
    try {
      await setZoom(page, 0.5)
      atZoomHalf = await railLeftOfFrame()
      await setZoom(page, 2)
      atZoom2 = await railLeftOfFrame()
    } finally {
      await clickResetView(page)
    }
    // `side` is derived from the free room for the *open* panel, so a window
    // near the left edge flips its collapsed rail to the right.
    expect({ atZoom1, atZoomHalf, atZoom2 }).toEqual({ atZoom1: true, atZoomHalf: true, atZoom2: true })
  }, 90_000)

  it.fails('П-17: the chats rail hugs the window header top at any height (R4 vertical centring)', async () => {
    await clickResetView(page)
    const short = await measureWindowParts(page, WINDOW_A)
    const tall = await measureWindowParts(page, WINDOW_C)
    const offset = (parts: { frame: Rect; rail: Rect }): number => parts.rail.top - parts.frame.top
    // railRect centres the strip in the frame, so stretching the window moves
    // the rail instead of keeping it pinned to the header.
    expect({
      shortHugsTop: Math.abs(offset(short)) <= 8,
      tallHugsTop: Math.abs(offset(tall)) <= 8,
      independentOfHeight: Math.abs(offset(short) - offset(tall)) <= 8,
    }).toEqual({ shortHugsTop: true, tallHugsTop: true, independentOfHeight: true })
  }, 60_000)

  it('П-18: the chats rail stays readable at minimum zoom (Р-3/П-32 simplified view)', async () => {
    await clickResetView(page)
    const railWidth = await (async (): Promise<number | null> => {
      try {
        await setZoom(page, 0.2)
        return await page.evaluate((id) => {
          const frames = [...document.querySelectorAll('[data-board-window-id]')]
          const rails = [...document.querySelectorAll('[data-board-panel-rail]')]
          // Below the detail threshold the simplified view hides rails; a
          // partial list means the cutoff is active, the readable outcome
          // П-18 asks for.
          if (rails.length !== frames.length) return null
          const index = frames.findIndex(frame => frame.getAttribute('data-board-window-id') === id)
          const rail = rails[index]
          return rail === undefined ? null : rail.getBoundingClientRect().width
        }, WINDOW_A)
      } finally {
        await clickResetView(page)
      }
    })()
    // Below the threshold the rail is gone, so nothing unreadable stays
    // clickable at 0.2 (Р-3/П-32).
    const readable = railWidth === null || railWidth >= 24
    expect({ railReadableAtMinZoom: readable }).toEqual({ railReadableAtMinZoom: true })
  }, 60_000)

  it('П-32/П-34: below the detail threshold windows show the simplified card and the grid doubles', async () => {
    await clickResetView(page)
    try {
      await setZoom(page, 0.2)
      const zoom = (await readTransform(page)).scale
      const view = await page.evaluate(() => {
        const surface = document.querySelector('[data-surface="canvas"]')
        const frames = [...document.querySelectorAll('[data-board-window-id]')]
        const cards = [...document.querySelectorAll('[data-board-action="window-simplified-card"]')]
        const header = frames[0]?.querySelector('[class*="header"]')
        return {
          frames: frames.length,
          cards: cards.length,
          headerHidden: header !== null && header !== undefined && getComputedStyle(header).visibility === 'hidden',
          gridSize: surface === null
            ? 0
            : Number.parseFloat(getComputedStyle(surface).getPropertyValue('--board-grid-size')),
          cardFont: cards[0] instanceof HTMLElement ? Number.parseFloat(cards[0].style.fontSize) : 0,
          statuses: cards.map(card => card.getAttribute('data-board-status')),
        }
      })
      expect(view.frames).toBe(3)
      expect(view.cards).toBe(3)
      expect(view.headerHidden).toBe(true)
      // The 24px step doubles below 8 screen px (П-34): the measured screen
      // step is the doubled 48 world units at the measured zoom.
      expect(zoom).toBeGreaterThanOrEqual(0.2)
      expect(zoom).toBeLessThanOrEqual(0.23)
      expect(view.gridSize).toBeCloseTo(48 * zoom, 3)
      // World-sized type for the 0.4 threshold: 12 / 0.4 = 30 world px (П-32).
      expect(view.cardFont).toBe(30)
      expect(view.statuses).toEqual(['ready', 'ready', 'ready'])

      // Clicking a card restores the detail view: the zoom rises to the
      // threshold and every card yields to its frame again.
      await page.locator('[data-board-action="window-simplified-card"]').first().click()
      await settle(page)
      const after = await readTransform(page)
      const cardsAfter = await page.locator('[data-board-action="window-simplified-card"]').count()
      expect(after.scale).toBeGreaterThanOrEqual(0.4)
      expect(cardsAfter).toBe(0)
    } finally {
      await clickResetView(page)
    }
  }, 90_000)

  it('П-26/П-27: a corner drag shrinks to the minimum layout and the window stays intact', async () => {
    await clickResetView(page)
    const handleSelector = `[data-board-window-id="${WINDOW_A}"] [data-board-handle="se"]`
    const dragCorner = async (dx: number, dy: number): Promise<void> => {
      const handle = await page.locator(handleSelector).boundingBox()
      if (handle === null) throw new Error('the south-east frame handle is missing')
      const startX = handle.x + handle.width / 2
      const startY = handle.y + handle.height / 2
      await page.mouse.move(startX, startY)
      await page.mouse.down()
      await page.mouse.move(startX + dx, startY + dy, { steps: 8 })
      await page.mouse.up()
      await settle(page)
    }
    try {
      const before = (await measureWindowParts(page, WINDOW_A)).frame
      // П-26: the corner shrinks both axes; the drag overshoots the floor, so
      // the result is the minimum layout (decision R-5).
      await dragCorner(-200, -200)
      const floor = (await measureWindowParts(page, WINDOW_A)).frame
      expect(Math.round(floor.width)).toBe(408)
      expect(Math.round(floor.height)).toBe(480)
      expect(floor.width).toBeLessThan(before.width)
      expect(floor.height).toBeLessThan(before.height)

      // П-27: the header, lane, and composer still lay out — every visible
      // button stays inside the frame, the lane does not scroll sideways, and
      // the composer's send control and the window title stay visible.
      const intact = await page.evaluate((id) => {
        const frame = document.querySelector(`[data-board-window-id="${id}"]`)
        if (frame === null) throw new Error('the frame is missing')
        const frameRect = frame.getBoundingClientRect()
        const outsideButtons = [...frame.querySelectorAll('button')].filter((button) => {
          const rect = button.getBoundingClientRect()
          return rect.width > 0 && (rect.right > frameRect.right + 1 || rect.left < frameRect.left - 1)
        }).length
        const lane = frame.querySelector('[data-board-lane]')
        const editor = frame.querySelector('textarea')
        const send = frame.querySelector('[data-board-action="composer-send"]')
        const sendRect = send?.getBoundingClientRect()
        const title = frame.querySelector('[class*="title"]')
        return {
          outsideButtons,
          laneOverflow: lane === null ? 0 : lane.scrollWidth - lane.clientWidth,
          editorWidth: editor === null ? 0 : Math.round(editor.getBoundingClientRect().width),
          sendVisible: sendRect !== undefined && sendRect.width > 0 && sendRect.right <= frameRect.right + 1,
          titleVisible: title !== null && title.getBoundingClientRect().width > 0,
        }
      }, WINDOW_A)
      expect(intact.outsideButtons).toBe(0)
      expect(intact.laneOverflow).toBeLessThanOrEqual(1)
      expect(intact.sendVisible).toBe(true)
      expect(intact.titleVisible).toBe(true)
      expect(intact.editorWidth).toBeGreaterThan(100)

      // The same handle grows the window back: the floor is a floor, not a
      // one-way latch.
      await dragCorner(144, 168)
      const restored = (await measureWindowParts(page, WINDOW_A)).frame
      expect(Math.round(restored.width)).toBe(552)
      expect(Math.round(restored.height)).toBe(648)
    } finally {
      await clickResetView(page)
    }
  }, 90_000)

  it.fails('П-28: reset view fits every window into the safe area (R5 no safe area)', async () => {
    await clickResetView(page)
    const area = await measureSafeArea(page)
    await clickResetView(page)
    const board = area.board
    const dock = area.dock
    const omnibar = area.omnibar
    const minimap = area.minimap
    if (board === null || dock === null || omnibar === null || minimap === null) {
      throw new Error('board safe-area boxes are missing')
    }
    const windows = [area.a, area.b, area.c].filter((rect): rect is Rect => rect !== null)
    expect({
      dockClear: !windows.some(rect => intersects(rect, dock)),
      omnibarClear: !windows.some(rect => intersects(rect, omnibar)),
      minimapClear: !windows.some(rect => intersects(rect, minimap)),
      windowsInsideBoard: windows.every(rect => contains(board, rect)),
    }).toEqual({ dockClear: true, omnibarClear: true, minimapClear: true, windowsInsideBoard: true })
  }, 60_000)

  it.fails('П-30: the omnibar and minimap do not overlap on a narrow board (R5 hard sizes)', async () => {
    await resizeViewport(page, NARROW_VIEWPORT)
    const narrow = await measureSafeArea(page)
    await resizeViewport(page, WIDE_VIEWPORT)
    await clickResetView(page)
    const omnibar = narrow.omnibar
    const minimap = narrow.minimap
    if (omnibar === null || minimap === null) throw new Error('narrow floating boxes are missing')
    expect({ omnibarMinimapOverlap: intersects(omnibar, minimap) }).toEqual({ omnibarMinimapOverlap: false })
  }, 60_000)

  it.fails('П-31: centring a window taller than the board fits it inside (R5 no fit-on-center)', async () => {
    await clickResetView(page)
    try {
      // Activate another window first so the tall window's dock row runs the
      // centre action instead of the reveal shortcut.
      await page.locator(`[data-board-dock-row][data-board-title="${FIXTURE_B.title}"]`).click()
      await page.locator(`[data-board-dock-row][data-board-title="${FIXTURE_C.title}"]`).click()
      await settle(page)
      const area = await measureSafeArea(page)
      const board = area.board
      const tall = area.c
      if (board === null || tall === null) throw new Error('board or tall window box is missing')
      expect({ fitsInsideBoard: contains(board, tall) }).toEqual({ fitsInsideBoard: true })
    } finally {
      await clickResetView(page)
    }
  }, 60_000)

  it('Д2.4: window popovers stay beside their button at every zoom and board edge', async () => {
    const failures: string[] = []
    try {
      for (const zoom of [0.5, 1, 2]) {
        await clickResetView(page)
        await setZoom(page, zoom)
        for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
          const board = (await measureSafeArea(page)).board
          if (board === null) throw new Error('board box is missing')
          const target = edgeAnchorTarget(board, edge)
          // The close tooltip: adjacent to the button, flipped where the edge
          // refuses the requested side, and inside the board box. Near an edge
          // the clamp may slide the bubble off the anchor's axis, so alignment
          // is asserted on the П-09 measurement, not here.
          await placeAnchor(page, closeButtonSelector(WINDOW_A), target)
          const tooltip = await measureTooltip(page, closeButtonSelector(WINDOW_A))
          if (!tooltip.adjacent || !tooltip.insideBoard) {
            failures.push(`close tooltip ${edge}@${String(zoom)}: ${JSON.stringify(tooltipVerdict(tooltip))}`)
          }
          // The model menu: attached to the chip and clamped inside the board.
          await placeAnchor(page, modelChipSelector(WINDOW_A), target)
          await openWindowMenu(page, WINDOW_A, { programmatic: true })
          const menu = await measureMenu(page, WINDOW_A)
          const attached = await menuAttachmentDistance(page, WINDOW_A)
          if (!menu.insideBoard || attached > 12) {
            failures.push(`model menu ${edge}@${String(zoom)}: inside=${String(menu.insideBoard)} attached=${attached.toFixed(1)}`)
          }
          await closeMenus(page)
        }
      }
      // The screen-space chrome is the audit's clean control group: its
      // tooltips are anchored at a fixed dock/omnibar position, so only the
      // zoom axis applies and the edges do not.
      for (const zoom of [0.5, 1, 2]) {
        await clickResetView(page)
        await setZoom(page, zoom)
        for (const [name, selector] of [
          ['dock', '[data-board-action="dock-reset-view"]'],
          ['omnibar', '[data-board-action="omnibar-action-menu"]'],
        ] as const) {
          const tooltip = await measureTooltip(page, selector)
          if (!tooltip.adjacent || !tooltip.axisAligned || !tooltip.insideBoard) {
            failures.push(`${name} tooltip @${String(zoom)}: ${JSON.stringify(tooltipVerdict(tooltip))}`)
          }
        }
      }
    } finally {
      await clickResetView(page)
    }
    expect(failures).toEqual([])
  }, 120_000)

  it('issued zero model calls and stayed clean', () => {
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  })
})
