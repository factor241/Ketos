// Browser geometry of the spatial Board (Д0.2 of docs/ketos/board-audit-plan.md
// and Э0.2 of docs/ketos/board-redesign-plan.md).
//
// The audit's input and popover problems (П-01 … П-15, П-36), the Д3.3/Д6
// problems (П-18, П-26/П-27, П-32/П-34), and the stage-24 redesign
// requirements (Т1.1 … Т3.13) are plain assertions; the two audit problems
// carried into stage 24 (П-28, П-31) landed with Д3.2 and are plain too. The
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

/** Board panel used by the audit (1440×900). */
const WIDE_VIEWPORT = { width: 1440, height: 900 }

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
  text: string | null
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

/** Wheel target over one window frame (header and body share the frame element). */
function frameTarget(windowId: string): WheelTarget {
  return { selector: `[data-board-window-id="${windowId}"]`, index: 0 }
}

/**
 * Build the DOMRect of one window frame for geometry assertions. The rail and
 * omnibar helpers went with their assertions: the redesign removes both
 * (Т1.12/Т3.1).
 */
function measureFrame(page: Page, windowId: string): Promise<Rect> {
  return page.evaluate((id) => {
    const frame = document.querySelector(`[data-board-window-id="${id}"]`)
    if (frame === null) throw new Error(`board window is missing: ${id}`)
    const box = frame.getBoundingClientRect()
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height }
  }, windowId)
}

/** Rects of the board box and its floating chrome, or null per missing layer. */
function measureFloating(page: Page): Promise<{ board: Rect | null; dock: Rect | null; omnibar: Rect | null; minimap: Rect | null }> {
  return page.evaluate(() => {
    const box = (selector: string): Rect | null => {
      const element = document.querySelector(selector)
      if (element === null) return null
      const rect = element.getBoundingClientRect()
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
    }
    return {
      board: box('[data-surface="board"]'),
      dock: box('[data-board-layer="dock"]'),
      omnibar: box('[data-board-layer="omnibar"]'),
      minimap: box('[data-board-layer="minimap"]'),
    }
  })
}

/**
 * Return to the board through the sidebar brand switch (Т2.5); no-op when
 * already there. The board's mode badge is the way back (Т2.6).
 */
async function openBoard(page: Page): Promise<void> {
  if (await page.locator('[data-surface="board"]').count() > 0) return
  await page.locator('[data-board-action="open-board"]').click()
  await page.locator('[data-surface="board"]').waitFor({ timeout: 30_000 })
}

/** Click the dock's «show all windows» control and settle. */
async function clickResetView(page: Page): Promise<void> {
  await page.locator('[data-board-action="dock-reset-view"]').click()
  await settle(page)
}

/** The board's shipped wheel-zoom sensitivity `k` of `factor = exp(−Δ·k)`. */
const BOARD_ZOOM_K = 0.0023

/**
 * Restore the identity view (pan 0, zoom 1) through canvas gestures. The
 * dock's control now fits every window, so tests that measure absolute world
 * geometry normalize here instead of clicking it. The zoom stroke is computed
 * from the exponential factor, so it lands on exactly 1 in one gesture.
 */
async function resetToIdentityView(page: Page): Promise<void> {
  const canvas = await page.locator('[data-surface="canvas"]').boundingBox()
  if (canvas === null) throw new Error('board canvas is missing')
  const clientX = canvas.x + canvas.width * 0.75
  const clientY = canvas.y + canvas.height * 0.5
  const target = { selector: '[data-surface="canvas"]', index: 0 }
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const current = await readTransform(page)
    if (Math.abs(current.scale - 1) > 0.0005) {
      // One event's delta is clamped to ±50, so a distant zoom converges over
      // several recomputed strokes.
      const delta = Math.min(50, Math.max(-50, Math.log(current.scale) / BOARD_ZOOM_K))
      await dispatchWheel(page, target, { ctrlKey: true, deltaY: delta, clientX, clientY })
      continue
    }
    if (Math.abs(current.panX) >= 0.5 || Math.abs(current.panY) >= 0.5) {
      await dispatchWheel(page, target, { deltaX: current.panX, deltaY: current.panY, clientX, clientY })
      continue
    }
    return
  }
  const settled = await readTransform(page)
  if (Math.abs(settled.scale - 1) > 0.0005 || Math.abs(settled.panX) >= 1 || Math.abs(settled.panY) >= 1) {
    throw new Error(`identity view did not converge: zoom ${String(settled.scale)}, pan ${String(settled.panX)}, ${String(settled.panY)}`)
  }
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
      text: bubble.textContent,
      bubbleRect: { left: t.left, right: t.right, top: t.top, bottom: t.bottom, width: t.width, height: t.height },
      anchorRect: { left: a.left, right: a.right, top: a.top, bottom: a.bottom, width: a.width, height: a.height },
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
    // Clear of the top-right minimap and of the bottom dock: the right edge's
    // free stretch sits between them.
    case 'right': return { x: board.right - 40, y: board.bottom - 160 }
    case 'top': return { x: board.left + board.width / 2, y: board.top + 40 }
    case 'bottom': return { x: board.left + 180, y: board.bottom - 40 }
  }
}

/** Pan the board until the anchor's centre sits at the target, then settle. */
async function placeAnchor(page: Page, selector: string, target: { x: number; y: number }): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const rect = await elementRect(page, selector)
    const deltaX = rect.left + rect.width / 2 - target.x
    const deltaY = rect.top + rect.height / 2 - target.y
    if (Math.abs(deltaX) < 2 && Math.abs(deltaY) < 2) return
    await dispatchWheel(page, { selector: '[data-surface="canvas"]', index: 0 }, { deltaX, deltaY })
    // A paint that lags the store would be read as "no progress" on the next
    // measurement; wait until the anchor actually moved.
    await page.waitForFunction(({ anchorSelector, from }) => {
      const element = document.querySelector(anchorSelector)
      if (element === null) return false
      const current = element.getBoundingClientRect()
      return Math.abs(current.left - from.left) > 0.5 || Math.abs(current.top - from.top) > 0.5
    }, { anchorSelector: selector, from: rect }, { timeout: 2_000 }).catch(() => {})
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
  /** Seeded session identities: the startup assertion restores one as the user's selection. */
  let sessionAId: string

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
    sessionAId = String(sessionA)
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
    await page.locator('[data-board-action="open-board"]').click()
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
    await resetToIdentityView(page)
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

    // Each window's own history loaded while the shell's current session
    // stayed elsewhere: the lane carries that session's seeded marker (A5).
    const lanes = await page.evaluate(({ ids, markers }: { ids: string[]; markers: Record<string, string> }) => {
      const laneText = (id: string): string =>
        document.querySelector(`[data-board-window-id="${id}"]`)?.textContent ?? ''
      return ids.map(id => laneText(id).includes(markers[id] ?? ''))
    }, {
      ids: [WINDOW_A, WINDOW_B, WINDOW_C],
      markers: {
        [WINDOW_A]: FIXTURE_A.markers.user(1),
        [WINDOW_B]: FIXTURE_B.markers.user(1),
        [WINDOW_C]: FIXTURE_C.markers.user(1),
      },
    })
    expect(lanes).toEqual([true, true, true])
  }, 60_000)

  it('control: an empty-canvas pinch already zooms the board and is prevented', async () => {
    // The correct subset of П-01 the board already implements: ctrl+wheel over
    // the bare canvas zooms the board and prevents the page zoom.
    await resetToIdentityView(page)
    const canvas = await dispatchWheel(page, { selector: '[data-surface="canvas"]', index: 0 }, { ctrlKey: true, deltaY: -100 })
    await resetToIdentityView(page)
    const dock = await dispatchWheel(page, { selector: '[data-board-layer="dock"]', index: 0 }, { ctrlKey: true, deltaY: -100 })
    await resetToIdentityView(page)
    expect({
      canvasPrevented: canvas.prevented,
      canvasZoomed: canvas.after.scale > canvas.before.scale,
      dockPrevented: dock.prevented,
      dockZoomed: dock.after.scale > dock.before.scale,
    }).toEqual({
      canvasPrevented: true,
      canvasZoomed: true,
      dockPrevented: true,
      dockZoomed: true,
    })
  }, 60_000)

  it('П-01: a pinch over a window zooms the board instead of the page (R3 wheel whitelist)', async () => {
    await resetToIdentityView(page)
    const overWindow = await dispatchWheel(page, frameTarget(WINDOW_A), { ctrlKey: true, deltaY: -100 })
    await resetToIdentityView(page)
    // Ctrl+wheel anywhere inside the board belongs to the board, a window
    // frame included, so the pinch never reaches the browser's page zoom.
    expect({
      prevented: overWindow.prevented,
      boardZoomed: overWindow.after.scale > overWindow.before.scale,
    }).toEqual({ prevented: true, boardZoomed: true })
  }, 60_000)

  it('П-07: a pinch outside the board is blocked app-wide (decision R-2)', async () => {
    await resetToIdentityView(page)
    // The shell overlay is a sibling of the board inside the frame: the pinch
    // guard must claim it while the board keeps its scale.
    const outside = await dispatchWheel(page, { selector: '[data-shell-overlay]', index: 0 }, { ctrlKey: true, deltaY: -100 })
    await resetToIdentityView(page)
    expect({
      prevented: outside.prevented,
      boardScaleUnchanged: outside.after.scale === outside.before.scale,
    }).toEqual({ prevented: true, boardScaleUnchanged: true })
  }, 60_000)

  it('П-02: a two-finger swipe pans the board and only ctrl+wheel zooms (R3 sign-only zoom)', async () => {
    await resetToIdentityView(page)
    const canvas = await page.locator('[data-surface="canvas"]').boundingBox()
    if (canvas === null) throw new Error('board canvas is missing')
    const center = { clientX: canvas.x + canvas.width / 2, clientY: canvas.y + canvas.height / 2 }
    const swipe = await dispatchWheel(page, { selector: '[data-surface="canvas"]', index: 0 }, { deltaX: 40, clientX: center.clientX, clientY: center.clientY })
    await resetToIdentityView(page)
    const scroll = await dispatchWheel(page, { selector: '[data-surface="canvas"]', index: 0 }, { deltaY: 2, clientX: center.clientX, clientY: center.clientY })
    await resetToIdentityView(page)
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
    await resetToIdentityView(page)
    const canvas = await page.locator('[data-surface="canvas"]').boundingBox()
    if (canvas === null) throw new Error('board canvas is missing')
    const center = { clientX: canvas.x + canvas.width / 2, clientY: canvas.y + canvas.height / 2 }
    const small = await dispatchWheel(page, { selector: '[data-surface="canvas"]', index: 0 }, { ctrlKey: true, deltaY: -2, ...center })
    await resetToIdentityView(page)
    const large = await dispatchWheel(page, { selector: '[data-surface="canvas"]', index: 0 }, { ctrlKey: true, deltaY: -40, ...center })
    await resetToIdentityView(page)
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
    await resetToIdentityView(page)
    // The seeded window sits at the board's top-left corner, under the mode
    // badge: pan it clear so the measurement reaches the button itself.
    await panBy(page, 80, 80)
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
      await resetToIdentityView(page)
    }
  }, 60_000)

  it('control: a tooltip outside every transformed ancestor stays adjacent', async () => {
    // The sidebar toggle is the honest control group: it lives outside the
    // canvas and outside the transformed dock/omnibar containers — and only
    // while the board is not the active panel, since the board hides the
    // shell's sidebar (Т2.7).
    await page.reload({ waitUntil: 'load' })
    await page.locator('button[aria-label="Collapse sidebar"], button[aria-label="Open sidebar"]').first()
      .waitFor({ timeout: 30_000 })
    try {
      const toggle = await measureTooltip(page, 'button[aria-label="Collapse sidebar"], button[aria-label="Open sidebar"]')
      expect({ adjacent: toggle.adjacent, axisAligned: toggle.axisAligned }).toEqual({ adjacent: true, axisAligned: true })
    } finally {
      await openBoard(page)
      await resetToIdentityView(page)
    }
  }, 60_000)

  it('П-09: the dock tooltip is not displaced by its anchor transform', async () => {
    await resetToIdentityView(page)
    // The audit calls the dock tooltips correct because they are outside the
    // canvas, but the anchor container carries its own transform
    // (`translateX(-50%)` on the bottom strip), which is a containing block
    // for the fixed bubble exactly like the canvas; the portalled bubble must
    // still land adjacent to and aligned with its anchor.
    const dock = await measureTooltip(page, '[data-board-action="dock-reset-view"]')
    expect({ dockAdjacent: dock.adjacent, dockAligned: dock.axisAligned })
      .toEqual({ dockAdjacent: true, dockAligned: true })
  }, 60_000)

  it('П-10: a window menu renders at the window scale (R2 page-scale portal)', async () => {
    await resetToIdentityView(page)
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
      await resetToIdentityView(page)
    }
  }, 90_000)

  it('П-11: an open menu follows its button when the board moves (R2 place-once)', async () => {
    await resetToIdentityView(page)
    await openWindowMenu(page, WINDOW_A)
    const before = await menuAttachmentDistance(page, WINDOW_A)
    const canvas = await page.locator('[data-surface="canvas"]').boundingBox()
    if (canvas === null) throw new Error('board canvas is missing')
    await dispatchWheel(page, { selector: '[data-surface="canvas"]', index: 0 }, {
      deltaY: -100, clientX: canvas.x + canvas.width / 2, clientY: canvas.y + canvas.height / 2,
    })
    const after = await menuAttachmentDistance(page, WINDOW_A)
    await closeMenus(page)
    await resetToIdentityView(page)
    // The menu repositions only on scroll/resize, so a wheel gesture that moves
    // the chip leaves the menu behind (4px before, hundreds after).
    expect({ attachedBefore: before <= 8, attachedAfter: after <= 8 }).toEqual({ attachedBefore: true, attachedAfter: true })
  }, 60_000)

  it('П-13: a window menu is clamped to the board, not the browser viewport (R2)', async () => {
    await resetToIdentityView(page)
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
      await resetToIdentityView(page)
    }
  }, 60_000)

  it('П-14: a submenu flips to stay on screen at small board offsets (R2 CSS-only direction)', async () => {
    await resetToIdentityView(page)
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
      await resetToIdentityView(page)
    }
  }, 60_000)

  it('П-15: a menu with submenus caps its height and scrolls (R2 scrollable guard)', async () => {
    await resetToIdentityView(page)
    await openWindowMenu(page, WINDOW_A)
    await page.getByRole('menuitem', { name: 'Model', exact: true }).hover()
    await settle(page)
    const submenu = await measureSubmenu(page)
    const main = await measureMenu(page, WINDOW_A)
    await closeMenus(page)
    await resetToIdentityView(page)
    // The list of 25 models renders 1008px tall; the submenu-bearing menu
    // skips the height cap because the overflow clip would crop the submenu.
    expect({
      mainMenuWithinBoard: main.menu.height <= main.board.height - 24,
      modelListWithinBoard: submenu !== null && submenu.height <= main.board.height - 24,
    }).toEqual({ mainMenuWithinBoard: true, modelListWithinBoard: true })
  }, 60_000)

  it('П-32/П-34: below the detail threshold windows show the simplified card and the grid doubles', async () => {
    await resetToIdentityView(page)
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
      await resetToIdentityView(page)
    }
  }, 90_000)

  it('П-26/П-27: a corner drag shrinks to the minimum layout and the window stays intact', async () => {
    await resetToIdentityView(page)
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
      const before = await measureFrame(page, WINDOW_A)
      // П-26: the corner shrinks both axes; the drag overshoots the floor, so
      // the result is the minimum layout (decision R-5).
      await dragCorner(-200, -200)
      const floor = await measureFrame(page, WINDOW_A)
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
        // The owner bezel is an overlay strip that deliberately extends past
        // the frame box; this check covers the frame's own chrome (header and
        // composer controls).
        const outsideButtons = [...frame.querySelectorAll('button')].filter((button) => {
          if (button.closest('[data-board-bezel]') !== null) return false
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
      const restored = await measureFrame(page, WINDOW_A)
      expect(Math.round(restored.width)).toBe(552)
      expect(Math.round(restored.height)).toBe(648)
    } finally {
      await resetToIdentityView(page)
    }
  }, 90_000)

  it('Т1.1/Т1.2: the dock sits at the board bottom centre and keeps its screen size at every zoom', async () => {
    await resetToIdentityView(page)
    const boxAt = (measured: Awaited<ReturnType<typeof measureFloating>>): Rect => {
      if (measured.board === null || measured.dock === null) throw new Error('board or dock box is missing')
      return measured.dock
    }
    const atZoom1 = await measureFloating(page)
    const dock1 = boxAt(atZoom1)
    const board = atZoom1.board
    if (board === null) throw new Error('board box is missing')
    const frameAtZoom1 = await measureFrame(page, WINDOW_A)
    let dockHalf: Rect | null = null
    let dock2: Rect | null = null
    let frameAtZoom2: Rect | null = null
    try {
      await setZoom(page, 0.5)
      dockHalf = boxAt(await measureFloating(page))
      await setZoom(page, 2)
      dock2 = boxAt(await measureFloating(page))
      frameAtZoom2 = await measureFrame(page, WINDOW_A)
    } finally {
      await resetToIdentityView(page)
    }
    if (dockHalf === null || dock2 === null || frameAtZoom2 === null) throw new Error('dock or frame box is missing at zoom 0.5 or 2')
    expect({
      // Bottom centre: the dock's centre line matches the board's, and its
      // bottom edge keeps the planned 16px inset.
      centredX: Math.abs((dock1.left + dock1.right) / 2 - (board.left + board.right) / 2) <= 2,
      bottomInset: Math.abs(board.bottom - dock1.bottom - 16) <= 4,
      horizontal: dock1.width > dock1.height,
      // Screen size: the dock keeps its box across 0.5×, 1×, and 2× zoom
      // while a window frame scales with the canvas.
      screenSized: [dockHalf, dock2].every(box =>
        Math.abs(box.width - dock1.width) <= 4 && Math.abs(box.height - dock1.height) <= 4),
      framesScale: Math.abs(frameAtZoom2.width / frameAtZoom1.width - 2) <= 0.1,
    }).toEqual({ centredX: true, bottomInset: true, horizontal: true, screenSized: true, framesScale: true })
  }, 90_000)

  it('Т1.3: the dock orders windows, controls, and clones left to right', async () => {
    await resetToIdentityView(page)
    const order = await page.evaluate(() => {
      const dock = document.querySelector('[data-board-layer="dock"]')
      if (dock === null) return []
      return [...dock.querySelectorAll('[data-board-action]')].map((element) => {
        const action = element.getAttribute('data-board-action') ?? ''
        return action === 'dock-row' ? 'row' : action
      })
    })
    // The open windows, then the add menu, the element picker, the brush and
    // eraser controls with the thickness menu, and the view reset; clone rows
    // follow the second divider (Т1.9).
    expect(order).toEqual([
      'row', 'row', 'row',
      'dock-add', 'dock-select-element', 'dock-brush', 'dock-eraser', 'dock-brush-width', 'dock-reset-view',
    ])
  }, 60_000)

  it('Т1.12/Т1.13: the omnibar is gone and the minimap sits at the board top right', async () => {
    await resetToIdentityView(page)
    const chrome = await measureFloating(page)
    if (chrome.board === null || chrome.minimap === null) throw new Error('board or minimap box is missing')
    expect({
      omnibarGone: chrome.omnibar === null,
      topRight: Math.abs(chrome.board.right - chrome.minimap.right - 16) <= 4
        && Math.abs(chrome.minimap.top - chrome.board.top - 16) <= 4,
    }).toEqual({ omnibarGone: true, topRight: true })
  }, 60_000)

  it('Т1.14: the dock stays visible while a window panel is open', async () => {
    await resetToIdentityView(page)
    const before = await measureFloating(page)
    if (before.dock === null) throw new Error('dock box is missing')
    const dock1 = before.dock
    try {
      // The window's own header carries the panel control now (Т3.2).
      await page.locator(`[data-board-window-id="${WINDOW_A}"] [data-board-action="window-left-panel"]`)
        .click({ timeout: 2_000 })
      await settle(page)
      const open = await measureFloating(page)
      expect({
        dockPresent: open.dock !== null,
        dockKeepsPlace: open.dock !== null
          && Math.abs(open.dock.left - dock1.left) <= 2
          && Math.abs(open.dock.bottom - dock1.bottom) <= 2,
      }).toEqual({ dockPresent: true, dockKeepsPlace: true })
    } finally {
      await page.keyboard.press('Escape')
      await settle(page)
    }
  }, 60_000)

  it('Т3.1/Т3.2: a chat window has no rail and its header carries both panel buttons', async () => {
    await resetToIdentityView(page)
    const header = await page.evaluate((id) => {
      const frame = document.querySelector(`[data-board-window-id="${id}"]`)
      if (frame === null) throw new Error('frame is missing')
      const header = frame.querySelector('[class*="header"]')
      return {
        railCount: document.querySelectorAll('[data-board-panel-rail]').length,
        left: header?.querySelector('[data-board-action="window-left-panel"]') !== null,
        right: header?.querySelector('[data-board-action="window-right-panel"]') !== null,
      }
    }, WINDOW_A)
    expect(header).toEqual({ railCount: 0, left: true, right: true })
  }, 60_000)

  it('Т3.5: panels slide out from under the window edges, not over the window', async () => {
    await resetToIdentityView(page)
    const panelButton = page.locator(`[data-board-window-id="${WINDOW_A}"] [data-board-action="window-left-panel"]`)
    try {
      // A panel another test left open would make this click a close.
      if (await panelButton.getAttribute('aria-pressed') === 'true') {
        await panelButton.click({ timeout: 2_000 })
        await settle(page)
      }
      // The seeded window is pinned at the board's top-left corner, where the
      // mode badge sits over its header: press the control directly.
      await panelButton.evaluate((button: HTMLElement) => { button.click() })
      // Let the slide-out animation finish before measuring the panel.
      await page.waitForTimeout(500)
      await settle(page)
      // Opening a panel that did not fit shifts the board (Т3.5), so the frame
      // is measured after the click.
      const frame = await measureFrame(page, WINDOW_A)
      const left = await page.evaluate(() => {
        // Every window renders both panels; only the opened one is visible.
        const panel = document.querySelector('[data-board-panel][data-board-panel-side="left"][data-board-panel-open]')
        if (panel === null) return null
        const rect = panel.getBoundingClientRect()
        return { right: rect.right, height: rect.height }
      })
      expect(left).not.toBeNull()
      expect({
        outside: left !== null && left.right <= frame.left + 1,
        fullHeight: left !== null && Math.abs(left.height - frame.height) <= 2,
      }).toEqual({ outside: true, fullHeight: true })
    } finally {
      await page.keyboard.press('Escape')
      await settle(page)
    }
  }, 60_000)

  /** One window header's panel control, addressed by its stable action id. */
  function panelButton(windowId: string, action: 'window-left-panel' | 'window-right-panel') {
    return page.locator(`[data-board-window-id="${windowId}"] [data-board-action="${action}"]`)
  }

  /** Ensure one window panel is open through its header control. */
  async function openPanel(windowId: string, action: 'window-left-panel' | 'window-right-panel'): Promise<void> {
    const button = panelButton(windowId, action)
    if (await button.getAttribute('aria-pressed') === 'true') return
    await button.evaluate((element: HTMLElement) => { element.click() })
  }

  /** The open panel's screen rectangle for one window and side, or null. */
  function measurePanel(page: Page, windowId: string, side: 'left' | 'right'): Promise<Rect | null> {
    return page.evaluate(({ id, side: panelSide }) => {
      const element = document.querySelector(
        `[data-board-panel-window="${id}"][data-board-panel-side="${panelSide}"][data-board-panel-open]`,
      )
      if (element === null) return null
      const r = element.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
    }, { id: windowId, side })
  }

  it('Т3.3: the session row spans the list and its age keeps the right edge', async () => {
    await resetToIdentityView(page)
    try {
      await openPanel(WINDOW_A, 'window-left-panel')
      await page.waitForTimeout(500)
      await settle(page)
      const layout = await page.evaluate(() => {
        const panel = document.querySelector('[data-board-panel-side="left"]')
        const list = panel?.querySelector('[data-board-panel-list]')
        const group = panel?.querySelector('[data-board-group-toggle]')
        const session = panel?.querySelector('[data-row-key^="chat:"]')
        const meta = session?.querySelector('[class*="rowMeta"]')
        if (list === null || list === undefined || group === null || group === undefined
          || session === null || session === undefined || meta === null || meta === undefined) return null
        const listRect = list.getBoundingClientRect()
        return {
          groupWidth: group.getBoundingClientRect().width,
          sessionWidth: session.getBoundingClientRect().width,
          ageRightGap: listRect.right - meta.getBoundingClientRect().right,
        }
      })
      expect(layout).not.toBeNull()
      // The session row spans the list exactly like the folder row, and at
      // rest (the trailing action stands down) its age keeps the list's right
      // edge; the action overlays the age on hover.
      expect(Math.abs((layout?.sessionWidth ?? 0) - (layout?.groupWidth ?? 0))).toBeLessThanOrEqual(1)
      expect(layout?.ageRightGap ?? Number.POSITIVE_INFINITY).toBeGreaterThanOrEqual(0)
      expect(layout?.ageRightGap ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(12.5)
    } finally {
      await page.keyboard.press('Escape')
      await resetToIdentityView(page)
    }
  }, 60_000)

  it('Т3.12: both panels of one window open at once, each beside its own edge', async () => {
    await resetToIdentityView(page)
    try {
      await openPanel(WINDOW_A, 'window-left-panel')
      await openPanel(WINDOW_A, 'window-right-panel')
      await page.waitForTimeout(500)
      await settle(page)
      // Opening a panel that did not fit shifts the board (Т3.5), so the frame
      // is measured after both are open.
      const frame = await measureFrame(page, WINDOW_A)
      const left = await measurePanel(page, WINDOW_A, 'left')
      const right = await measurePanel(page, WINDOW_A, 'right')
      expect(left).not.toBeNull()
      expect(right).not.toBeNull()
      expect({
        leftOutside: left !== null && left.right <= frame.left + 1,
        rightOutside: right !== null && right.left >= frame.right - 1,
        fullHeight: left !== null && right !== null
          && Math.abs(left.height - frame.height) <= 2 && Math.abs(right.height - frame.height) <= 2,
      }).toEqual({ leftOutside: true, rightOutside: true, fullHeight: true })
    } finally {
      await page.keyboard.press('Escape')
      await settle(page)
    }
  }, 60_000)

  it('Т3.12: a raised window paints its panel over another window\'s panel', async () => {
    await resetToIdentityView(page)
    try {
      // Window A's right panel spans [552, 912] in world x, window B's left
      // panel [440, 700]: the two overlap while both windows share y = 0.
      await openPanel(WINDOW_A, 'window-right-panel')
      await openPanel(WINDOW_B, 'window-left-panel')
      await page.waitForTimeout(500)
      await settle(page)
      // Raising A by pressing its body must put A's panel above B's in the
      // overlap; the topmost element there names the panel's window.
      const frame = await measureFrame(page, WINDOW_A)
      await page.mouse.click(frame.left + frame.width / 2, frame.top + frame.height / 2)
      await settle(page)
      const overlap = await page.evaluate(({ a, b }) => {
        const rectOf = (selector: string): { left: number; right: number; top: number; bottom: number } | null => {
          const element = document.querySelector(selector)
          if (element === null) return null
          const r = element.getBoundingClientRect()
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
        }
        const panelA = rectOf(`[data-board-panel-window="${a}"][data-board-panel-side="right"][data-board-panel-open]`)
        const panelB = rectOf(`[data-board-panel-window="${b}"][data-board-panel-side="left"][data-board-panel-open]`)
        if (panelA === null || panelB === null) return null
        const width = Math.min(panelA.right, panelB.right) - Math.max(panelA.left, panelB.left)
        const x = (Math.max(panelA.left, panelB.left) + Math.min(panelA.right, panelB.right)) / 2
        const y = (Math.max(panelA.top, panelB.top) + Math.min(panelA.bottom, panelB.bottom)) / 2
        const hit = document.elementFromPoint(x, y)?.closest('[data-board-panel-window]')
          ?.getAttribute('data-board-panel-window') ?? null
        return { width, hit }
      }, { a: WINDOW_A, b: WINDOW_B })
      expect(overlap).not.toBeNull()
      expect(overlap?.width ?? 0).toBeGreaterThan(20)
      expect(overlap?.hit).toBe(WINDOW_A)
    } finally {
      await page.keyboard.press('Escape')
      await settle(page)
    }
  }, 60_000)

  it('Т3.4: a window panel scales with the canvas at zoom 0.5, 1, and 2', async () => {
    await resetToIdentityView(page)
    try {
      await openPanel(WINDOW_A, 'window-left-panel')
      await page.waitForTimeout(500)
      await settle(page)
      const at1 = await measurePanel(page, WINDOW_A, 'left')
      await setZoom(page, 2)
      const at2 = await measurePanel(page, WINDOW_A, 'left')
      await setZoom(page, 0.5)
      const atHalf = await measurePanel(page, WINDOW_A, 'left')
      if (at1 === null || at2 === null || atHalf === null) throw new Error('panel box is missing at one of the zooms')
      expect(Math.abs(at2.width / at1.width - 2)).toBeLessThanOrEqual(0.1)
      expect(Math.abs(atHalf.width / at1.width - 0.5)).toBeLessThanOrEqual(0.06)
    } finally {
      await page.keyboard.press('Escape')
      await resetToIdentityView(page)
    }
  }, 90_000)

  it('Т2.1: expanding a window hands its session to the standard interface', async () => {
    await resetToIdentityView(page)
    try {
      await page.locator(`[data-board-window-id="${WINDOW_A}"] [data-board-action="window-fullscreen"]`)
        .click({ timeout: 2_000 })
      await page.waitForTimeout(300)
      const standard = await page.evaluate(() => ({
        board: document.querySelector('[data-surface="board"]') !== null,
        fullscreen: document.querySelector('[data-board-fullscreen]') !== null,
      }))
      expect({
        board: standard.board,
        fullscreen: standard.fullscreen,
        showsSession: await page.getByText(FIXTURE_A.title).count() > 0,
      }).toEqual({ board: false, fullscreen: false, showsSession: true })
    } finally {
      await openBoard(page)
      await resetToIdentityView(page)
    }
  }, 90_000)

  it('Т2.9/А5: startup keeps the standard interface and the user\'s last session', async () => {
    // The user's last selection: session A, the persisted cell the app
    // restores at boot. The board layout restore must not move it.
    await page.evaluate((sessionId: string) => {
      localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId }))
    }, sessionAId)
    await page.reload({ waitUntil: 'load' })
    try {
      // Boot wipes the persisted cell while the list loads and restores it once
      // the list is ready; the settled read is what the user sees.
      await page.getByText(FIXTURE_A.title).first().waitFor({ timeout: 15_000 })
      await page.waitForTimeout(300)
      const state = await page.evaluate(() => {
        const raw = localStorage.getItem('dsh.sessions.current')
        let current: string | null = null
        try {
          current = (JSON.parse(raw ?? '{}') as { sessionId?: string }).sessionId ?? null
        } catch {
          current = null
        }
        return {
          boardMounted: document.querySelector('[data-surface="board"]') !== null,
          current,
        }
      })
      expect(state).toEqual({ boardMounted: false, current: sessionAId })

      // The panel list carries no board entry any more (Т2.8), and the switch
      // is the sidebar brand action (Т2.5).
      expect(await page.getByRole('button', { name: 'Board', exact: true }).count()).toBe(0)
      // The board's badge holds the same screen position as the sidebar logo,
      // so the switch does not move when the interfaces trade places (Т2.6).
      const brandMark = await page.locator('[data-slot="sidebar.brand.mark"] > *').first().boundingBox()
      await openBoard(page)
      await page.waitForFunction(() => {
        const frame = document.querySelector('[class*="frame"]')
        return frame !== null && getComputedStyle(frame).gridTemplateColumns.startsWith('0px')
      }, { timeout: 5_000 })
      const badgeMark = await page.locator('[data-board-layer="badge"] > *').first().boundingBox()
      if (brandMark === null || badgeMark === null) throw new Error('brand or badge mark is missing')
      expect(Math.abs(badgeMark.x - brandMark.x)).toBeLessThanOrEqual(2)
      expect(Math.abs(badgeMark.y - brandMark.y)).toBeLessThanOrEqual(2)
      // The board's badge is the same switch position (Т2.6): it returns to
      // the standard interface, and the brand action comes back.
      await page.locator('[data-board-action="open-standard"]').click()
      await page.locator('[data-surface="board"]').waitFor({ state: 'detached', timeout: 30_000 })
      expect(await page.locator('[data-board-action="open-board"]').count()).toBe(1)
    } finally {
      await openBoard(page)
      await resetToIdentityView(page)
    }
  }, 120_000)

  it('П-28/Д3.2: show all windows fits every window, panels included, into the safe area', async () => {
    await resetToIdentityView(page)
    try {
      // One window opens its left panel: the overview must fit the panel too.
      await openPanel(WINDOW_A, 'window-left-panel')
      await page.waitForTimeout(500)
      // The dock's own control runs the overview.
      await clickResetView(page)
      await settle(page)
      const area = await measureSafeArea(page)
      const board = area.board
      const dock = area.dock
      const minimap = area.minimap
      if (board === null || dock === null) {
        throw new Error('board or dock box is missing')
      }
      const windows = [area.a, area.b, area.c].filter((rect): rect is Rect => rect !== null)
      const panel = await measurePanel(page, WINDOW_A, 'left')
      expect({
        dockClear: !windows.some(rect => intersects(rect, dock)),
        // The minimap stands down while a window panel is open; nothing to
        // clear when it is not rendered.
        minimapClear: minimap === null || !windows.some(rect => intersects(rect, minimap)),
        windowsInsideBoard: windows.every(rect => contains(board, rect)),
        panelInsideBoard: panel !== null && contains(board, panel),
        panelClearOfDock: panel !== null && !intersects(panel, dock),
      }).toEqual({
        dockClear: true,
        minimapClear: true,
        windowsInsideBoard: true,
        panelInsideBoard: true,
        panelClearOfDock: true,
      })
    } finally {
      await page.keyboard.press('Escape')
      await resetToIdentityView(page)
    }
  }, 60_000)

  it('П-31/Д3.2: centring a window taller than the board fits it by reducing the zoom', async () => {
    await resetToIdentityView(page)
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
      const zoom = (await readTransform(page)).scale
      expect({
        fitsInsideBoard: contains(board, tall),
        zoomReduced: zoom < 1,
        zoomAboveDetail: zoom >= 0.4,
      }).toEqual({ fitsInsideBoard: true, zoomReduced: true, zoomAboveDetail: true })
    } finally {
      await resetToIdentityView(page)
    }
  }, 60_000)

  it('Т2.5/Т2.6: the switch works from the collapsed rail and at a narrow window (S1)', async () => {
    // Standard interface with the sidebar collapsed by hand.
    await page.reload({ waitUntil: 'load' })
    await page.locator('button[aria-label="Collapse sidebar"]').waitFor({ timeout: 30_000 })
    await page.locator('button[aria-label="Collapse sidebar"]').click()
    try {
      // The rail keeps the switch as the icon under the logo.
      await page.locator('[data-board-action="open-board"]').waitFor({ timeout: 10_000 })
      const railLogo = await page.locator('[data-slot="sidebar.brand.mark"] > *').first().boundingBox()
      await page.locator('[data-board-action="open-board"]').click()
      await page.locator('[data-surface="board"]').waitFor({ timeout: 30_000 })
      await page.waitForFunction(() => {
        const frame = document.querySelector('[class*="frame"]')
        return frame !== null && getComputedStyle(frame).gridTemplateColumns.startsWith('0px')
      }, { timeout: 5_000 })
      const badgeMark = await page.locator('[data-board-layer="badge"] > *').first().boundingBox()
      if (railLogo === null || badgeMark === null) throw new Error('rail logo or badge mark is missing')
      // The badge holds the sidebar logo's position from the rail state too.
      expect(Math.abs(badgeMark.x - railLogo.x)).toBeLessThanOrEqual(2)
      expect(Math.abs(badgeMark.y - railLogo.y)).toBeLessThanOrEqual(2)

      // The badge returns to the standard interface with the rail intact.
      await page.locator('[data-board-action="open-standard"]').click()
      await page.locator('[data-surface="board"]').waitFor({ state: 'detached', timeout: 30_000 })
      expect(await page.locator('[data-board-action="open-board"]').count()).toBe(1)

      // A narrow window auto-collapses the sidebar; the switch stays reachable.
      await page.setViewportSize({ width: 900, height: 800 })
      await page.waitForTimeout(400)
      await page.locator('[data-board-action="open-board"]').click()
      await page.locator('[data-surface="board"]').waitFor({ timeout: 30_000 })
      await page.locator('[data-board-action="open-standard"]').click()
      await page.locator('[data-surface="board"]').waitFor({ state: 'detached', timeout: 30_000 })
      expect(await page.locator('[data-board-action="open-board"]').count()).toBe(1)
    } finally {
      await page.setViewportSize(WIDE_VIEWPORT)
      await page.waitForTimeout(300)
      // Re-expand the sidebar for whatever runs next.
      const openToggle = page.locator('button[aria-label="Open sidebar"]')
      if (await openToggle.count() > 0) {
        await openToggle.click()
        await page.waitForTimeout(400)
      }
      await openBoard(page)
      await resetToIdentityView(page)
    }
  }, 120_000)

  it('Д2.4: window popovers stay beside their button at every zoom and board edge', async () => {
    const failures: string[] = []
    try {
      for (const zoom of [0.5, 1, 2]) {
        await resetToIdentityView(page)
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
      // tooltips are anchored at a fixed dock position, so only the zoom axis
      // applies and the edges do not.
      for (const zoom of [0.5, 1, 2]) {
        await resetToIdentityView(page)
        await setZoom(page, zoom)
        for (const [name, selector] of [
          ['dock', '[data-board-action="dock-reset-view"]'],
          ['dock-add', '[data-board-action="dock-add"]'],
        ] as const) {
          const tooltip = await measureTooltip(page, selector)
          if (!tooltip.adjacent || !tooltip.axisAligned || !tooltip.insideBoard) {
            failures.push(`${name} tooltip @${String(zoom)}: ${JSON.stringify(tooltipVerdict(tooltip))}`)
          }
        }
      }
    } finally {
      await resetToIdentityView(page)
    }
    expect(failures).toEqual([])
  }, 120_000)

  it('Т1.6/Т1.13: the dock and the minimap stay clear of each other at every board width', async () => {
    const failures: string[] = []
    try {
      for (const width of [600, 820, 1160, 1640]) {
        await page.setViewportSize({ width, height: WIDE_VIEWPORT.height })
        await settle(page)
        await resetToIdentityView(page)
        const chrome = await measureFloating(page)
        if (chrome.board === null || chrome.dock === null || chrome.minimap === null) {
          failures.push(`${String(width)}: chrome box is missing`)
          continue
        }
        // The strip keeps the 16px bottom inset and never grows past the
        // board's width minus the 24px inset on each side (Т1.6).
        if (Math.abs(chrome.board.bottom - chrome.dock.bottom - 16) > 4) {
          failures.push(`${String(width)}: dock bottom inset is off`)
        }
        if (chrome.dock.width > width - 48 + 1) {
          failures.push(`${String(width)}: dock is wider than the board minus its inset`)
        }
        // The top-right minimap keeps its own corner (Т1.13).
        if (intersects(chrome.dock, chrome.minimap)) {
          failures.push(`${String(width)}: dock and minimap intersect`)
        }
      }
    } finally {
      await page.setViewportSize(WIDE_VIEWPORT)
      await settle(page)
      await resetToIdentityView(page)
    }
    expect(failures).toEqual([])
  }, 120_000)

  it('Т1.6: the dock scrolls sideways once its icons outgrow the board', async () => {
    await resetToIdentityView(page)
    // Fill the strip through the catalog itself: the dock's own add menu opens
    // agent windows until twenty icons outgrow the board.
    while (await page.evaluate(() => document.querySelectorAll('[data-board-dock-row]').length) < 20) {
      await page.locator('[data-board-action="dock-add"]').click()
      await page.locator('[role="menuitem"]', { hasText: 'Agent window' }).first().click()
      await settle(page)
    }
    try {
      // The 20-icon strip outgrows the narrower board: the dock caps at the
      // board width minus the 48px inset and scrolls.
      await page.setViewportSize({ width: 820, height: WIDE_VIEWPORT.height })
      await settle(page)
      const before = await page.evaluate(() => {
        const dock = document.querySelector<HTMLElement>('[data-board-layer="dock"]')
        if (dock === null) return null
        return { scrollLeft: dock.scrollLeft, overflow: dock.scrollWidth > dock.clientWidth }
      })
      if (before === null) throw new Error('dock box is missing')
      expect(before.overflow).toBe(true)

      // A wheel over the strip scrolls it sideways instead of panning the board.
      const box = await page.locator('[data-board-layer="dock"]').boundingBox()
      if (box === null) throw new Error('dock box is missing')
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.wheel(0, 240)
      await settle(page)
      const scrolled = await page.evaluate(() =>
        document.querySelector<HTMLElement>('[data-board-layer="dock"]')?.scrollLeft ?? 0)
      expect(scrolled).toBeGreaterThan(before.scrollLeft)
    } finally {
      await page.setViewportSize(WIDE_VIEWPORT)
      await settle(page)
    }
  }, 180_000)

  it('issued zero model calls and stayed clean', () => {
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  })
})
