/**
 * Preferred-model route of one clone: the stored `provider/model` string the
 * editor's picker produces and `remote.session.selectModel` consumes.
 */

/** One model route split into the parts the model selection accepts. */
export interface CloneModelRoute {
  readonly provider: string
  readonly model: string
}

/**
 * Split one stored preferred-model route at its first separator. Provider ids
 * carry no slash, so a model id that contains one stays intact.
 * @param route - stored `provider/model` value.
 * @returns the parts, or undefined when the value names no route.
 */
export function parseModelRoute(route: string): CloneModelRoute | undefined {
  const at = route.indexOf('/')
  if (at <= 0 || at === route.length - 1) return undefined
  return { provider: route.slice(0, at), model: route.slice(at + 1) }
}

/**
 * Compose the stored value of one picker row.
 * @param provider - provider id.
 * @param model - model id inside that provider.
 * @returns the stored route.
 */
export function formatModelRoute(provider: string, model: string): string {
  return `${provider}/${model}`
}
