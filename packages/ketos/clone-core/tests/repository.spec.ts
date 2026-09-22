/** Clone records and session bindings: CRUD, revision CAS, and durable decoding. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../src/db.ts'
import {
  CloneConflictError, CloneNotFoundError, CloneNotInterviewingError, CloneRepository, CloneSessionNotBoundError,
  CLONE_TEXT_LIMITS,
} from '../src/repository.ts'
import type { CloneId, CloneSkill } from '../src/types.ts'

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

/** One stored skill with a description unless the test says otherwise. */
const skill = (name: string, description = '', instructions = ''): CloneSkill => ({ name, description, instructions })

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
      skills: [skill('dogovory', 'Договорная работа')],
      status: 'ready',
    })
    expect(second).toMatchObject({
      description: 'Договорная работа',
      persona: 'Педантичный',
      methodology: 'Сначала факты',
      preferredModel: 'deepseek-chat',
      skills: [skill('dogovory', 'Договорная работа')],
      status: 'ready',
    })
    expect(repository.listClones().map(clone => clone.id)).toEqual([second.id, first.id])
    expect(repository.getClone('missing' as CloneId)).toBeUndefined()
  })

  it('applies an update patch, bumps the revision, and moves updatedAt', async () => {
    const repository = await fixture()
    const clone = repository.createClone(MINIMAL)
    const updated = repository.updateClone(clone.id, { name: 'Анна П.', status: 'interviewing', preferredModel: null }, 1)
    expect(updated).toMatchObject({ name: 'Анна П.', role: 'Аналитик', status: 'interviewing', revision: 2 })
    expect(updated.createdAt).toBe(clone.createdAt)
    expect(updated.updatedAt).toMatch(ISO_UTC)
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(clone.updatedAt))
    expect(repository.getClone(clone.id)).toEqual(updated)
  })

  it('round-trips skill objects through create and update', async () => {
    const repository = await fixture()
    const clone = repository.createClone({
      ...MINIMAL,
      skills: [skill('sql', 'Запросы к базе', 'Пиши SELECT по схеме')],
    })
    expect(clone.skills).toEqual([skill('sql', 'Запросы к базе', 'Пиши SELECT по схеме')])
    const updated = repository.updateClone(clone.id, {
      skills: [skill('dogovory', 'Договорная работа'), skill('analiz', 'Разбор требований', 'Сначала факты')],
    }, 1)
    expect(updated.skills).toEqual([
      skill('dogovory', 'Договорная работа'),
      skill('analiz', 'Разбор требований', 'Сначала факты'),
    ])
    expect(repository.getClone(clone.id)?.skills).toEqual(updated.skills)
  })

  it('bumps the revision on a skills-only patch', async () => {
    const repository = await fixture()
    const clone = repository.createClone({ ...MINIMAL, skills: [skill('sql', 'Запросы')] })
    const updated = repository.updateClone(clone.id, { skills: [skill('sql', 'Другие запросы')] }, 1)
    expect(updated.revision).toBe(2)
    expect(updated.skills).toEqual([skill('sql', 'Другие запросы')])
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
    repository.updateClone(clone.id, { status: 'ready' }, 1)
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
    repository.bindSession({ cloneId: second.id, sessionId: sid('session-1'), role: 'interview' })
    expect(repository.listSessions(first.id)).toEqual([])
    expect(repository.listSessions(second.id)).toMatchObject([{ sessionId: sid('session-1'), role: 'interview' }])
    expect(() => repository.bindSession({ cloneId: 'missing' as CloneId, sessionId: sid('session-2') })).toThrow(CloneNotFoundError)
    expect(repository.listSessions('missing' as CloneId)).toEqual([])
  })
})

describe('interview drafts', () => {
  it('finds the clone of a bound session and nothing for an unbound one', async () => {
    const repository = await fixture()
    const clone = repository.createClone(MINIMAL)
    repository.bindSession({ cloneId: clone.id, sessionId: sid('session-1'), role: 'interview' })
    expect(repository.bindingFor(sid('session-1'))).toMatchObject({ cloneId: clone.id, role: 'interview' })
    expect(repository.bindingFor(sid('session-2'))).toBeUndefined()
  })

  it('writes the authored profile of the bound clone and marks it ready', async () => {
    const repository = await fixture()
    const clone = repository.createClone(MINIMAL)
    repository.updateClone(clone.id, { status: 'interviewing' }, 1)
    repository.bindSession({ cloneId: clone.id, sessionId: sid('session-1'), role: 'interview' })
    const saved = repository.saveDraft(sid('session-1'), {
      role: 'Старший аналитик',
      description: 'Разбирает требования',
      persona: 'Спокойная и точная',
      methodology: 'Сначала факты, потом гипотезы',
      skills: [skill('analiz', 'Разбор требований'), skill('intervyu', 'Интервью')],
    })
    expect(saved).toMatchObject({
      id: clone.id,
      role: 'Старший аналитик',
      description: 'Разбирает требования',
      persona: 'Спокойная и точная',
      methodology: 'Сначала факты, потом гипотезы',
      skills: [skill('analiz', 'Разбор требований'), skill('intervyu', 'Интервью')],
      status: 'ready',
      revision: 3,
    })
    expect(repository.getClone(clone.id)).toEqual(saved)
  })

  it('merges the draft skills over the stored list by name', async () => {
    const repository = await fixture()
    const clone = repository.createClone({
      ...MINIMAL,
      skills: [skill('sql', 'Старое описание'), skill('otchety', 'Отчёты')],
    })
    repository.updateClone(clone.id, { status: 'interviewing' }, 1)
    repository.bindSession({ cloneId: clone.id, sessionId: sid('session-1'), role: 'interview' })
    const saved = repository.saveDraft(sid('session-1'), {
      role: 'Старший аналитик',
      description: 'Разбирает требования',
      persona: 'Спокойная',
      methodology: 'Сначала факты',
      // `sql` is edited in place, `otchety` is not mentioned and survives,
      // and `analiz` is new.
      skills: [skill('sql', 'Новое описание', 'Пиши SELECT'), skill('analiz', 'Разбор требований')],
    })
    expect(saved.skills).toEqual([
      skill('sql', 'Новое описание', 'Пиши SELECT'),
      skill('otchety', 'Отчёты'),
      skill('analiz', 'Разбор требований'),
    ])
    expect(repository.getClone(clone.id)?.skills).toEqual(saved.skills)
  })

  it('refuses a merge that would exceed the stored skill count', async () => {
    const repository = await fixture()
    const clone = repository.createClone({
      ...MINIMAL,
      skills: Array.from(
        { length: CLONE_TEXT_LIMITS.skillCount },
        (_unused, index) => skill(`stored-${String(index)}`, 'Сохранённый навык'),
      ),
    })
    repository.updateClone(clone.id, { status: 'interviewing' }, 1)
    repository.bindSession({ cloneId: clone.id, sessionId: sid('session-1'), role: 'interview' })
    const refusal = (() => {
      try {
        return repository.saveDraft(sid('session-1'), {
          role: 'роль',
          description: 'описание',
          persona: 'персона',
          methodology: 'метод',
          skills: [skill('novyy', 'Новый навык')],
        })
      } catch (error: unknown) {
        return error
      }
    })()
    expect(refusal).toMatchObject({ code: 'ketos/invalid-draft' })
    expect(repository.getClone(clone.id)?.skills).toHaveLength(CLONE_TEXT_LIMITS.skillCount)
  })

  it('refuses a draft whose clone already left the interview', async () => {
    const repository = await fixture()
    const clone = repository.createClone(MINIMAL)
    repository.updateClone(clone.id, { status: 'interviewing' }, 1)
    repository.bindSession({ cloneId: clone.id, sessionId: sid('session-1'), role: 'interview' })
    // The person confirmed the profile from the form; the agent's later save
    // must not overwrite it.
    repository.updateClone(clone.id, { status: 'ready' }, 2)
    expect(() => repository.saveDraft(sid('session-1'), {
      role: 'роль', description: 'описание', persona: 'персона', methodology: 'метод', skills: [],
    })).toThrow(CloneNotInterviewingError)
  })

  it('refuses a draft from a working session and one that exceeds the field bounds', async () => {
    const repository = await fixture()
    const clone = repository.createClone(MINIMAL)
    repository.updateClone(clone.id, { status: 'interviewing' }, 1)
    repository.bindSession({ cloneId: clone.id, sessionId: sid('session-1'), role: 'main' })
    expect(() => repository.saveDraft(sid('session-1'), {
      role: 'роль', description: 'описание', persona: 'персона', methodology: 'метод', skills: [],
    })).toThrow(CloneSessionNotBoundError)
    repository.bindSession({ cloneId: clone.id, sessionId: sid('session-1'), role: 'interview' })
    expect(() => repository.saveDraft(sid('session-1'), {
      role: 'роль',
      description: 'описание',
      persona: 'персона',
      methodology: 'x'.repeat(20_001),
      skills: [],
    })).toThrow(/methodology exceeds/u)
    // An unauthored skill is a draft, not a malformed one: the interview may
    // name a skill before the person describes it.
    expect(() => repository.saveDraft(sid('session-1'), {
      role: 'роль',
      description: 'описание',
      persona: 'персона',
      methodology: 'метод',
      skills: [skill('analiz')],
    })).not.toThrow()
  })

  it('refuses a draft skill whose name or bounds leave the stored rules', async () => {
    const repository = await fixture()
    const clone = repository.createClone(MINIMAL)
    repository.updateClone(clone.id, { status: 'interviewing' }, 1)
    repository.bindSession({ cloneId: clone.id, sessionId: sid('session-1'), role: 'interview' })
    const draft = (skills: readonly CloneSkill[]): (() => unknown) => () => repository.saveDraft(sid('session-1'), {
      role: 'роль', description: 'описание', persona: 'персона', methodology: 'метод', skills,
    })
    const refusals: ReadonlyArray<readonly [string, readonly CloneSkill[]]> = [
      ['a non-kebab name', [skill('Анализ')]],
      ['an empty name', [skill('')]],
      ['a duplicate name', [skill('sql', 'первый'), skill('sql', 'второй')]],
      ['too many skills', Array.from(
        { length: CLONE_TEXT_LIMITS.skillCount + 1 },
        (_unused, index) => skill(`skill-${String(index)}`, 'описание'),
      )],
      ['an over-long name', [skill(`a${'b'.repeat(CLONE_TEXT_LIMITS.skillName)}`)]],
      ['an over-long description', [skill('sql', 'x'.repeat(CLONE_TEXT_LIMITS.skillDescription + 1))]],
      ['over-long instructions', [skill('sql', 'описание', 'x'.repeat(CLONE_TEXT_LIMITS.skillInstructions + 1))]],
    ]
    for (const [reason, skills] of refusals) {
      const refusal = (() => { try { return draft(skills)() } catch (error: unknown) { return error } })()
      expect(refusal, reason).toMatchObject({ code: 'ketos/invalid-draft' })
    }
    // The refusals wrote nothing: the clone is still interviewing.
    expect(repository.getClone(clone.id)?.status).toBe('interviewing')
  })

  it('refuses a draft from a session that is not bound to a clone', async () => {
    const repository = await fixture()
    repository.createClone(MINIMAL)
    const refusal = (() => {
      try {
        return repository.saveDraft(sid('stranger'), {
          role: 'роль', description: 'описание', persona: 'персона', methodology: 'метод', skills: [],
        })
      } catch (error: unknown) { return error }
    })()
    expect(refusal).toBeInstanceOf(CloneSessionNotBoundError)
    expect((refusal as CloneSessionNotBoundError).code).toBe('ketos/not-a-clone-session')
  })

  it('refuses a draft whose bound clone disappeared', async () => {
    const db = await openDatabase(':memory:')
    cleanups.push(() => { db.close() })
    const repository = new CloneRepository(db)
    const clone = repository.createClone(MINIMAL)
    repository.bindSession({ cloneId: clone.id, sessionId: sid('session-1'), role: 'interview' })
    // Simulates a database whose binding outlived its clone (the shipped
    // delete removes both in one transaction).
    db.prepare('DELETE FROM clones WHERE id = ?').run(clone.id)
    expect(() => repository.saveDraft(sid('session-1'), {
      role: 'роль', description: 'описание', persona: 'персона', methodology: 'метод', skills: [],
    })).toThrow(CloneNotFoundError)
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
    expect(() => repository.getClone(clone.id)).toThrow(/array of skill objects/u)
    db.prepare('UPDATE clones SET skills_json = ? WHERE id = ?').run('["sql"]', clone.id)
    expect(() => repository.getClone(clone.id)).toThrow(/array of skill objects/u)
    db.prepare('UPDATE clones SET skills_json = ? WHERE id = ?').run('[{"name":"sql"}]', clone.id)
    expect(() => repository.getClone(clone.id)).toThrow(/array of skill objects/u)
    db.prepare('UPDATE clones SET skills_json = ? WHERE id = ?').run('[{"name":"sql","description":1,"instructions":""}]', clone.id)
    expect(() => repository.getClone(clone.id)).toThrow(/array of skill objects/u)
    db.prepare('UPDATE clones SET skills_json = ? WHERE id = ?').run('not json', clone.id)
    expect(() => repository.getClone(clone.id)).toThrow()
  })

  it('reads a legacy name the registry would reject instead of refusing the record', async () => {
    const db = await openDatabase(':memory:')
    cleanups.push(() => { db.close() })
    const repository = new CloneRepository(db)
    const clone = repository.createClone(MINIMAL)
    // A row written before the name grammar was enforced; the decode guard is a
    // shape check, so the editor can still show the person what to fix.
    db.prepare('UPDATE clones SET skills_json = ? WHERE id = ?').run(JSON.stringify([
      { name: 'Договоры', description: 'Договорная работа', instructions: '' },
    ]), clone.id)
    expect(repository.getClone(clone.id)?.skills).toEqual([
      { name: 'Договоры', description: 'Договорная работа', instructions: '' },
    ])
  })

  it('refuses a hand-edited binding role instead of surfacing it', async () => {
    const db = await openDatabase(':memory:')
    cleanups.push(() => { db.close() })
    const repository = new CloneRepository(db)
    const clone = repository.createClone(MINIMAL)
    repository.bindSession({ cloneId: clone.id, sessionId: sid('session-1') })
    db.prepare('UPDATE clone_sessions SET role = ? WHERE session_id = ?').run('broken', 'session-1')
    expect(() => repository.bindingFor(sid('session-1'))).toThrow(/unknown role/u)
  })
})
