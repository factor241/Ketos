/**
 * Durable board layout: the settings namespace, the document version, the
 * restore limits, and the schema both halves share. The layout is a
 * user-settings document rather than session data, so the Host validates every
 * write through {@link BoardSettingsSchema} and the browser writes it back
 * under the revision it read.
 */
import z from '@deepseek-ai/schemastery'
import type { WindowBodyKind, WindowKind } from './client/contract/slots.ts'

/** How the chats panel arranges its list. */
export type BoardPanelGroupBy = 'workspace' | 'flat'

/** How the chats panel orders chats inside a group. */
export type BoardPanelOrderBy = 'manual' | 'updated'

/** Width the left panel opens with. */
export const PANEL_LEFT_DEFAULT_WIDTH = 260
/** Smallest readable left-panel width. */
export const PANEL_LEFT_MIN_WIDTH = 260
/** Largest left-panel width. */
export const PANEL_LEFT_MAX_WIDTH = 360
/** Width the right panel opens with. */
export const PANEL_RIGHT_DEFAULT_WIDTH = 360
/** Smallest readable right-panel width. */
export const PANEL_RIGHT_MIN_WIDTH = 280
/** Largest right-panel width. */
export const PANEL_RIGHT_MAX_WIDTH = 600

/**
 * Smallest readable width of the legacy single chats panel. Version-1
 * documents still carry `panelWidth` and the schema accepts it, while the
 * running board ignores the field (its panels store per-window widths).
 */
export const PANEL_MIN_WIDTH = 260

/** Largest legacy chats-panel width, kept for the version-1 schema bounds. */
export const PANEL_MAX_WIDTH = 420

/** Width the legacy chats panel opened with, kept as the schema default. */
export const PANEL_DEFAULT_WIDTH = 300

/** Settings namespace owning the durable board layout. */
export const BOARD_SETTINGS_NAMESPACE = 'ui-board'

/** Layout document version; a document bearing another version is ignored. */
export const BOARD_SETTINGS_VERSION = 1

/** Window kinds a stored layout may restore; an unknown kind drops the window. */
export const BOARD_WINDOW_KINDS = [
  'agent', 'connectors', 'settings', 'dashboard', 'clone', 'tasks',
] as const satisfies readonly WindowKind[]

/** Window body kinds a stored layout may restore; an unknown body kind drops the window. */
export const BOARD_WINDOW_BODY_KINDS = [
  'conversation', 'connectors', 'settings', 'dashboard', 'clone', 'clone-memory', 'tasks',
] as const satisfies readonly WindowBodyKind[]

/** Chats-panel grouping modes a stored layout may restore. */
export const BOARD_PANEL_GROUP_BYS = ['workspace', 'flat'] as const satisfies readonly BoardPanelGroupBy[]

/** Chats-panel ordering modes a stored layout may restore. */
export const BOARD_PANEL_ORDER_BYS = ['manual', 'updated'] as const satisfies readonly BoardPanelOrderBy[]

/** Largest number of windows one stored layout may restore; the rest are dropped. */
export const BOARD_LAYOUT_MAX_WINDOWS = 50

/** Absolute world-coordinate bound for pan and window placement. */
export const BOARD_LAYOUT_COORD_LIMIT = 100_000

/** Smallest board zoom a stored layout may restore. */
export const BOARD_ZOOM_MIN = 0.2

/** Largest board zoom a stored layout may restore. */
export const BOARD_ZOOM_MAX = 2

/** One window as the layout document stores it. Session identity lives in the bridge, not here. */
export type BoardLayoutWindow = {
  /** Board-local window identity; unique inside one document. */
  id: string
  /** Window category selecting the frame. */
  kind: WindowKind
  /** Window content category selecting the body. */
  bodyKind: WindowBodyKind
  /** Ordinal among the window's kind, fixed at opening; names the template fallback. */
  ordinal: number
  /** User-given window name, absent while the frame uses the chat title. */
  customTitle?: string
  /** Clone a clone window edits, absent for every other window. */
  cloneId?: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  /** Whether the window's left panel (working folders) is open. */
  leftPanelOpen: boolean
  /** Stored width of the left panel. */
  leftPanelWidth: number
  /** Whether the window's right panel (files) is open. */
  rightPanelOpen: boolean
  /** Stored width of the right panel. */
  rightPanelWidth: number
}

/**
 * Layout fields a stored document carries. `viewportWidth/Height` are absent:
 * the canvas measures them at mount.
 */
export type BoardLayout = {
  panX: number
  panY: number
  zoom: number
  /** Windows in paint order, topmost last. */
  windows: BoardLayoutWindow[]
  /** Window ids in paint order; every id names a window in {@link windows}. */
  windowOrder: string[]
  /**
   * Window ids in dock order, left to right (A6). Independent of the paint
   * order: focusing a window raises it without moving its dock icon. Missing
   * ids are appended by ordinal when a document is repaired.
   */
  dockOrder: string[]
  /**
   * Clone ids in dock order (A6). Membership stays the clone roster's; this
   * list only orders the clone icons the user rearranged.
   */
  cloneOrder: string[]
  /** Focused window id, or '' when none is. */
  activeWindowId: string
  /** How the chats panel arranged its list. */
  panelGroupBy: BoardPanelGroupBy
  /** How the chats panel ordered chats inside a group. */
  panelOrderBy: BoardPanelOrderBy
  /** Agent preset new windows start with, or '' when the deployment default composes them. */
  defaultPreset: string
}

/**
 * Fields version-1 documents may still carry for the removed global chats
 * panel. The schema accepts and defaults them so an old document parses, and
 * the running board never reads them.
 */
export type BoardLegacyLayout = {
  /** Window whose single chats panel was open, or '' when none was. */
  panelWindowId: string
  /** Whether that panel was collapsed to its rail. */
  panelCollapsed: boolean
  /** Width the user last dragged that panel to. */
  panelWidth: number
}

/** Complete stored layout document; `version` gates the restore. */
export type BoardLayoutDocument = BoardLayout & {
  version: typeof BOARD_SETTINGS_VERSION
}

/**
 * Window → session bindings the session bridge maintains for restored windows
 * (written on discrete events: creation, rebind, close). The persistence layer
 * merges the bridge's live map into every section write, so a layout gesture
 * carries the current map with it; only the restore path reads it back.
 */
export type BoardSettingsBindings = Record<string, string>

/** Complete stored settings section: the durable layout plus the session bindings. */
export type BoardSettings = BoardLayoutDocument & BoardLegacyLayout & {
  bindings: BoardSettingsBindings
}

/** One stored window: structurally complete, with ranges the restore clamps. */
const BoardLayoutWindowSchema = z.object({
  id: z.string().required(),
  kind: z.union([...BOARD_WINDOW_KINDS]).required(),
  bodyKind: z.union([...BOARD_WINDOW_BODY_KINDS]).required(),
  ordinal: z.natural().default(1),
  customTitle: z.string(),
  cloneId: z.string(),
  x: z.number().min(-BOARD_LAYOUT_COORD_LIMIT).max(BOARD_LAYOUT_COORD_LIMIT).required(),
  y: z.number().min(-BOARD_LAYOUT_COORD_LIMIT).max(BOARD_LAYOUT_COORD_LIMIT).required(),
  width: z.number().min(1).max(BOARD_LAYOUT_COORD_LIMIT).required(),
  height: z.number().min(1).max(BOARD_LAYOUT_COORD_LIMIT).required(),
  zIndex: z.natural().required(),
  /** Whether the window's left panel (working folders) is open. */
  leftPanelOpen: z.boolean().default(false),
  /** Stored width of the left panel. */
  leftPanelWidth: z.number().min(PANEL_LEFT_MIN_WIDTH).max(PANEL_LEFT_MAX_WIDTH).default(PANEL_LEFT_DEFAULT_WIDTH),
  /** Whether the window's right panel (files) is open. */
  rightPanelOpen: z.boolean().default(false),
  /** Stored width of the right panel. */
  rightPanelWidth: z.number().min(PANEL_RIGHT_MIN_WIDTH).max(PANEL_RIGHT_MAX_WIDTH).default(PANEL_RIGHT_DEFAULT_WIDTH),
})

/**
 * Settings schema of the durable layout. Fields default so the namespace
 * resolves without a user section; an out-of-range or structurally broken
 * section rejects the write (and is ignored with a warning when read from a
 * hand-edited document).
 */
export const BoardSettingsSchema: z<BoardSettings> = z.object({
  version: z.const(BOARD_SETTINGS_VERSION).default(BOARD_SETTINGS_VERSION),
  panX: z.number().min(-BOARD_LAYOUT_COORD_LIMIT).max(BOARD_LAYOUT_COORD_LIMIT).default(0),
  panY: z.number().min(-BOARD_LAYOUT_COORD_LIMIT).max(BOARD_LAYOUT_COORD_LIMIT).default(0),
  zoom: z.number().min(BOARD_ZOOM_MIN).max(BOARD_ZOOM_MAX).default(1),
  windows: z.array(BoardLayoutWindowSchema).max(BOARD_LAYOUT_MAX_WINDOWS).default([]),
  bindings: z.dict(z.string()).default({}),
  windowOrder: z.array(z.string()).default([]),
  dockOrder: z.array(z.string()).default([]),
  cloneOrder: z.array(z.string()).default([]),
  activeWindowId: z.string().default(''),
  panelWindowId: z.string().default(''),
  panelCollapsed: z.boolean().default(true),
  panelWidth: z.number().min(PANEL_MIN_WIDTH).max(PANEL_MAX_WIDTH).default(PANEL_DEFAULT_WIDTH),
  panelGroupBy: z.union([...BOARD_PANEL_GROUP_BYS]).default('workspace'),
  panelOrderBy: z.union([...BOARD_PANEL_ORDER_BYS]).default('updated'),
  defaultPreset: z.string().default(''),
})
