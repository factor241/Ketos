/**
 * Ketos ru language pack wiring: language + dictionary registration through
 * the shared locale service, disposal removing the contribution, the
 * no-preference ru default (including its deference to the first settings
 * snapshot), and the stored-preference guard that keeps an explicit `en`
 * choice untouched. Service-level seams; no DOM pragma needed.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleSettingsSchema } from '@deepseek-ai/dsh-client-locale/src/locale-settings.ts'
import {
  apply as localeApply, inject as localeInject, type LocaleRuntime,
} from '@deepseek-ai/dsh-client-locale/client'
import { apply, COMMON_NS, SETTINGS_NS } from '../src/client/index.ts'

/** Adds a hook that keeps the first settings describe pending until released. */
interface BenchOptions {
  /** The Host settings `describe` answers only after {@link release} runs. */
  defer?: boolean
}

interface Bench {
  ctx: Context
  disposePack: () => Promise<void>
  locale: () => LocaleRuntime
  mutate: ReturnType<typeof vi.fn>
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
    return new Promise<typeof answer>((resolve) => { pending.push(() => resolve(answer)) })
  })
  const mutate = vi.fn(async (_ns: string, ops: { value: string }[]) => {
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

describe('ketos ru language pack', () => {
  it('adds ru to the catalog with the en fallback and translates the registered namespaces', async () => {
    const b = await bench(undefined)
    const locales = b.locale().getLocale().locales
    expect(locales.find(locale => locale.id === 'ru')).toEqual({ id: 'ru', label: 'Русский', fallback: 'en' })
    // The settings row copy answers in Russian through the namespace's own seat.
    expect(b.locale().bind(SETTINGS_NS)('language.title')).toBe('Язык')
  })

  it('disposal removes the language and its dictionaries (registry contributions prove disposal)', async () => {
    const b = await bench(undefined)
    await b.disposePack()
    expect(b.locale().getLocale().locales.find(locale => locale.id === 'ru')).toBeUndefined()
    expect(b.locale().getLocale().active).toBe('en')
  })

  it('defers the no-preference default until the settings document resolves, then applies ru', async () => {
    const b = await bench(undefined, { defer: true })
    expect(b.locale().getLocale().active).not.toBe('ru')
    b.release()
    await vi.waitFor(() => { expect(b.locale().getLocale().active).toBe('ru') })
    expect(b.locale().bind(COMMON_NS)('copy')).toBe('Копировать')
    expect(b.locale().bind(COMMON_NS)('brand.localBuild')).toBe('Локальная сборка Кетос')
    expect(b.locale().bind(COMMON_NS)('copy.optionsHint', { action: 'Действие' })).toContain('Действие;')
  })

  it('defaults to ru immediately when the stored document already resolved without a preference', async () => {
    const b = await bench(undefined)
    await vi.waitFor(() => { expect(b.locale().getLocale().active).toBe('ru') })
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
