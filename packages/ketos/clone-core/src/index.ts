/**
 * Ketos clone core: the first host package of the Ketos fork. It owns the
 * clone database (`$DSH_HOME/clones.db`), its forward-only schema, the exact
 * Fetch routes the board's clone windows read and write through, and the
 * clone session scope: the profile and memory an agent of a bound session
 * carries, and the interview mode it enters while it drafts a clone's profile.
 *
 * The database opens on the first request, so a process that never touches
 * clones never imports `node:sqlite` and startup output stays quiet.
 * @module @ketos/clone-core
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-projection'
import { CloneDatabase } from './db.ts'
import { registerMemoryRoutes } from './memory-routes.ts'
import { registerCloneRoutes } from './routes.ts'
import {
  CloneSessionCoordinator, DEFAULT_MEMORY_CHARS, DEFAULT_MEMORY_ENTRIES, MAX_MEMORY_CHARS, MAX_MEMORY_ENTRIES,
} from './session.ts'

/** Loader entry name of the plugin. */
export const name = 'ketos-clone-core'

/**
 * Services the plugin needs: the authenticated Fetch surface it registers on,
 * the live agents whose interview mode it derives, the projection registry
 * that makes the interview kickoff exactly once per session, and the two
 * registries the per-agent interview scope contributes to.
 */
export const inject = ['connection', 'agents', 'sessionProjections', 'tools', 'systemPrompt']

/** Deployment configuration of the clone domain. */
export interface Config {
  /**
   * Path of the clone database file. The shipped web profile passes
   * `dshHomePath('clones.db')`; the parent directory is created owner-only
   * before the file is opened.
   */
  path: string
  /**
   * Largest number of active memories the prompt snapshot lists. The default
   * suits a clone that remembers a handful of working facts; deeper lookup is
   * the `clone_memory_search` tool.
   */
  memoryEntries?: number
  /** Largest total length, in characters, of the prompt memory snapshot. */
  memoryChars?: number
}

/** Schemastery configuration of the clone domain; only the path is required. */
export const Config: z<Config> = z.object({
  path: z.string().required(),
  memoryEntries: z.number().step(1).min(1).max(MAX_MEMORY_ENTRIES).default(DEFAULT_MEMORY_ENTRIES),
  memoryChars: z.number().step(1).min(1).max(MAX_MEMORY_CHARS).default(DEFAULT_MEMORY_CHARS),
})

/**
 * Own the clone database for the lifetime of the plugin, register its routes,
 * and follow the clone session scope of bound sessions.
 * @param ctx - host context carrying `connection`, `agents`, and `sessionProjections`.
 * @param config - deployment's database path and prompt snapshot budget.
 */
export function apply(ctx: Context, config: Config): void {
  const database = new CloneDatabase(config.path)
  // Registration order matters at disposal: the routes' effects are created
  // last, so they are withdrawn before this effect closes the handle.
  ctx.effect(() => () => database.close(), 'ketos-clone-core: clones.db')
  const sessions = new CloneSessionCoordinator(ctx, database, {
    entries: config.memoryEntries ?? DEFAULT_MEMORY_ENTRIES,
    chars: config.memoryChars ?? DEFAULT_MEMORY_CHARS,
  })
  sessions.start()
  registerCloneRoutes(ctx, database, () => { void sessions.cloneDataChanged() })
  registerMemoryRoutes(ctx, database, () => { void sessions.cloneDataChanged() })
}
