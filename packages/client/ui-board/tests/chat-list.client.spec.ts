/**
 * Chat list model of the chats panel: workspace groups with the ungrouped
 * bucket last, subagent and archived rows out, the blank session only for the
 * window that shows it, the chosen order inside every group, the flat view, the
 * local search filter, and the move anchors the reorder actions use.
 */
import { describe, expect, it } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  chatGroups, chatMatches, filterGroups, moveAnchor,
} from '../src/client/chat-list-model.ts'

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

/** The grouped, newest-first view the panel defaults to. */
function grouped(snapshot: WorkspaceSnapshot, sessions: SessionListState, windowSessionId?: SessionId) {
  return chatGroups(snapshot, sessions, { windowSessionId, groupBy: 'workspace', orderBy: 'updated' })
}

describe('chatGroups', () => {
  it('groups sessions under their workspace and keeps the ungrouped bucket last', () => {
    const groups = grouped(workspaces([workspace('ws-1', '/work/ketos', ['a', 'b'])]), list([row('a'), row('b'), row('c')]))
    expect(groups.map(group => group.workspaceId)).toEqual(['ws-1', undefined])
    expect(groups[0]?.label).toBe('ketos')
    expect(groups[0]?.chats.map(chat => chat.id)).toEqual(['a', 'b'])
    expect(groups[1]?.chats.map(chat => chat.id)).toEqual(['c'])
  })

  it('lists registered workspaces without chats and uses their title', () => {
    const groups = grouped(
      workspaces([workspace('ws-1', '/work/ketos', [], 'Ketos bot'), workspace('ws-2', '/work/other', [])]),
      list([row('a')]),
    )
    expect(groups.map(group => group.workspaceId)).toEqual(['ws-1', 'ws-2', undefined])
    expect(groups[0]?.label).toBe('Ketos bot')
    expect(groups[0]?.chats).toEqual([])
    expect(groups[1]?.label).toBe('other')
  })

  it('leaves out subagent and archived rows', () => {
    const groups = grouped(
      workspaces([], ['b' as SessionId]),
      list([row('a'), row('b'), row('c', { origin: 'subagent' })]),
    )
    expect(groups[0]?.chats.map(chat => chat.id)).toEqual(['a'])
  })

  it('shows the blank session only for the window that has it, newest first', () => {
    const rows = [row('blank', { blank: true, updatedAt: 9 }), row('a', { updatedAt: 2 }), row('b', { updatedAt: 5 })]
    expect(grouped(workspaces([]), list(rows))[0]?.chats.map(chat => chat.id)).toEqual(['b', 'a'])

    const withWindow = grouped(workspaces([]), list(rows), 'blank' as SessionId)
    expect(withWindow[0]?.chats.map(chat => chat.id)).toEqual(['blank', 'b', 'a'])
    expect(withWindow[0]?.chats[0]?.current).toBe(true)
  })

  it('keeps the manual order when that is the chosen order', () => {
    const rows = [row('a', { updatedAt: 2 }), row('b', { updatedAt: 5 })]
    const manual = chatGroups(workspaces([workspace('ws-1', '/work/ketos', ['b', 'a'])]), list(rows), {
      windowSessionId: undefined,
      groupBy: 'workspace',
      orderBy: 'manual',
    })
    expect(manual[0]?.chats.map(chat => chat.id)).toEqual(['b', 'a'])
  })

  it('lists every visible chat in one bucket in the flat view', () => {
    const flat = chatGroups(
      workspaces([workspace('ws-1', '/work/ketos', ['a'])]),
      list([row('a'), row('b', { updatedAt: 7 })]),
      { windowSessionId: undefined, groupBy: 'flat', orderBy: 'updated' },
    )
    expect(flat).toHaveLength(1)
    expect(flat[0]?.workspaceId).toBeUndefined()
    expect(flat[0]?.chats.map(chat => chat.id)).toEqual(['b', 'a'])
  })

  it('marks the running chat and carries the directory the ungrouped bucket creates in', () => {
    const groups = grouped(
      workspaces([], []),
      list([row('a', { running: true, cwd: '/work/ketos' })]),
      'a' as SessionId,
    )
    expect(groups[0]?.chats[0]?.running).toBe(true)
    expect(groups[0]?.cwd).toBe('/work/ketos')
  })

  it('anchors the ungrouped bucket on its own rows when a workspace claims the window session', () => {
    const groups = grouped(
      workspaces([workspace('ws-1', '/work/ketos', ['w'])]),
      list([row('w', { cwd: '/work/ketos' }), row('x', { cwd: '/work/other' })]),
      'w' as SessionId,
    )
    const ungrouped = groups.find(group => group.workspaceId === undefined)
    expect(ungrouped?.chats.map(chat => chat.id)).toEqual(['x'])
    expect(ungrouped?.cwd).toBe('/work/other')
  })
})

describe('filterGroups', () => {
  it('keeps matching rows by title or directory and drops empty groups', () => {
    const groups = grouped(
      workspaces([workspace('ws-1', '/work/ketos', ['a'])]),
      list([row('a', { displayTitle: 'Alpha' }), row('b', { displayTitle: 'Beta', cwd: '/work/ketos' })]),
    )
    expect(filterGroups(groups, 'alp')[0]?.chats.map(chat => chat.id)).toEqual(['a'])
    // The directory of either group matches too, across both groups.
    expect(filterGroups(groups, 'ketos').flatMap(group => group.chats.map(chat => chat.id))).toEqual(['a', 'b'])
    expect(filterGroups(groups, 'nothing')).toHaveLength(0)
  })

  it('keeps a chatless workspace whose directory matches the query', () => {
    const groups = grouped(
      workspaces([workspace('ws-1', '/work/ketos', [])]),
      list([row('a', { cwd: '/work/other' })]),
    )
    const filtered = filterGroups(groups, 'ketos')
    expect(filtered.map(group => group.workspaceId)).toEqual(['ws-1'])
    expect(filtered[0]?.chats).toEqual([])
    expect(filterGroups(groups, 'nothing')).toHaveLength(0)
  })

  it('matches on a blank query and lower-cased titles', () => {
    const chat = { id: 'a' as SessionId, title: 'Alpha', updatedAt: 1, running: false, blank: false, current: false }
    expect(chatMatches(chat, '/work/ketos', '')).toBe(true)
    expect(chatMatches(chat, '/work/ketos', 'alpha')).toBe(true)
    expect(chatMatches(chat, '/work/ketos', 'beta')).toBe(false)
  })
})

describe('moveAnchor', () => {
  const ids = ['a', 'b', 'c'] as unknown as readonly SessionId[]

  it('anchors one step in either direction', () => {
    expect(moveAnchor(ids, 'b' as SessionId, -1)).toBe('a')
    // Moving down from the middle anchors before the row after the target.
    expect(moveAnchor(['a', 'b', 'c', 'd'] as unknown as readonly SessionId[], 'b' as SessionId, 1)).toBe('d')
  })

  it('stays put at the top and appends at the bottom', () => {
    expect(moveAnchor(ids, 'a' as SessionId, -1)).toBe('a')
    expect(moveAnchor(ids, 'c' as SessionId, 1)).toBeUndefined()
  })
})
