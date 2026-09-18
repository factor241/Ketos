/**
 * Chat list model of the window's chats panel: the project groups the panel
 * navigates and the chats each group holds. The app sidebar keeps its tree
 * derivation inside its own package, so the board re-derives the handful of
 * rules it needs — membership from the workspace, subagent and archived rows
 * out, the blank session only while it is the window's own chat, and the order
 * the user picked (the workspace's manual order, or newest first).
 */
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId, WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
// The grouping and ordering modes are part of the durable layout contract (the
// settings schema validates them), so they live with the layout schema and are
// re-exported here for the list model's consumers.
import type { BoardPanelGroupBy, BoardPanelOrderBy } from '../../board-settings.ts'

export type { BoardPanelGroupBy, BoardPanelOrderBy } from '../../board-settings.ts'

/** One chat row inside a project. */
export interface BoardChatRow {
  readonly id: SessionId
  readonly title: string
  readonly updatedAt: number
  readonly running: boolean
  readonly blank: boolean
  /** Whether the row is the chat the window currently shows. */
  readonly current: boolean
}

/** One project the panel lists: a workspace folder, or the ungrouped bucket. */
export interface BoardChatGroup {
  /** Workspace the group belongs to; absent for sessions no workspace claims. */
  readonly workspaceId?: WorkspaceId | undefined
  /** Workspace title, or '' when the panel labels the ungrouped bucket itself. */
  readonly label: string
  /** Directory the group's new chats run in. */
  readonly cwd: string
  readonly chats: readonly BoardChatRow[]
}

interface ChatGroupOptions {
  readonly windowSessionId: SessionId | undefined
  readonly groupBy: BoardPanelGroupBy
  readonly orderBy: BoardPanelOrderBy
}

/** Folder name of a path, or the path itself when it has no separator. */
function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(part => part !== '')
  return parts[parts.length - 1] ?? path
}

/** The rows one listed id set holds, in the requested order. */
function rowsOf(
  sessionIds: readonly SessionId[],
  sessions: SessionListState,
  archived: ReadonlySet<string>,
  options: ChatGroupOptions,
): readonly BoardChatRow[] {
  const rows: BoardChatRow[] = []
  for (const id of sessionIds) {
    const summary: SessionSummary | undefined = sessions.byId[id]
    if (summary === undefined) continue
    if (summary.origin === 'subagent' || archived.has(summary.id)) continue
    // The shared empty session stays visible only for the window that shows it.
    if (summary.blank && summary.id !== options.windowSessionId) continue
    rows.push({
      id: summary.id,
      title: summary.displayTitle,
      updatedAt: summary.updatedAt,
      running: summary.running,
      blank: summary.blank,
      current: summary.id === options.windowSessionId,
    })
  }
  return options.orderBy === 'updated'
    ? [...rows].sort((left, right) => right.updatedAt - left.updatedAt)
    : rows
}

/** Newest arrival order, used when the list is flat. */
function flatIds(sessions: SessionListState): readonly SessionId[] {
  return [...sessions.ids].sort((left, right) => (sessions.byId[right]?.updatedAt ?? 0) - (sessions.byId[left]?.updatedAt ?? 0))
}

/**
 * The projects the panel lists: every workspace that holds a visible chat, then
 * the ungrouped bucket for sessions no workspace claims. In the flat mode the
 * groups are one unlabelled bucket holding every visible chat.
 * @param workspaces - workspace list snapshot.
 * @param sessions - session list snapshot.
 * @param options - the window's own chat and the user's view choice.
 * @returns the groups, in workspace order with the ungrouped bucket last.
 */
export function chatGroups(
  workspaces: WorkspaceSnapshot,
  sessions: SessionListState,
  options: ChatGroupOptions,
): readonly BoardChatGroup[] {
  const archived = new Set<string>(workspaces.archivedSessionIds)
  if (options.groupBy === 'flat') {
    const ids = flatIds(sessions).filter(id => !archived.has(id))
    const chats = rowsOf(ids, sessions, archived, options)
    return chats.length === 0 ? [] : [{ label: '', cwd: '', chats }]
  }
  const claimed = new Set<string>()
  const groups: BoardChatGroup[] = []
  for (const workspace of workspaces.items) {
    const chats = rowsOf(workspace.sessionIds, sessions, archived, options)
    for (const chat of chats) claimed.add(chat.id)
    if (chats.length === 0) continue
    groups.push({
      workspaceId: workspace.workspaceId,
      label: workspace.title === '' ? folderName(workspace.path) : workspace.title,
      cwd: workspace.path,
      chats,
    })
  }
  const loose = sessions.ids.filter(id => !claimed.has(id) && !archived.has(id))
  const ungrouped = rowsOf(loose, sessions, archived, options)
  if (ungrouped.length > 0) {
    const anchor = options.windowSessionId ?? loose[0]
    groups.push({
      label: '',
      cwd: anchor === undefined ? '' : sessions.byId[anchor]?.cwd ?? '',
      chats: ungrouped,
    })
  }
  return groups
}

/**
 * Whether one chat row matches a search query, by title or directory.
 * @param row - the chat row.
 * @param cwd - the directory the row's group runs in.
 * @param query - the trimmed, lower-cased query.
 * @returns true when the row should stay visible.
 */
export function chatMatches(row: BoardChatRow, cwd: string, query: string): boolean {
  if (query === '') return true
  return row.title.toLowerCase().includes(query) || cwd.toLowerCase().includes(query)
}

/**
 * The groups a local query keeps, dropping groups that end up empty.
 * @param groups - the groups to filter.
 * @param query - the raw query; blank keeps everything.
 * @returns the filtered groups.
 */
export function filterGroups(groups: readonly BoardChatGroup[], query: string): readonly BoardChatGroup[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return groups
  return groups
    .map(group => ({ ...group, chats: group.chats.filter(row => chatMatches(row, group.cwd, needle)) }))
    .filter(group => group.chats.length > 0)
}

/**
 * The chat that precedes a moved one in a list, for the move-before calls.
 * @param ids - the manual order the list currently shows.
 * @param moved - the id being moved.
 * @param delta - -1 moves one step up, +1 one step down.
 * @returns the anchor to insert before, or undefined to append.
 */
export function moveAnchor<Id extends string>(
  ids: readonly Id[],
  moved: Id,
  delta: -1 | 1,
): Id | undefined {
  const index = ids.indexOf(moved)
  if (index < 0) return undefined
  const target = index + delta
  if (target < 0) return ids[0]
  if (target >= ids.length) return undefined
  return delta === 1 ? ids[target + 1] : ids[target]
}
