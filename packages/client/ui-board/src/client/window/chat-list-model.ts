/**
 * Chat list model of the window's chats panel: the project groups the panel
 * navigates and the chats each group holds. The app sidebar keeps its tree
 * derivation inside its own package, so the board re-derives the handful of
 * rules it needs — membership from the workspace, subagent and archived rows
 * out, the blank session only while it is the window's own chat, newest first.
 */
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId, WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'

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

/** Folder name of a path, or the path itself when it has no separator. */
function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(part => part !== '')
  return parts[parts.length - 1] ?? path
}

/** The rows one set of session ids holds, newest first. */
function rowsOf(
  sessionIds: readonly SessionId[],
  sessions: SessionListState,
  archived: ReadonlySet<string>,
  windowSessionId: SessionId | undefined,
): readonly BoardChatRow[] {
  const rows: BoardChatRow[] = []
  for (const id of sessionIds) {
    const summary: SessionSummary | undefined = sessions.byId[id]
    if (summary === undefined) continue
    if (summary.origin === 'subagent' || archived.has(summary.id)) continue
    // The shared empty session stays visible only for the window that shows it.
    if (summary.blank && summary.id !== windowSessionId) continue
    rows.push({
      id: summary.id,
      title: summary.displayTitle,
      updatedAt: summary.updatedAt,
      running: summary.running,
      blank: summary.blank,
      current: summary.id === windowSessionId,
    })
  }
  return rows.sort((left, right) => right.updatedAt - left.updatedAt)
}

/**
 * The projects the panel lists: every workspace that holds a visible chat, then
 * the ungrouped bucket for sessions no workspace claims. Groups without rows
 * are absent, so the panel never shows an empty project.
 * @param workspaces - workspace list snapshot.
 * @param sessions - session list snapshot.
 * @param windowSessionId - the chat the window shows, kept visible while blank.
 * @returns the groups, in workspace order with the ungrouped bucket last.
 */
export function chatGroups(
  workspaces: WorkspaceSnapshot,
  sessions: SessionListState,
  windowSessionId: SessionId | undefined,
): readonly BoardChatGroup[] {
  const archived = new Set<string>(workspaces.archivedSessionIds)
  const claimed = new Set<string>()
  const groups: BoardChatGroup[] = []
  for (const workspace of workspaces.items) {
    const chats = rowsOf(workspace.sessionIds, sessions, archived, windowSessionId)
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
  const ungrouped = rowsOf(loose, sessions, archived, windowSessionId)
  if (ungrouped.length > 0) {
    const anchor = windowSessionId ?? loose[0]
    groups.push({
      label: '',
      cwd: anchor === undefined ? '' : sessions.byId[anchor]?.cwd ?? '',
      chats: ungrouped,
    })
  }
  return groups
}
