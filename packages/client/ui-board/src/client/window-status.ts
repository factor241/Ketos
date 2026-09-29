/**
 * Session status shared by every window surface that reports one: the dock
 * row and the simplified card. One resolver keeps the same session reading the
 * same everywhere.
 */
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BoardWindowSessionState } from './contract/slots.ts'
import type { BoardTranslate } from './locale.ts'

/** Status one dock row or simplified card resolves for its window. */
export type WindowStatus = 'idle' | 'running' | 'ready' | 'error'

/** Dot state per resolved window status. */
export const WINDOW_STATUS_DOT = {
  idle: 'idle',
  running: 'ongoing',
  ready: 'done',
  error: 'error',
} as const satisfies Record<WindowStatus, StateDotState>

/** Locale key per resolved window status. */
export const WINDOW_STATUS_KEY = {
  idle: 'rail.status.pending',
  running: 'rail.status.running',
  ready: 'rail.status.ready',
  error: 'rail.status.error',
} as const satisfies Record<WindowStatus, Parameters<BoardTranslate>[0]>

/**
 * Resolve one window's status from its session channel: a session that does
 * not exist yet or is still restoring reads `idle`, a failed creation, turn, or
 * vanished session reads `error` before a running turn does, and any other
 * ready session reads `ready`.
 * @param session - the window's channel state, or absence when it has none.
 * @returns the status the surface shows.
 */
export function windowStatus(session: BoardWindowSessionState | undefined): WindowStatus {
  if (session === undefined || session.status === 'pending' || session.status === 'restoring') return 'idle'
  if (
    session.status === 'error' || session.status === 'missing'
    || session.turnError !== undefined || session.promptError !== undefined
  ) return 'error'
  if (session.running) return 'running'
  return 'ready'
}
