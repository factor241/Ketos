/**
 * Display name of one board window. The ladder is: the user's own window name,
 * then the clone a clone window edits, then the chat title the session list
 * reports, then the template label for the window kind. The clone outranks the
 * chat because a clone window stands for its clone: the interview session's
 * generated title must not rename the window that edits the record. The
 * template label is derived at render time from the window's ordinal, so it
 * follows the active locale instead of freezing the locale the window opened in.
 */
import type { BoardWindowRecord } from '@ketos/board-doc/types'
import type { BoardWindowState, WindowKind } from './contract/slots.ts'
import type { BoardTranslate } from './locale.ts'

/** Template label key of one window kind. */
const TEMPLATE_KEYS = {
  agent: 'canvas.agentTitle',
  clone: 'canvas.agentTitle',
  connectors: 'window.kind.connectors',
  settings: 'window.kind.settings',
  dashboard: 'window.kind.dashboard',
  tasks: 'window.kind.tasks',
} as const satisfies Record<WindowKind, Parameters<BoardTranslate>[0]>

/**
 * Resolve the name a window's chrome shows.
 * @param t - locale seat of the board namespace.
 * @param window - the window whose name is resolved.
 * @param sessionTitle - chat title the session list reports, when the window has a chat.
 * @param cloneName - name of the clone the window edits, when it edits one.
 * @returns the user name, the clone name, the chat title, or the localized template label.
 */
export function windowTitle(
  t: BoardTranslate,
  window: BoardWindowState,
  sessionTitle: string | undefined,
  cloneName?: string,
): string {
  const custom = window.customTitle?.trim() ?? ''
  if (custom !== '') return custom
  const clone = cloneName?.trim() ?? ''
  if (clone !== '') return clone
  const chat = sessionTitle?.trim() ?? ''
  if (chat !== '') return chat
  return t(TEMPLATE_KEYS[window.kind], { n: String(window.ordinal) })
}

/**
 * Name a foreign window record renders: the title its host published, or the
 * template label of the record's kind and ordinal in the receiving locale.
 * @param t - locale seat of the board namespace.
 * @param record - the published record.
 * @returns the resolved window name.
 */
export function foreignWindowTitle(
  t: BoardTranslate,
  record: Pick<BoardWindowRecord, 'title' | 'kind' | 'ordinal'>,
): string {
  const published = record.title?.trim() ?? ''
  if (published !== '') return published
  return t(TEMPLATE_KEYS[record.kind], { n: String(record.ordinal) })
}
