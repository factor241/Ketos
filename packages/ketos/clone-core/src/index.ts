/**
 * Ketos clone core: the first host package of the Ketos fork. It owns the
 * clone database (`$DSH_HOME/clones.db`), its forward-only schema, and the
 * exact Fetch route the board's clone windows read and write through.
 *
 * The database opens on the first request, so a process that never touches
 * clones never imports `node:sqlite` and startup output stays quiet.
 * @module @ketos/clone-core
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { CloneDatabase } from './db.ts'
import { registerCloneRoutes } from './routes.ts'

/** Loader entry name of the plugin. */
export const name = 'ketos-clone-core'

/** Services the plugin needs: the authenticated Fetch surface it registers on. */
export const inject = ['connection']

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
 * Own the clone database for the lifetime of the plugin and register its route.
 * @param ctx - host context carrying `connection`.
 * @param config - deployment's database path.
 */
export function apply(ctx: Context, config: Config): void {
  const database = new CloneDatabase(config.path)
  // Registration order matters at disposal: the route's effect is created last,
  // so it is withdrawn before this effect closes the handle.
  ctx.effect(() => () => database.close(), 'ketos-clone-core: clones.db')
  registerCloneRoutes(ctx, database)
}
