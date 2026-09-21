/** Clone records and session bindings: CRUD, revision CAS, and durable decoding. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../src/db.ts'
import { CloneConflictError, CloneNotFoundError, CloneRepository } from '../src/repository.ts'
import type { CloneId } from '../src/types.ts'

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

/** Repository over a fresh in-memory database the test owns. */
async function fixture(): Promise<CloneRepository> {
  const db = await openDatabase(':memory:')
  cleanups.push(() => { db.close() })
  return new CloneRepository(db)
}

const MINIMAL = { name: 'Анна', role: 'Аналитик' } as const

/** The ISO-8601 UTC form every stored timestamp carries. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** Branded session identity as the host route decodes it. */
const sid = (value: string): SessionId => brandString<SessionId>(value)

describe('clone records', () => {
  it('creates a clone at revision 1 with stored defaults and ISO UTC timestamps', async () => {
    const repository = await fixture()
    const before = Date.now()
    const clone = repository.createClone(MINIMAL)
    expect(clone).toMatchObject({
      name: 'Анна',
      role: 'Аналитик',
      description: '',
      persona: '',
      methodology: '',
      preferredModel: null,
      skills: [],
      status: 'draft',
      revision: 1,
    })
    expect(clone.createdAt).toMatch(ISO_UTC)
    expect(Date.parse(clone.createdAt)).toBeGreaterThanOrEqual(before)
    expect(Date.parse(clone.createdAt)).toBeLessThanOrEqual(Date.now())
    expect(clone.createdAt).toBe(clone.updatedAt)
    expect(repository.getClone(clone.id)).toEqual(clone)
  })

  it('stores every supplied field and lists clones newest first', async () => {
    const repository = await fixture()
    const first = repository.createClone(MINIMAL)
    const second = repository.createClone({
      name: 'Борис',
      role: 'Юрист',
      description: 'Договорная работа',
      persona: 'Педантичный',
      methodology: 'Сначала факты',
      preferredModel: 'deepseek-chat',
      skills: ['договоры'],
      status: 'active',
    })
    expect(second).toMatchObject({
      description: 'Договорная работа',
      persona: 'Педантичный',
      methodology: 'Сначала факты',
      preferredModel: 'deepseek-chat',
      skills: ['договоры'],
      status: 'active',
    })
    expect(repository.listClones().map(clone => clone.id)).toEqual([second.id, first.id])
    expect(repository.getClone('missing' as CloneId)).toBeUndefined()
  })

  it('applies an update patch, bumps the revision, and moves updatedAt', async () => {
    const repository = await fixture()
    const clone = repository.createClone(MINIMAL)
    const updated = repository.updateClone(clone.id, { name: 'Анна П.', status: 'active', preferredModel: null }, 1)
    expect(updated).toMatchObject({ name: 'Анна П.', role: 'Аналитик', status: 'active', revision: 2 })
    expect(updated.createdAt).toBe(clone.createdAt)
    expect(updated.updatedAt).toMatch(ISO_UTC)
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(clone.updatedAt))
    expect(repository.getClone(clone.id)).toEqual(updated)
  })

  it('refuses a stale revision and a patch that selects no field', async () => {
    const repository = await fixture()
    const clone = repository.createClone(MINIMAL)
    repository.updateClone(clone.id, { name: 'Анна II' }, 1)
    const conflict = (() => { try { return repository.updateClone(clone.id, { name: 'Анна III' }, 1) } catch (error: unknown) { return error } })()
    expect(conflict).toBeInstanceOf(CloneConflictError)
    expect((conflict as CloneConflictError).code).toBe('ketos/clone-conflict')
    expect(repository.getClone(clone.id)?.name).toBe('Анна II')
    expect(() => repository.updateClone(clone.id, {}, 2)).toThrow(/selects no field/u)
    expect(() => repository.updateClone('missing' as CloneId, { name: 'X' }, 1)).toThrow(CloneNotFoundError)
  })

  it('deletes a clone and its session bindings, refusing a stale revision', async () => {
    const repository = await fixture()
    const clone = repository.createClone(MINIMAL)
    repository.bindSession({ cloneId: clone.id, sessionId: sid('session-1') })
    expect(() => repository.deleteClone(clone.id, 9)).toThrow(CloneConflictError)
    expect(repository.getClone(clone.id)).toBeDefined()
    repository.updateClone(clone.id, { status: 'archived' }, 1)
    expect(repository.deleteClone(clone.id, 2)).toBe(clone.id)
    expect(repository.getClone(clone.id)).toBeUndefined()
    expect(repository.listSessions(clone.id)).toEqual([])
    expect(() => repository.deleteClone(clone.id, 2)).toThrow(CloneNotFoundError)
  })
})

describe('clone session bindings', () => {
  it('binds sessions with the main role by default and lists them newest first', async () => {
    const repository = await fixture()
    const clone = repository.createClone(MINIMAL)
    const first = repository.bindSession({ cloneId: clone.id, sessionId: sid('session-1') })
    const second = repository.bindSession({ cloneId: clone.id, sessionId: sid('session-2'), role: 'interview' })
    expect(first).toMatchObject({ sessionId: sid('session-1'), cloneId: clone.id, role: 'main' })
    expect(second.role).toBe('interview')
    expect(repository.listSessions(clone.id).map(binding => binding.sessionId)).toEqual(['session-2', 'session-1'])
  })

  it('replaces the binding of a session and refuses an unknown clone', async () => {
    const repository = await fixture()
    const first = repository.createClone(MINIMAL)
    const second = repository.createClone({ name: 'Борис', role: 'Юрист' })
    repository.bindSession({ cloneId: first.id, sessionId: sid('session-1') })
    repository.bindSession({ cloneId: second.id, sessionId: sid('session-1'), role: 'task' })
    expect(repository.listSessions(first.id)).toEqual([])
    expect(repository.listSessions(second.id)).toMatchObject([{ sessionId: sid('session-1'), role: 'task' }])
    expect(() => repository.bindSession({ cloneId: 'missing' as CloneId, sessionId: sid('session-2') })).toThrow(CloneNotFoundError)
    expect(repository.listSessions('missing' as CloneId)).toEqual([])
  })
})

describe('durable decoding', () => {
  it('refuses a hand-edited status or skills document instead of surfacing it', async () => {
    const db = await openDatabase(':memory:')
    cleanups.push(() => { db.close() })
    const repository = new CloneRepository(db)
    const clone = repository.createClone(MINIMAL)
    db.prepare('UPDATE clones SET status = ? WHERE id = ?').run('broken', clone.id)
    expect(() => repository.getClone(clone.id)).toThrow(/unknown status/u)
    db.prepare('UPDATE clones SET status = ?, skills_json = ? WHERE id = ?').run('draft', '{"a":1}', clone.id)
    expect(() => repository.getClone(clone.id)).toThrow(/array of strings/u)
    db.prepare('UPDATE clones SET skills_json = ? WHERE id = ?').run('not json', clone.id)
    expect(() => repository.getClone(clone.id)).toThrow()
  })
})
