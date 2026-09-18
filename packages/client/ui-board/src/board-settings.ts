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

/** Smallest readable chats-panel width, whichever mode is active. */
export const PANEL_MIN_WIDTH = 260

/** Largest chats-panel width, so a wide window keeps its chat dominant. */
export const PANEL_MAX_WIDTH = 420

/** Width a window opens its chats panel with before the user resizes it. */
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
  x: number
  y: number
  width: number
  height: number
  zIndex: number
}

/**
 * Layout fields a stored document carries. `viewportWidth/Height` are absent:
 * the canvas measures them at mount; `fullscreenWindowId` is absent: fullscreen
 * is a session modality.
 */
export type BoardLayout = {
  panX: number
  panY: number
  zoom: number
  /** Windows in paint order, topmost last. */
  windows: BoardLayoutWindow[]
  /** Window ids in paint order; every id names a window in {@link windows}. */
  windowOrder: string[]
  /** Focused window id, or '' when none is. */
  activeWindowId: string
  /** Window whose chats panel was open, or '' when none was. */
  panelWindowId: string
  /** Whether that panel was collapsed to its rail; true without an owner window. */
  panelCollapsed: boolean
  /** Width the user last dragged the chats panel to. */
  panelWidth: number
  /** How the chats panel arranged its list. */
  panelGroupBy: BoardPanelGroupBy
  /** How the chats panel ordered chats inside a group. */
  panelOrderBy: BoardPanelOrderBy
}

/** Complete stored layout document; `version` gates the restore. */
export type BoardLayoutDocument = BoardLayout & {
  version: typeof BOARD_SETTINGS_VERSION
}

/** One stored window: structurally complete, with ranges the restore clamps. */
const BoardLayoutWindowSchema = z.object({
  id: z.string().required(),
  kind: z.union([...BOARD_WINDOW_KINDS]).required(),
  bodyKind: z.union([...BOARD_WINDOW_BODY_KINDS]).required(),
  ordinal: z.natural().default(1),
  customTitle: z.string(),
  x: z.number().min(-BOARD_LAYOUT_COORD_LIMIT).max(BOARD_LAYOUT_COORD_LIMIT).required(),
  y: z.number().min(-BOARD_LAYOUT_COORD_LIMIT).max(BOARD_LAYOUT_COORD_LIMIT).required(),
  width: z.number().min(1).max(BOARD_LAYOUT_COORD_LIMIT).required(),
  height: z.number().min(1).max(BOARD_LAYOUT_COORD_LIMIT).required(),
  zIndex: z.natural().required(),
})

/**
 * Settings schema of the durable layout. Fields default so the namespace
 * resolves without a user section; an out-of-range or structurally broken
 * section rejects the write (and is ignored with a warning when read from a
 * hand-edited document).
 */
export const BoardSettingsSchema: z<BoardLayoutDocument> = z.object({
  version: z.const(BOARD_SETTINGS_VERSION).default(BOARD_SETTINGS_VERSION),
  panX: z.number().min(-BOARD_LAYOUT_COORD_LIMIT).max(BOARD_LAYOUT_COORD_LIMIT).default(0),
  panY: z.number().min(-BOARD_LAYOUT_COORD_LIMIT).max(BOARD_LAYOUT_COORD_LIMIT).default(0),
  zoom: z.number().min(BOARD_ZOOM_MIN).max(BOARD_ZOOM_MAX).default(1),
  windows: z.array(BoardLayoutWindowSchema).max(BOARD_LAYOUT_MAX_WINDOWS).default([]),
  windowOrder: z.array(z.string()).default([]),
  activeWindowId: z.string().default(''),
  panelWindowId: z.string().default(''),
  panelCollapsed: z.boolean().default(true),
  panelWidth: z.number().min(PANEL_MIN_WIDTH).max(PANEL_MAX_WIDTH).default(PANEL_DEFAULT_WIDTH),
  panelGroupBy: z.union([...BOARD_PANEL_GROUP_BYS]).default('workspace'),
  panelOrderBy: z.union([...BOARD_PANEL_ORDER_BYS]).default('updated'),
})
