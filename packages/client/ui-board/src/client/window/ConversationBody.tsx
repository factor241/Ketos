/**
 * Body of a window: the Harness session lane plus the full composer bar. The
 * lane renders the window session's assembled chat snapshot and its states —
 * creating, creation failure, empty, turn failure, running, and earlier-turn
 * loading — through dictionary lines, and follows the tail only while the user
 * stays there. Earlier turns prepend without moving the reader's position.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconChevronUpOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { AssistantBlock, ChatSnapshot, ConversationNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { BoardWindowInjected } from '../contract/slots.ts'
import type { BoardStoreHandle } from '../store.ts'
import { ComposerBar } from './ComposerBar.tsx'
import { ToolRow } from './ToolRow.tsx'
import css from './ConversationBody.module.css'

export type ConversationBodyProps =
  PropsRuntime<'board.window.body'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>
  & InjectFace<BoardWindowInjected>

/** One lane row the body renders; kinds outside the lane's scope are skipped. */
type LaneRow =
  | { readonly key: string; readonly kind: 'user' | 'assistant'; readonly text: string }
  | { readonly key: string; readonly kind: 'tool'; readonly name: string; readonly failed: boolean; readonly unavailable: boolean }

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
 * prose and settled tool results render here; other surfaces (compaction,
 * steering, errors) arrive with the stages that own their presentation.
 * @param chat - the window session's chat snapshot.
 * @returns lane rows in transcript order.
 */
function laneRows(chat: ChatSnapshot): readonly LaneRow[] {
  const rows: LaneRow[] = []
  for (const node of chat.legacy.nodes as readonly (ConversationNode | undefined)[]) {
    if (node === undefined) continue
    switch (node.kind) {
      case 'user': {
        const text = contentText(node.content)
        if (text !== '') rows.push({ key: `user-${String(node.seq)}`, kind: 'user', text })
        break
      }
      case 'assistant': {
        const text = assistantText(node.blocks)
        if (text !== '') rows.push({ key: `assistant-${String(node.seq)}`, kind: 'assistant', text })
        break
      }
      case 'tool-result':
        rows.push({
          key: `tool-${String(node.seq)}`,
          kind: 'tool',
          name: node.call?.name ?? node.callId,
          failed: node.isError,
          // A result whose call was truncated out of the loaded window has no
          // name to show and offers the repeat control instead.
          unavailable: node.call === null,
        })
        break
      default:
        // Merge-extensible union: surfaces outside the lane's scope are skipped.
        break
    }
  }
  return rows
}

export function ConversationBody({
  window: cardWindow, t, useStore, useWindowSession, ...injected
}: ConversationBodyProps) {
  // `injected` stays whole for the composer; the window creation callback rides it.
  const ensureWindowSession = injected.ensureWindowSession
  const session = useWindowSession(cardWindow.id)
  const laneRef = useRef<HTMLDivElement>(null)
  const [atTail, setAtTail] = useState(true)
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
  const streaming = assistantText(session?.chat?.legacy.partial?.blocks ?? [])
  const runningCalls = session?.runningCalls ?? []
  const ready = session?.status === 'ready'
  const hasRows = rows.length > 0 || runningCalls.length > 0 || streaming !== ''

  // Earlier turns prepend: the added height above the reader moves the scrollbar,
  // not the reading position. The anchor is consumed only once the transcript's
  // leading row changes, so a chunk or a running call landing below the reader
  // in the meantime leaves it intact.
  useLayoutEffect(() => {
    const lane = laneRef.current
    const anchor = anchorRef.current
    if (lane === null || anchor === null) return
    if ((rows[0]?.key ?? null) === anchor.firstKey) return
    lane.scrollTop += lane.scrollHeight - anchor.height
    anchorRef.current = null
  }, [rows, streaming])

  // Follow the tail while the lane grows and the user has not scrolled away.
  useLayoutEffect(() => {
    const lane = laneRef.current
    if (lane === null || !atTail || anchorRef.current !== null) return
    lane.scrollTop = lane.scrollHeight
  }, [rows, streaming, runningCalls, atTail])

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

  const loadOlder = (): void => {
    const lane = laneRef.current
    if (lane !== null) {
      anchorRef.current = { height: lane.scrollHeight, firstKey: rows[0]?.key ?? null }
      setAtTail(false)
    }
    injected.loadOlderTurns(cardWindow.id)
  }

  const jumpToLatest = (): void => {
    const lane = laneRef.current
    if (lane !== null) lane.scrollTop = lane.scrollHeight
    anchorRef.current = null
    setAtTail(true)
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
        {session?.status === 'error' && (
          <div className={css.noticeError} data-board-lane-state="creation-error">
            {t('conversation.error')}: {session.error}
          </div>
        )}
        {ready && !hasRows && !session.running && (
          <div className={css.statusLine} data-board-lane-state="empty">{t('conversation.empty')}</div>
        )}

        {rows.map(row => row.kind === 'tool'
          ? (
            <ToolRow
              key={row.key}
              name={row.name}
              failed={row.failed}
              unavailable={row.unavailable}
              t={t}
              onRepeat={session?.hasMore === true ? loadOlder : undefined}
            />
          )
          : (
            <div key={row.key} className={clsx(css.message, row.kind === 'user' ? css.user : css.assistant)}>
              {row.kind === 'assistant'
                ? <MarkdownText text={row.text} labels={markdownLabels} />
                : row.text}
            </div>
          ))}

        {runningCalls.map(call => (
          <ToolRow key={`running-${call.id}`} name={call.name} failed={false} running t={t} />
        ))}

        {streaming !== '' && (
          <div className={clsx(css.message, css.assistant, css.streaming)}>
            <MarkdownText text={streaming} streaming labels={markdownLabels} />
          </div>
        )}

        {session?.running === true && (
          <div className={css.statusLine} data-board-lane-state="running">{t('agent.statusRunning')}</div>
        )}
        {session?.turnError !== undefined && (
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

      <ComposerBar
        windowId={cardWindow.id}
        session={session}
        t={t}
        injected={injected}
        onSent={jumpToLatest}
      />
    </div>
  )
}
