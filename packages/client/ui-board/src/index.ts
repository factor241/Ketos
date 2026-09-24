/**
 * Spatial multi-window board canvas plugin, host half.
 * Registers the durable layout namespace in the user-settings document; the
 * browser half ships via exports["./client"].
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { BOARD_SETTINGS_NAMESPACE, BoardSettingsSchema } from './board-settings.ts'

/**
 * Register the durable layout section when the optional settings service is
 * composed. The registration is an effect of this plugin's fiber: unloading
 * the board withdraws the namespace.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(BOARD_SETTINGS_NAMESPACE, BoardSettingsSchema)
  })
}
