/**
 * Publisher of the browser's own windows into the shared document: one
 * `window.put` per changed window after a quiet period, and a reconciliation
 * that removes own records the layout no longer holds (a window closed here,
 * in another tab, or while this tab was hidden).
 *
 * Posts are one operation each, so one refused record cannot hold back the
 * others. `ketos/limit` (the record budget is spent) is posted again once the
 * document holds fewer records than when it was refused; any other refusal
 * except `ketos/unreachable` is a verdict on that record's content and is not
 * repeated until the window's published fields change. `ketos/unreachable` is
 * retried after a pause. Removals come only from the reconciliation — an own
 * record whose window the layout does not hold and whose put is not in flight
 * — and only while the tab is visible and the layout source is known, so a
 * tab that has not yet seen the settings answer, or a hidden tab, never
 * deletes records another tab still publishes. A layout adopted from the
 * settings server holds every window of this Ketos, so any own record without
 * a window is removed; a layout held in page memory removes only records this
 * publisher put itself. A tab that becomes visible republishes every window
 * (the host skips a put that matches the stored record) and reconciles.
 *
 * The window→session status, title, session id, and clone names come from the
 * caller, so this module holds no session or clone machinery of its own.
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { BoardOp, BoardWindowRecord, BoardWindowRecordInput, OwnerId, WindowId } from '@ketos/board-doc/types'
import { clampWindowTitle } from '@ketos/board-doc/windows'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CloneId } from '@ketos/clone-core/types'
import type { BoardWindowState } from './contract/slots.ts'
import type { BoardLayoutSource } from './store.ts'
import type { WindowStatus } from './window-status.ts'

/** Failure code that marks a transport failure; every other code is a host verdict. */
const UNREACHABLE = 'ketos/unreachable'

/** Failure code of a put the record budget refused; it stands until the document holds fewer records. */
const LIMIT = 'ketos/limit'

/** The board state one publish pass reads. */
export interface WindowPublisherState {
  /** Acting participant identity; null before the first snapshot publishes nothing. */
  readonly selfId: OwnerId | null
  /**
   * Where the layout was adopted from (see `BoardState.layoutSource`); null
   * holds the reconciliation back.
   */
  readonly layoutSource: BoardLayoutSource | null
  /** Local layout windows, keyed by window id. */
  readonly windows: Record<string, BoardWindowState>
  /** Shared window records from the document, keyed by window id. */
  readonly windowRecords: Record<string, BoardWindowRecord>
}

/**
 * Outcome of one posted operation: `ok`, or the failure code. A host code
 * (`ketos/invalid`, `ketos/limit`, `ketos/window-foreign`, ...) is a verdict
 * on the operation; `ketos/unreachable` is a transport failure. The outcome of
 * `postBoardOps` has this form.
 */
export type WindowPostOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string }

/**
 * The clone roster the publisher names clone windows by. A deployment without
 * a clone roster omits it, and a clone window then publishes its chat title.
 */
export interface WindowPublisherClones {
  /**
   * Name of one clone.
   * @param cloneId - clone the window edits.
   * @returns the clone's name, or undefined while the roster does not hold it.
   */
  nameOf(cloneId: CloneId): string | undefined
  /** Follow roster changes (a rename, a load); returns the unsubscribe. */
  subscribe(listener: () => void): () => void
}

/** Everything the publisher reads from its owner. */
export interface WindowPublisherDeps {
  /** Current board state. */
  getState(): WindowPublisherState
  /** Follow board store changes; returns the unsubscribe. */
  subscribe(listener: () => void): () => void
  /** Follow one window's session channel; returns the unsubscribe. */
  watchWindow(windowId: WindowId, listener: () => void): () => void
  /** Status the window's session resolves to. */
  statusFor(windowId: WindowId): WindowStatus
  /** Session the window shows, when it carries one. */
  sessionFor(windowId: WindowId): SessionId | undefined
  /** Chat title the session list reports, when it reports one. */
  chatTitleFor(windowId: WindowId): string | undefined
  /** Clone roster for the names of clone windows; absent names none. */
  readonly clones?: WindowPublisherClones
  /** Whether this tab may publish; only the visible tab publishes. */
  isVisible(): boolean
  /** Follow page visibility changes; returns the unsubscribe. */
  onVisibilityChange(listener: () => void): () => void
  /**
   * Post one operation as its own batch.
   * @param op - the operation.
   * @returns its outcome; a rejection counts as `ketos/unreachable`.
   */
  post(op: BoardOp): Promise<WindowPostOutcome>
  /** Receives one line per publish anomaly. */
  log(message: string): void
}

/** Timing of the publisher. */
export interface WindowPublisherOptions {
  /** Quiet period after the last change of any window before the put operations go out. */
  readonly debounceMs: number
  /** Pause before an operation that failed with `ketos/unreachable` is tried again. */
  readonly retryMs: number
}

/**
 * One board plugin's window publisher. The owner starts it with the plugin
 * effect; {@link WindowPublisher.dispose} leaves no subscription, watcher, or
 * timer behind.
 */
export class WindowPublisher {
  /** Signature to publish per window key, waiting for the quiet period. */
  private readonly queue = new Map<string, string>()
  /** Signature of the last successfully published state per window key. */
  private readonly published = new Map<string, string>()
  /** Signature the host refused per window key; not posted again until it changes. */
  private readonly refused = new Map<string, string>()
  /**
   * Record count of the document a `ketos/limit` refusal was measured against,
   * per window key: the larger of the counts this tab saw when the put went
   * out and when the refusal came back. Fewer records lift the refusal.
   */
  private readonly limitedAt = new Map<string, number>()
  /** Signature of the put in flight per window key. */
  private readonly inFlight = new Map<string, string>()
  /** Window keys whose removal post is in flight. */
  private readonly removing = new Set<string>()
  /** Window keys whose removal was answered, until the record leaves the document. */
  private readonly removalAnswered = new Set<string>()
  /**
   * Window keys this publisher posted a put for in this page session, until
   * their removal is answered; a layout held in memory removes only these.
   */
  private readonly putKeys = new Set<string>()
  /** Active per-window session-channel watchers, by window key. */
  private readonly watchers = new Map<string, () => void>()
  private unsubscribeStore: (() => void) | undefined
  private unsubscribeVisibility: (() => void) | undefined
  private unsubscribeClones: (() => void) | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  /** Serialized flush chain, so two flushes never overlap. */
  private tail: Promise<void> = Promise.resolve()
  /** Epoch milliseconds before which nothing is posted after an unreachable failure. */
  private blockedUntil = 0
  private disposed = false

  /**
   * Whether {@link dispose} ran; read after an `await`, where control-flow narrowing of the field is stale.
   * @returns true once the publisher is disposed.
   */
  private isDisposed(): boolean {
    return this.disposed
  }

  /**
   * @param deps - state reads, change sources, and the operation post.
   * @param options - publish debounce and retry pause.
   */
  constructor(
    private readonly deps: WindowPublisherDeps,
    private readonly options: WindowPublisherOptions,
  ) {}

  /**
   * Follow every publish source and publish the current layout once. The
   * returned function disposes the publisher.
   * @returns the dispose function.
   */
  start(): () => void {
    this.unsubscribeStore = this.deps.subscribe(() => { this.sweep() })
    this.unsubscribeVisibility = this.deps.onVisibilityChange(() => {
      if (!this.deps.isVisible()) return
      // Another tab may have published meanwhile: the returning tab states its
      // windows again and reconciles.
      this.published.clear()
      this.sweep()
    })
    this.unsubscribeClones = this.deps.clones?.subscribe(() => { this.sweep() })
    this.sweep()
    return () => { this.dispose() }
  }

  /** Stop following every source and drop the queued puts. */
  dispose(): void {
    this.disposed = true
    this.unsubscribeStore?.()
    this.unsubscribeStore = undefined
    this.unsubscribeVisibility?.()
    this.unsubscribeVisibility = undefined
    this.unsubscribeClones?.()
    this.unsubscribeClones = undefined
    for (const unwatch of this.watchers.values()) unwatch()
    this.watchers.clear()
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.queue.clear()
  }

  /**
   * One pass over the current state: queue every window whose published
   * fields changed (restarting the quiet period only when the queue changed),
   * forget windows that left, and reconcile records without a window.
   */
  private sweep(): void {
    if (this.disposed) return
    const state = this.deps.getState()
    if (state.selfId === null) return
    const keys = Object.keys(state.windows)
    this.syncWatchers(keys)
    const recordCount = Object.keys(state.windowRecords).length
    let changed = false
    for (const key of keys) {
      const window = state.windows[key]
      if (window === undefined) continue
      const signature = this.signatureOf(window)
      const limitedAt = this.limitedAt.get(key)
      if (this.refused.get(key) !== signature || (limitedAt !== undefined && recordCount < limitedAt)) {
        this.refused.delete(key)
        this.limitedAt.delete(key)
      }
      if (this.published.get(key) === signature || this.inFlight.get(key) === signature || this.refused.get(key) === signature) {
        if (this.queue.delete(key)) changed = true
        continue
      }
      if (this.queue.get(key) === signature) continue
      this.queue.set(key, signature)
      changed = true
    }
    for (const key of [...this.queue.keys()]) {
      if (state.windows[key] === undefined) this.queue.delete(key)
    }
    for (const key of [...this.published.keys(), ...this.refused.keys()]) {
      if (state.windows[key] !== undefined) continue
      this.published.delete(key)
      this.refused.delete(key)
      this.limitedAt.delete(key)
    }
    if (changed || (this.queue.size > 0 && this.timer === undefined)) this.arm(this.options.debounceMs)
    this.reconcile(state)
  }

  /**
   * Open a watcher for every local window and close the watchers of windows
   * that left, so a session status change triggers a publish pass.
   * @param keys - current local window keys.
   */
  private syncWatchers(keys: readonly string[]): void {
    const wanted = new Set(keys)
    for (const key of keys) {
      if (this.watchers.has(key)) continue
      const windowId = brandString<WindowId>(key)
      this.watchers.set(key, this.deps.watchWindow(windowId, () => { this.sweep() }))
    }
    for (const [key, unwatch] of [...this.watchers]) {
      if (wanted.has(key)) continue
      unwatch()
      this.watchers.delete(key)
    }
  }

  /**
   * (Re)start the quiet-period timer. Every change restarts it, so the puts go
   * out once the windows have been still for the period; a pause after an
   * unreachable failure stretches it.
   * @param delayMs - quiet period or retry pause to wait.
   */
  private arm(delayMs: number): void {
    if (this.disposed) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    const wait = Math.max(delayMs, this.blockedUntil - Date.now())
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.tail = this.tail.then(() => this.flush())
    }, wait)
  }

  /**
   * Post one `window.put` per queued window, then reconcile. A hidden tab
   * keeps its queue. A refusal marks the window's signature as refused, and a
   * `ketos/limit` refusal also records the document's record count; an
   * unreachable failure queues the window and the rest again and waits out the
   * retry pause.
   */
  private async flush(): Promise<void> {
    if (this.disposed || !this.deps.isVisible()) return
    if (this.deps.getState().selfId === null) return
    const keys = [...this.queue.keys()]
    this.queue.clear()
    for (const key of keys) {
      const window = this.deps.getState().windows[key]
      if (window === undefined) continue
      const signature = this.signatureOf(window)
      const countBefore = this.recordCount()
      this.inFlight.set(key, signature)
      this.putKeys.add(key)
      const outcome = await this.attempt({ op: 'window.put', record: this.recordOf(window) }, 'window publish', key)
      this.inFlight.delete(key)
      if (this.isDisposed()) return
      if (outcome.ok) {
        this.published.set(key, signature)
      } else if (outcome.code === UNREACHABLE) {
        // The closing sweep queues this window and the ones not yet tried again.
        this.blockedUntil = Date.now() + this.options.retryMs
        break
      } else {
        this.refused.set(key, signature)
        if (outcome.code === LIMIT) this.limitedAt.set(key, Math.max(countBefore, this.recordCount()))
      }
    }
    this.sweep()
  }

  /**
   * Number of window records the document holds, as the stream reported them.
   * @returns the record count.
   */
  private recordCount(): number {
    return Object.keys(this.deps.getState().windowRecords).length
  }

  /**
   * Remove every own record the layout does not hold. Runs only on a visible
   * tab once the layout source is known, and not during a retry pause. A
   * record whose put is in flight waits for the put to settle: the host could
   * otherwise apply the removal first and the put would recreate the record.
   * A layout held in memory removes only records this publisher put.
   * @param state - the state the pass reads.
   */
  private reconcile(state: WindowPublisherState): void {
    for (const key of [...this.removalAnswered]) {
      if (state.windowRecords[key] === undefined || state.windows[key] !== undefined) this.removalAnswered.delete(key)
    }
    if (!this.deps.isVisible() || state.layoutSource === null || Date.now() < this.blockedUntil) return
    for (const [key, record] of Object.entries(state.windowRecords)) {
      if (record.hostId !== state.selfId || state.windows[key] !== undefined) continue
      if (state.layoutSource === 'memory' && !this.putKeys.has(key)) continue
      if (this.inFlight.has(key) || this.removing.has(key) || this.removalAnswered.has(key)) continue
      this.removing.add(key)
      void this.removeRecord(key)
    }
  }

  /**
   * Post one window removal and record its answer.
   * @param key - window key whose record the layout does not hold.
   */
  private async removeRecord(key: string): Promise<void> {
    const outcome = await this.attempt({ op: 'window.remove', id: brandString<WindowId>(key) }, 'window removal', key)
    this.removing.delete(key)
    if (this.disposed) return
    if (outcome.ok || outcome.code !== UNREACHABLE) {
      // Answered: the record leaves the document through the stream; a refusal
      // is a verdict that repeating cannot change.
      this.removalAnswered.add(key)
      this.putKeys.delete(key)
      return
    }
    this.blockedUntil = Date.now() + this.options.retryMs
    this.arm(this.options.retryMs)
  }

  /**
   * Post one operation and log its failure.
   * @param op - the operation.
   * @param label - log prefix naming the operation kind.
   * @param key - window key the operation concerns.
   * @returns the outcome; a rejected post is reported as unreachable.
   */
  private async attempt(op: BoardOp, label: string, key: string): Promise<WindowPostOutcome> {
    let outcome: WindowPostOutcome
    try {
      outcome = await this.deps.post(op)
    } catch (error: unknown) {
      this.deps.log(`${label} failed: ${String(error)}`)
      return { ok: false, code: UNREACHABLE }
    }
    if (!outcome.ok) this.deps.log(`${label} failed (${outcome.code}): ${key}`)
    return outcome
  }

  /**
   * The record one local window publishes. `title` is the user-given name or
   * the chat title; null lets the receiver name the window by kind and
   * ordinal. `sessionId` accompanies chat windows only.
   * @param window - the local window.
   * @returns the record input to post.
   */
  private recordOf(window: BoardWindowState): BoardWindowRecordInput {
    const sessionId = window.bodyKind === 'conversation' ? this.deps.sessionFor(window.id) : undefined
    return {
      id: window.id,
      ownerId: window.ownerId,
      kind: window.kind,
      bodyKind: window.bodyKind,
      title: this.titleOf(window),
      ordinal: window.ordinal,
      x: window.x,
      y: window.y,
      w: window.width,
      h: window.height,
      z: window.zIndex,
      access: { mode: window.access.mode, people: [...window.access.people] },
      status: this.deps.statusFor(window.id),
      ...(sessionId === undefined ? {} : { sessionId }),
    }
  }

  /**
   * The published title of one window, resolved like the local window name:
   * the user's own name, then the name of the clone a clone window edits, then
   * the chat title.
   * @param window - the local window.
   * @returns the first non-empty name, cut to the longest title a record accepts, or null.
   */
  private titleOf(window: BoardWindowState): string | null {
    const cloneName = window.cloneId === undefined ? undefined : this.deps.clones?.nameOf(window.cloneId)
    for (const candidate of [window.customTitle, cloneName, this.deps.chatTitleFor(window.id)]) {
      const title = clampWindowTitle(candidate?.trim() ?? '').trim()
      if (title !== '') return title
    }
    return null
  }

  /**
   * Signature of the fields a publish reflects: place, size, title, owner,
   * access, status, and session. `z` is outside it — raising a window must not
   * publish on every focus change — and is still written with each put.
   * @param window - the local window.
   * @returns the comparison signature.
   */
  private signatureOf(window: BoardWindowState): string {
    return [
      window.ownerId,
      window.kind,
      window.bodyKind,
      String(window.ordinal),
      String(window.x),
      String(window.y),
      String(window.width),
      String(window.height),
      window.access.mode,
      window.access.people.join(','),
      this.titleOf(window) ?? '',
      this.deps.statusFor(window.id),
      window.bodyKind === 'conversation' ? this.deps.sessionFor(window.id) ?? '' : '',
    ].join('\u0000')
  }
}
