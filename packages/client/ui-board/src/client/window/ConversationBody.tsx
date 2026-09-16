/**
 * Body of a window: the Harness session lane plus the full composer bar. The
 * lane renders the window session's assembled chat snapshot; the composer bar
 * carries the context chips, tool row, dock strips, and command menus.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  IconCheckOutline14, IconChevronUpOutline14, IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { AssistantBlock, ChatSnapshot, ConversationNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { BoardWindowInjected } from '../contract/slots.ts'
import type { BoardStoreHandle } from '../store.ts'
import { ComposerBar } from './ComposerBar.tsx'
import css from './ConversationBody.module.css'

export type ConversationBodyProps =
  PropsRuntime<'board.window.body'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>
  & InjectFace<BoardWindowInjected>

/** One lane row the body renders; kinds outside the lane's scope are skipped. */
type LaneRow =
  | { readonly key: string; readonly kind: 'user' | 'assistant'; readonly text: string }
  | { readonly key: string; readonly kind: 'tool'; readonly name: string; readonly failed: boolean }

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

  // The window owns its session: create it once, on first mount.
  useEffect(() => {
    ensureWindowSession(cardWindow.id)
  }, [ensureWindowSession, cardWindow.id])

  const rows = useMemo(() => session?.chat === undefined ? [] : laneRows(session.chat), [session?.chat])
  const streaming = assistantText(session?.chat?.legacy.partial?.blocks ?? [])
  const ready = session?.status === 'ready'

  // Follow the tail while the lane grows and the user has not scrolled away.
  useEffect(() => {
    const lane = laneRef.current
    if (lane !== null && atTail) lane.scrollTop = lane.scrollHeight
  }, [rows.length, streaming, atTail])

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

  return (
    <div className={clsx(css.body, isFullscreen && css.centered)}>
      <div ref={laneRef} className={css.lane} onScroll={handleScroll}>
        {ready && rows.length > 0 && (
          <button
            type="button"
            className={css.loadOlder}
            onClick={() => { injected.loadOlderTurns(cardWindow.id) }}
          >
            {t('conversation.loadOlder')}
          </button>
        )}
        {session?.status === 'pending' && (
          <div className={css.statusLine}>{t('conversation.creating')}</div>
        )}
        {session?.status === 'error' && (
          <div className={css.noticeError}>{t('conversation.error')}: {session.error}</div>
        )}
        {ready && rows.length === 0 && streaming === '' && (
          <div className={css.statusLine}>{t('conversation.empty')}</div>
        )}

        {rows.map(row => row.kind === 'tool'
          ? (
            <div key={row.key} className={clsx(css.tool, row.failed && css.toolFailed)}>
              {row.failed ? <IconWarningOutline16 /> : <IconCheckOutline14 />}
              <span>{row.name}</span>
              {row.failed && <span>{t('conversation.toolFailed')}</span>}
            </div>
          )
          : (
            <div key={row.key} className={clsx(css.message, row.kind === 'user' ? css.user : css.assistant)}>
              {row.kind === 'assistant'
                ? <MarkdownText text={row.text} labels={markdownLabels} />
                : row.text}
            </div>
          ))}

        {streaming !== '' && (
          <div className={clsx(css.message, css.assistant, css.streaming)}>
            <MarkdownText text={streaming} streaming labels={markdownLabels} />
          </div>
        )}

        {session?.running === true && <div className={css.statusLine}>{t('agent.statusRunning')}</div>}
        {session?.error !== undefined && session.status === 'ready' && (
          <div className={css.noticeError}>{session.error}</div>
        )}
      </div>

      {session !== undefined && session.status === 'ready' && (
        <div className={css.laneTail}>
          {!atTail && (
            <button
              type="button"
              className={css.laneAction}
              onClick={() => {
                const lane = laneRef.current
                if (lane !== null) lane.scrollTop = lane.scrollHeight
                setAtTail(true)
              }}
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
        onSent={() => {
          setAtTail(true)
          const lane = laneRef.current
          if (lane !== null) lane.scrollTop = lane.scrollHeight
        }}
      />
    </div>
  )
}
