/**
 * Board layout document: capture the live store into the wire document and
 * repair a document read from the settings namespace or the first-frame cache.
 * The repair is lenient — one broken window drops that window — while a
 * document whose version is unknown is ignored whole.
 */
import {
  BOARD_LAYOUT_COORD_LIMIT, BOARD_LAYOUT_MAX_WINDOWS, BOARD_PANEL_GROUP_BYS, BOARD_PANEL_ORDER_BYS,
  BOARD_SETTINGS_VERSION, BOARD_WINDOW_BODY_KINDS, BOARD_WINDOW_KINDS, BOARD_ZOOM_MAX, BOARD_ZOOM_MIN,
  BoardSettingsSchema, PANEL_DEFAULT_WIDTH, PANEL_MAX_WIDTH, PANEL_MIN_WIDTH,
  type BoardLayoutDocument, type BoardLayoutWindow,
} from '../board-settings.ts'
import type { WindowId } from './contract/slots.ts'
import { MIN_WINDOW_SIZE, WINDOW_Z_BASE, WINDOW_Z_MAX, type BoardState } from './store.ts'

/** Whether a wire value is a plain JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A finite number from the document, or the fallback. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** A finite number clamped into the restore range. */
function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, finite(value, fallback)))
}

/** One of the allowed string literals, or undefined. */
function memberOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? value as T
    : undefined
}

/** A non-empty identity string, or undefined. */
function identity(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Repair one stored window; a missing identity, kind, or body kind drops it. */
function sanitizeWindow(raw: unknown): BoardLayoutWindow | undefined {
  if (!isRecord(raw)) return undefined
  const id = identity(raw.id)
  const kind = memberOf(raw.kind, BOARD_WINDOW_KINDS)
  const bodyKind = memberOf(raw.bodyKind, BOARD_WINDOW_BODY_KINDS)
  if (id === undefined || kind === undefined || bodyKind === undefined) return undefined
  const title = typeof raw.customTitle === 'string' ? raw.customTitle.trim() : ''
  return {
    id,
    kind,
    bodyKind,
    ordinal: Math.max(1, Math.trunc(finite(raw.ordinal, 1))),
    ...(title === '' ? {} : { customTitle: title }),
    x: bounded(raw.x, 0, -BOARD_LAYOUT_COORD_LIMIT, BOARD_LAYOUT_COORD_LIMIT),
    y: bounded(raw.y, 0, -BOARD_LAYOUT_COORD_LIMIT, BOARD_LAYOUT_COORD_LIMIT),
    // A negative size is a corrupted value, not an orientation: repair it to
    // its magnitude, then to the smallest window the composer can lay out.
    width: Math.min(BOARD_LAYOUT_COORD_LIMIT, Math.max(MIN_WINDOW_SIZE.width, Math.abs(finite(raw.width, MIN_WINDOW_SIZE.width)))),
    height: Math.min(BOARD_LAYOUT_COORD_LIMIT, Math.max(MIN_WINDOW_SIZE.height, Math.abs(finite(raw.height, MIN_WINDOW_SIZE.height)))),
    zIndex: WINDOW_Z_BASE,
  }
}

/**
 * Capture the store's layout as the stored document; the session bridge keeps
 * session identity. Only the topmost {@link BOARD_LAYOUT_MAX_WINDOWS} windows
 * are captured, matching what the schema and the restore keep, so an overfull
 * board still persists.
 * @param state - the board store snapshot to capture.
 * @returns the complete wire document for the durable layout.
 */
export function captureBoardLayout(state: BoardState): BoardLayoutDocument {
  const order: WindowId[] = []
  const windows: BoardLayoutWindow[] = []
  for (const id of state.windowOrder.slice(-BOARD_LAYOUT_MAX_WINDOWS)) {
    const window = state.windows[id as string]
    if (window === undefined) continue
    order.push(id)
    windows.push({
      id: window.id,
      kind: window.kind,
      bodyKind: window.bodyKind,
      ordinal: window.ordinal,
      ...(window.customTitle === undefined ? {} : { customTitle: window.customTitle }),
      x: window.x,
      y: window.y,
      width: window.width,
      height: window.height,
      zIndex: window.zIndex,
    })
  }
  const kept = new Set(order)
  return {
    version: BOARD_SETTINGS_VERSION,
    panX: state.panX,
    panY: state.panY,
    zoom: state.zoom,
    windows,
    windowOrder: order,
    activeWindowId: state.activeWindowId !== null && kept.has(state.activeWindowId) ? state.activeWindowId : '',
    panelWindowId: state.panelWindowId !== null && kept.has(state.panelWindowId) ? state.panelWindowId : '',
    panelCollapsed: state.panelCollapsed,
    panelWidth: state.panelWidth,
    panelGroupBy: state.panelGroupBy,
    panelOrderBy: state.panelOrderBy,
  }
}

/**
 * Repair one stored layout: drop windows of unknown kind or body kind, drop
 * duplicate identities, repair sizes and out-of-range numbers, renormalize the
 * paint order, and bound the restore. A document of another version is
 * ignored whole, and the repaired candidate must still satisfy the settings
 * schema before the board adopts it.
 * @param raw - the wire value read from settings or the first-frame cache.
 * @returns the repaired document, or undefined when the value cannot be adopted.
 */
export function sanitizeBoardLayout(raw: unknown): BoardLayoutDocument | undefined {
  if (!isRecord(raw)) return undefined
  if (raw.version !== BOARD_SETTINGS_VERSION) {
    console.warn(`ui-board: ignoring a stored layout of version ${String(raw.version)}`)
    return undefined
  }
  const byId = new Map<string, BoardLayoutWindow>()
  if (Array.isArray(raw.windows)) {
    for (const candidate of raw.windows) {
      const window = sanitizeWindow(candidate)
      if (window !== undefined && !byId.has(window.id)) byId.set(window.id, window)
    }
  }
  const requested = Array.isArray(raw.windowOrder)
    ? raw.windowOrder.filter((id): id is string => typeof id === 'string')
    : []
  const order: string[] = []
  const seen = new Set<string>()
  for (const id of [...requested, ...byId.keys()]) {
    if (byId.has(id) && !seen.has(id)) {
      seen.add(id)
      order.push(id)
    }
  }
  // An overfull document keeps its topmost windows: the stack order is the
  // record of what the user worked with most recently.
  const windowOrder = order.slice(-BOARD_LAYOUT_MAX_WINDOWS)
  const kept = new Set(windowOrder)
  const windows = windowOrder.map((id, index) => ({
    ...byId.get(id) as BoardLayoutWindow,
    zIndex: Math.min(WINDOW_Z_BASE + index, WINDOW_Z_MAX),
  }))
  const active = identity(raw.activeWindowId)
  const panel = identity(raw.panelWindowId)
  const panelWindowId = panel !== undefined && kept.has(panel) ? panel : undefined
  const candidate: BoardLayoutDocument = {
    version: BOARD_SETTINGS_VERSION,
    panX: bounded(raw.panX, 0, -BOARD_LAYOUT_COORD_LIMIT, BOARD_LAYOUT_COORD_LIMIT),
    panY: bounded(raw.panY, 0, -BOARD_LAYOUT_COORD_LIMIT, BOARD_LAYOUT_COORD_LIMIT),
    zoom: bounded(raw.zoom, 1, BOARD_ZOOM_MIN, BOARD_ZOOM_MAX),
    windows,
    windowOrder,
    activeWindowId: active !== undefined && kept.has(active) ? active : '',
    // A collapsed panel without an owner window is indistinguishable from a
    // closed one (both are the initial state), so hydration reads it as closed.
    panelWindowId: panelWindowId ?? '',
    panelCollapsed: panelWindowId === undefined ? true : raw.panelCollapsed === true,
    panelWidth: bounded(raw.panelWidth, PANEL_DEFAULT_WIDTH, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH),
    panelGroupBy: memberOf(raw.panelGroupBy, BOARD_PANEL_GROUP_BYS) ?? 'workspace',
    panelOrderBy: memberOf(raw.panelOrderBy, BOARD_PANEL_ORDER_BYS) ?? 'updated',
  }
  try {
    return BoardSettingsSchema(candidate)
  } catch (error) {
    console.warn('ui-board: ignoring a stored layout the settings schema rejects', error)
    return undefined
  }
}
