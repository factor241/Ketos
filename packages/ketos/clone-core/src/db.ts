/**
 * Owner of the `clones.db` file: the exclusive owner-only creation of the file,
 * the open sequence (journal mode, identity and version stamps), the lazy
 * handle the plugin shares, and its disposal.
 *
 * Opening is lazy on purpose: `node:sqlite` is imported on the first repository
 * call, so a process that never touches clones never prints Node's SQLite
 * experimental warning during startup.
 * @module @ketos/clone-core/db
 */

import type { DatabaseSync } from 'node:sqlite'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { MemoryRepository } from './memory.ts'
import { CloneRepository } from './repository.ts'
import { migrate } from './schema.ts'
import { INTERRUPTED_TASK_REASON, TaskRepository } from './task-repository.ts'

/* jscpd:ignore-start -- deliberately mirrors the storage-sqlite and
   session-query-sqlite open sequence. Each package owns a distinct database
   identity, schema, and version policy, so a shared medium helper would couple
   independently released packages. */
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
 * Open the clone database, creating its directory (`0700`) and file (`0600`)
 * when they are missing, and bring it to the current schema version. A foreign
 * application id or a newer schema version is refused, so an unrelated SQLite
 * file is never written to.
 * @param path - database path from the profile config, or `:memory:`.
 * @returns the open handle with the journal mode and schema applied.
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
    migrate(db)
    db.exec('PRAGMA journal_mode = WAL')
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}
/* jscpd:ignore-end */

/**
 * The plugin's database owner. The handle stays closed until the first
 * repository call and is closed by the plugin's disposal; `close()` is
 * idempotent and awaited, and a call after disposal fails instead of silently
 * reopening the file.
 */
export class CloneDatabase {
  private readonly path: string
  private opening: Promise<DatabaseSync> | undefined
  private repositoryPromise: Promise<CloneRepository> | undefined
  private memoryPromise: Promise<MemoryRepository> | undefined
  private taskPromise: Promise<TaskRepository> | undefined
  private closing: Promise<void> | undefined
  private disposed = false

  /**
   * @param path - database path from the profile config.
   */
  constructor(path: string) {
    this.path = path
  }

  /**
   * The clone repository over this database, opening the file on first use.
   * @returns the shared repository instance.
   */
  repository(): Promise<CloneRepository> {
    if (this.disposed) return Promise.reject(new Error('clone database: already closed'))
    this.repositoryPromise ??= this.openRepository().catch((error: unknown) => {
      // A failed attempt is not cached: a transient lock, permission, or
      // vanished-file failure would otherwise fail every later request until
      // the process restarts. Concurrent callers still share one attempt.
      this.repositoryPromise = undefined
      throw error
    })
    return this.repositoryPromise
  }

  /**
   * The memory repository over the same database, opening the file on first
   * use. Both repositories share one handle.
   * @returns the shared repository instance.
   */
  memoryRepository(): Promise<MemoryRepository> {
    if (this.disposed) return Promise.reject(new Error('clone database: already closed'))
    this.memoryPromise ??= this.openMemoryRepository().catch((error: unknown) => {
      // Same retry policy as {@link repository}: a failed open is not cached.
      this.memoryPromise = undefined
      throw error
    })
    return this.memoryPromise
  }

  /**
   * The task repository over the same database, opening the file on first use.
   * A task a previous process left `running` cannot continue — its goal and
   * round are gone — so the first open in a process settles such tasks as
   * failed before this repository answers anything.
   * @returns the shared repository instance.
   */
  taskRepository(): Promise<TaskRepository> {
    if (this.disposed) return Promise.reject(new Error('clone database: already closed'))
    this.taskPromise ??= this.openTaskRepository().catch((error: unknown) => {
      // Same retry policy as {@link repository}: a failed open is not cached.
      this.taskPromise = undefined
      throw error
    })
    return this.taskPromise
  }

  /**
   * Close the handle if it was opened. Safe before the first repository call
   * and safe to call more than once; a failed open is not rethrown here,
   * because the caller that asked for the repository already received it.
   * @returns a promise settling when the handle is closed.
   */
  close(): Promise<void> {
    this.closing ??= this.dispose()
    return this.closing
  }

  private async openRepository(): Promise<CloneRepository> {
    return new CloneRepository(await this.handle())
  }

  private async openMemoryRepository(): Promise<MemoryRepository> {
    return new MemoryRepository(await this.handle())
  }

  private async openTaskRepository(): Promise<TaskRepository> {
    const tasks = new TaskRepository(await this.handle())
    tasks.failInterrupted(INTERRUPTED_TASK_REASON)
    return tasks
  }

  /**
   * The open handle, opening the file on first use. A failed open clears the
   * shared attempt so the next call retries.
   */
  private async handle(): Promise<DatabaseSync> {
    try {
      this.opening ??= openDatabase(this.path)
      const db = await this.opening
      // Disposal may have won the race while the file was opening; the handle
      // belongs to `dispose()` from here on, so no caller receives it.
      if (this.disposed) throw new Error('clone database: already closed')
      return db
    } catch (error: unknown) {
      this.opening = undefined
      throw error
    }
  }

  private async dispose(): Promise<void> {
    const opening = this.opening
    this.disposed = true
    this.opening = undefined
    this.repositoryPromise = undefined
    this.memoryPromise = undefined
    this.taskPromise = undefined
    if (opening === undefined) return
    let db: DatabaseSync
    try {
      db = await opening
    } catch {
      // The failed open already closed its own handle and was reported to the
      // caller that requested the repository; disposal has nothing left to free.
      return
    }
    db.close()
  }
}
