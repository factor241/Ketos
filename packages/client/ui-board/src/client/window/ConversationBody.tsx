/**
 * Body of a window: the Harness session lane plus the full composer bar. The
 * lane renders the window session's assembled chat snapshot and its states —
 * creating, creation failure, empty, turn failure, running, and earlier-turn
 * loading — through dictionary lines, and follows the tail only while the user
 * stays there. Earlier turns prepend without moving the reader's position.
 *
 * Every lane row is a memoized leaf taking primitive props: streaming republishes
 * the chat snapshot on each chunk, and unchanged rows must not re-render with it.
 * Local submission echoes and pending steering occurrences render as user
 * bubbles until their durable counterpart arrives, and a durable turn failure
 * renders as an expandable card instead of a bare line.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconChevronUpOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  AssistantBlock, ChatSnapshot, ConversationNode, ToolResultNode,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { BoardPendingRow, BoardWindowInjected } from '../contract/slots.ts'
import type { BoardStoreHandle } from '../store.ts'
import type { BoardTranslate } from '../locale.ts'
import { ComposerBar } from './ComposerBar.tsx'
import { ToolCard } from './ToolCard.tsx'
import css from './ConversationBody.module.css'

export type ConversationBodyProps =
  PropsRuntime<'board.window.body'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>
  & InjectFace<BoardWindowInjected>

/** One lane row the body renders; kinds outside the lane's scope are skipped. */
type LaneRow =
  | { readonly key: string; readonly kind: 'user' | 'steering' | 'assistant'; readonly text: string }
  | { readonly key: string; readonly kind: 'tool'; readonly node: ToolResultNode }
  | {
    readonly key: string
    readonly kind: 'turn-error'
    readonly message: string
    readonly code?: string
    /** Prompt of the turn that failed, when it is in the loaded window. */
    readonly prompt?: string
  }

/** Text of one content-block list; non-text blocks carry no lane text yet. */
function contentText(blocks: readonly { type: string; text?: string }[]): string {
  return blocks
    .map(block => block.type === 'text' ? (block.text ?? '') : '')
    .filter(text => text !== '')
    .join('\n')
}

/** Text of one assistant block list; reasoning and tool heads stay out of the MVP lane. */
function assistantText(blocks: readonly AssistantBlock[]): string {
  return blocks
    .map(block => block.kind === 'text' ? block.text : '')
    .filter(text => text !== '')
    .join('\n')
}

/**
 * Fold the assembled chat snapshot into lane rows. Only the human/assistant
 * prose, steering corrections, settled tool results, and durable turn failures
 * render here; other surfaces (compaction, retries, token caps) arrive with the
 * stages that own their presentation. Rows are deduplicated by event seq, so a
 * history page that repeats a loaded event can never double a row.
 * @param chat - the window session's chat snapshot.
 * @returns lane rows in transcript order.
 */
function laneRows(chat: ChatSnapshot): readonly LaneRow[] {
  const rows: LaneRow[] = []
  const seen = new Set<number>()
  let prompt: string | undefined
  for (const node of chat.legacy.nodes as readonly (ConversationNode | undefined)[]) {
    if (node === undefined || seen.has(node.seq)) continue
    seen.add(node.seq)
    switch (node.kind) {
      case 'user': {
        const text = contentText(node.content)
        if (text === '') break
        prompt = text
        rows.push({ key: `user-${String(node.seq)}`, kind: 'user', text })
        break
      }
      case 'steering': {
        const text = contentText(node.content)
        if (text !== '') rows.push({ key: `steering-${String(node.seq)}`, kind: 'steering', text })
        break
      }
      case 'assistant': {
        const text = assistantText(node.blocks)
        if (text !== '') rows.push({ key: `assistant-${String(node.seq)}`, kind: 'assistant', text })
        break
      }
      case 'tool-result':
        rows.push({ key: `tool-${String(node.seq)}`, kind: 'tool', node })
        break
      case 'turn-error':
        rows.push({
          key: `turn-error-${String(node.seq)}`,
          kind: 'turn-error',
          message: node.message,
          ...(node.code === undefined ? {} : { code: node.code }),
          ...(prompt === undefined ? {} : { prompt }),
        })
        break
      default:
        // Merge-extensible union: surfaces outside the lane's scope are skipped.
        break
    }
  }
  return rows
}

const EMPTY_RPC_IDS: ReadonlySet<string> = new Set()

/**
 * The prompt identities durable user and steering nodes advertise. An echo whose
 * identity is already in the transcript is one animation frame from its own
 * retirement, so the lane hides it here instead of flashing a duplicate.
 * @param chat - the window session's chat snapshot.
 * @returns the rpcIds the loaded transcript carries.
 */
function observedRpcIds(chat: ChatSnapshot): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const node of chat.legacy.nodes as readonly (ConversationNode | undefined)[]) {
    if (node === undefined || (node.kind !== 'user' && node.kind !== 'steering')) continue
    const source = node.source as { rpcId?: unknown } | undefined
    if (typeof source?.rpcId === 'string') ids.add(source.rpcId)
  }
  return ids
}

/** One prose row; memoized on primitive props so a streamed chunk leaves it alone. */
const LaneMessage = memo(function LaneMessage({ kind, text, labels }: {
  readonly kind: 'user' | 'steering' | 'assistant'
  readonly text: string
  readonly labels: MarkdownLabels
}) {
  return (
    <div
      className={clsx(css.message, kind === 'assistant' ? css.assistant : css.user)}
      data-board-message={kind}
    >
      {kind === 'assistant' ? <MarkdownText text={text} labels={labels} /> : text}
    </div>
  )
})

/** Stable empty attachment lists for bubbles that carry none. */
const NO_IMAGES: readonly { readonly id: string; readonly preview: string; readonly name?: string }[] = []
const NO_FILES: readonly string[] = []

/** One local user bubble: echo or pending steering; the marker attributes name its state. */
const LaneBubble = memo(function LaneBubble({ text, images, files, source }: {
  readonly text: string
  readonly images: readonly { readonly id: string; readonly preview: string; readonly name?: string }[]
  readonly files: readonly string[]
  readonly source: 'echo' | 'steering-echo' | 'steering'
}) {
  return (
    <div
      className={clsx(css.message, css.user)}
      data-board-message="user"
      data-board-submission-echo={source === 'echo' ? '' : undefined}
      data-board-steering={source === 'echo' ? undefined : ''}
      data-board-pending-steering={source === 'steering-echo' ? '' : undefined}
    >
      {images.length > 0 && (
        <span className={css.echoAttachments}>
          {images.map(image => (
            <img key={image.id} className={css.echoThumb} src={image.preview} alt={image.name ?? ''} />
          ))}
        </span>
      )}
      {files.length > 0 && <span className={css.echoFiles}>{files.join(', ')}</span>}
      {text}
    </div>
  )
})

/**
 * One durable turn failure: the localized title, the provider message (or the
 * localized copy a known code owns), an expandable detail row, and a repeat
 * action when the failed turn's prompt is still in the loaded window.
 */
const TurnErrorCard = memo(function TurnErrorCard({ message, code, prompt, t, onRepeat }: {
  readonly message: string
  readonly code?: string
  readonly prompt?: string
  readonly t: BoardTranslate
  readonly onRepeat: (prompt: string) => void
}) {
  const [open, setOpen] = useState(false)
  const primary = code === 'AUTH'
    ? t('conversation.failure.auth')
    : message !== '' ? message : t('conversation.failure.unknown')
  // The raw provider text and the code are the detail beyond a localized line.
  const detail = message !== '' && primary !== message ? message : undefined
  return (
    <div className={css.turnError} data-board-lane-state="turn-error" data-board-turn-error={code ?? 'unknown'}>
      <div className={css.turnErrorHead}>
        <span className={css.turnErrorTitle}>{t('conversation.turnFailed')}</span>
        <span className={css.turnErrorGap} />
        {(detail !== undefined || code !== undefined) && (
          <button
            type="button"
            className={css.turnErrorAction}
            aria-expanded={open}
            data-board-action="turn-error-details"
            onClick={() => { setOpen(value => !value) }}
          >
            {t('conversation.details')}
          </button>
        )}
        {prompt !== undefined && (
          <button
            type="button"
            className={css.turnErrorAction}
            data-board-action="turn-error-repeat"
            onClick={() => { onRepeat(prompt) }}
          >
            {t('conversation.repeatTurn')}
          </button>
        )}
      </div>
      <div className={css.turnErrorText}>{primary}</div>
      {open && (
        <div className={css.turnErrorDetail} data-board-turn-error-detail="">
          {detail !== undefined && <div>{detail}</div>}
          {code !== undefined && <div>{t('conversation.errorCode', { code })}</div>}
        </div>
      )}
    </div>
  )
})

/**
 * Localized title of one pending interaction the window banners: the kind the
 * answering domain publishes, with a generic line for a kind this stage does
 * not know.
 * @param t - board locale seat.
 * @param kind - `SessionPendingInteraction.kind` of the pending value.
 * @returns the banner title for the active locale.
 */
function pendingTitle(t: BoardTranslate, kind: string): string {
  switch (kind) {
    case 'approval':
      return t('pending.approval')
    case 'question':
      return t('pending.question')
    case 'plan-review':
      return t('pending.planReview')
    default:
      return t('pending.other')
  }
}

export function ConversationBody({
  window: cardWindow, t, useStore, actions, useWindowSession, useSessionPendingInteraction, ...injected
}: ConversationBodyProps) {
  // `injected` stays whole for the composer; the window creation callback rides it.
  const ensureWindowSession = injected.ensureWindowSession
  const session = useWindowSession(cardWindow.id)
  const sessionId = session?.sessionId
  // The pending approval or question of the window's session, owned by the root
  // pending-interaction source; the window only reads it and navigates to the
  // main panel, where the answering composer lives.
  const pending = useSessionPendingInteraction(
    snapshot => sessionId === undefined ? undefined : snapshot.get(sessionId),
  )
  const laneRef = useRef<HTMLDivElement>(null)
  const [atTail, setAtTail] = useState(true)
  const [actionError, setActionError] = useState<string | null>(null)
  // Scroll anchor captured when earlier turns are requested: the lane height at
  // that moment plus the transcript's leading row. Only a changed leading row
  // means a page was actually prepended — growth below the reader (streaming,
  // running calls, any other chat republish) must not consume the anchor.
  const anchorRef = useRef<{ height: number; firstKey: string | null } | null>(null)

  // The window owns its session: create it once, on first mount.
  useEffect(() => {
    ensureWindowSession(cardWindow.id)
  }, [ensureWindowSession, cardWindow.id])

  const rows = useMemo(() => session?.chat === undefined ? [] : laneRows(session.chat), [session?.chat])
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const observed = useMemo(
    () => session?.chat === undefined ? EMPTY_RPC_IDS : observedRpcIds(session.chat),
    [session?.chat],
  )
  const pendingLane = (session?.pending ?? []).filter(row => row.placement !== 'queued' && !observed.has(row.id))
  const steeringQueue = (session?.queue ?? []).filter(row => row.placement === 'steering')
  const streaming = assistantText(session?.chat?.legacy.partial?.blocks ?? [])
  const runningCalls = session?.chat?.legacy.runningCalls ?? []
  const ready = session?.status === 'ready'
  const hasRows = rows.length > 0 || runningCalls.length > 0 || streaming !== ''
    || pendingLane.length > 0 || steeringQueue.length > 0
  // A durable turn failure already renders as its own card; the channel's
  // latest-agent-error line must not repeat the same failure beside it. A
  // failure at the transcript tail is that failure's card — its sanitized
  // message may be empty for a known code, so the position is the signal; an
  // older card is matched by its message when the two carry the same text.
  const lastRow = rows[rows.length - 1]
  const turnErrorCovered = session?.turnError !== undefined && (
    lastRow?.kind === 'turn-error'
    || rows.some(row => row.kind === 'turn-error' && row.message === session.turnError)
  )

  // Earlier turns prepend: the added height above the reader moves the scrollbar,
  // not the reading position. The baseline moves only with the leading row (an
  // actual prepend) or with a shrink above the reader — the load-earlier
  // affordance leaving the lane once the last page arrives. Growth below the
  // reader (streaming, running calls, any other republish) never touches it.
  useLayoutEffect(() => {
    const lane = laneRef.current
    const anchor = anchorRef.current
    if (lane === null || anchor === null) return
    const leading = rows[0]?.key ?? null
    if (leading !== anchor.firstKey) {
      lane.scrollTop += lane.scrollHeight - anchor.height
      anchor.firstKey = leading
      anchor.height = lane.scrollHeight
      return
    }
    if (lane.scrollHeight < anchor.height) {
      lane.scrollTop -= anchor.height - lane.scrollHeight
      anchor.height = lane.scrollHeight
    }
  })

  // Follow the tail while the lane grows and the user has not scrolled away.
  useLayoutEffect(() => {
    const lane = laneRef.current
    if (lane === null || !atTail || anchorRef.current !== null) return
    lane.scrollTop = lane.scrollHeight
  }, [rows, streaming, runningCalls, atTail, pendingLane, steeringQueue])

  const markdownLabels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('markdown.copy'), copiedLabel: t('markdown.copied') },
    footnotes: t('markdown.footnotes'),
  }), [t])

  // Fullscreen keeps a normal chat layout: the lane and composer ride a centred
  // column beside the docked chats panel.
  const isFullscreen = useStore(s => s.fullscreenWindowId === cardWindow.id)

  const handleScroll = (): void => {
    const lane = laneRef.current
    if (lane === null) return
    setAtTail(lane.scrollHeight - lane.scrollTop - lane.clientHeight < 24)
  }

  const loadOlder = useCallback((): void => {
    const lane = laneRef.current
    if (lane !== null) {
      anchorRef.current = { height: lane.scrollHeight, firstKey: rowsRef.current[0]?.key ?? null }
      setAtTail(false)
    }
    injected.loadOlderTurns(cardWindow.id)
  }, [injected, cardWindow.id])

  const jumpToLatest = useCallback((): void => {
    const lane = laneRef.current
    if (lane !== null) lane.scrollTop = lane.scrollHeight
    anchorRef.current = null
    setAtTail(true)
  }, [])

  const repeatTurn = useCallback((prompt: string): void => {
    void injected.sendPrompt(cardWindow.id, prompt, 'queue')
  }, [injected, cardWindow.id])

  // Durable result images resolve through the window's session-authorized
  // loader, so an image card never handles authorization itself.
  const loadToolImage = useCallback(
    (attachment: ImageAttachmentRef): Promise<string> => injected.loadQueueImage(cardWindow.id, attachment),
    [injected, cardWindow.id],
  )

  const createSession = (): void => {
    setActionError(null)
    void injected.startChat(cardWindow.id).catch((failure: unknown) => {
      setActionError(failure instanceof Error ? failure.message : String(failure))
    })
  }

  return (
    <div className={clsx(css.body, isFullscreen && css.centered)}>
      <div ref={laneRef} className={css.lane} onScroll={handleScroll} data-board-lane="">
        {ready && session.hasMore && (
          <button
            type="button"
            className={css.loadOlder}
            disabled={session.loadingOlder}
            onClick={loadOlder}
            data-board-action="lane-load-older"
          >
            {t(session.loadingOlder ? 'conversation.loadingOlder' : 'conversation.loadOlder')}
          </button>
        )}
        {session?.status === 'pending' && (
          <div className={css.statusLine} data-board-lane-state="creating">{t('conversation.creating')}</div>
        )}
        {session?.status === 'restoring' && (
          <div className={css.statusLine} data-board-lane-state="restoring">{t('conversation.restoring')}</div>
        )}
        {session?.status === 'error' && (
          <div className={css.noticeError} data-board-lane-state="creation-error">
            {t('conversation.error')}: {session.error}
          </div>
        )}
        {session?.status === 'missing' && (
          <div className={css.noticeError} data-board-lane-state="session-missing">
            <span>{t('conversation.sessionMissing')}</span>
            <div className={css.missingActions}>
              <button
                type="button"
                data-board-action="lane-create-session"
                onClick={createSession}
              >
                {t('conversation.createSession')}
              </button>
              <button
                type="button"
                data-board-action="lane-choose-chat"
                onClick={() => { actions.openWindowPanel(cardWindow.id) }}
              >
                {t('conversation.chooseChat')}
              </button>
            </div>
            {actionError !== null && <div>{actionError}</div>}
          </div>
        )}
        {ready && !hasRows && !session.running && (
          <div className={css.statusLine} data-board-lane-state="empty">{t('conversation.empty')}</div>
        )}

        {rows.map((row) => {
          switch (row.kind) {
            case 'tool':
              return (
                <ToolCard
                  key={row.key}
                  node={row.node}
                  t={t}
                  canRepeat={session?.hasMore === true}
                  onRepeat={loadOlder}
                  loadImage={loadToolImage}
                />
              )
            case 'turn-error':
              return (
                <TurnErrorCard
                  key={row.key}
                  message={row.message}
                  {...(row.code === undefined ? {} : { code: row.code })}
                  {...(row.prompt === undefined ? {} : { prompt: row.prompt })}
                  t={t}
                  onRepeat={repeatTurn}
                />
              )
            default:
              return <LaneMessage key={row.key} kind={row.kind} text={row.text} labels={markdownLabels} />
          }
        })}

        {(pendingLane as readonly BoardPendingRow[]).map(row => (
          <LaneBubble
            key={`echo-${row.id}`}
            text={row.text}
            images={row.images}
            files={row.files}
            source={row.placement === 'steering' ? 'steering-echo' : 'echo'}
          />
        ))}
        {steeringQueue.map(row => (
          <LaneBubble key={`steering-${row.id}`} text={row.preview} images={NO_IMAGES} files={NO_FILES} source="steering" />
        ))}

        {runningCalls.map(call => (
          <ToolCard key={`running-${call.callId}`} node={call} t={t} loadImage={loadToolImage} />
        ))}

        {streaming !== '' && (
          <div className={clsx(css.message, css.assistant, css.streaming)} data-board-message="assistant" data-board-streaming="">
            <MarkdownText text={streaming} streaming labels={markdownLabels} />
          </div>
        )}

        {session?.running === true && (
          <div className={css.statusLine} data-board-lane-state="running">{t('agent.statusRunning')}</div>
        )}
        {session?.turnError !== undefined && !turnErrorCovered && (
          <div className={css.noticeError} data-board-lane-state="turn-error">
            {t('conversation.turnFailed')}: {session.turnError}
          </div>
        )}
        {session?.promptError !== undefined && (
          <div className={css.noticeError} data-board-lane-state="prompt-error">
            {t('conversation.sendFailed')}: {session.promptError}
          </div>
        )}
      </div>

      {session !== undefined && session.status === 'ready' && (
        <div className={css.laneTail}>
          {!atTail && (
            <button
              type="button"
              className={css.laneAction}
              onClick={jumpToLatest}
              aria-label={t('conversation.scrollBottom')}
              title={t('conversation.scrollBottom')}
            >
              <IconChevronUpOutline14 />
            </button>
          )}
        </div>
      )}

      {pending !== undefined && (
        <div className={css.pending} data-board-pending={pending.kind}>
          <span className={css.pendingText}>{pendingTitle(t, pending.kind)}</span>
          <button
            type="button"
            className={css.pendingAction}
            data-board-action="pending-open-main"
            onClick={() => { injected.openInMainPanel(cardWindow.id) }}
          >
            {t('pending.open')}
          </button>
        </div>
      )}

      <ComposerBar
        windowId={cardWindow.id}
        // While an approval or question waits in the main panel, the window's
        // composer stays inert and names the banner as its reason.
        session={pending === undefined || session === undefined
          ? session
          : { ...session, blocked: pendingTitle(t, pending.kind) }}
        t={t}
        injected={injected}
        onSent={jumpToLatest}
        useStore={useStore}
        actions={actions}
      />
    </div>
  )
}
