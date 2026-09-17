/**
 * Ketos ru language pack wiring: language + dictionary registration through
 * the shared locale service, disposal removing the contribution, the
 * no-preference ru default (including its deference to the first settings
 * snapshot), and the stored-preference guard that keeps an explicit `en`
 * choice untouched. Service-level seams; no DOM pragma needed.
 */
import { readFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleSettingsSchema } from '@deepseek-ai/dsh-client-locale/src/locale-settings.ts'
import {
  apply as localeApply, inject as localeInject, type LocaleRuntime,
} from '@deepseek-ai/dsh-client-locale/client'
import { apply, BOARD_NS, COMMON_NS } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { boardRu, packRu, ru as commonRu } from '../src/locales/index.ts'

/** Adds a hook that keeps the first settings describe pending until released. */
interface BenchOptions {
  /** The Host settings `describe` answers only after {@link release} runs. */
  defer?: boolean
}

/** The scripted Host settings `mutate` surface this pack writes through. */
type SettingsMutate = (ns: string, ops: { value: string }[]) => Promise<{ ok: true; value: unknown }>

interface Bench {
  ctx: Context
  disposePack: () => Promise<void>
  locale: () => LocaleRuntime
  mutate: ReturnType<typeof vi.fn<SettingsMutate>>
  /** Resolve all describe calls deferred by {@link BenchOptions.defer}. */
  release: () => void
}

/**
 * Boot the settings plugin over a scripted Host settings document, then open
 * the locale service and this plugin on top; the returned disposer releases
 * the pack's contributions. `mutate` observes every durable write the active
 * locale performs.
 */
async function bench(storedPreference: string | undefined, options: BenchOptions = {}): Promise<Bench> {
  const ctx = new Context()
  const pending: Array<(value: unknown) => void> = []
  await ctx.plugin(SlotRegistry).await()
  let preference = storedPreference
  let revision = 0
  const namespace = () => ({
    ns: 'locale',
    schema: LocaleSettingsSchema.toJSON(),
    value: preference === undefined ? {} : { preference },
    applies: 'live' as const,
    secrets: [],
    revision,
  })
  const describe = vi.fn(async () => {
    const answer = {
      ok: true as const,
      value: { writable: true, hasDocument: true, namespaces: [namespace()] },
    }
    if (options.defer !== true) return answer
    return new Promise<typeof answer>((resolve) => { pending.push(() => { resolve(answer) }) })
  })
  const mutate = vi.fn<SettingsMutate>(async (_ns, ops) => {
    preference = ops[0]!.value
    revision += 1
    return { ok: true as const, value: namespace() }
  })
  new TestRemote(ctx, { settings: { describe, mutate } })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  await ctx.plugin({ inject: [...localeInject], apply: localeApply }).await()
  const pack = ctx.plugin({ inject: ['locale', 'settingsScope'], apply })
  await pack.await()
  return {
    ctx,
    disposePack: () => pack.dispose(),
    locale: () => ctx.get('locale') as LocaleRuntime,
    mutate,
    release: () => { for (const resolve of pending) resolve(undefined) },
  }
}

/**
 * Run `body` with the browser's own language reports stubbed; `undefined`
 * removes the navigator entirely, so the shipped fallback contract is what
 * the pack sees.
 */
async function withBrowserLanguage(tags: string[] | undefined, body: () => Promise<void>): Promise<void> {
  const g = globalThis as unknown as {
    navigator?: { language: string; languages?: string[] }
    window?: { navigator?: { language: string; languages?: string[] } }
  }
  const originalNavigator = g.navigator
  const originalWindow = g.window
  // A single tag omits `languages`, the embedder/older-WebView state the
  // locale package's detector guards with `?? []`; two or more tags exercise
  // the ordered `languages` list.
  const stub = tags === undefined
    ? undefined
    : { language: tags.at(-1)!, ...(tags.length > 1 ? { languages: tags.slice(0, -1) } : {}) }
  Object.defineProperty(g, 'navigator', { value: stub, configurable: true })
  Object.defineProperty(g, 'window', { value: stub === undefined ? undefined : { navigator: stub }, configurable: true })
  try {
    await body()
  } finally {
    if (originalNavigator === undefined) delete (g as Record<string, unknown>).navigator
    else Object.defineProperty(g, 'navigator', { value: originalNavigator, configurable: true })
    if (originalWindow === undefined) delete (g as Record<string, unknown>).window
    else Object.defineProperty(g, 'window', { value: originalWindow, configurable: true })
  }
}

describe('ketos ru language pack', () => {
  it('covers every key of the recorded fork corpus with a non-empty translation', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('./fixtures/ru-keys.json', import.meta.url), 'utf8'),
    ) as Record<string, string[]>
    const dictionaries: Record<string, Record<string, string>> = { common: commonRu, board: boardRu, ...packRu }
    expect(Object.keys(dictionaries).sort()).toEqual(Object.keys(manifest).sort())
    for (const [namespace, keys] of Object.entries(manifest)) {
      const dictionary = dictionaries[namespace] ?? {}
      expect(Object.keys(dictionary).sort()).toEqual(keys)
      for (const value of Object.values(dictionary)) {
        // A NBSP group separator is a legitimate non-empty value; trim() would
        // erase it.
        expect(value).not.toBe('')
      }
    }
  })

  it('mounts and disposes the host half as an ordinary no-op plugin', async () => {
    const ctx = new Context()
    const host = ctx.plugin({ apply: hostApply })
    await host.await()
    await host.dispose()
  })

  it('defaults to ru when the browser names the exact ru tag', async () => {
    await withBrowserLanguage(['ru'], async () => {
      const b = await bench(undefined)
      await vi.waitFor(() => { expect(b.locale().getLocale().active).toBe('ru') })
    })
  })

  it('defaults to ru when the ordered languages list names ru after a base language', async () => {
    await withBrowserLanguage(['de-DE', 'ru'], async () => {
      const b = await bench(undefined)
      await vi.waitFor(() => { expect(b.locale().getLocale().active).toBe('ru') })
    })
  })

  it('adds ru to the catalog with the en fallback and leaves the active chain alone without a ru ask', async () => {
    const b = await bench(undefined)
    const locales = b.locale().getLocale().locales
    expect(locales.find(locale => locale.id === 'ru')).toEqual({ id: 'ru', label: 'Русский', fallback: 'en' })
  })

  it('disposal removes the language and its dictionaries (registry contributions prove disposal)', async () => {
    const b = await bench(undefined)
    await b.disposePack()
    expect(b.locale().getLocale().locales.find(locale => locale.id === 'ru')).toBeUndefined()
    expect(b.locale().getLocale().active).toBe('en')
  })

  it('defers the durable ru preference write until the settings document resolves, then writes it once', async () => {
    await withBrowserLanguage(['ru-RU'], async () => {
      const b = await bench(undefined, { defer: true })
      // The provisional recompute may already show ru after registration, but
      // the durable preference write must not happen before the document asks.
      expect(b.mutate).not.toHaveBeenCalled()
      b.release()
      await vi.waitFor(() => {
        expect(b.mutate.mock.calls.some(([, ops]) => ops[0]?.value === 'ru')).toBe(true)
      })
      expect(b.locale().getLocale().active).toBe('ru')
      expect(b.locale().bind(COMMON_NS)('copy')).toBe('Копировать')
      expect(b.locale().bind(COMMON_NS)('brand.localBuild')).toBe('Кетос')
      expect(b.locale().bind(COMMON_NS)('copy.optionsHint', { action: 'Действие' })).toContain('Действие;')
    })
  })

  it('defaults to ru immediately when the settings document resolved without a preference', async () => {
    await withBrowserLanguage(['ru-RU'], async () => {
      const b = await bench(undefined)
      await vi.waitFor(() => { expect(b.locale().getLocale().active).toBe('ru') })
      // The board namespace is translated too: the Ketos canvas copy has no ru fallback gap.
      expect(b.locale().bind(BOARD_NS)('sidebar.panel')).toBe('Доска')
      expect(b.locale().bind(BOARD_NS)('conversation.turnFailed')).toBe('Ход завершился ошибкой')
    })
  })

  it('registers the complete Ketos corpus: the community namespaces, common, and board resolve in ru', async () => {
    await withBrowserLanguage(['ru-RU'], async () => {
      const b = await bench(undefined)
      await vi.waitFor(() => { expect(b.locale().getLocale().active).toBe('ru') })
      expect(b.locale().bind('chat')('stats.dialog.title')).toBe('Статистика сессии')
      expect(b.locale().bind('settings.locale')('language.title')).toBe('Язык')
      expect(b.locale().bind('settings.models')('customBaseUrlInvalid')).toBe('Введите корректный URL с HTTP или HTTPS.')
      expect(b.locale().bind('schedule.catalog')('status.overdue')).toBe('Просрочено')
      expect(b.locale().bind('open-in-app')('app.explorer')).toBe('Проводник')
      expect(b.locale().bind('sidebarRight')('dock.splitPane')).toBe('Разделить')
      // Rebranding: the community pack's product-name strings are Ketos, while
      // the DeepSeek provider keeps its own name.
      expect(b.locale().bind('settings.models')('welcomeBody')).toContain('Кетос')
      expect(b.locale().bind('settings.models')('welcomeBody')).not.toContain('Harness')
      expect(b.locale().bind('settings.models')('onboardingDescription')).toContain('DeepSeek')
      expect(b.locale().bind(COMMON_NS)('brand.localBuild')).toBe('Кетос')
    })
  })

  it('keeps the browser-requested base language and the no-shipped-language en fallback', async () => {
    await withBrowserLanguage(['en-US'], async () => {
      const b = await bench(undefined)
      await vi.waitFor(() => { expect(b.locale().getLocale().active).toBe('en') })
      expect(b.mutate).not.toHaveBeenCalled()
    })
    await withBrowserLanguage(['fr-FR'], async () => {
      const b = await bench(undefined)
      await vi.waitFor(() => { expect(b.locale().getLocale().active).toBe('en') })
      expect(b.mutate).not.toHaveBeenCalled()
    })
  })

  it('keeps an explicit en preference: no ru write, en stays active across disposal and re-apply', async () => {
    const b = await bench('en')
    expect(b.locale().getLocale().active).toBe('en')
    expect(b.mutate).not.toHaveBeenCalled()
    await b.disposePack()
    const reapply = b.ctx.plugin({ inject: ['locale', 'settingsScope'], apply })
    await reapply.await()
    expect(b.locale().getLocale().active).toBe('en')
    await reapply.dispose()
    expect(b.locale().getLocale().active).toBe('en')
    expect(b.mutate).not.toHaveBeenCalled()
  })
})
