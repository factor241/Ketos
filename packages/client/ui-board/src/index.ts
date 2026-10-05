/**
 * Spatial multi-window board canvas plugin, host half.
 * Declares the durable layout as this profile entry's live configuration; the
 * browser half reads and writes it as the `ui-board` namespace.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { BoardSettingsSchema } from './board-settings.ts'

/**
 * Live board layout configuration: the whole document is client-writable, so
 * the schema is root-volatile and the settings service projects every field.
 */
export const Config = BoardSettingsSchema.volatile()

/**
 * Withdraw the auto-generated settings page: the board ships its own layout
 * UI. The entry stays addressable through the settings transport for the
 * browser half's `ui-board` namespace reads and writes.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
}
