/**
 * Spatial multi-window board store.
 */
import { defineStore, type EngineStoreHandle, type EngineStoreInstance } from '@deepseek-ai/dsh-client-store'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { WorkspaceDirectoryEntry } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CloneId } from '@ketos/clone-core/types'
import type { CloneEdit } from './clone-draft.ts'
import {
  BOARD_ZOOM_MAX, BOARD_ZOOM_MIN, PANEL_LEFT_DEFAULT_WIDTH, PANEL_LEFT_MAX_WIDTH,
  PANEL_LEFT_MIN_WIDTH, PANEL_RIGHT_DEFAULT_WIDTH, PANEL_RIGHT_MAX_WIDTH,
  PANEL_RIGHT_MIN_WIDTH,
  type BoardLayoutDocument, type BoardPanelGroupBy, type BoardPanelOrderBy,
} from '../board-settings.ts'
import type {
  BoardDraftFile, BoardDraftImage, BoardWindowState, WindowAccess, WindowBodyKind, WindowId, WindowKind,
} from './contract/slots.ts'
import {
  canManageWindow, currentOwnerId, isOwnerIdFormat, sanitizeWindowAccess, type OwnerId,
} from './owners.ts'
import { isWindowOnScreen } from './window-screen.ts'
import { safeArea, type ChromeEdge, type ChromeInsetContribution } from './chrome-insets.ts'
import { windowPanelWidth } from './panel-geometry.ts'

/** Store handle handed to every board registration; one live root-scope instance backs them all. */
export type BoardStoreHandle = EngineStoreHandle<BoardState, BoardActions>

/** The board's live engine instance: the shared state and baked action face. */
export type BoardStoreInstance = EngineStoreInstance<BoardState, BoardActions>

/**
 * A window the board opens from its own chrome: everything except the placement
 * the store computes and the ownership the insert fills. A spec that carries
 * owner and access is the restore path: the window reopens as the stored
 * document described it.
 */
export type OpenWindowSpec = Omit<BoardWindowState, 'x' | 'y' | 'zIndex' | 'ownerId' | 'access'> & {
  /** Owner to reopen the window under; absent opens it as the acting owner's. */
  readonly ownerId?: OwnerId
  /** Access to reopen the window with; absent opens it owner-only. */
  readonly access?: WindowAccess
}

/**
 * One staged file of a window draft: the visible record plus the local source
 * the retry re-stages. The source stays beside the record so a refused prompt
 * or a failed upload returns both together. It is absent for a receipt-only
 * entry — a file the standard composer handed over, whose bytes never enter
 * the browser: the chip offers no retry, and a refused prompt marks it failed.
 */
export interface BoardWindowDraftFile {
  readonly record: BoardDraftFile
  readonly source?: File | undefined
}

/**
 * One window's unsent composer draft. It lives in the board store, not in the
 * composer's React state, so switching the main panel away from the board —
 * which unmounts the whole board — keeps the text, images, and staged files
 * until the window sends or closes. The layout never carries it: a reload
 * starts from an empty composer.
 */
export interface BoardWindowDraft {
  text: string
  images: BoardDraftImage[]
  files: BoardWindowDraftFile[]
}

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

/** One tab of a window's right panel. */
export interface BoardRightPanelTab {
  /** 'home', 'files', or `viewer:<absolute path>`; the id is the dedupe key. */
  readonly id: string
  readonly kind: 'home' | 'files' | 'viewer'
  /** Absolute path of a viewer tab. */
  readonly path?: string
}

/** One directory level of a files tab. */
export type BoardFilesLevel =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly entries: readonly WorkspaceDirectoryEntry[]; readonly truncated: boolean }
  | { readonly kind: 'failed'; readonly code: string; readonly message: string }

/** One files tab's tree (mirrors ui-sidebar-files' state). */
export interface BoardFilesTabState {
  /** Absolute workspace root. */
  readonly root: string
  /** Level state by absolute directory path. */
  readonly levels: Record<string, BoardFilesLevel>
  /** Expanded absolute directory paths, root included. */
  readonly expanded: string[]
}

/** One session's right-panel tabs and files trees. */
export interface BoardRightPanelState {
  tabs: BoardRightPanelTab[]
  activeTabId: string | null
  files: Record<string, BoardFilesTabState>
}

type BoardActions = {
  setPan: (draft: BoardState, panX: number, panY: number) => void
  /** Shift the view by one screen-pixel pan delta; the stored pan moves by its negation. */
  panBy: (draft: BoardState, deltaX: number, deltaY: number) => void
  setZoom: (draft: BoardState, zoom: number) => void
  /** Multiply the zoom by `factor` around the pointer, clamped to the layout limits. */
  zoomBy: (draft: BoardState, factor: number, pointerX: number, pointerY: number) => void
  /**
   * Show every window: fit the bounding box of all windows — their open panels
   * included — into the safe area at no more than zoom 1, centred. A board
   * without windows returns to pan (0, 0) and zoom 1.
   */
  resetView: (draft: BoardState) => void
  setViewport: (draft: BoardState, width: number, height: number) => void
  /**
   * Publish one chrome element's contribution for its declared edge; the
   * element's own key replaces its previous entry.
   */
  publishChromeInset: (draft: BoardState, key: string, edge: ChromeEdge, depth: number) => void
  /** Drop one chrome element's contribution (unmount, or ref change). */
  clearChromeInset: (draft: BoardState, key: string) => void
  addWindow: (draft: BoardState, window: BoardWindowState) => void
  openWindow: (draft: BoardState, spec: OpenWindowSpec) => void
  moveWindow: (draft: BoardState, id: WindowId, x: number, y: number, snap: boolean) => void
  resizeWindow: (draft: BoardState, id: WindowId, width: number, height: number, snap: boolean) => void
  setWindowBodyKind: (draft: BoardState, id: WindowId, bodyKind: WindowBodyKind) => void
  setCloneEdit: (draft: BoardState, windowId: WindowId, cloneId: CloneId, edit: CloneEdit | undefined) => void
  setWindowCustomTitle: (draft: BoardState, id: WindowId, title: string | undefined) => void
  /**
   * Transfer one window to another participant. Only the current owner may
   * transfer; a target that is malformed or already the owner changes nothing,
   * and the new owner leaves the window's selected-people list. The window's
   * agent and placement do not change.
   */
  transferWindow: (draft: BoardState, id: WindowId, ownerId: OwnerId) => void
  /**
   * Replace one window's access. Only the current owner may change it; the
   * people list is repaired like a stored one and kept across mode switches.
   */
  setWindowAccess: (draft: BoardState, id: WindowId, access: WindowAccess) => void
  focusWindow: (draft: BoardState, id: WindowId) => void
  /**
   * Drop the focused window. A plain click on the empty canvas clears the
   * selection, which withdraws the active window's bezel; the window itself
   * stays open.
   */
  clearActiveWindow: (draft: BoardState) => void
  centerOnWindow: (draft: BoardState, id: WindowId) => void
  revealWindow: (draft: BoardState, id: WindowId) => void
  /** Open or close one of the window's two panels (Т3.12). */
  setWindowPanel: (draft: BoardState, id: WindowId, side: 'left' | 'right', open: boolean) => void
  /** Store one panel's width, clamped to its side's range. */
  setWindowPanelWidth: (draft: BoardState, id: WindowId, side: 'left' | 'right', width: number) => void
  /** Open one right-panel tab of a session, or activate the tab with the same id. */
  openRightTab: (draft: BoardState, sessionId: SessionId, tab: BoardRightPanelTab) => void
  /** Activate one open right-panel tab; an id the session does not hold is ignored. */
  activateRightTab: (draft: BoardState, sessionId: SessionId, tabId: string) => void
  /** Close one right-panel tab and activate its nearest remaining neighbour. */
  closeRightTab: (draft: BoardState, sessionId: SessionId, tabId: string) => void
  /** Seed one files tab's tree at its workspace root, root expanded. */
  filesStart: (draft: BoardState, sessionId: SessionId, tabId: string, root: string) => void
  /** Mark one directory level as being listed. */
  filesLoading: (draft: BoardState, sessionId: SessionId, tabId: string, path: string) => void
  /** Record one directory level's contents. */
  filesLoaded: (
    draft: BoardState,
    sessionId: SessionId,
    tabId: string,
    path: string,
    level: { readonly entries: readonly WorkspaceDirectoryEntry[]; readonly truncated: boolean },
  ) => void
  /** Record why one directory level could not be listed. */
  filesFailed: (
    draft: BoardState,
    sessionId: SessionId,
    tabId: string,
    path: string,
    code: string,
    message: string,
  ) => void
  /** Open or collapse one directory of a files tab. */
  filesToggle: (draft: BoardState, sessionId: SessionId, tabId: string, path: string) => void
  /** Drop one files tab's loaded levels, keeping what is expanded. */
  filesReset: (draft: BoardState, sessionId: SessionId, tabId: string) => void
  setPanelGroupBy: (draft: BoardState, groupBy: BoardPanelGroupBy) => void
  setPanelOrderBy: (draft: BoardState, orderBy: BoardPanelOrderBy) => void
  /** Open or close one group node of the working-folders tree. */
  setPanelGroupExpanded: (draft: BoardState, key: string, expanded: boolean) => void
  setDefaultPreset: (draft: BoardState, presetId: string) => void
  closeWindow: (draft: BoardState, id: WindowId) => void
  hydrate: (draft: BoardState, layout: BoardLayoutDocument) => void
  setSelectingElement: (draft: BoardState, selecting: boolean) => void
  /**
   * Remember (or clear) the window whose session was expanded into the
   * standard interface. Set only after a successful handoff; the binding
   * rules Т2.13–Т2.16 run while it is set.
   */
  setExpandedWindow: (draft: BoardState, id: WindowId | null) => void
  /**
   * Move one window's dock icon before another (or to the end with `null`).
   * The paint order never changes: the dock has its own order (A6).
   */
  reorderDock: (draft: BoardState, id: WindowId, before: WindowId | null) => void
  /** Move one clone's dock icon before another (or to the end with `null`). */
  reorderClones: (draft: BoardState, id: CloneId, before: CloneId | null) => void
  pushComposerIntent: (draft: BoardState, windowId: WindowId, intent: { text?: string; pickFiles?: boolean }) => void
  consumeComposerIntent: (draft: BoardState, id: number) => void
  setDraftText: (draft: BoardState, windowId: WindowId, text: string) => void
  /**
   * Append one paragraph to the window's draft: an empty draft takes the text
   * verbatim, a non-empty one gains it after a blank line. The store owns the
   * rule so a refused submission never doubles text against a stale read.
   */
  appendDraftText: (draft: BoardState, windowId: WindowId, text: string) => void
  addDraftImages: (draft: BoardState, windowId: WindowId, images: readonly BoardDraftImage[]) => void
  addDraftFiles: (draft: BoardState, windowId: WindowId, files: readonly BoardWindowDraftFile[]) => void
  updateDraftFile: (draft: BoardState, windowId: WindowId, fileId: string, patch: Partial<BoardDraftFile>) => void
  removeDraftItem: (draft: BoardState, windowId: WindowId, kind: 'image' | 'file', itemId: string) => void
  clearDraft: (draft: BoardState, windowId: WindowId) => void
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
  /**
   * Per-element chrome contributions, keyed by the publishing element: each
   * entry declares one board edge and its depth from it. `safeArea` folds them;
   * a hidden chrome element clears its entry (an open panel).
   */
  chromeInsetSources: Record<string, ChromeInsetContribution>
  windows: Record<string, BoardWindowState>
  /** Window ids in paint order, bottom to top. */
  windowOrder: WindowId[]
  /**
   * Window ids in dock order, left to right (A6). Independent of the paint
   * order, so focusing a window never moves its dock icon; every open window
   * appears exactly once, and {@link BoardActions.reorderDock} is the only
   * writer besides window open and close.
   */
  dockOrder: WindowId[]
  /** Clone ids in dock order (A6); membership stays the clone roster's. */
  cloneOrder: CloneId[]
  activeWindowId: WindowId | null
  /** How the chats panel arranges its list. */
  panelGroupBy: BoardPanelGroupBy
  /** How the chats panel orders chats inside a group. */
  panelOrderBy: BoardPanelOrderBy
  /**
   * Group keys (the workspace id, '' for the ungrouped bucket) whose tree node
   * is expanded in the windows' working-folders panel. In-memory view state:
   * switching the main panel away from the board unmounts the tree but not the
   * board plugin, so the expansion returns with the board.
   */
  panelExpandedGroups: string[]
  /** Agent preset new windows start with, or '' when the deployment default composes them. */
  defaultPreset: string
  isSelectingElement: boolean
  /**
   * Window expanded into the standard interface by its header control, or
   * null. Transient view state: the layout never carries it, and the explicit
   * return clears it.
   */
  expandedWindowId: WindowId | null
  /** Composer commands waiting for their window's composer to pick them up. */
  composerIntents: ComposerIntent[]
  /** Monotonic source of composer-intent identities. */
  composerIntentSeq: number
  /**
   * Unsent composer drafts per window, in memory only. Keyed by window id, so
   * a session change inside the window keeps the draft while closing the
   * window drops it.
   */
  drafts: Record<string, BoardWindowDraft>
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
  /**
   * Right-panel tabs and files trees per session, in memory only. The tabs
   * belong to the Session, not the window: rebinding a window to another
   * session shows that session's tabs, and switching back restores them.
   */
  rightPanels: Record<string, BoardRightPanelState>
}

/**
 * Size and body of the windows the board's own chrome opens. The chat window
 * takes 552×648: the base design's 480×560 grown with the window UI scale and
 * kept on the 24px grid. Tool windows start larger — the frame is shared, so
 * only their template size differs — and every size stays on the same grid and
 * above {@link MIN_WINDOW_SIZE}.
 */
/** Panel defaults every opened window starts from (both panels closed). */
const WINDOW_PANEL_DEFAULTS = {
  leftPanelOpen: false,
  leftPanelWidth: PANEL_LEFT_DEFAULT_WIDTH,
  rightPanelOpen: false,
  rightPanelWidth: PANEL_RIGHT_DEFAULT_WIDTH,
} as const satisfies Pick<BoardWindowState, 'leftPanelOpen' | 'leftPanelWidth' | 'rightPanelOpen' | 'rightPanelWidth'>

/** Size and panel defaults of every window kind the board opens from its chrome. */
export const BOARD_WINDOW_TEMPLATES = {
  agent: { kind: 'agent', bodyKind: 'conversation', width: 552, height: 648, ...WINDOW_PANEL_DEFAULTS },
  connectors: { kind: 'connectors', bodyKind: 'connectors', width: 648, height: 768, ...WINDOW_PANEL_DEFAULTS },
  settings: { kind: 'settings', bodyKind: 'settings', width: 648, height: 768, ...WINDOW_PANEL_DEFAULTS },
  dashboard: { kind: 'dashboard', bodyKind: 'dashboard', width: 768, height: 768, ...WINDOW_PANEL_DEFAULTS },
  clone: { kind: 'clone', bodyKind: 'clone', width: 648, height: 768, ...WINDOW_PANEL_DEFAULTS },
  tasks: { kind: 'tasks', bodyKind: 'tasks', width: 648, height: 768, ...WINDOW_PANEL_DEFAULTS },
} as const satisfies Record<string, Pick<BoardWindowState, 'kind' | 'bodyKind' | 'width' | 'height' | 'leftPanelOpen' | 'leftPanelWidth' | 'rightPanelOpen' | 'rightPanelWidth'>>

/**
 * The smallest window the board opens: the minimum working chat layout
 * (decision R-5). A window never shrinks below it — the header, composer, and
 * lane cannot lay out in less — and grows freely in width, height, or
 * proportionally. Both numbers stay on the 24 px grid.
 */
export const MIN_WINDOW_SIZE = { width: 408, height: 480 } as const

/** Grid step the snap rounds to while dragging without Alt. */
const GRID_STEP = 24

/**
 * Bottom of the window z-index band. Windows paint above the canvas grid and
 * below every floating layer of the board: the chrome (dock, omnibar, minimap)
 * sits at 100, the active handle ring at 150, the screen-space popover layer
 * (tooltips and menus) at {@link BOARD_POPOVER_Z}, the element-selection
 * overlay at 500, and an overlay chats panel at 1000.
 * The band tops out below the chrome, so a window can never paint over it
 * however many windows are open.
 */
export const WINDOW_Z_BASE = 10

/** Top of the window z-index band; the chrome above it starts at 100. */
export const WINDOW_Z_MAX = 99

/**
 * Z-index of the board's popover layer. Tooltips and menus of the windows, the
 * chats rail and panel, and the floating chrome portal into that layer, so
 * they paint above the chrome and the handle ring while the element-selection
 * overlay still covers them.
 */
export const BOARD_POPOVER_Z = 300

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

/** Center a new window in the board's safe area (world coordinates, Т1.15). */
function placeWindow(draft: BoardState, width: number, height: number): { x: number; y: number } {
  const area = safeArea(draft).world
  return {
    x: area.left + (area.right - area.left - width) / 2,
    y: area.top + (area.bottom - area.top - height) / 2,
  }
}

/** One world-space rectangle; the fields name the box's edges, not its size. */
interface WorldBox {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** One window's world box: its open panels extend it sideways. */
function windowBox(window: BoardWindowState): WorldBox {
  return {
    left: window.x - (window.leftPanelOpen === true ? windowPanelWidth(window, 'left') : 0),
    top: window.y,
    right: window.x + window.width + (window.rightPanelOpen === true ? windowPanelWidth(window, 'right') : 0),
    bottom: window.y + window.height,
  }
}

/** The world box of every window, or null when the board holds none. */
function windowsBox(draft: BoardState): WorldBox | null {
  let box: WorldBox | null = null
  for (const window of Object.values(draft.windows)) {
    const own = windowBox(window)
    box = box === null
      ? own
      : {
        left: Math.min(box.left, own.left),
        top: Math.min(box.top, own.top),
        right: Math.max(box.right, own.right),
        bottom: Math.max(box.bottom, own.bottom),
      }
  }
  return box
}

/**
 * Scale and pan the view so one world box fits the safe area: the zoom drops
 * to the box's fit when the box is larger than the free rectangle (never
 * above the current zoom), and the box's centre lands on the area's centre.
 */
function fitBoxInSafeArea(draft: BoardState, box: WorldBox): void {
  const area = safeArea(draft).screen
  const availableWidth = area.right - area.left
  const availableHeight = area.bottom - area.top
  const width = Math.max(1, box.right - box.left)
  const height = Math.max(1, box.bottom - box.top)
  // An unmeasured board has no free rectangle to scale against: the box is
  // still centred against the box it reports, and the zoom stays as it is.
  if (availableWidth > 0 && availableHeight > 0) {
    const fit = Math.min(draft.zoom, availableWidth / width, availableHeight / height)
    draft.zoom = Math.max(BOARD_ZOOM_MIN, fit)
  }
  draft.panX = (area.left + area.right) / 2 - (box.left + box.right) / 2 * draft.zoom
  draft.panY = (area.top + area.bottom) / 2 - (box.top + box.bottom) / 2 * draft.zoom
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
 * Move one id before another inside an order list, or to the end when `before`
 * is null or absent. A missing `id` is appended; the result never drops an
 * entry.
 * @param order - the current order.
 * @param id - the id being moved.
 * @param before - the id it lands before, or null for the end.
 * @returns the reordered list.
 */
function moveBefore<T extends string>(order: readonly T[], id: T, before: T | null): T[] {
  const without = order.filter(candidate => candidate !== id)
  if (before === null || before === id) return [...without, id]
  const index = without.indexOf(before)
  if (index < 0) return [...without, id]
  return [...without.slice(0, index), id, ...without.slice(index)]
}

/**
 * The window's draft entry, created empty on the first write. The read-back
 * returns the immer draft over the fresh entry, so the caller's mutations are
 * tracked; mutating the assigned literal would not be.
 */
function draftWindowDraft(draft: BoardState, windowId: WindowId): BoardWindowDraft {
  const key = windowId as string
  const existing = draft.drafts[key]
  if (existing !== undefined) return existing
  draft.drafts[key] = { text: '', images: [], files: [] }
  return draft.drafts[key]
}

/**
 * One session's right-panel bucket, created empty on first use.
 * @param draft - the board draft.
 * @param sessionId - session whose panel is written.
 * @returns the session's bucket.
 */
function rightPanelBucket(draft: BoardState, sessionId: SessionId): BoardRightPanelState {
  const existing = draft.rightPanels[sessionId]
  if (existing !== undefined) return existing
  draft.rightPanels[sessionId] = { tabs: [], activeTabId: null, files: {} }
  return draft.rightPanels[sessionId]
}

/**
 * One files tab's tree, or undefined when the session or tab has none.
 * @param draft - the board draft.
 * @param sessionId - session whose panel is read.
 * @param tabId - id of the files tab.
 * @returns the tab's tree state, when it exists.
 */
function rightPanelFiles(draft: BoardState, sessionId: SessionId, tabId: string): BoardFilesTabState | undefined {
  return draft.rightPanels[sessionId]?.files[tabId]
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
 * An insert without an owner or access opens the window as the acting owner's,
 * owner-only; a supplied access is copied so the store never shares the
 * caller's array.
 */
function insertWindow(
  draft: BoardState,
  window: Omit<BoardWindowState, 'ownerId' | 'access'> & { readonly ownerId?: OwnerId; readonly access?: WindowAccess },
): void {
  const placed: BoardWindowState = {
    ...window,
    ownerId: window.ownerId ?? currentOwnerId(draft),
    access: window.access === undefined
      ? { mode: 'owner', people: [] }
      : { mode: window.access.mode, people: [...window.access.people] },
    leftPanelOpen: window.leftPanelOpen ?? false,
    leftPanelWidth: window.leftPanelWidth ?? PANEL_LEFT_DEFAULT_WIDTH,
    rightPanelOpen: window.rightPanelOpen ?? false,
    rightPanelWidth: window.rightPanelWidth ?? PANEL_RIGHT_DEFAULT_WIDTH,
    zIndex: Math.min(Math.max(window.zIndex, WINDOW_Z_BASE), WINDOW_Z_MAX),
  }
  draft.windows[placed.id as string] = placed
  if (!draft.windowOrder.includes(placed.id)) {
    draft.windowOrder.push(placed.id)
  }
  // The dock shows the window at the end of its own order until the user
  // drags it elsewhere; focusing never touches this list.
  if (!draft.dockOrder.includes(placed.id)) {
    draft.dockOrder.push(placed.id)
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
      chromeInsetSources: {},
      windows: {},
      windowOrder: [],
      dockOrder: [],
      cloneOrder: [],
      activeWindowId: null,
      panelGroupBy: 'workspace',
      panelOrderBy: 'updated',
      panelExpandedGroups: [],
      defaultPreset: '',
      isSelectingElement: false,
      expandedWindowId: null,
      composerIntents: [],
      composerIntentSeq: 0,
      drafts: {},
      returnWindowId: null,
      highlightWindowId: null,
      cloneEdits: {},
      rightPanels: {},
    }),
    actions: {
      setPan: (draft, panX, panY) => {
        draft.panX = panX
        draft.panY = panY
      },
      panBy: (draft, deltaX, deltaY) => {
        draft.panX -= deltaX
        draft.panY -= deltaY
      },
      setZoom: (draft, zoom) => {
        draft.zoom = Math.min(BOARD_ZOOM_MAX, Math.max(BOARD_ZOOM_MIN, zoom))
      },
      zoomBy: (draft, factor, pointerX, pointerY) => {
        // The world point under the pointer stays fixed: pan is recomputed for
        // the new scale, and a clamped zoom leaves the pan untouched.
        const newZoom = Math.min(BOARD_ZOOM_MAX, Math.max(BOARD_ZOOM_MIN, draft.zoom * factor))
        if (newZoom === draft.zoom) return
        draft.panX = pointerX - (pointerX - draft.panX) * (newZoom / draft.zoom)
        draft.panY = pointerY - (pointerY - draft.panY) * (newZoom / draft.zoom)
        draft.zoom = newZoom
      },
      resetView: (draft) => {
        const box = windowsBox(draft)
        if (box === null) {
          draft.panX = 0
          draft.panY = 0
          draft.zoom = 1
          return
        }
        // The overview never magnifies: a fitting board returns to zoom 1, and
        // a box larger than the free rectangle scales down to fit it.
        const area = safeArea(draft).screen
        const availableWidth = area.right - area.left
        const availableHeight = area.bottom - area.top
        // An unmeasured board has no free rectangle to fit into: the command
        // falls back to the initial view.
        if (availableWidth <= 0 || availableHeight <= 0) {
          draft.panX = 0
          draft.panY = 0
          draft.zoom = 1
          return
        }
        const width = Math.max(1, box.right - box.left)
        const height = Math.max(1, box.bottom - box.top)
        draft.zoom = Math.max(BOARD_ZOOM_MIN, Math.min(1, availableWidth / width, availableHeight / height))
        draft.panX = (area.left + area.right) / 2 - (box.left + box.right) / 2 * draft.zoom
        draft.panY = (area.top + area.bottom) / 2 - (box.top + box.bottom) / 2 * draft.zoom
      },
      setViewport: (draft, width, height) => {
        draft.viewportWidth = width
        draft.viewportHeight = height
      },
      publishChromeInset: (draft, key, edge, depth) => {
        const previous = draft.chromeInsetSources[key]
        if (previous !== undefined && previous.edge === edge && previous.depth === depth) return
        draft.chromeInsetSources[key] = { edge, depth }
      },
      clearChromeInset: (draft, key) => {
        // Immer draft: the hook instance id is the opaque record key.
        Reflect.deleteProperty(draft.chromeInsetSources, key)
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
      transferWindow: (draft, id, ownerId) => {
        const win = draft.windows[id as string]
        if (win === undefined || !canManageWindow(draft, win)) return
        if (win.ownerId === ownerId || !isOwnerIdFormat(ownerId)) return
        win.ownerId = ownerId
        win.access = { mode: win.access.mode, people: win.access.people.filter(person => person !== ownerId) }
      },
      setWindowAccess: (draft, id, access) => {
        const win = draft.windows[id as string]
        if (win === undefined || !canManageWindow(draft, win)) return
        const repaired = sanitizeWindowAccess(access, win.ownerId)
        win.access = { mode: repaired.mode, people: [...repaired.people] }
      },
      focusWindow: (draft, id) => {
        raiseWindow(draft, id)
      },
      clearActiveWindow: (draft) => {
        draft.activeWindowId = null
      },
      centerOnWindow: (draft, id) => {
        const win = draft.windows[id as string]
        if (!win) return
        raiseWindow(draft, id)
        fitBoxInSafeArea(draft, windowBox(win))
      },
      revealWindow: (draft, id) => {
        const win = draft.windows[id as string]
        if (!win) return
        raiseWindow(draft, id)
        // Raising a window the view has left would be a dead gesture: the
        // window becomes active but stays out of sight.
        if (isWindowOnScreen(draft, win)) return
        fitBoxInSafeArea(draft, windowBox(win))
      },
      setWindowPanel: (draft, id, side, open) => {
        const win = draft.windows[id as string]
        if (!win) return
        if (side === 'left') win.leftPanelOpen = open
        else win.rightPanelOpen = open
        if (!open) return
        // A panel that would fall outside the safe area shifts the board (no
        // zoom change), so the panel opens fully visible (Т3.5).
        const width = windowPanelWidth(win, side)
        const area = safeArea(draft).screen
        if (side === 'left') {
          const panelLeft = draft.panX + (win.x - width) * draft.zoom
          if (panelLeft < area.left) draft.panX += area.left - panelLeft
          return
        }
        const panelRight = draft.panX + (win.x + win.width + width) * draft.zoom
        if (panelRight > area.right) draft.panX -= panelRight - area.right
      },
      setWindowPanelWidth: (draft, id, side, width) => {
        const win = draft.windows[id as string]
        if (!win) return
        const clamped = side === 'left'
          ? Math.min(PANEL_LEFT_MAX_WIDTH, Math.max(PANEL_LEFT_MIN_WIDTH, Math.round(width)))
          : Math.min(PANEL_RIGHT_MAX_WIDTH, Math.max(PANEL_RIGHT_MIN_WIDTH, Math.round(width)))
        if (side === 'left') win.leftPanelWidth = clamped
        else win.rightPanelWidth = clamped
      },
      openRightTab: (draft, sessionId, tab) => {
        const bucket = rightPanelBucket(draft, sessionId)
        if (!bucket.tabs.some(existing => existing.id === tab.id)) bucket.tabs.push(tab)
        bucket.activeTabId = tab.id
      },
      activateRightTab: (draft, sessionId, tabId) => {
        const bucket = draft.rightPanels[sessionId]
        if (bucket === undefined || !bucket.tabs.some(tab => tab.id === tabId)) return
        bucket.activeTabId = tabId
      },
      closeRightTab: (draft, sessionId, tabId) => {
        const bucket = draft.rightPanels[sessionId]
        if (bucket === undefined) return
        const index = bucket.tabs.findIndex(tab => tab.id === tabId)
        if (index < 0) return
        bucket.tabs.splice(index, 1)
        Reflect.deleteProperty(bucket.files, tabId)
        if (bucket.activeTabId !== tabId) return
        bucket.activeTabId = bucket.tabs[index - 1]?.id ?? bucket.tabs[0]?.id ?? null
      },
      filesStart: (draft, sessionId, tabId, root) => {
        const bucket = rightPanelBucket(draft, sessionId)
        if (bucket.files[tabId] !== undefined) return
        bucket.files[tabId] = { root, levels: {}, expanded: [root] }
      },
      filesLoading: (draft, sessionId, tabId, path) => {
        const files = rightPanelFiles(draft, sessionId, tabId)
        if (files === undefined) return
        files.levels[path] = { kind: 'loading' }
      },
      filesLoaded: (draft, sessionId, tabId, path, level) => {
        const files = rightPanelFiles(draft, sessionId, tabId)
        if (files === undefined) return
        files.levels[path] = { kind: 'ready', entries: level.entries, truncated: level.truncated }
      },
      filesFailed: (draft, sessionId, tabId, path, code, message) => {
        const files = rightPanelFiles(draft, sessionId, tabId)
        if (files === undefined) return
        files.levels[path] = { kind: 'failed', code, message }
      },
      filesToggle: (draft, sessionId, tabId, path) => {
        const files = rightPanelFiles(draft, sessionId, tabId)
        if (files === undefined) return
        const at = files.expanded.indexOf(path)
        if (at >= 0) files.expanded.splice(at, 1)
        else files.expanded.push(path)
      },
      filesReset: (draft, sessionId, tabId) => {
        const bucket = draft.rightPanels[sessionId]
        const files = bucket?.files[tabId]
        if (bucket === undefined || files === undefined) return
        bucket.files[tabId] = { root: files.root, levels: {}, expanded: [...files.expanded] }
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
      setPanelGroupExpanded: (draft, key, expanded) => {
        const open = draft.panelExpandedGroups.includes(key)
        if (expanded && !open) draft.panelExpandedGroups.push(key)
        if (!expanded && open) draft.panelExpandedGroups = draft.panelExpandedGroups.filter(entry => entry !== key)
      },
      closeWindow: (draft, id) => {
        // A closed clone window takes its unsaved draft with it: the window is
        // the only surface that edits the record, so nothing should keep a
        // copy of what the user abandoned. A tasks window carries the same
        // clone id but edits no draft, so its close leaves the record alone.
        const closing = draft.windows[id as string]
        if (closing?.kind === 'clone' && closing.cloneId !== undefined) {
          Reflect.deleteProperty(draft.cloneEdits, closing.cloneId)
        }
        // Immer draft: removing the window entry on close; WindowId is
        // opaque, so the record key is only reachable dynamically.
        Reflect.deleteProperty(draft.windows, id)
        draft.windowOrder = draft.windowOrder.filter(wId => wId !== id)
        draft.dockOrder = draft.dockOrder.filter(wId => wId !== id)
        // A queued composer command for the closed window can never land: its
        // composer is gone, so the queue must not grow with orphans.
        draft.composerIntents = draft.composerIntents.filter(intent => intent.windowId !== id)
        // A closed window's draft goes with it: nothing may resurrect it.
        Reflect.deleteProperty(draft.drafts, id)
        if (draft.expandedWindowId === id) draft.expandedWindowId = null
        if (draft.activeWindowId === id) {
          draft.activeWindowId = draft.windowOrder[draft.windowOrder.length - 1] ?? null
        }
      },
      hydrate: (draft, layout) => {
        // Only the stored layout fields move: transient interaction state
        // (selection, queued composer commands) and the measured viewport box
        // belong to the running session.
        // A window the adopted document drops loses its per-window view state
        // as closing it would: a draft or queued command must not outlive its
        // window.
        const kept = new Set(layout.windows.map(window => window.id))
        for (const id of Object.keys(draft.windows)) {
          if (kept.has(id)) continue
          const dropped = draft.windows[id]
          if (dropped?.kind === 'clone' && dropped.cloneId !== undefined) {
            Reflect.deleteProperty(draft.cloneEdits, dropped.cloneId)
          }
          draft.composerIntents = draft.composerIntents.filter(intent => intent.windowId !== id)
          Reflect.deleteProperty(draft.drafts, id)
        }
        draft.panX = layout.panX
        draft.panY = layout.panY
        draft.zoom = layout.zoom
        draft.windows = Object.fromEntries(layout.windows.map((window) => {
          // The stored layout carries plain strings; the window state carries
          // the branded clone identity the editor resolves its record by and
          // the branded owner identities the management predicate compares.
          const { cloneId, ...rest } = window
          const state: BoardWindowState = {
            ...rest,
            id: window.id as WindowId,
            ownerId: brandString<OwnerId>(window.ownerId),
            access: {
              mode: window.access.mode,
              people: window.access.people.map(person => brandString<OwnerId>(person)),
            },
            ...(cloneId === undefined ? {} : { cloneId: cloneId as CloneId }),
          }
          return [window.id, state]
        }))
        draft.windowOrder = layout.windowOrder as WindowId[]
        draft.dockOrder = layout.dockOrder as WindowId[]
        draft.cloneOrder = layout.cloneOrder as CloneId[]
        draft.activeWindowId = layout.activeWindowId === '' ? null : layout.activeWindowId as WindowId
        draft.panelGroupBy = layout.panelGroupBy
        draft.panelOrderBy = layout.panelOrderBy
        draft.defaultPreset = layout.defaultPreset
        draft.expandedWindowId = null
      },
      setSelectingElement: (draft, selecting) => {
        draft.isSelectingElement = selecting
      },
      setExpandedWindow: (draft, id) => {
        if (id === null) {
          draft.expandedWindowId = null
          return
        }
        if (!draft.windows[id as string]) return
        draft.expandedWindowId = id
      },
      reorderDock: (draft, id, before) => {
        draft.dockOrder = moveBefore(draft.dockOrder, id, before)
      },
      reorderClones: (draft, id, before) => {
        draft.cloneOrder = moveBefore(draft.cloneOrder, id, before)
      },
      pushComposerIntent: (draft, windowId, intent) => {
        draft.composerIntentSeq += 1
        draft.composerIntents.push({ id: draft.composerIntentSeq, windowId, ...intent })
      },
      consumeComposerIntent: (draft, id) => {
        draft.composerIntents = draft.composerIntents.filter(intent => intent.id !== id)
      },
      setDraftText: (draft, windowId, text) => {
        draftWindowDraft(draft, windowId).text = text
      },
      appendDraftText: (draft, windowId, text) => {
        const windowDraft = draftWindowDraft(draft, windowId)
        windowDraft.text = windowDraft.text === '' ? text : `${windowDraft.text}\n\n${text}`
      },
      addDraftImages: (draft, windowId, images) => {
        const windowDraft = draftWindowDraft(draft, windowId)
        // The running list carries the batch's own earlier entries, so one
        // batch cannot stage the same chip twice.
        for (const image of images) {
          if (windowDraft.images.some(held => held.id === image.id)) continue
          windowDraft.images.push(image)
        }
      },
      addDraftFiles: (draft, windowId, files) => {
        const windowDraft = draftWindowDraft(draft, windowId)
        for (const file of files) {
          if (windowDraft.files.some(held => held.record.id === file.record.id)) continue
          windowDraft.files.push(file)
        }
      },
      updateDraftFile: (draft, windowId, fileId, patch) => {
        const windowDraft = draftWindowDraft(draft, windowId)
        windowDraft.files = windowDraft.files.map(entry => entry.record.id === fileId
          ? { ...entry, record: { ...entry.record, ...patch } }
          : entry)
      },
      removeDraftItem: (draft, windowId, kind, itemId) => {
        const windowDraft = draftWindowDraft(draft, windowId)
        if (kind === 'image') windowDraft.images = windowDraft.images.filter(image => image.id !== itemId)
        else windowDraft.files = windowDraft.files.filter(entry => entry.record.id !== itemId)
      },
      clearDraft: (draft, windowId) => {
        // Immer draft: the window id is the opaque record key.
        Reflect.deleteProperty(draft.drafts, windowId)
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
