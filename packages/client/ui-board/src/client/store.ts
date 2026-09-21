/**
 * Spatial multi-window board store.
 */
import { defineStore, type EngineStoreHandle, type EngineStoreInstance } from '@deepseek-ai/dsh-client-store'
import type { CloneId } from '@ketos/clone-core/types'
import type { CloneEdit } from './clone-draft.ts'
import {
  BOARD_ZOOM_MAX, BOARD_ZOOM_MIN, PANEL_DEFAULT_WIDTH, PANEL_MAX_WIDTH, PANEL_MIN_WIDTH,
  type BoardLayoutDocument, type BoardPanelGroupBy, type BoardPanelOrderBy,
} from '../board-settings.ts'
import type { BoardWindowState, WindowBodyKind, WindowId, WindowKind } from './contract/slots.ts'

/** Store handle handed to every board registration; one live root-scope instance backs them all. */
export type BoardStoreHandle = EngineStoreHandle<BoardState, BoardActions>

/** The board's live engine instance: the shared state and baked action face. */
export type BoardStoreInstance = EngineStoreInstance<BoardState, BoardActions>

/** A window the board opens from its own chrome: everything except the placement it computes. */
export type OpenWindowSpec = Omit<BoardWindowState, 'x' | 'y' | 'zIndex'>

/**
 * One command the board chrome pushes into a window's composer, consumed where
 * it lands: the inspector appends a captured-element chip, the Omnibox's attach
 * entry opens the composer's file picker. The queue is view state, not session
 * data — nothing here reaches the host until the user sends the draft.
 */
export interface ComposerIntent {
  /** Monotonic identity; consuming removes exactly one queued command. */
  readonly id: number
  /** The window whose composer consumes this command. */
  readonly windowId: WindowId
  /** Text appended to the composer's draft (the inspector chip). */
  readonly text?: string
  /** Whether the composer opens its file picker. */
  readonly pickFiles?: boolean
}

type BoardActions = {
  setPan: (draft: BoardState, panX: number, panY: number) => void
  setZoom: (draft: BoardState, zoom: number) => void
  zoomTowardPointer: (draft: BoardState, delta: number, pointerX: number, pointerY: number) => void
  setViewport: (draft: BoardState, width: number, height: number) => void
  addWindow: (draft: BoardState, window: BoardWindowState) => void
  openWindow: (draft: BoardState, spec: OpenWindowSpec) => void
  moveWindow: (draft: BoardState, id: WindowId, x: number, y: number, snap: boolean) => void
  resizeWindow: (draft: BoardState, id: WindowId, width: number, height: number, snap: boolean) => void
  setWindowBodyKind: (draft: BoardState, id: WindowId, bodyKind: WindowBodyKind) => void
  setCloneEdit: (draft: BoardState, windowId: WindowId, cloneId: CloneId, edit: CloneEdit | undefined) => void
  setWindowCustomTitle: (draft: BoardState, id: WindowId, title: string | undefined) => void
  focusWindow: (draft: BoardState, id: WindowId) => void
  centerOnWindow: (draft: BoardState, id: WindowId) => void
  setWindowFullscreen: (draft: BoardState, id: WindowId) => void
  exitFullscreen: (draft: BoardState) => void
  openWindowPanel: (draft: BoardState, id: WindowId, tab?: 'chats' | 'artifacts') => void
  closeWindowPanel: (draft: BoardState) => void
  setPanelTab: (draft: BoardState, tab: 'chats' | 'artifacts') => void
  setPanelCollapsed: (draft: BoardState, collapsed: boolean) => void
  setPanelWidth: (draft: BoardState, width: number) => void
  setPanelGroupBy: (draft: BoardState, groupBy: BoardPanelGroupBy) => void
  setPanelOrderBy: (draft: BoardState, orderBy: BoardPanelOrderBy) => void
  setDefaultPreset: (draft: BoardState, presetId: string) => void
  closeWindow: (draft: BoardState, id: WindowId) => void
  hydrate: (draft: BoardState, layout: BoardLayoutDocument) => void
  setSelectingElement: (draft: BoardState, selecting: boolean) => void
  pushComposerIntent: (draft: BoardState, windowId: WindowId, intent: { text?: string; pickFiles?: boolean }) => void
  consumeComposerIntent: (draft: BoardState, id: number) => void
  expectReturnWindow: (draft: BoardState, id: WindowId) => void
  clearReturnWindow: (draft: BoardState) => void
  setHighlightWindow: (draft: BoardState, id: WindowId | null) => void
}

/** Pan, zoom, window, and selection state of the board canvas. */
export interface BoardState {
  panX: number
  panY: number
  zoom: number
  /** Canvas box the minimap and window placement measure against; written by the canvas layer. */
  viewportWidth: number
  viewportHeight: number
  windows: Record<string, BoardWindowState>
  windowOrder: WindowId[]
  activeWindowId: WindowId | null
  /**
   * The window filling the board panel, or null. A fullscreen window keeps its
   * stored rectangle and its controls; the frames skip drag and resize while it
   * is fullscreen, so the rectangle survives the mode.
   */
  fullscreenWindowId: WindowId | null
  /**
   * The window whose chats panel is open, or null. One panel is open at a
   * time; it keeps the window's stored rectangle and only decorates it.
   */
  panelWindowId: WindowId | null
  /** Whether the window's chats panel is collapsed to its rail. */
  panelCollapsed: boolean
  /** Active tab in the chats panel: chats list or artifacts list. */
  panelTab: 'chats' | 'artifacts'
  /** Width the user last dragged the chats panel to. */
  panelWidth: number
  /** How the chats panel arranges its list. */
  panelGroupBy: BoardPanelGroupBy
  /** How the chats panel orders chats inside a group. */
  panelOrderBy: BoardPanelOrderBy
  /** Agent preset new windows start with, or '' when the deployment default composes them. */
  defaultPreset: string
  isSelectingElement: boolean
  /** Composer commands waiting for their window's composer to pick them up. */
  composerIntents: ComposerIntent[]
  /** Monotonic source of composer-intent identities. */
  composerIntentSeq: number
  /**
   * Window the board must bring forward when its panel next becomes visible,
   * or null. Set when the lane sends the user to the main panel for a pending
   * approval or question; the board centres and highlights the window on return.
   */
  returnWindowId: WindowId | null
  /** Window flashing the return highlight, or null. Transient view state. */
  highlightWindowId: WindowId | null
  /**
   * Unsaved editor state per clone. It lives here, not in the clone body, so
   * switching the window between its profile and interview bodies — or any
   * remount — keeps the user's text and the fields the agent rewrote. The
   * layout document does not carry it: a reload starts from the stored record.
   */
  cloneEdits: Record<string, CloneEdit>
}

/**
 * Size and body of the windows the board's own chrome opens. The chat window
 * takes 552×648: the base design's 480×560 grown with the window UI scale and
 * kept on the 24px grid. Tool windows start larger — the frame is shared, so
 * only their template size differs — and every size stays on the same grid and
 * above {@link MIN_WINDOW_SIZE}.
 */
export const BOARD_WINDOW_TEMPLATES = {
  agent: { kind: 'agent', bodyKind: 'conversation', width: 552, height: 648 },
  connectors: { kind: 'connectors', bodyKind: 'connectors', width: 648, height: 768 },
  settings: { kind: 'settings', bodyKind: 'settings', width: 648, height: 768 },
  dashboard: { kind: 'dashboard', bodyKind: 'dashboard', width: 768, height: 768 },
  clone: { kind: 'clone', bodyKind: 'clone', width: 648, height: 768 },
  tasks: { kind: 'tasks', bodyKind: 'tasks', width: 648, height: 768 },
} as const satisfies Record<string, Pick<BoardWindowState, 'kind' | 'bodyKind' | 'width' | 'height'>>

/**
 * The smallest window the board opens: the default chat size. A window never
 * shrinks below it — the composer's rows cannot lay out in less — and grows
 * freely in width, height, or proportionally.
 */
export const MIN_WINDOW_SIZE = {
  width: BOARD_WINDOW_TEMPLATES.agent.width,
  height: BOARD_WINDOW_TEMPLATES.agent.height,
} as const

/** Grid step the snap rounds to while dragging without Shift. */
const GRID_STEP = 24

/**
 * Bottom of the window z-index band. Windows paint above the canvas grid and
 * below every floating layer of the board: the chrome (dock, omnibar, minimap)
 * sits at 100, the element-selection overlay at 500, and the fullscreen frame
 * and an overlay chats panel at 1000. The band tops out below the chrome, so a
 * window can never paint over it however many windows are open.
 */
export const WINDOW_Z_BASE = 10

/** Top of the window z-index band; the chrome above it starts at 100. */
export const WINDOW_Z_MAX = 99

/**
 * Snap one position component to the board grid.
 * @param value - world coordinate.
 * @param snap - whether grid snapping is on.
 * @returns the rounded coordinate.
 */
export function snapPosition(value: number, snap: boolean): number {
  return snap ? Math.round(value / GRID_STEP) * GRID_STEP : Math.round(value)
}

/**
 * Apply grid snapping and the minimum-size floor to one requested window size.
 * The floor is applied after snapping, so a snapped value can never land below
 * the layout's minimum.
 * @param width - requested width in world units.
 * @param height - requested height in world units.
 * @param snap - whether grid snapping is on.
 * @returns the size the window takes.
 */
export function clampWindowSize(
  width: number,
  height: number,
  snap: boolean,
): { width: number; height: number } {
  const snapped = (value: number): number => snapPosition(value, snap)
  return {
    width: Math.max(MIN_WINDOW_SIZE.width, snapped(width)),
    height: Math.max(MIN_WINDOW_SIZE.height, snapped(height)),
  }
}

/**
 * The ordinal the next window takes: one past the highest ordinal in the
 * layout. Closing a window therefore never recycles a name the stack still
 * shows, and the ordinal is board-scoped rather than per-kind.
 * @param windows - the board's window map.
 * @returns the next ordinal.
 */
export function nextWindowOrdinal(windows: Record<string, BoardWindowState>): number {
  let highest = 0
  for (const window of Object.values(windows)) {
    if (window.ordinal > highest) highest = window.ordinal
  }
  return highest + 1
}

/**
 * Mint an id for one board window. The id is a board-local identity unique per
 * window; the kind is a readable prefix, not part of the identity.
 * @param kind - window category the id is prefixed with.
 * @returns the fresh window id.
 */
export function mintWindowId(kind: WindowKind): WindowId {
  const entropy = Math.random().toString(36).slice(2, 8)
  return `${kind}-${Date.now().toString(36)}-${entropy}` as WindowId
}

/** Center a new window in the current viewport (world coordinates). */
function placeWindow(draft: BoardState, width: number, height: number): { x: number; y: number } {
  return {
    x: (-draft.panX + draft.viewportWidth / 2 - width / 2) / draft.zoom,
    y: (-draft.panY + draft.viewportHeight / 2 - height / 2) / draft.zoom,
  }
}

/** The highest z-index among the windows other than `except`. */
function topWindowZ(draft: BoardState, except: WindowId): number {
  let top = WINDOW_Z_BASE - 1
  for (const [key, window] of Object.entries(draft.windows)) {
    if (key === except) continue
    top = Math.max(top, window.zIndex)
  }
  return top
}

/**
 * Rewrite every window's z-index from the current paint order. The band is
 * finite so windows never reach the floating chrome above it; past the last
 * distinct slot (more than {@link WINDOW_Z_MAX} windows) windows share the top
 * value and DOM order — window order — keeps the stack exact.
 */
function renormalizeWindowZ(draft: BoardState): void {
  draft.windowOrder.forEach((wId, idx) => {
    const window = draft.windows[wId as string]
    if (window) window.zIndex = Math.min(WINDOW_Z_BASE + idx, WINDOW_Z_MAX)
  })
}

/**
 * Insert one window on top of the stack and make it active. The stored z-index
 * is clamped into the band whatever the caller passed, so no insertion path —
 * including a restored layout — can place a window over the floating chrome.
 */
function insertWindow(draft: BoardState, window: BoardWindowState): void {
  const placed: BoardWindowState = {
    ...window,
    zIndex: Math.min(Math.max(window.zIndex, WINDOW_Z_BASE), WINDOW_Z_MAX),
  }
  draft.windows[placed.id as string] = placed
  if (!draft.windowOrder.includes(placed.id)) {
    draft.windowOrder.push(placed.id)
  }
  draft.activeWindowId = placed.id
}

/**
 * Raise one window to the top of the z-order and make it active. Only the
 * raised window's z-index moves — focusing is not a re-layout of the stack —
 * and when the band is exhausted the whole band is renormalized in the current
 * order instead of overflowing into the chrome above it.
 */
function raiseWindow(draft: BoardState, id: WindowId): void {
  const window = draft.windows[id as string]
  if (!window) return
  draft.activeWindowId = id
  draft.windowOrder = draft.windowOrder.filter(wId => wId !== id)
  draft.windowOrder.push(id)
  const top = topWindowZ(draft, id)
  if (window.zIndex > top) return
  if (top >= WINDOW_Z_MAX) {
    renormalizeWindowZ(draft)
    return
  }
  window.zIndex = top + 1
}

/**
 * Create the board canvas view store handle. Durable layout is the settings
 * namespace's document (see `board-persistence.ts`); the store itself keeps no
 * localStorage copy, so transient interaction state never outlives a reload.
 * @returns a handle instantiated once per scope by the renderer's store seat.
 */
export function createBoardStore(): BoardStoreHandle {
  return defineStore({
    init: (): BoardState => ({
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
      panelTab: 'chats',
      panelWidth: PANEL_DEFAULT_WIDTH,
      panelGroupBy: 'workspace',
      panelOrderBy: 'updated',
      defaultPreset: '',
      isSelectingElement: false,
      composerIntents: [],
      composerIntentSeq: 0,
      returnWindowId: null,
      highlightWindowId: null,
      cloneEdits: {},
    }),
    actions: {
      setPan: (draft, panX, panY) => {
        draft.panX = panX
        draft.panY = panY
      },
      setZoom: (draft, zoom) => {
        draft.zoom = Math.min(BOARD_ZOOM_MAX, Math.max(BOARD_ZOOM_MIN, zoom))
      },
      zoomTowardPointer: (draft, delta, pointerX, pointerY) => {
        const factor = delta < 0 ? 1.1 : 0.9
        const newZoom = Math.min(BOARD_ZOOM_MAX, Math.max(BOARD_ZOOM_MIN, draft.zoom * factor))
        if (newZoom === draft.zoom) return
        draft.panX = pointerX - (pointerX - draft.panX) * (newZoom / draft.zoom)
        draft.panY = pointerY - (pointerY - draft.panY) * (newZoom / draft.zoom)
        draft.zoom = newZoom
      },
      setViewport: (draft, width, height) => {
        draft.viewportWidth = width
        draft.viewportHeight = height
      },
      addWindow: (draft, window) => {
        insertWindow(draft, window)
      },
      openWindow: (draft, spec) => {
        // Every window kind opens at its template size or above: the floor is
        // the composer's minimum, applied to tool windows as well.
        const size = clampWindowSize(spec.width, spec.height, false)
        insertWindow(draft, {
          ...spec,
          ...size,
          ...placeWindow(draft, size.width, size.height),
          // Seeded at the band top and then placed above the current stack;
          // renaming the whole band keeps a crowded board exact.
          zIndex: WINDOW_Z_MAX,
        })
        const placed = draft.windows[spec.id as string]
        if (!placed) return
        const top = topWindowZ(draft, spec.id)
        if (top >= WINDOW_Z_MAX) renormalizeWindowZ(draft)
        else placed.zIndex = top + 1
      },
      moveWindow: (draft, id, x, y, snap) => {
        const win = draft.windows[id as string]
        if (!win) return
        win.x = snapPosition(x, snap)
        win.y = snapPosition(y, snap)
      },
      resizeWindow: (draft, id, width, height, snap) => {
        const win = draft.windows[id as string]
        if (!win) return
        const size = clampWindowSize(width, height, snap)
        win.width = size.width
        win.height = size.height
      },
      setWindowBodyKind: (draft, id, bodyKind) => {
        const win = draft.windows[id as string]
        if (!win) return
        win.bodyKind = bodyKind
      },
      setCloneEdit: (draft, windowId, cloneId, edit) => {
        // A closed window owns no draft: its collapse already deleted the
        // entry, and a write still in flight must not resurrect it.
        if (draft.windows[windowId as string] === undefined) return
        // Immer draft: the branded id is an opaque record key.
        if (edit === undefined) Reflect.deleteProperty(draft.cloneEdits, cloneId)
        else draft.cloneEdits[cloneId] = edit
      },
      setWindowCustomTitle: (draft, id, title) => {
        const win = draft.windows[id as string]
        if (!win) return
        const trimmed = title?.trim() ?? ''
        if (trimmed === '') delete win.customTitle
        else win.customTitle = trimmed
      },
      focusWindow: (draft, id) => {
        raiseWindow(draft, id)
      },
      centerOnWindow: (draft, id) => {
        const win = draft.windows[id as string]
        if (!win) return
        raiseWindow(draft, id)
        draft.panX = -(win.x + win.width / 2 - draft.viewportWidth / (2 * draft.zoom)) * draft.zoom
        draft.panY = -(win.y + win.height / 2 - draft.viewportHeight / (2 * draft.zoom)) * draft.zoom
      },
      setWindowFullscreen: (draft, id) => {
        if (!draft.windows[id as string]) return
        draft.fullscreenWindowId = id
        raiseWindow(draft, id)
      },
      exitFullscreen: (draft) => {
        draft.fullscreenWindowId = null
      },
      openWindowPanel: (draft, id, tab) => {
        if (!draft.windows[id as string]) return
        draft.panelWindowId = id
        draft.panelCollapsed = false
        if (tab !== undefined) draft.panelTab = tab
      },
      closeWindowPanel: (draft) => {
        draft.panelWindowId = null
        draft.panelCollapsed = true
      },
      setPanelTab: (draft, tab) => {
        draft.panelTab = tab
      },
      setPanelCollapsed: (draft, collapsed) => {
        draft.panelCollapsed = collapsed
      },
      setPanelWidth: (draft, width) => {
        draft.panelWidth = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Math.round(width)))
      },
      setPanelGroupBy: (draft, groupBy) => {
        draft.panelGroupBy = groupBy
      },
      setDefaultPreset: (draft, presetId) => {
        draft.defaultPreset = presetId
      },
      setPanelOrderBy: (draft, orderBy) => {
        draft.panelOrderBy = orderBy
      },
      closeWindow: (draft, id) => {
        // A closed clone window takes its unsaved draft with it: the window is
        // the only surface that edits the record, so nothing should keep a
        // copy of what the user abandoned.
        const closing = draft.windows[id as string]
        if (closing?.cloneId !== undefined) Reflect.deleteProperty(draft.cloneEdits, closing.cloneId)
        // Immer draft: removing the window entry on close; WindowId is
        // opaque, so the record key is only reachable dynamically.
        Reflect.deleteProperty(draft.windows, id)
        draft.windowOrder = draft.windowOrder.filter(wId => wId !== id)
        // A queued composer command for the closed window can never land: its
        // composer is gone, so the queue must not grow with orphans.
        draft.composerIntents = draft.composerIntents.filter(intent => intent.windowId !== id)
        if (draft.fullscreenWindowId === id) {
          draft.fullscreenWindowId = null
        }
        if (draft.panelWindowId === id) {
          draft.panelWindowId = null
        }
        if (draft.activeWindowId === id) {
          draft.activeWindowId = draft.windowOrder[draft.windowOrder.length - 1] ?? null
        }
      },
      hydrate: (draft, layout) => {
        // Only the stored layout fields move: transient interaction state
        // (selection, queued composer commands) and the measured viewport box
        // belong to the running session. Fullscreen is deliberately not stored,
        // so an adopted layout always leaves it.
        draft.panX = layout.panX
        draft.panY = layout.panY
        draft.zoom = layout.zoom
        draft.windows = Object.fromEntries(layout.windows.map((window) => {
          // The stored layout carries plain strings; the window state carries
          // the branded clone identity the editor resolves its record by.
          const { cloneId, ...rest } = window
          const state: BoardWindowState = {
            ...rest,
            id: window.id as WindowId,
            ...(cloneId === undefined ? {} : { cloneId: cloneId as CloneId }),
          }
          return [window.id, state]
        }))
        draft.windowOrder = layout.windowOrder as WindowId[]
        draft.activeWindowId = layout.activeWindowId === '' ? null : layout.activeWindowId as WindowId
        draft.fullscreenWindowId = null
        draft.panelWindowId = layout.panelWindowId === '' ? null : layout.panelWindowId as WindowId
        draft.panelCollapsed = layout.panelCollapsed
        draft.panelWidth = layout.panelWidth
        draft.panelGroupBy = layout.panelGroupBy
        draft.panelOrderBy = layout.panelOrderBy
        draft.defaultPreset = layout.defaultPreset
        draft.panelTab = 'chats'
      },
      setSelectingElement: (draft, selecting) => {
        draft.isSelectingElement = selecting
      },
      pushComposerIntent: (draft, windowId, intent) => {
        draft.composerIntentSeq += 1
        draft.composerIntents.push({ id: draft.composerIntentSeq, windowId, ...intent })
      },
      consumeComposerIntent: (draft, id) => {
        draft.composerIntents = draft.composerIntents.filter(intent => intent.id !== id)
      },
      expectReturnWindow: (draft, id) => {
        if (!draft.windows[id as string]) return
        draft.returnWindowId = id
      },
      clearReturnWindow: (draft) => {
        draft.returnWindowId = null
      },
      setHighlightWindow: (draft, id) => {
        draft.highlightWindowId = id === null || draft.windows[id as string] ? id : null
      },
    },
  })
}
