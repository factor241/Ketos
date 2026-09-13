/**
 * Ketos Russian language pack, browser half. Registers the `ru` locale with
 * the shared locale service, translates the `common` and `settings.locale`
 * namespaces, and applies Russian as the default active locale exactly once —
 * only when the durable locale preference is absent. An explicit user choice
 * (for example English) is adopted by the locale service's own scope
 * subscription; this plugin observes it and never writes over it.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.locale service merge and the shared key unions
// (cross-plugin collaboration goes through the service, never a value import —
// client bundle purity gate).
import type { LocaleSettings } from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { ru, settingsRu } from '../locales/index.ts'

// Value import from the same package's browser face is impossible without a
// feature-plugin dependency; the browser-name check mirrors
// `detectBrowserLocale` in dsh-client-locale, whose token ordering contract
// this helper keeps local.
const RU_TOKEN = 'ru'

/** Mirror of the locale package's namespace constants; type-only import contract. */
const LOCALE_SETTINGS_NAMESPACE = 'locale'
/** Mirror of the locale package's preference field constant. */
const LOCALE_PREFERENCE_FIELD = 'preference'

/** Namespace of the shared shell vocabulary. */
export const COMMON_NS = 'common'
/** Namespace of the locale feature's own settings-row copy. */
export const SETTINGS_NS = 'settings.locale'

/**
 * Whether the browser asks for Russian without naming a base language first.
 * Mirrors `detectBrowserLocale` in dsh-client-locale word-for-word: tags
 * match `ru` exactly, by primary subtag, and the ordered `languages` list
 * precedes `language`; the list order wins. A browser naming a base language
 * (`zh`, `en`) first keeps the ordinary chain, and the shipped
 * no-shipped-language fallback stays English, so the Ketos default applies
 * only when the deployment's browser itself asks for Russian.
 * Non-browser runs report `false` and keep the shipped fallback.
 * @returns `true` when the browser asks for `ru` and the default may apply.
 */
function browserAsksRu(): boolean {
  if (typeof window === 'undefined') return false
  const navigator = (window as { readonly navigator?: { language?: string; languages?: readonly string[] } }).navigator
  for (const tag of [...(navigator?.languages ?? []), navigator?.language]) {
    if (tag === undefined) continue
    const requested = tag.toLowerCase()
    if (requested === RU_TOKEN) return true
    if (requested.startsWith(`${RU_TOKEN}-`)) return true
    if (requested.split('-')[0] === RU_TOKEN) return true
  }
  return false
}

/** Required services: the locale registry and the settings transport. */
export const inject = ['locale', 'settingsScope']

/**
 * Client plugin body: add `ru` to the language catalog, register its
 * dictionaries, and default the active locale to `ru` once, when the settings
 * document exposes no `locale.preference`. The defaults decision fires on the
 * first resolved settings snapshot; before that first acceptance the scope
 * reports `loading`, and the plugin defers so it can never overwrite an
 * explicit selection that simply has not arrived yet. A scope resolving as
 * `unavailable` (non-loopback page, process-local preferences) keeps the
 * browser-derived locale instead of guessing.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  const locale = ctx.locale
  ctx.effect(
    () => locale.addLanguage({ id: 'ru', label: 'Русский', fallback: 'en' }),
    'ketos-locale-ru: language registration',
  )
  ctx.effect(
    () => locale.register(COMMON_NS, 'ru', ru),
    'ketos-locale-ru: common dictionary',
  )
  ctx.effect(
    () => locale.register(SETTINGS_NS, 'ru', settingsRu),
    'ketos-locale-ru: settings.locale dictionary',
  )

  // The runtime's own scope adoption resolves stored preferences; this watcher
  // only decides the no-preference default, once, and then stands down.
  const scope = ctx.settingsScope.bind<LocaleSettings>({ namespace: LOCALE_SETTINGS_NAMESPACE })
  let defaulted = false
  const applyDefaultOnce = (): void => {
    const snapshot = scope.getSnapshot()
    if (defaulted || snapshot.status === 'loading') return
    defaulted = true
    // An unavailable scope stays on the browser-derived locale; the pack
    // defaults to `ru` only when the browser itself asks for Russian and no
    // stored preference exists, leaving the shipped zh/en fallback contract
    // untouched otherwise.
    if (snapshot.status === 'ready' && snapshot.value?.[LOCALE_PREFERENCE_FIELD] === undefined) {
      if (browserAsksRu()) locale.setLocale('ru')
    }
  }
  ctx.effect(() => {
    const unsubscribe = scope.subscribe(applyDefaultOnce)
    applyDefaultOnce()
    return unsubscribe
  }, 'ketos-locale-ru: default locale without a stored preference')
}
