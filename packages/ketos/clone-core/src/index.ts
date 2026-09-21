/**
 * Ketos clone core: the first host package of the Ketos fork. It owns the
 * clone database (`$DSH_HOME/clones.db`), its forward-only schema, the exact
 * Fetch route the board's clone windows read and write through, and the
 * interview mode a session enters while it drafts a clone's profile.
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
import { CloneInterviewCoordinator } from './interview.ts'
import { registerCloneRoutes } from './routes.ts'

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
}

/** Schemastery configuration of the clone domain; the path has no default. */
export const Config: z<Config> = z.object({
  path: z.string().required(),
})

/**
 * Own the clone database for the lifetime of the plugin, register its route,
 * and follow the interview mode of bound sessions.
 * @param ctx - host context carrying `connection`, `agents`, and `sessionProjections`.
 * @param config - deployment's database path.
 */
export function apply(ctx: Context, config: Config): void {
  const database = new CloneDatabase(config.path)
  // Registration order matters at disposal: the route's effect is created last,
  // so it is withdrawn before this effect closes the handle.
  ctx.effect(() => () => database.close(), 'ketos-clone-core: clones.db')
  const interviews = new CloneInterviewCoordinator(ctx, database)
  interviews.start()
  registerCloneRoutes(ctx, database, () => { void interviews.clonesChanged() })
}
