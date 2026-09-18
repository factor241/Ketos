/**
 * Durable layout transport of the board: the first-frame cache read from
 * localStorage, the server document seen through the shared settings describe
 * mirror, and the debounced revision-checked write path. Every subscription and
 * timer lives here in the plugin's apply; components only write the store.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the ctx.settingsScope Context merge and the mirror face the board
// derives from (the shared describe reader; cross-plugin collaboration goes
// through the service, never a value import).
import type { SettingsDescribeFace } from '@deepseek-ai/dsh-client-ui-settings/client'
import { BOARD_SETTINGS_NAMESPACE, type BoardLayoutDocument } from '../board-settings.ts'
import { captureBoardLayout, sanitizeBoardLayout } from './board-layout.ts'
import type { BoardStoreInstance } from './store.ts'

/** localStorage entry holding the last written document for the first frame. */
export const BOARD_LAYOUT_CACHE_KEY = 'dsh.board.layout'

/** Quiet period after the last layout change before the settings write. */
export const BOARD_LAYOUT_WRITE_DEBOUNCE_MS = 600

/** Floor between two settings writes, so discrete gestures stay at most one write per second. */
export const BOARD_LAYOUT_WRITE_MIN_INTERVAL_MS = 1000

/** Cached document plus the settings revision it was written under. */
interface BoardLayoutCache {
  /** Namespace revision the write answered with. */
  revision: number
  /** The document that write stored. */
  layout: BoardLayoutDocument
}

/**
 * Read the first-frame cache; unreadable or unsanitizable entries are ignored.
 * @returns the cached document and revision, or undefined without a usable entry.
 */
export function readBoardLayoutCache(): BoardLayoutCache | undefined {
  if (typeof localStorage === 'undefined') return undefined
  try {
    const raw = localStorage.getItem(BOARD_LAYOUT_CACHE_KEY)
    if (raw === null) return undefined
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const { revision, layout } = parsed as { revision?: unknown; layout?: unknown }
    if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) return undefined
    const sanitized = sanitizeBoardLayout(layout)
    if (sanitized === undefined) return undefined
    return { revision, layout: sanitized }
  } catch (error) {
    console.warn('ui-board: ignoring the unreadable layout cache', error)
    return undefined
  }
}

/**
 * Store one document in the first-frame cache; storage failures only drop the cache.
 * @param revision - namespace revision the write answered with.
 * @param layout - the accepted document.
 */
export function writeBoardLayoutCache(revision: number, layout: BoardLayoutDocument): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(BOARD_LAYOUT_CACHE_KEY, JSON.stringify({ revision, layout }))
  } catch (error) {
    console.warn('ui-board: layout cache write failed', error)
  }
}

/** Identity comparison of two documents: capture builds the same key order every time. */
function serialize(layout: BoardLayoutDocument): string {
  return JSON.stringify(layout)
}

/**
 * Layout persistence of one board plugin fiber. The class owns the store
 * subscription, the mirror subscription, the debounce timer, and the last
 * written document; {@link dispose} leaves no listener or timer behind. Reads
 * and writes derive from the shared settings mirror, so the board adds no
 * `settings.describe` read of its own and inherits the client's loopback
 * persistence policy (a mirror that stays `unavailable` never writes).
 */
export class BoardLayoutPersistence {
  /** Serialized form of the last document the server accepted (or the cache holds). */
  private lastDocument: string | undefined
  /** Revision the adopted cache was written under; undefined when no cache was adopted. */
  private cacheRevision: number | undefined
  /** Whether the one startup adoption of the server document already ran. */
  private serverChecked = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private unsubscribeStore: (() => void) | undefined
  private unsubscribeScope: (() => void) | undefined
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
   * Adopt the cached layout synchronously, before the first render. The cache
   * is the same document the server stores, so hydration is a plain replace;
   * a missing or unreadable cache leaves the store's initial state.
   */
  hydrateFromCache(): void {
    const cached = readBoardLayoutCache()
    if (cached === undefined) return
    this.instance.actions.hydrate(cached.layout)
    this.cacheRevision = cached.revision
    this.lastDocument = serialize(cached.layout)
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
    this.lastDocument ??= serialize(captureBoardLayout(this.instance.getSnapshot()))
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

  /** Adopt the server document once the mirror holds a ready answer with the namespace. */
  private adoptServerLayout(): void {
    if (this.disposed || this.serverChecked) return
    const snapshot = this.describeFace.getSnapshot()
    if (snapshot.status !== 'ready') return
    const view = snapshot.view?.namespaces.find(entry => entry.ns === BOARD_SETTINGS_NAMESPACE)
    if (view === undefined) return
    this.serverChecked = true
    if (view.user === undefined) return
    const layout = sanitizeBoardLayout(view.user)
    if (layout === undefined) return
    if (this.cacheRevision === undefined || view.revision > this.cacheRevision) {
      this.instance.actions.hydrate(layout)
      this.lastDocument = serialize(layout)
      // The adopted document is what the next first frame should paint.
      writeBoardLayoutCache(view.revision, layout)
    } else if (view.revision < this.cacheRevision) {
      this.lastDocument = undefined
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

  /** Write the current document when the mirror is writable and the document moved. */
  private async writeCurrent(): Promise<void> {
    if (this.disposed) return
    const snapshot = this.describeFace.getSnapshot()
    // A non-loopback page keeps preferences process-local: the mirror stays
    // unavailable and never writes, and the board still paints its cache.
    if (snapshot.status !== 'ready' || snapshot.view?.writable !== true) return
    const layout = captureBoardLayout(this.instance.getSnapshot())
    const serialized = serialize(layout)
    if (serialized === this.lastDocument) return
    this.lastWriteAt = Date.now()
    const revision = snapshot.view.namespaces.find(entry => entry.ns === BOARD_SETTINGS_NAMESPACE)?.revision
    await this.writeDocument(layout, serialized, revision, false)
  }

  /** One settings write, with one retry at the revision the conflict reported. */
  private async writeDocument(
    layout: BoardLayoutDocument,
    serialized: string,
    revision: number | undefined,
    retried: boolean,
  ): Promise<void> {
    let response
    try {
      response = await this.ctx.remote.settings.update(
        BOARD_SETTINGS_NAMESPACE,
        layout,
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
      this.lastDocument = serialized
      writeBoardLayoutCache(response.value.revision, layout)
      return
    }
    if (response.error.code === 'settings/conflict' && !retried) {
      // Last-writer-wins over another tab is deliberate: the layout belongs to
      // the user's latest gesture, and the revision the conflict reports is
      // the re-read that makes the retry land instead of conflicting forever.
      await this.writeDocument(layout, serialized, response.error.details.actual, true)
      return
    }
    console.warn(`ui-board: layout write refused (${response.error.code}): ${response.error.message}`)
  }
}
