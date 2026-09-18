/**
 * Durable settings transport of the board: the first-frame cache read from
 * localStorage, the server section seen through the shared settings describe
 * mirror, and the debounced revision-checked write path. The section carries
 * both halves the board persists — the layout document the store owns and the
 * window → session bindings the session bridge owns — so one writer keeps the
 * revision and the merge discipline. Every subscription and timer lives here in
 * the plugin's apply; components only write the store.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the ctx.settingsScope Context merge and the mirror face the board
// derives from (the shared describe reader; cross-plugin collaboration goes
// through the service, never a value import).
import type { SettingsDescribeFace } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  BOARD_SETTINGS_NAMESPACE, type BoardLayoutDocument, type BoardSettings, type BoardSettingsBindings,
} from '../board-settings.ts'
import { captureBoardLayout, sanitizeBoardLayout } from './board-layout.ts'
import type { BoardStoreInstance } from './store.ts'

/** localStorage entry holding the last written document for the first frame. */
export const BOARD_LAYOUT_CACHE_KEY = 'dsh.board.layout'

/** Quiet period after the last layout change before the settings write. */
export const BOARD_LAYOUT_WRITE_DEBOUNCE_MS = 600

/** Floor between two settings writes, so discrete gestures stay at most one write per second. */
export const BOARD_LAYOUT_WRITE_MIN_INTERVAL_MS = 1000

/** Cached stored section plus the settings revision it was written under. */
interface BoardLayoutCache {
  /** Namespace revision the write answered with. */
  revision: number
  /** The repaired section that write stored. */
  settings: BoardSettings
}

/**
 * Read the first-frame cache; unreadable or unsanitizable entries are ignored.
 * A cache written before the bindings existed holds none, which the repair
 * resolves to the empty map.
 * @returns the cached section and revision, or undefined without a usable entry.
 */
export function readBoardLayoutCache(): BoardLayoutCache | undefined {
  if (typeof localStorage === 'undefined') return undefined
  try {
    const raw = localStorage.getItem(BOARD_LAYOUT_CACHE_KEY)
    if (raw === null) return undefined
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const { revision, layout, bindings } = parsed as { revision?: unknown; layout?: unknown; bindings?: unknown }
    if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) return undefined
    const repaired = sanitizeBoardLayout({ ...(typeof layout === 'object' && layout !== null ? layout : {}), bindings })
    if (repaired === undefined) return undefined
    return { revision, settings: repaired }
  } catch (error) {
    console.warn('ui-board: ignoring the unreadable layout cache', error)
    return undefined
  }
}

/**
 * Store one accepted section in the first-frame cache; storage failures only drop the cache.
 * @param revision - namespace revision the write answered with.
 * @param settings - the accepted layout and bindings.
 */
export function writeBoardLayoutCache(revision: number, settings: BoardSettings): void {
  if (typeof localStorage === 'undefined') return
  try {
    const { bindings, ...layout } = settings
    localStorage.setItem(BOARD_LAYOUT_CACHE_KEY, JSON.stringify({ revision, layout, bindings }))
  } catch (error) {
    console.warn('ui-board: layout cache write failed', error)
  }
}

/** Identity comparison of two documents or maps: both build the same key order every time. */
function serialize(value: BoardLayoutDocument | BoardSettingsBindings): string {
  return JSON.stringify(value)
}

/**
 * Settings persistence of one board plugin fiber. The class owns the store
 * subscription, the mirror subscription, the debounce timer, the live bindings
 * map, and the last written section; {@link dispose} leaves no listener or
 * timer behind. Reads and writes derive from the shared settings mirror, so the
 * board adds no `settings.describe` read of its own and inherits the client's
 * loopback persistence policy (a mirror that stays `unavailable` never writes).
 */
export class BoardLayoutPersistence {
  /** Serialized form of the last layout the server accepted (or the cache holds). */
  private lastLayout: string | undefined
  /** Serialized form of the last bindings map the server accepted (or the cache holds). */
  private lastBindings: string | undefined
  /** The window → session map to write; the session bridge owns its content. */
  private bindings: BoardSettingsBindings = {}
  /** Revision the adopted cache was written under; undefined when no cache was adopted. */
  private cacheRevision: number | undefined
  /** Whether the one startup adoption of the server document already ran. */
  private serverChecked = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private unsubscribeStore: (() => void) | undefined
  private unsubscribeScope: (() => void) | undefined
  /** Consumer told about every adopted section; the session bridge restores from it. */
  private adoptListener: ((settings: BoardSettings) => void) | undefined
  /** Serialized write chain, so an in-flight write never overlaps the next. */
  private tail: Promise<void> = Promise.resolve()
  private lastWriteAt = 0
  private disposed = false

  /**
   * @param ctx - the board plugin's context, whose `remote.settings` namespace carries the writes.
   * @param describeFace - the shared describe mirror's read/fold face.
   * @param instance - the board's shared store instance, read on every capture.
   */
  constructor(
    private readonly ctx: ClientContext,
    private readonly describeFace: SettingsDescribeFace,
    private readonly instance: BoardStoreInstance,
  ) {}

  /**
   * Register the one consumer of adopted sections. The callback runs on every
   * adoption — the first-frame cache read and the server document — so the
   * session bridge can restore its window → session map from either.
   * @param listener - called with the repaired section the board just adopted.
   */
  onAdopt(listener: (settings: BoardSettings) => void): void {
    this.adoptListener = listener
  }

  /**
   * Adopt the cached section synchronously, before the first render. The cache
   * is the same section the server stores, so hydration is a plain replace;
   * a missing or unreadable cache leaves the store's initial state.
   */
  hydrateFromCache(): void {
    const cached = readBoardLayoutCache()
    if (cached === undefined) return
    const { bindings, ...layout } = cached.settings
    this.instance.actions.hydrate(layout)
    this.cacheRevision = cached.revision
    this.lastLayout = serialize(layout)
    this.bindings = bindings
    this.lastBindings = serialize(bindings)
    this.adoptListener?.(cached.settings)
  }

  /**
   * Replace the bindings map the bridge owns and schedule its write. Called on
   * the bridge's discrete events — creation, rebind, close — never per frame.
   * @param bindings - the complete current window → session map.
   */
  writeBindings(bindings: BoardSettingsBindings): void {
    if (this.disposed) return
    this.bindings = bindings
    this.scheduleWrite()
  }

  /**
   * Adopt the current document as the write baseline, follow every store
   * change, and adopt the server document once the mirror answers. The
   * baseline means a frame-driven change (the canvas measuring its viewport)
   * that does not move the stored fields writes nothing, so the first write
   * always answers a real layout gesture. Without a first-frame cache the
   * server document is adopted whatever its revision: it is the only layout
   * this browser has. With a cache, the server wins when it is ahead and the
   * cache is pushed back when a write was lost (for example the process ended
   * inside the debounce).
   */
  start(): void {
    this.lastLayout ??= serialize(captureBoardLayout(this.instance.getSnapshot()))
    this.lastBindings ??= serialize(this.bindings)
    this.unsubscribeStore = this.instance.subscribe(() => { this.scheduleWrite() })
    this.unsubscribeScope = this.describeFace.subscribe(() => { this.adoptServerLayout() })
    this.adoptServerLayout()
  }

  /** Stop following the store and the mirror, and drop the pending write. */
  dispose(): void {
    this.disposed = true
    this.unsubscribeStore?.()
    this.unsubscribeStore = undefined
    this.unsubscribeScope?.()
    this.unsubscribeScope = undefined
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  /** Adopt the server section once the mirror holds a ready answer with the namespace. */
  private adoptServerLayout(): void {
    if (this.disposed || this.serverChecked) return
    const snapshot = this.describeFace.getSnapshot()
    if (snapshot.status !== 'ready') return
    const view = snapshot.view?.namespaces.find(entry => entry.ns === BOARD_SETTINGS_NAMESPACE)
    if (view === undefined) return
    this.serverChecked = true
    if (view.user === undefined) return
    const settings = sanitizeBoardLayout(view.user)
    if (settings === undefined) return
    if (this.cacheRevision === undefined || view.revision > this.cacheRevision) {
      const { bindings, ...layout } = settings
      this.instance.actions.hydrate(layout)
      this.lastLayout = serialize(layout)
      this.bindings = bindings
      this.lastBindings = serialize(bindings)
      // The adopted section is what the next first frame should paint.
      writeBoardLayoutCache(view.revision, settings)
      this.adoptListener?.(settings)
    } else if (view.revision < this.cacheRevision) {
      this.lastLayout = undefined
      this.scheduleWrite()
    }
  }

  /** Debounce one write, never closer than {@link BOARD_LAYOUT_WRITE_MIN_INTERVAL_MS} to the previous one. */
  private scheduleWrite(): void {
    if (this.disposed) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    const sinceLast = Date.now() - this.lastWriteAt
    const delay = Math.max(BOARD_LAYOUT_WRITE_DEBOUNCE_MS, BOARD_LAYOUT_WRITE_MIN_INTERVAL_MS - sinceLast)
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.tail = this.tail.then(() => this.writeCurrent())
    }, delay)
  }

  /** Write the current section when the mirror is writable and either half moved. */
  private async writeCurrent(): Promise<void> {
    if (this.disposed) return
    const snapshot = this.describeFace.getSnapshot()
    // A non-loopback page keeps preferences process-local: the mirror stays
    // unavailable and never writes, and the board still paints its cache.
    if (snapshot.status !== 'ready' || snapshot.view?.writable !== true) return
    const layout = captureBoardLayout(this.instance.getSnapshot())
    const serializedLayout = serialize(layout)
    const serializedBindings = serialize(this.bindings)
    if (serializedLayout === this.lastLayout && serializedBindings === this.lastBindings) return
    this.lastWriteAt = Date.now()
    const revision = snapshot.view.namespaces.find(entry => entry.ns === BOARD_SETTINGS_NAMESPACE)?.revision
    await this.writeDocument({ ...layout, bindings: this.bindings }, serializedLayout, serializedBindings, revision, false)
  }

  /** One settings write, with one retry at the revision the conflict reported. */
  private async writeDocument(
    settings: BoardSettings,
    serializedLayout: string,
    serializedBindings: string,
    revision: number | undefined,
    retried: boolean,
  ): Promise<void> {
    let response
    try {
      response = await this.ctx.remote.settings.update(
        BOARD_SETTINGS_NAMESPACE,
        settings,
        revision,
      )
    } catch (error) {
      // A transport failure only loses this attempt: the store keeps the
      // layout, the next change schedules another write.
      console.warn('ui-board: layout write failed', error)
      return
    }
    if (this.disposed) return
    if (response.ok) {
      this.describeFace.acceptView(response.value)
      this.lastLayout = serializedLayout
      this.lastBindings = serializedBindings
      writeBoardLayoutCache(response.value.revision, settings)
      return
    }
    if (response.error.code === 'settings/conflict' && !retried) {
      // Last-writer-wins over another tab is deliberate: the layout belongs to
      // the user's latest gesture, and the revision the conflict reports is
      // the re-read that makes the retry land instead of conflicting forever.
      await this.writeDocument(settings, serializedLayout, serializedBindings, response.error.details.actual, true)
      return
    }
    console.warn(`ui-board: layout write refused (${response.error.code}): ${response.error.message}`)
  }
}
