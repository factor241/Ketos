/**
 * Owner of the `board.db` file: the owner-only creation of the file, the open
 * sequence (journal mode, identity and version stamps, local identity), the
 * lazy handle the plugin shares, and its disposal.
 *
 * Opening is lazy on purpose: `node:sqlite` is imported on the first document
 * call, so a process that never touches the board never prints Node's SQLite
 * experimental warning during startup.
 * @module @ketos/board-doc/db
 */

import type { DatabaseSync } from 'node:sqlite'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import { UUID_PATTERN, mintUuid } from './data.ts'
import { migrate } from './schema.ts'
import type { BoardDocId, OwnerId } from './types.ts'

/** Local identities a `board.db` carries outside the synchronized document. */
export interface BoardIdentity {
  /** Identity of this Ketos; the host stamps it on every browser-created element. */
  readonly selfId: OwnerId
  /** Identity of the document; stage 33 relates two documents by it. */
  readonly docId: BoardDocId
}

/** Meta keys of the local identity. */
const SELF_ID_KEY = 'selfId'
const DOC_ID_KEY = 'docId'

/**
 * Read one `meta` value.
 * @param db - open database handle.
 * @param key - meta key.
 * @returns the stored value, or undefined when the key is absent.
 */
function readMeta(db: DatabaseSync, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value
}

/**
 * Read one meta value, minting and storing a UUID when the key is absent. A
 * stored value that is not a UUID fails the open instead of being replaced:
 * losing the local identity would silently orphan every element this Ketos
 * created.
 * @param db - open database handle.
 * @param key - meta key.
 * @returns the stored or minted UUID.
 */
function ensureMetaUuid(db: DatabaseSync, key: string): string {
  const stored = readMeta(db, key)
  if (stored !== undefined) {
    if (!UUID_PATTERN.test(stored)) throw new Error(`board database: ${key} is not a UUID`)
    return stored
  }
  const minted = mintUuid()
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(key, minted)
  return minted
}

/**
 * Read the local identities, creating them on the first open of the file.
 * @param db - open database handle.
 * @returns the stable `selfId` and `docId` of this database.
 */
export function ensureIdentity(db: DatabaseSync): BoardIdentity {
  return {
    selfId: brandString<OwnerId>(ensureMetaUuid(db, SELF_ID_KEY)),
    docId: brandString<BoardDocId>(ensureMetaUuid(db, DOC_ID_KEY)),
  }
}

/* jscpd:ignore-start -- deliberately mirrors the clone-core open sequence.
   Each package owns a distinct database identity, schema, and version policy,
   so a shared medium helper would couple independently released packages. */
/** SQLite primary result code `SQLITE_BUSY`; extended codes carry it in the low byte. */
const SQLITE_BUSY = 5

/**
 * Whether a `node:sqlite` error reports that another connection holds the file.
 * @param error - the caught value.
 * @returns true for `SQLITE_BUSY` and its extended codes.
 */
function isBusyError(error: unknown): boolean {
  const code = (error as { errcode?: unknown }).errcode
  return typeof code === 'number' && (code & 0xff) === SQLITE_BUSY
}

/**
 * Exclusively create a missing database file with owner-only permissions.
 * Existing files retain their modes, and errors other than `EEXIST` propagate.
 * @param path - resolved database path.
 */
async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/**
 * Open the board database, creating its directory (`0700`) and file (`0600`)
 * when they are missing, and bring it to the current schema version. A foreign
 * application id or a newer schema version is refused, so an unrelated SQLite
 * file is never written to.
 *
 * The connection takes the file's exclusive lock before it enables WAL and
 * keeps it until it closes (`locking_mode = EXCLUSIVE`), so a second Ketos
 * process on the same file cannot delete journal rows the first process
 * still depends on. Because the holder keeps the lock for its whole life, the
 * second opener does not wait (`busy_timeout = 0`): it fails at once with an
 * error naming the file instead of blocking its event loop on every attempt.
 * Every other reader of the file, `sqlite3` included, is locked out as well
 * while the Ketos process runs.
 * @param path - database path from the profile config, or `:memory:`.
 * @returns the open handle with the journal mode, schema, and identity applied.
 */
export async function openDatabase(path: string): Promise<DatabaseSync> {
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') {
    await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
    await createDatabaseFile(actual)
  }
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(actual)
  try {
    db.exec('PRAGMA busy_timeout = 0')
    db.exec('PRAGMA locking_mode = EXCLUSIVE')
    // The first read takes the lock; with EXCLUSIVE locking it is kept after
    // the commit, before any journal mode change.
    db.exec('BEGIN EXCLUSIVE; COMMIT')
    migrate(db)
    db.exec('PRAGMA journal_mode = WAL')
    ensureIdentity(db)
    return db
  } catch (error: unknown) {
    db.close()
    if (isBusyError(error)) {
      throw new Error(`board database ${actual} is open in another Ketos process`, { cause: error })
    }
    throw error
  }
}
/* jscpd:ignore-end */

/**
 * The plugin's database owner. The handle stays closed until the first
 * document call and is closed by the plugin's disposal; `close()` is
 * idempotent and awaited, and a call after disposal fails instead of silently
 * reopening the file.
 */
export class BoardDatabase {
  private readonly path: string
  private opening: Promise<DatabaseSync> | undefined
  private closing: Promise<void> | undefined
  private disposed = false

  /**
   * @param path - database path from the profile config.
   */
  constructor(path: string) {
    this.path = path
  }

  /**
   * The open handle, opening the file on first use. A failed open is not
   * cached, so a transient lock, permission, or vanished-file failure does not
   * fail every later call until the process restarts; concurrent callers still
   * share one attempt.
   * @returns the shared open handle.
   */
  handle(): Promise<DatabaseSync> {
    if (this.disposed) return Promise.reject(new Error('board database: already closed'))
    this.opening ??= openDatabase(this.path).catch((error: unknown) => {
      this.opening = undefined
      throw error
    })
    return this.opening
  }

  /**
   * Close the handle if it was opened. Safe before the first document call and
   * safe to call more than once; a failed open is not rethrown here, because
   * the caller that asked for the handle already received it.
   * @returns a promise settling when the handle is closed.
   */
  close(): Promise<void> {
    this.closing ??= this.dispose()
    return this.closing
  }

  private async dispose(): Promise<void> {
    const opening = this.opening
    this.disposed = true
    this.opening = undefined
    if (opening === undefined) return
    try {
      (await opening).close()
    } catch {
      // The failed open already closed its own handle and was reported to the
      // caller that requested it; disposal has nothing left to free.
    }
  }
}
