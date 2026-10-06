// board.db keeps the document across restarts, compacts its journal without
// losing state, keeps the local identity outside the synchronized document,
// and refuses foreign files. The entry module stays lazy: importing it must
// not load either node:sqlite or yjs.
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { BoardDatabase, ensureIdentity, openDatabase } from '../src/db.ts'
import { BoardJournal, COMPACT_ORIGIN, LOAD_ORIGIN } from '../src/journal.ts'
import {
  BOARD_DOC_APPLICATION_ID, BOARD_DOC_SCHEMA_VERSION, runMigrations,
} from '../src/schema.ts'

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

/** Fresh temporary directory that the running test owns. */
async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-board-doc-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  return root
}

/** One open database plus its document and journal, closed exactly once. */
class Fixture {
  private closed = false

  private constructor(
    readonly db: Awaited<ReturnType<typeof openDatabase>>,
    readonly doc: Y.Doc,
    readonly journal: BoardJournal,
  ) {}

  /**
   * Open the database at `path`, create a document, and load its journal.
   * @param path - database file path.
   * @param compactRows - row budget handed to the journal.
   * @returns the open fixture.
   */
  static async open(path: string, compactRows = 500): Promise<Fixture> {
    const db = await openDatabase(path)
    const doc = new Y.Doc()
    const fixture = new Fixture(db, doc, new BoardJournal(db, doc, compactRows))
    cleanups.push(() => { fixture.close() })
    return fixture
  }

  /** Close the journal, destroy the document, and close the handle once. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.journal.close()
    this.doc.destroy()
    this.db.close()
  }
}

/**
 * One document fixture the journal follows.
 * @param path - database file path.
 * @param compactRows - row budget handed to the journal.
 * @returns the fixture with its journal already loaded.
 */
async function loaded(path: string, compactRows = 500): Promise<Fixture> {
  const fixture = await Fixture.open(path, compactRows)
  await fixture.journal.load()
  return fixture
}

/**
 * Write one element field inside one transaction, like the service does.
 * @param doc - document to mutate.
 * @param id - element id.
 * @param x - stored x coordinate.
 * @param origin - transaction origin; omitted mutations carry none.
 */
function writeElement(doc: Y.Doc, id: string, x: number, origin?: string): void {
  doc.transact(() => {
    const elements = doc.getMap<Y.Map<unknown>>('elements')
    let element = elements.get(id)
    if (element === undefined) {
      element = new Y.Map()
      elements.set(id, element)
    }
    element.set('x', x)
  }, origin)
}

/** Every element of a document as a plain object. */
function elementsOf(doc: Y.Doc): Record<string, unknown> {
  return Object.fromEntries([...doc.getMap<Y.Map<unknown>>('elements')].map(([id, element]) => [id, element.toJSON()]))
}

describe('board.db identity and file policy', () => {
  it('creates the directory 0700 and the file 0600, and stamps identity, version, and WAL', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'home', 'board.db')
    const db = await openDatabase(path)
    expect((await stat(join(root, 'home'))).mode & 0o777).toBe(0o700)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    const { application_id: applicationId } = db.prepare('PRAGMA application_id').get() as { application_id: number }
    const { user_version: userVersion } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    const { journal_mode: journalMode } = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
    db.close()
    expect({ applicationId, userVersion, journalMode }).toEqual({
      applicationId: BOARD_DOC_APPLICATION_ID,
      userVersion: BOARD_DOC_SCHEMA_VERSION,
      journalMode: 'wal',
    })
  })

  it('keeps selfId and docId stable across opens, and rejects a corrupted one', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'board.db')
    const first = await openDatabase(path)
    const identity = ensureIdentity(first)
    expect(identity.selfId).toMatch(/^[0-9a-f-]{36}$/u)
    expect(identity.docId).toMatch(/^[0-9a-f-]{36}$/u)
    first.close()

    const second = await openDatabase(path)
    expect(ensureIdentity(second)).toEqual(identity)
    second.prepare("UPDATE meta SET value = 'not-a-uuid' WHERE key = 'docId'").run()
    second.close()
    await expect(openDatabase(path)).rejects.toThrow(/docId is not a UUID/u)

    const { DatabaseSync } = await import('node:sqlite')
    const repair = new DatabaseSync(path)
    repair.prepare("UPDATE meta SET value = ? WHERE key = 'docId'").run(identity.docId)
    repair.prepare("UPDATE meta SET value = 'not-a-uuid' WHERE key = 'selfId'").run()
    repair.close()
    await expect(openDatabase(path)).rejects.toThrow(/selfId is not a UUID/u)
  })

  it('supports an in-memory database', async () => {
    const db = await openDatabase(':memory:')
    expect(ensureIdentity(db).selfId).toBeTypeOf('string')
    db.close()
  })

  it('propagates a file-creation failure that is not EEXIST', async () => {
    const root = await temporaryDirectory()
    await expect(openDatabase(join(root, 'board\u0000.db'))).rejects.toThrow()
  })

  it('refuses a database stamped for another application or a newer build', async () => {
    const root = await temporaryDirectory()
    const foreignPath = join(root, 'foreign.db')
    const foreign = await openDatabase(foreignPath)
    foreign.exec('PRAGMA application_id = 0x1234')
    foreign.close()
    await expect(openDatabase(foreignPath)).rejects.toThrow(/belongs to another application/u)

    const newerPath = join(root, 'newer.db')
    const newer = await openDatabase(newerPath)
    newer.exec('PRAGMA user_version = 2')
    newer.close()
    await expect(openDatabase(newerPath)).rejects.toThrow(/newer than this build/u)
  })
})

describe('board journal', () => {
  it('keeps elements across a close and reopen', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'board.db')
    const first = await loaded(path)
    writeElement(first.doc, 'note-1', 12, 'host')
    expect(first.journal.revision()).toBe(1)
    expect(elementsOf(first.doc)).toEqual({ 'note-1': { x: 12 } })
    first.close()

    const second = await loaded(path)
    expect(second.journal.revision()).toBe(1)
    expect(elementsOf(second.doc)).toEqual({ 'note-1': { x: 12 } })
  })

  it('compacts without changing the snapshot and never decreasing the revision', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'board.db')
    const fixture = await loaded(path, 3)
    for (let index = 1; index <= 5; index++) writeElement(fixture.doc, `note-${String(index)}`, index, 'browser')
    const before = elementsOf(fixture.doc)
    const revision = fixture.journal.revision()
    expect(revision).toBeGreaterThanOrEqual(5)

    const rows = fixture.db.prepare('SELECT seq, origin FROM updates ORDER BY seq').all()
    expect(rows.length).toBeLessThanOrEqual(3)
    expect(rows.some(row => row.origin === COMPACT_ORIGIN)).toBe(true)
    expect(rows.at(-1)?.seq).toBe(revision)

    const restored = new Y.Doc()
    cleanups.push(() => { restored.destroy() })
    const stored = fixture.db.prepare('SELECT "update" FROM updates ORDER BY seq').all()
    Y.applyUpdate(
      restored,
      Y.mergeUpdates(stored.map(row => new Uint8Array(row.update as Uint8Array))),
      LOAD_ORIGIN,
    )
    expect(elementsOf(restored)).toEqual(before)
  })

  it('stores an update that carries no origin and stops following after close', async () => {
    const root = await temporaryDirectory()
    const fixture = await loaded(join(root, 'board.db'))
    writeElement(fixture.doc, 'note-1', 1)
    const { origin } = fixture.db.prepare('SELECT origin FROM updates ORDER BY seq').get() as { origin: string }
    expect(origin).toBe('local')

    fixture.journal.close()
    writeElement(fixture.doc, 'note-2', 2)
    const { rows } = fixture.db.prepare('SELECT COUNT(*) AS rows FROM updates').get() as { rows: number }
    expect(rows).toBe(1)
  })

  it('keeps no local identity key inside the document', async () => {
    const root = await temporaryDirectory()
    const fixture = await loaded(join(root, 'board.db'))
    const { selfId, docId } = ensureIdentity(fixture.db)
    writeElement(fixture.doc, 'note-1', 1, 'host')
    expect([...fixture.doc.share.keys()]).toEqual(['elements'])
    const encoded = Buffer.from(Y.encodeStateAsUpdate(fixture.doc)).toString('latin1')
    expect(encoded).not.toContain(selfId)
    expect(encoded).not.toContain(docId)
  })

  it('rolls the compaction back when its insert fails, keeping the journal whole', async () => {
    const root = await temporaryDirectory()
    const fixture = await loaded(join(root, 'board.db'), 1)
    writeElement(fixture.doc, 'note-1', 1, 'host')
    fixture.db.exec(`
      CREATE TRIGGER refuse_compact BEFORE INSERT ON updates WHEN NEW.origin = 'compact'
      BEGIN SELECT RAISE(ABORT, 'compact refused'); END
    `)
    expect(() => { writeElement(fixture.doc, 'note-2', 2, 'host') }).toThrow(/compact refused/u)
    expect(fixture.journal.revision()).toBe(2)
    const { rows } = fixture.db.prepare('SELECT COUNT(*) AS rows FROM updates').get() as { rows: number }
    expect(rows).toBe(2)
    expect(elementsOf(fixture.doc)).toEqual({ 'note-1': { x: 1 }, 'note-2': { x: 2 } })
  })

  it('keeps the journal whole when the database rolled its transaction back on its own', async () => {
    const root = await temporaryDirectory()
    const fixture = await loaded(join(root, 'board.db'), 1)
    writeElement(fixture.doc, 'note-1', 1, 'host')
    fixture.db.exec(`
      CREATE TRIGGER rollback_compact BEFORE INSERT ON updates WHEN NEW.origin = 'compact'
      BEGIN SELECT RAISE(ROLLBACK, 'compact rolled back'); END
    `)
    expect(() => { writeElement(fixture.doc, 'note-2', 2, 'host') }).toThrow(/compact rolled back/u)
    expect(fixture.journal.revision()).toBe(2)
    const { rows } = fixture.db.prepare('SELECT COUNT(*) AS rows FROM updates').get() as { rows: number }
    expect(rows).toBe(2)
  })
})

describe('migration runner', () => {
  it('refuses a version that has no step', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(':memory:')
    expect(() => { runMigrations(db, [() => {}], 2) }).toThrow(/need 1 migration steps/u)
    expect(() => { runMigrations(db, [() => {}, undefined as never], 2) }).toThrow(/no migration step for version 2/u)
    db.close()
  })

  it('rolls a failing step back without stamping the version', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(':memory:')
    expect(() => {
      runMigrations(db, [() => {
        db.exec('CREATE TABLE half (id TEXT)')
        throw new Error('step failed')
      }], 1)
    }).toThrow(/step failed/u)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'half'").get()).toBeUndefined()
    const { user_version: userVersion } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(userVersion).toBe(0)
    db.close()
  })
})

describe('board database owner', () => {
  it('opens lazily, rejects after close, and tolerates repeated close', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'board.db')
    const database = new BoardDatabase(path)
    const db = await database.handle()
    expect((await stat(path)).isFile()).toBe(true)
    db.close()
    await database.close()
    await database.close()
    await expect(database.handle()).rejects.toThrow(/already closed/u)
  })

  it('closes before the first open without creating the file, and retries a failed open', async () => {
    const root = await temporaryDirectory()
    const untouched = new BoardDatabase(join(root, 'untouched.db'))
    await untouched.close()
    await expect(stat(join(root, 'untouched.db'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(untouched.handle()).rejects.toThrow(/already closed/u)

    const blocker = join(root, 'blocker')
    await writeFile(blocker, 'not a directory')
    const database = new BoardDatabase(join(blocker, 'board.db'))
    await expect(database.handle()).rejects.toThrow()
    await database.close()
    await expect(database.handle()).rejects.toThrow(/already closed/u)

    const retried = new BoardDatabase(join(root, 'retried.db'))
    const failed = new BoardDatabase(join(blocker, 'board.db'))
    await expect(failed.handle()).rejects.toThrow()
    await rm(blocker)
    expect(await failed.handle()).toBeDefined()
    await failed.close()
    expect(await retried.handle()).toBeDefined()
    await retried.close()
  })
})

describe('lazy library loading', () => {
  it('does not load yjs or node:sqlite when the entry module is imported', async () => {
    vi.resetModules()
    let yjsLoads = 0
    let sqliteLoads = 0
    vi.doMock('yjs', () => {
      yjsLoads += 1
      return {}
    })
    vi.doMock('node:sqlite', () => {
      sqliteLoads += 1
      return {}
    })
    await import('../src/index.ts')
    expect({ yjsLoads, sqliteLoads }).toEqual({ yjsLoads: 0, sqliteLoads: 0 })
    vi.doUnmock('yjs')
    vi.doUnmock('node:sqlite')
    vi.resetModules()
  })
})
