/** clones.db opens owner-only, stamps its identity and version, and refuses foreign files. */
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CloneDatabase, openDatabase } from '../src/db.ts'
import { CloneRepository } from '../src/repository.ts'
import { CLONE_CORE_APPLICATION_ID, CLONE_CORE_SCHEMA_VERSION, migrate, runMigrations } from '../src/schema.ts'

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

/** Fresh temporary directory that the running test owns. */
async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-clone-core-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  return root
}

/** Pragmas of one database file, read through a throwaway handle. */
async function pragmas(path: string): Promise<{ applicationId: number; userVersion: number; journalMode: string }> {
  const db = await openDatabase(path)
  cleanups.push(() => { db.close() })
  const { application_id: applicationId } = db.prepare('PRAGMA application_id').get() as { application_id: number }
  const { user_version: userVersion } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  const { journal_mode: journalMode } = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
  return { applicationId, userVersion, journalMode }
}

describe('clones.db open sequence', () => {
  it('creates the directory 0700 and the file 0600, and stamps identity, version, and WAL', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'home', 'clones.db')
    const db = await openDatabase(path)
    expect((await stat(join(root, 'home'))).mode & 0o777).toBe(0o700)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    db.close()
    expect(await pragmas(path)).toEqual({
      applicationId: CLONE_CORE_APPLICATION_ID,
      userVersion: CLONE_CORE_SCHEMA_VERSION,
      journalMode: 'wal',
    })
  })

  it('keeps its records across a close and reopen', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'clones.db')
    const first = await openDatabase(path)
    const created = new CloneRepository(first).createClone({ name: 'Анна', role: 'Аналитик' })
    first.close()
    const second = await openDatabase(path)
    expect(new CloneRepository(second).getClone(created.id)).toMatchObject({ name: 'Анна', revision: 1 })
    second.close()
  })

  it('refuses a database stamped for another application', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'clones.db')
    const db = await openDatabase(path)
    db.exec('PRAGMA application_id = 0x1234')
    db.close()
    await expect(openDatabase(path)).rejects.toThrow(/belongs to another application/u)
  })

  it('leaves a foreign file unlabelled when a migration step fails on it', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'clones.db')
    const { DatabaseSync } = await import('node:sqlite')
    const foreign = new DatabaseSync(path)
    // A foreign file that happens to collide with the first migration step.
    foreign.exec('CREATE TABLE clones (id TEXT PRIMARY KEY)')
    foreign.close()

    await expect(openDatabase(path)).rejects.toThrow()
    const check = new DatabaseSync(path)
    const { application_id: applicationId } = check.prepare('PRAGMA application_id').get() as { application_id: number }
    const { user_version: userVersion } = check.prepare('PRAGMA user_version').get() as { user_version: number }
    check.close()
    expect({ applicationId, userVersion }).toEqual({ applicationId: 0, userVersion: 0 })
  })

  it('adopts a version 1 file and stamps it at the current version', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'clones.db')
    const db = await openDatabase(path)
    // Rewind to a genuine version 1 file: the stores the later steps add must
    // be absent, or adoption would re-run their DDL over existing tables.
    db.exec('DROP TABLE clone_tasks')
    db.exec('DROP TABLE memories_fts')
    db.exec('DROP TABLE memories')
    db.exec('PRAGMA user_version = 1')
    db.close()
    expect((await pragmas(path)).userVersion).toBe(CLONE_CORE_SCHEMA_VERSION)
    const adopted = await openDatabase(path)
    cleanups.push(() => { adopted.close() })
    expect(adopted.prepare("SELECT name FROM sqlite_master WHERE name = 'memories'").get()).toBeDefined()
  })

  it('refuses a schema version newer than this build', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'clones.db')
    const db = await openDatabase(path)
    db.exec(`PRAGMA user_version = ${String(CLONE_CORE_SCHEMA_VERSION + 1)}`)
    db.close()
    await expect(openDatabase(path)).rejects.toThrow(/newer than this build/u)
  })

  it('rewrites a legacy skill name list into skill objects', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'clones.db')
    const db = await openDatabase(path)
    const repository = new CloneRepository(db)
    const legacy = repository.createClone({ name: 'Анна', role: 'Аналитик' })
    const modern = repository.createClone({ name: 'Борис', role: 'Юрист' })
    // What a build before this stage stored: bare names, in the person's order.
    db.prepare('UPDATE clones SET skills_json = ? WHERE id = ?').run(JSON.stringify(['sql', 'Договоры']), legacy.id)
    db.prepare('UPDATE clones SET skills_json = ? WHERE id = ?').run(JSON.stringify([
      { name: 'analiz', description: 'Разбор требований', instructions: 'Сначала факты' },
    ]), modern.id)
    // The schema shape is unchanged by v4, so rewinding the stamp is honest
    // once the v5 table is absent.
    db.exec('DROP TABLE clone_tasks')
    db.exec('PRAGMA user_version = 3')
    db.close()

    expect((await pragmas(path)).userVersion).toBe(CLONE_CORE_SCHEMA_VERSION)
    const adopted = await openDatabase(path)
    cleanups.push(() => { adopted.close() })
    const records = new CloneRepository(adopted)
    expect(records.getClone(legacy.id)?.skills).toEqual([
      { name: 'sql', description: '', instructions: '' },
      { name: 'Договоры', description: '', instructions: '' },
    ])
    // A row already holding skill objects is untouched.
    expect(records.getClone(modern.id)?.skills).toEqual([
      { name: 'analiz', description: 'Разбор требований', instructions: 'Сначала факты' },
    ])
    // The migration ran once; reopening the v4 file changes nothing.
    const reopened = await openDatabase(path)
    cleanups.push(() => { reopened.close() })
    expect(new CloneRepository(reopened).getClone(legacy.id)?.skills).toEqual([
      { name: 'sql', description: '', instructions: '' },
      { name: 'Договоры', description: '', instructions: '' },
    ])
  })

  it('keeps a row whose skills document is not JSON readable after the migration', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'clones.db')
    const db = await openDatabase(path)
    const repository = new CloneRepository(db)
    const clone = repository.createClone({ name: 'Анна', role: 'Аналитик' })
    db.prepare('UPDATE clones SET skills_json = ? WHERE id = ?').run('not json', clone.id)
    db.exec('DROP TABLE clone_tasks')
    db.exec('PRAGMA user_version = 3')
    db.close()
    // The step must not fail the whole database open on a hand-edited value;
    // the repository's decode guard reports it on the first read instead.
    const adopted = await openDatabase(path)
    cleanups.push(() => { adopted.close() })
    expect(() => new CloneRepository(adopted).getClone(clone.id)).toThrow()
  })

  it('refuses a file that is not a SQLite database', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'clones.db')
    await writeFile(path, 'not a database')
    await expect(openDatabase(path)).rejects.toThrow()
  })
})

describe('forward-only migration runner', () => {
  it('applies every missing step in order and preserves existing rows', async () => {
    const db = await openDatabase(':memory:')
    cleanups.push(() => { db.close() })
    const repository = new CloneRepository(db)
    const created = repository.createClone({ name: 'Борис', role: 'Юрист' })
    // The file ships at the current version; the synthetic steps exercise the
    // runner from an older stamp.
    db.exec('PRAGMA user_version = 1')
    const applied: string[] = []
    runMigrations(db, [
      () => { applied.push('v1') },
      (migrating) => {
        applied.push('v2')
        migrating.exec('ALTER TABLE clones ADD COLUMN notes TEXT NOT NULL DEFAULT \'\'')
      },
      (migrating) => {
        applied.push('v3')
        migrating.exec('CREATE TABLE clone_skills (clone_id TEXT NOT NULL, skill TEXT NOT NULL) STRICT')
      },
    ], 3)
    const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(version).toBe(3)
    expect(applied).toEqual(['v2', 'v3'])
    expect(repository.getClone(created.id)).toMatchObject({ name: 'Борис', revision: 1 })
    const notes = db.prepare('SELECT notes FROM clones WHERE id = ?').get(created.id) as { notes: string }
    expect(notes.notes).toBe('')
  })

  it('rolls back a migration whose step fails, keeping the database at its version', async () => {
    const db = await openDatabase(':memory:')
    cleanups.push(() => { db.close() })
    const repository = new CloneRepository(db)
    const created = repository.createClone({ name: 'Борис', role: 'Юрист' })
    db.exec('PRAGMA user_version = 1')
    expect(() => {
      runMigrations(db, [
        () => { throw new Error('step one is unreachable at version 1') },
        (migrating) => { migrating.exec('CREATE TABLE clone_skills (clone_id TEXT NOT NULL, skill TEXT NOT NULL) STRICT') },
        () => { throw new Error('the second step fails after the first applied') },
      ], 3)
    }).toThrow('the second step fails')
    const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(version).toBe(1)
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'memories_fts_%' ORDER BY name",
    ).all()
    expect(tables).toEqual([
      { name: 'clone_sessions' }, { name: 'clone_tasks' }, { name: 'clones' }, { name: 'memories' }, { name: 'memories_fts' },
    ])
    expect(repository.getClone(created.id)?.name).toBe('Борис')
  })

  it('normalizes the earlier status pair when a version 1 file is adopted', async () => {
    const db = await openDatabase(':memory:')
    cleanups.push(() => { db.close() })
    const repository = new CloneRepository(db)
    const active = repository.createClone({ name: 'Вера', role: 'Аналитик' })
    const archived = repository.createClone({ name: 'Борис', role: 'Юрист' })
    // Values only the superseded lifecycle could store; the v2 step is the one
    // under test, so the stamp is rewound to v1 first.
    db.prepare('UPDATE clones SET status = ? WHERE id = ?').run('active', active.id)
    db.prepare('UPDATE clones SET status = ? WHERE id = ?').run('archived', archived.id)
    // A version 1 file has neither the memory table, its index, nor the task
    // table; dropping all three makes the rewind honest instead of re-running
    // the later DDL.
    db.exec('DROP TABLE clone_tasks')
    db.exec('DROP TABLE memories_fts')
    db.exec('DROP TABLE memories')
    db.exec('PRAGMA user_version = 1')
    migrate(db)
    expect(repository.getClone(active.id)?.status).toBe('ready')
    expect(repository.getClone(archived.id)?.status).toBe('draft')
    expect(repository.listClones().map(clone => clone.name)).toEqual(['Борис', 'Вера'])
  })

  it('refuses a step list that cannot reach the current version', async () => {
    const db = await openDatabase(':memory:')
    cleanups.push(() => { db.close() })
    expect(() => { runMigrations(db, [], 1) }).toThrow(/need 0 migration steps/u)
  })
})

describe('lazy database owner', () => {
  it('does not touch the filesystem before the first repository call', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'clones.db')
    const database = new CloneDatabase(path)
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    const repository = await database.repository()
    expect(repository.listClones()).toEqual([])
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    await database.close()
  })

  it('answers the same repository and closes idempotently', async () => {
    const root = await temporaryDirectory()
    const database = new CloneDatabase(join(root, 'clones.db'))
    const first = await database.repository()
    expect(await database.repository()).toBe(first)
    const created = first.createClone({ name: 'Вера', role: 'Аналитик' })
    await database.close()
    await database.close()
    await expect(database.repository()).rejects.toThrow(/already closed/u)
    const reopened = new CloneDatabase(join(root, 'clones.db'))
    cleanups.push(() => reopened.close())
    expect((await reopened.repository()).getClone(created.id)?.name).toBe('Вера')
  })

  it('refuses a repository whose open a concurrent close took over', async () => {
    const root = await temporaryDirectory()
    const database = new CloneDatabase(join(root, 'clones.db'))
    const pending = database.repository()
    await database.close()
    // The handle belongs to the disposal from here on: the caller must not
    // receive a repository over a closed database.
    await expect(pending).rejects.toThrow(/already closed/u)
    await expect(database.repository()).rejects.toThrow(/already closed/u)
  })

  it('retries an open that failed instead of caching the failure', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'clones.db')
    const database = new CloneDatabase(path)
    await mkdir(path)
    await expect(database.repository()).rejects.toThrow()
    // Clearing the obstruction must be enough; no restart is needed.
    await rm(path, { recursive: true, force: true })
    const repository = await database.repository()
    expect(repository.listClones()).toEqual([])
    await database.close()
  })
})
