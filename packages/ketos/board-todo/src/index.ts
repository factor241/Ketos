/**
 * Ketos board to-do lists host package: one Beads epic per list in the
 * Ketos-owned Beads database under `$DSH_HOME/beads`, reached through the
 * queued, telemetry-free `bd` CLI; the `/api/ketos.board.todo` Fetch route
 * the board's to-do element calls; and the `/todo` command that creates a
 * list from chat.
 *
 * The board document stays the single stored snapshot of each list: every
 * change goes through `bd`, then the items are re-read and the snapshot is
 * written back through `ctx.ketosBoardDoc`, so the browser and the second
 * Ketos see the same element the owner's host holds.
 * @module @ketos/board-todo
 */

import type { Context } from '@deepseek-ai/cordis'
// The type import applies the board document's `ctx.ketosBoardDoc` Context
// declaration merge; the service stays outside the upstream Cordis catalog.
import type { KetosBoardDocService } from '@ketos/board-doc/src/service.ts'
import z from '@deepseek-ai/schemastery'
import { BeadsCli } from './beads.ts'
import { todoCommand } from './command.ts'
import { registerTodoRoutes } from './routes.ts'
import type { TodoRouteConfig } from './routes.ts'

/** Loader entry name of the plugin. */
export const name = 'ketos-board-todo'

/** Services the plugin needs at its root. */
export const inject = ['connection', 'subprocess', 'commands', 'ketosBoardDoc']

/** Deployment configuration of the to-do lists. */
export interface Config {
  /**
   * Directory holding the Ketos Beads database. The `bd` CLI stores the
   * database in `<beadsDir>/.beads`; the shipped web profile passes
   * `dshHomePath('beads')`. The directory is created owner-only before the
   * first call.
   */
  beadsDir: string
  /** Executable name or absolute path of the Beads CLI (`bd`). */
  bdCommand?: string
  /** Issue prefix `bd init` gives the Ketos database. */
  beadsPrefix?: string
  /** Largest time one `bd` call may run, in milliseconds (1000–300000). */
  bdTimeoutMs?: number
  /** Largest stdout one `bd` call may produce, in bytes (1 KiB–64 MiB). */
  bdOutputMaxBytes?: number
  /** Largest list or item title, in UTF-16 code units (1–10000). */
  todoTitleMaxChars?: number
}

/** Schemastery configuration of the to-do lists; only the directory is required. */
export const Config: z<Config> = z.object({
  beadsDir: z.string().required(),
  bdCommand: z.string().default('bd'),
  beadsPrefix: z.string().default('kt'),
  bdTimeoutMs: z.number().step(1).min(1000).max(300_000).default(15_000),
  bdOutputMaxBytes: z.number().step(1).min(1024).max(67_108_864).default(1_048_576),
  todoTitleMaxChars: z.number().step(1).min(1).max(10_000).default(200),
})

/**
 * Own the to-do lists for the lifetime of the plugin: provide the `bd`
 * wrapper, register the Fetch route, and register the `/todo` command.
 * @param ctx - host context carrying the injected services.
 * @param config - deployment's Beads directory and call bounds.
 */
export function apply(ctx: Context, config: Config): void {
  const logger = (message: string): void => { ctx.logger('ketos-board-todo').warn(message) }
  const doc: KetosBoardDocService = ctx.ketosBoardDoc
  const routeConfig: TodoRouteConfig = {
    doc,
    beads: new BeadsCli(ctx.subprocess, {
      beadsDir: config.beadsDir,
      bdCommand: config.bdCommand as string,
      beadsPrefix: config.beadsPrefix as string,
      bdTimeoutMs: config.bdTimeoutMs as number,
      bdOutputMaxBytes: config.bdOutputMaxBytes as number,
      todoTitleMaxChars: config.todoTitleMaxChars as number,
      logger,
    }),
    titleMaxChars: config.todoTitleMaxChars as number,
    logger,
  }
  registerTodoRoutes(ctx, routeConfig)
  ctx.effect(() => ctx.commands.register(todoCommand(routeConfig)), 'ketos-board-todo: command')
}
