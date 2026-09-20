/**
 * One tool card in the window lane. The card maps the call's wire name to the
 * ui-primitives block that presents it — terminal for `bash`, read for `read`,
 * diff for `write`/`edit`, search for `grep`/`glob`, web for
 * `web_search`/`web_fetch` — and falls back to a collapsed JSON block for every
 * other tool or any node whose data no card can read. A running call shows its
 * localized run state with the elapsed seconds and, where the call already
 * names its change, the intended terminal or diff; a failure shows the
 * localized state plus the provider's detail; an interrupted result shows its
 * stopped state; a result whose call head left the loaded window keeps the
 * unavailable line and the repeat control. Memoized on the frozen node, so a
 * streamed chunk republishes the lane without touching settled cards.
 */
import { memo, useEffect, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import {
  DiffBlock,
  IconStopFill16,
  IconWarningOutline16,
  JsonBlock,
  ReadBlock,
  SearchBlock,
  TerminalBlock,
  WebBlock,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { BoardTranslate } from '../locale.ts'
import {
  diffBlockLabels, readBlockLabels, searchBlockLabels, terminalBlockLabels, webBlockLabels,
} from './tool-card-labels.ts'
import {
  diffCardData, imageCardData, questionCardData, readCardData, searchCardData,
  terminalCardData, todoCardData, toolCardKind, toolJsonPayload, toolNodeName, toolNodeText,
  webCardData, type ToolCardKind,
} from './tool-card-model.ts'
import css from './ToolCard.module.css'

/** Props of one lane tool card. */
export interface ToolCardProps {
  /** Frozen running call or settled result node. */
  readonly node: ToolCallBlock
  /** Locale seat of the board namespace. */
  readonly t: BoardTranslate
  /** Whether an unavailable result can ask for the earlier turns again. */
  readonly canRepeat?: boolean | undefined
  /** Request the earlier turns again; the lane passes the load-earlier action. */
  readonly onRepeat?: (() => void) | undefined
  /** Resolve one durable result image into a browser URL; absent keeps the JSON fallback. */
  readonly loadImage?: ((attachment: ImageAttachmentRef) => Promise<string>) | undefined
}

/** A settled result carries its discriminant; a running call carries none. */
function isSettledNode(node: ToolCallBlock): node is ToolResultNode {
  return 'kind' in node
}

/**
 * Error codes that mean the call was cancelled rather than refused: the host
 * logs `ABORTED` for a user cancel, and the chat assembler synthesizes
 * `interrupted` for a call left open at a turn boundary.
 */
const STOPPED_CODES: ReadonlySet<string> = new Set(['ABORTED', 'interrupted'])

/** Elapsed whole seconds since one instant, ticking while the call runs. */
function useElapsedSeconds(since: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { window.clearInterval(timer) }
  }, [active])
  return Math.max(0, Math.floor((now - since) / 1000))
}

/** The block a running call can already draw, before its result exists. */
function runningBody(node: ToolCallBlock, kind: ToolCardKind, t: BoardTranslate): ReactNode {
  if (kind === 'terminal') {
    const data = terminalCardData(node)
    if (data === null) return null
    return (
      <TerminalBlock
        command={data.command}
        running
        labels={terminalBlockLabels(t)}
      />
    )
  }
  if (kind === 'diff') {
    const diffs = diffCardData(node)
    if (diffs === null) return null
    return <DiffBlock diffs={diffs} labels={diffBlockLabels(t)} />
  }
  return null
}

/** The block a settled successful result maps to; null declines to the JSON fallback. */
function settledBody(
  node: ToolCallBlock,
  kind: ToolCardKind,
  t: BoardTranslate,
  loadImage: ((attachment: ImageAttachmentRef) => Promise<string>) | undefined,
): ReactNode {
  switch (kind) {
    case 'terminal': {
      const data = terminalCardData(node)
      if (data === null) return null
      return (
        <TerminalBlock
          command={data.command}
          output={data.output}
          exitCode={data.exitCode}
          signal={data.signal}
          labels={terminalBlockLabels(t)}
        />
      )
    }
    case 'read': {
      const data = readCardData(node)
      if (data === null) return null
      return (
        <ReadBlock
          label={data.label}
          lines={data.lines}
          totalLines={data.totalLines}
          lang={data.lang}
          labels={readBlockLabels(t)}
        />
      )
    }
    case 'diff': {
      const diffs = diffCardData(node)
      if (diffs === null) return null
      return <DiffBlock diffs={diffs} labels={diffBlockLabels(t)} />
    }
    case 'search': {
      const data = searchCardData(node)
      if (data === null) return null
      return <SearchBlock {...data} labels={searchBlockLabels(t)} />
    }
    case 'web': {
      const data = webCardData(node)
      if (data === null) return null
      return <WebBlock {...data} labels={webBlockLabels(t)} />
    }
    case 'image': {
      const data = imageCardData(node)
      if (data === null || loadImage === undefined) return null
      return (
        <div className={css.images} data-board-image={data.label}>
          {data.attachments.map((attachment, index) => (
            <ToolImage
              key={`${attachment.attachmentId}:${String(index)}`}
              attachment={attachment}
              load={loadImage}
              alt={data.label}
            />
          ))}
        </div>
      )
    }
    case 'todos': {
      const items = todoCardData(node)
      if (items === null) return null
      return (
        <div className={css.list} data-board-todos="">
          <div className={css.listTitle}>{t('todo.title')}</div>
          <ul className={css.todoList}>
            {items.map((item, index) => (
              <li
                key={`${String(index)}:${item.content}`}
                className={clsx(css.todo, item.status === 'completed' && css.todoDone)}
                data-board-todo={item.status}
              >
                <span className={css.todoMark} aria-hidden="true" />
                <span className={css.todoText}>{item.content}</span>
              </li>
            ))}
          </ul>
        </div>
      )
    }
    case 'question': {
      const pairs = questionCardData(node)
      if (pairs === null) return null
      return (
        <div className={css.list} data-board-questions="">
          <div className={css.listTitle}>{t('question.title')}</div>
          <dl className={css.qaList}>
            {pairs.map((pair, index) => (
              <div key={`${String(index)}:${pair.question}`} className={css.qa}>
                <dt className={css.qaQuestion}>{pair.question}</dt>
                <dd className={css.qaAnswer}>{pair.answers.join(', ')}</dd>
              </div>
            ))}
          </dl>
        </div>
      )
    }
    default:
      return null
  }
}

/** One durable result image; a pending or refused read keeps the placeholder. */
const ToolImage = memo(function ToolImage({ attachment, load, alt }: {
  readonly attachment: ImageAttachmentRef
  readonly load: (attachment: ImageAttachmentRef) => Promise<string>
  readonly alt: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setUrl(null)
    load(attachment).then(
      (value) => { if (live) setUrl(value) },
      () => {
        // A refused read keeps the placeholder; the lane does not surface it.
      },
    )
    return () => { live = false }
  }, [attachment, load])
  if (url === null) return <span className={css.imagePending} data-board-image-pending="" />
  return <img className={css.image} src={url} alt={alt} />
})

/** Display name of one node: its wire name, or the call id when the head is gone. */
function nodeTitle(node: ToolCallBlock): string {
  const name = toolNodeName(node)
  return name === '' ? node.callId : name
}

export const ToolCard = memo(function ToolCard({
  node, t, canRepeat = false, onRepeat, loadImage,
}: ToolCardProps) {
  const running = !isSettledNode(node)
  const failed = !running && node.isError
  const interrupted = failed && node.error !== undefined && STOPPED_CODES.has(node.error.code)
  const unavailable = !running && node.call === null
  const seconds = useElapsedSeconds(node.time, running)
  const title = nodeTitle(node)
  const kind = toolCardKind(toolNodeName(node))
  const state = running ? 'running' : failed ? 'failed' : 'done'

  let status: ReactNode = null
  if (running) {
    status = (
      <div className={css.status} data-board-tool-status="running">
        <span className={css.runningDot} aria-hidden="true" />
        <span className={css.statusName}>{title}</span>
        <span className={css.statusNote}>{t('conversation.toolRunningSeconds', { seconds })}</span>
      </div>
    )
  } else if (unavailable) {
    status = (
      <div className={css.status} data-board-tool-status="unavailable">
        <IconWarningOutline16 />
        <span className={css.statusName}>{title}</span>
        <span className={css.statusNote}>{t('conversation.toolUnavailable')}</span>
        {canRepeat && onRepeat !== undefined && (
          <button type="button" className={css.repeat} onClick={onRepeat}>
            {t('conversation.toolRepeat')}
          </button>
        )}
      </div>
    )
  } else if (interrupted) {
    status = (
      <div className={css.status} data-board-tool-status="stopped">
        <IconStopFill16 />
        <span className={css.statusName}>{title}</span>
        <span className={css.statusNote}>{t('conversation.toolStopped')}</span>
      </div>
    )
  } else if (failed) {
    status = (
      <div className={css.status} data-board-tool-status="failed">
        <IconWarningOutline16 />
        <span className={css.statusName}>{title}</span>
        <span className={css.statusNote}>{t('conversation.toolFailed')}</span>
        {node.error !== undefined && (
          <span className={css.errorDetail} data-board-tool-error={node.error.code}>
            {node.error.name}
          </span>
        )}
      </div>
    )
  }

  const body = running
    ? runningBody(node, kind, t)
    : failed || unavailable
      ? null
      : settledBody(node, kind, t, loadImage)
  const errorText = failed && !interrupted ? toolNodeText(node) : ''

  return (
    <div className={clsx(css.card, failed && css.cardFailed)} data-board-tool={state}>
      {status}
      {errorText !== '' && <pre className={css.errorText}>{errorText}</pre>}
      {body}
      {!running && !failed && !unavailable && body === null && (
        <JsonBlock
          label={title}
          payload={toolJsonPayload(node)}
          truncatedLabel={total => t('json.truncated', { total })}
        />
      )}
    </div>
  )
})
