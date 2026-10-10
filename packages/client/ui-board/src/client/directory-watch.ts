/**
 * Directory observation of the right panel's files tab: one
 * `workspaceFiles.changes` stream run through the Client Remote's stream
 * supervisor, which reopens the host stream after a lost connection. Each
 * stream generation opens with `ready`, which the listener hears as a change
 * too, because entries may have changed while no stream was open.
 *
 * Only the host stream's own end — a refusal, a failure, or a normal end the
 * supervisor classifies as terminal — reaches `failed`, logged with the host
 * error. A throwing listener is a defect of its owner: it is reported and the
 * observation goes on. Nothing reaches the listener after stop.
 */
import type { WorkspaceFileWatchFrame } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { BoardDirectoryWatchListener } from './contract/slots.ts'

/** What one supervised stream needs from its owner. */
export interface DirectoryWatchStreamOptions<Item> {
  /** Diagnostic owner name. */
  readonly name: string
  /** Open one generation of the host stream; `signal` aborts it. */
  readonly open: (signal: AbortSignal) => AsyncIterable<Item>
  /** The error a generation's normal end amounts to. */
  readonly ended: (accepted: boolean) => Error
}

/** One item the supervisor delivers. */
export interface DirectoryWatchStreamItem<Item> {
  /** The decoded frame. */
  readonly value: Item
  /** Mark the delivering generation's opening frame as accepted. */
  accept(): void
}

/** The slice of the Client Remote the observation calls, structurally. */
export interface DirectoryWatchRemote {
  /**
   * Create one reconnecting single-consumer stream.
   * @param options - opener and end classification.
   * @returns the supervised stream; disposal ends it for good.
   */
  $stream<Item>(options: DirectoryWatchStreamOptions<Item>): AsyncIterable<DirectoryWatchStreamItem<Item>> & {
    dispose(): Promise<void>
  }
  /** The `workspaceFiles` namespace's directory change stream. */
  readonly workspaceFiles: {
    changes(sessionId: SessionId, path: string, signal: AbortSignal): AsyncIterable<WorkspaceFileWatchFrame>
  }
}

/**
 * Observe the direct entries of one session-workspace directory.
 * @param remote - the Client Remote slice carrying the stream supervisor and `workspaceFiles.changes`.
 * @param sessionId - session whose workspace resolves the path.
 * @param path - absolute directory path.
 * @param listener - receives the change and failure calls.
 * @returns the stop function; its promise settles once the host stream is disposed and its iteration ended.
 */
export function observeWorkspaceDirectory(
  remote: DirectoryWatchRemote,
  sessionId: SessionId,
  path: string,
  listener: BoardDirectoryWatchListener,
): () => Promise<void> {
  const stream = remote.$stream<WorkspaceFileWatchFrame>({
    name: `board files ${path}`,
    open: lifetime => remote.workspaceFiles.changes(sessionId, path, lifetime),
    ended: () => new Error(`Board directory observation ended: ${path}`),
  })
  let stopped = false
  const notify = (call: () => void): void => {
    try {
      call()
    } catch (error) {
      // The listener's defect is not the host stream's: report it and keep observing.
      console.error(`ui-board: the files tab's listener for ${path} threw`, error)
    }
  }
  const frames = stream[Symbol.asyncIterator]()
  const pump = async (): Promise<void> => {
    for (;;) {
      let next: Awaited<ReturnType<typeof frames.next>>
      try {
        next = await frames.next()
      } catch (error) {
        // After stop the stream's end is the stop itself; before it, the host
        // refused or ended the observation and the level has no live updates.
        if (stopped) return
        console.warn(`ui-board: the observation of ${path} ended`, error)
        notify(() => { listener.failed() })
        return
      }
      if (next.done === true || stopped) return
      if (next.value.value.kind === 'ready') next.value.accept()
      notify(() => { listener.changed() })
    }
  }
  const pumping = pump()
  return async () => {
    stopped = true
    await stream.dispose()
    await pumping
  }
}
