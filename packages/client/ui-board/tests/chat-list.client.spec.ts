/**
 * Chat list model of the chats panel: workspace groups with the ungrouped
 * bucket last, subagent and archived rows out, the blank session only for the
 * window that shows it, and newest first inside every group.
 */
import { describe, expect, it } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId, WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { chatGroups } from '../src/client/window/chat-list-model.ts'

/** One list row with the fields the panel reads. */
function row(id: string, fields: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: id as SessionId,
    displayTitle: id,
    running: false,
    blank: false,
    updatedAt: 1,
    ...fields,
  }
}

/** A session list snapshot over the given rows, in the order given. */
function list(rows: readonly SessionSummary[]): SessionListState {
  const byId: Record<string, SessionSummary> = {}
  for (const summary of rows) byId[summary.id] = summary
  return {
    ids: rows.map(summary => summary.id),
    byId,
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

/** A workspace snapshot over the given views. */
function workspaces(items: readonly WorkspaceView[], archived: readonly SessionId[] = []): WorkspaceSnapshot {
  return { items, archivedSessionIds: archived, state: 'idle', phase: 'ready', error: null }
}

/** One workspace view with the fields the panel reads. */
function workspace(id: string, path: string, sessionIds: readonly string[], title = ''): WorkspaceView {
  return {
    workspaceId: id as WorkspaceId,
    path,
    title,
    sessionIds: sessionIds.map(sessionId => sessionId as SessionId),
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
  }
}

describe('chatGroups', () => {
  it('groups sessions under their workspace and keeps the ungrouped bucket last', () => {
    const groups = chatGroups(
      workspaces([workspace('ws-1', '/work/ketos', ['a', 'b'])]),
      list([row('a'), row('b'), row('c')]),
      undefined,
    )
    expect(groups.map(group => group.workspaceId)).toEqual(['ws-1', undefined])
    expect(groups[0]?.label).toBe('ketos')
    expect(groups[0]?.chats.map(chat => chat.id)).toEqual(['a', 'b'])
    expect(groups[1]?.chats.map(chat => chat.id)).toEqual(['c'])
    expect(groups[1]?.cwd).toBe('')
  })

  it('uses the workspace title when it has one and skips empty groups', () => {
    const groups = chatGroups(
      workspaces([workspace('ws-1', '/work/ketos', [], 'Ketos bot'), workspace('ws-2', '/work/other', [])]),
      list([row('a')]),
      undefined,
    )
    expect(groups.map(group => group.workspaceId)).toEqual([undefined])
  })

  it('leaves out subagent and archived rows', () => {
    const groups = chatGroups(
      workspaces([], ['b' as SessionId]),
      list([row('a'), row('b'), row('c', { origin: 'subagent' })]),
      undefined,
    )
    expect(groups[0]?.chats.map(chat => chat.id)).toEqual(['a'])
  })

  it('shows the blank session only for the window that has it, newest first', () => {
    const rows = [row('blank', { blank: true, updatedAt: 9 }), row('a', { updatedAt: 2 }), row('b', { updatedAt: 5 })]
    const withoutWindow = chatGroups(workspaces([]), list(rows), undefined)
    expect(withoutWindow[0]?.chats.map(chat => chat.id)).toEqual(['b', 'a'])

    const withWindow = chatGroups(workspaces([]), list(rows), 'blank' as SessionId)
    expect(withWindow[0]?.chats.map(chat => chat.id)).toEqual(['blank', 'b', 'a'])
    expect(withWindow[0]?.chats[0]?.current).toBe(true)
  })

  it('marks the running chat and carries the directory the ungrouped bucket creates in', () => {
    const groups = chatGroups(
      workspaces([], []),
      list([row('a', { running: true, cwd: '/work/ketos' })]),
      'a' as SessionId,
    )
    expect(groups[0]?.chats[0]?.running).toBe(true)
    expect(groups[0]?.cwd).toBe('/work/ketos')
  })
})
