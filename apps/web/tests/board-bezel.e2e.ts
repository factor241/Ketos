// Browser behavior of the window owner bezel (stage 27.4): the owner-colored
// edge is always on the window, the bezel slides out on hover or selection,
// reduced motion removes its transition, and selection no longer rebinds the
// elevation stroke to the theme accent.
//
// The window panels (stage 27.6) are measured on the same scenario: a closed
// panel rests under the frame on its own side and its hidden area takes no
// hits, while an open panel slides out from under the frame edge and the point
// just inside its inner strip belongs to the panel, not the bezel.
//
// The scenario seeds two sessions and a deterministic localStorage layout
// (`dsh.board.layout`) with window A selected, so the bezel's hover, selection,
// and reduced-motion computed styles are measured on the real assembled client.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const FIXTURE_A = createChatScrollFixture({ markerPrefix: 'BOARD_BEZEL_A', title: 'BOARD_BEZEL window A', turns: 1 })
const FIXTURE_B = createChatScrollFixture({ markerPrefix: 'BOARD_BEZEL_B', title: 'BOARD_BEZEL window B', turns: 1 })

/** Seeded window identities; A is the selected window. */
const WINDOW_A = 'agent-bezel-a'
const WINDOW_B = 'agent-bezel-b'

const VIEWPORT = { width: 1440, height: 900 }

/** A pointer park far from both windows: moving here clears every window hover. */
const NEUTRAL_POINTER = { x: 1435, y: 5 }

/** Wait two animation frames so React commits and the browser paints a measurement. */
function settle(page: Page): Promise<void> {
  return page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => { resolve() }))
  }))
}

/** Computed opacity of one window's bezel; a missing bezel fails loud. */
function bezelOpacity(page: Page, windowId: string): Promise<number> {
  return page.evaluate((id) => {
    const bezel = document.querySelector(`[data-board-window-id="${id}"] [data-board-bezel]`)
    if (bezel === null) throw new Error(`bezel is missing for ${id}`)
    return Number.parseFloat(getComputedStyle(bezel).opacity)
  }, windowId)
}

/** The bezel's computed transition duration for one window. */
function bezelTransitionDuration(page: Page, windowId: string): Promise<string> {
  return page.evaluate((id) => {
    const bezel = document.querySelector(`[data-board-window-id="${id}"] [data-board-bezel]`)
    if (bezel === null) throw new Error(`bezel is missing for ${id}`)
    return getComputedStyle(bezel).transitionDuration
  }, windowId)
}

/** A closed panel's computed horizontal slide and the width it must equal. */
function closedPanelShift(page: Page, windowId: string, side: 'left' | 'right'): Promise<{ shiftX: number; width: number }> {
  return page.evaluate(({ windowId: id, side: panelSide }) => {
    const panel = document.querySelector(`[data-board-panel-window="${id}"][data-board-panel-side="${panelSide}"]`)
    if (panel === null) throw new Error(`panel is missing: ${id}/${panelSide}`)
    const matrix = new DOMMatrixReadOnly(getComputedStyle(panel).transform)
    return { shiftX: matrix.e, width: panel.getBoundingClientRect().width }
  }, { windowId, side })
}

/** Whether a closed panel's hidden centre hit-tests as a window instead. */
function probeClosedPanelArea(page: Page, windowId: string, side: 'left' | 'right'): Promise<{ hitPanel: boolean; hitWindow: boolean }> {
  return page.evaluate(({ windowId: id, side: panelSide }) => {
    const panel = document.querySelector(`[data-board-panel-window="${id}"][data-board-panel-side="${panelSide}"]`)
    if (panel === null) throw new Error(`panel is missing: ${id}/${panelSide}`)
    const rect = panel.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return {
      hitPanel: (hit?.closest('[data-board-panel]') ?? null) !== null,
      hitWindow: (hit?.closest('[data-board-window-id]') ?? null) !== null,
    }
  }, { windowId, side })
}

/** An open panel's computed state, its box beside the frame, and the panel
 * captured by a point 4px inside its frame-facing edge. */
interface OpenPanelProbe {
  readonly visibility: string
  readonly identityTransform: boolean
  readonly besideFrame: boolean
  readonly innerHitSide: string | null
  readonly innerHitWindow: string | null
}

/** Probe one open panel: visibility, rest transform, box, and inner-edge hit. */
function probeOpenPanel(page: Page, windowId: string, side: 'left' | 'right'): Promise<OpenPanelProbe> {
  return page.evaluate(({ windowId: id, side: panelSide }) => {
    const panel = document.querySelector(
      `[data-board-panel-window="${id}"][data-board-panel-side="${panelSide}"][data-board-panel-open]`,
    )
    const frame = document.querySelector(`[data-board-window-id="${id}"]`)
    if (panel === null || frame === null) throw new Error(`open panel or frame is missing: ${id}/${panelSide}`)
    const panelRect = panel.getBoundingClientRect()
    const frameRect = frame.getBoundingClientRect()
    const transform = getComputedStyle(panel).transform
    const matrix = transform === 'none' ? null : new DOMMatrixReadOnly(transform)
    // Probe near the panel's top: 4px clears the frame's edge and its owner
    // ring, and top + 12 sits below the corner handles (they end at top + 10)
    // and above the edge handles (they start at top + 14), so the hit can only
    // come from the panel — or, with the open-panel bezel rule missing, from
    // the bezel's 8px side overhang.
    const innerX = panelSide === 'right' ? panelRect.left + 4 : panelRect.right - 4
    const hitPanel = document.elementFromPoint(innerX, panelRect.top + 12)?.closest('[data-board-panel]') ?? null
    return {
      visibility: getComputedStyle(panel).visibility,
      identityTransform: matrix === null
        || (Math.abs(matrix.a - 1) < 1e-6 && Math.abs(matrix.b) < 1e-6
          && Math.abs(matrix.c) < 1e-6 && Math.abs(matrix.d - 1) < 1e-6
          && Math.abs(matrix.e) < 1e-6 && Math.abs(matrix.f) < 1e-6),
      besideFrame: panelSide === 'right'
        ? panelRect.left >= frameRect.right - 1
        : panelRect.right <= frameRect.left + 1,
      innerHitSide: hitPanel?.getAttribute('data-board-panel-side') ?? null,
      innerHitWindow: hitPanel?.getAttribute('data-board-panel-window') ?? null,
    }
  }, { windowId, side })
}

describe('web e2e: window owner bezel', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    const sessionA = await seedSession(scaffold, FIXTURE_A.log, 'board-bezel-a')
    const sessionB = await seedSession(scaffold, FIXTURE_B.log, 'board-bezel-b')
    browser = await chromium.launch()
    page = await newEnglishPage(browser, VIEWPORT.height)
    tripwire = watchConsole(page)
    await page.setViewportSize(VIEWPORT)
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
        // A sits clear of the board's top-left corner: its panels (40..300 and
        // 852..1212 at zoom 1) open inside the viewport, so opening one never
        // shifts the board (Т3.5) and the measured coordinates stay stable.
        // A is last in the paint order (the restore lifts later entries), so
        // its header controls stay clickable over B, and clicking one leaves
        // the DOM order untouched.
        windows: [
          { id: WINDOW_A, kind: 'agent', bodyKind: 'conversation', ordinal: 1, x: 300, y: 120, width: 552, height: 648, zIndex: 11 },
          { id: WINDOW_B, kind: 'agent', bodyKind: 'conversation', ordinal: 2, x: 700, y: 0, width: 552, height: 648, zIndex: 10 },
        ],
        windowOrder: [WINDOW_B, WINDOW_A],
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
      },
    }))
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.locator('[data-board-action="open-board"]').click()
    await page.locator('[data-surface="board"]').waitFor({ timeout: 30_000 })
    await page.locator(`[data-board-window-id="${WINDOW_A}"] [data-board-bezel]`).waitFor({ timeout: 30_000 })
    await page.waitForTimeout(1_000)
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('shows the bezel on hover, hides it after leaving an unselected window, and keeps it on the selected one', async () => {
    // A pointer away from both windows: the selected window keeps its bezel,
    // the unselected one does not show it at rest.
    await page.mouse.move(NEUTRAL_POINTER.x, NEUTRAL_POINTER.y)
    await page.waitForTimeout(350)
    expect(await bezelOpacity(page, WINDOW_A)).toBe(1)
    expect(await bezelOpacity(page, WINDOW_B)).toBe(0)

    // Hovering the unselected window slides its bezel out.
    const box = await page.locator(`[data-board-window-id="${WINDOW_B}"]`).boundingBox()
    if (box === null) throw new Error('window B box is missing')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(350)
    expect(await bezelOpacity(page, WINDOW_B)).toBe(1)

    // Leaving it hides the bezel again; the selected window stays open.
    await page.mouse.move(NEUTRAL_POINTER.x, NEUTRAL_POINTER.y)
    await page.waitForTimeout(350)
    expect(await bezelOpacity(page, WINDOW_B)).toBe(0)
    expect(await bezelOpacity(page, WINDOW_A)).toBe(1)
  }, 60_000)

  it('keeps the owner edge on every window and the accent off its elevation stroke', async () => {
    const styles = await page.evaluate((id) => {
      const frame = document.querySelector(`[data-board-window-id="${id}"]`)
      if (frame === null) throw new Error(`window is missing: ${id}`)
      const computed = getComputedStyle(frame)
      return {
        ownerColor: frame.getAttribute('data-board-owner-color'),
        edgeColor: computed.getPropertyValue('--board-owner-edge').trim(),
        edgeWidth: getComputedStyle(frame, '::before').borderTopWidth,
        stroke: computed.getPropertyValue('--dsw-elevation-stroke-color').trim(),
        accent: computed.getPropertyValue('--dsw-alias-state-business-primary').trim(),
      }
    }, WINDOW_A)
    expect(styles.ownerColor).toBe('1')
    expect(styles.edgeColor).not.toBe('')
    expect(styles.edgeWidth).toBe('2px')
    expect(styles.stroke).not.toBe('')
    expect(styles.accent).not.toBe('')
    expect(styles.stroke).not.toBe(styles.accent)
  }, 60_000)

  it('drops the bezel transition under prefers-reduced-motion', async () => {
    const normal = await bezelTransitionDuration(page, WINDOW_A)
    expect(Number.parseFloat(normal)).toBeGreaterThan(0)

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await settle(page)
    expect(await bezelTransitionDuration(page, WINDOW_A)).toBe('0s')

    await page.emulateMedia({ reducedMotion: null })
    await settle(page)
    expect(Number.parseFloat(await bezelTransitionDuration(page, WINDOW_A))).toBeGreaterThan(0)
  }, 60_000)

  it('slides the closed panels under the window and opens each from under its frame edge', async () => {
    await page.mouse.move(NEUTRAL_POINTER.x, NEUTRAL_POINTER.y)
    await settle(page)

    // A closed panel rests under the frame: the left one a width to the right,
    // the right one a width to the left, so opening slides it out from under.
    const closedLeft = await closedPanelShift(page, WINDOW_A, 'left')
    const closedRight = await closedPanelShift(page, WINDOW_A, 'right')
    expect(closedLeft.shiftX).toBeGreaterThan(0)
    expect(Math.abs(closedLeft.shiftX - closedLeft.width)).toBeLessThanOrEqual(1)
    expect(closedRight.shiftX).toBeLessThan(0)
    expect(Math.abs(closedRight.shiftX + closedRight.width)).toBeLessThanOrEqual(1)

    // A hidden panel takes no hits: its footprint belongs to a window above.
    expect(await probeClosedPanelArea(page, WINDOW_A, 'left')).toEqual({ hitPanel: false, hitWindow: true })
    expect(await probeClosedPanelArea(page, WINDOW_A, 'right')).toEqual({ hitPanel: false, hitWindow: true })

    // The right panel slides out from under the frame's right edge; the point
    // just inside its inner strip belongs to the panel, not the bezel.
    const panelButton = (action: 'window-right-panel' | 'window-left-panel') =>
      page.locator(`[data-board-window-id="${WINDOW_A}"] [data-board-action="${action}"]`)
    await panelButton('window-right-panel').click()
    await page.waitForTimeout(500)
    await settle(page)
    expect(await probeOpenPanel(page, WINDOW_A, 'right')).toEqual({
      visibility: 'visible',
      identityTransform: true,
      besideFrame: true,
      innerHitSide: 'right',
      innerHitWindow: WINDOW_A,
    })

    // Escape closes it; the left panel opens the same way from the left edge.
    await page.keyboard.press('Escape')
    await settle(page)
    await panelButton('window-left-panel').click()
    await page.waitForTimeout(500)
    await settle(page)
    expect(await probeOpenPanel(page, WINDOW_A, 'left')).toEqual({
      visibility: 'visible',
      identityTransform: true,
      besideFrame: true,
      innerHitSide: 'left',
      innerHitWindow: WINDOW_A,
    })

    // Leave the board as the following checks expect it: both panels closed
    // and the pointer parked.
    await page.keyboard.press('Escape')
    await settle(page)
    await page.mouse.move(NEUTRAL_POINTER.x, NEUTRAL_POINTER.y)
    expect(await page.locator('[data-board-panel-open]').count()).toBe(0)
  }, 60_000)

  it('issued zero model calls and stayed clean', () => {
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  })
})
