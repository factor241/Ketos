/**
 * One tool line in the window lane: the call name, its outcome marker, and the
 * repeat control an unavailable result offers. The lane owns the row's place in
 * the transcript; the stages that replace this line with full tool cards keep
 * the same props, so the lane itself needs no change.
 */
import clsx from 'clsx'
import { IconCheckOutline14, IconWarningOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BoardTranslate } from '../locale.ts'
import css from './ToolRow.module.css'

export interface ToolRowProps {
  /** Tool name as the call logged it. */
  readonly name: string
  /** Whether the logged result failed. */
  readonly failed: boolean
  /** Whether the call the result belongs to is outside the loaded window. */
  readonly unavailable?: boolean
  /** Whether the call is still running; the row then shows the running marker. */
  readonly running?: boolean
  /** Locale seat of the board namespace. */
  readonly t: BoardTranslate
  /** Request the earlier turns again, so an unavailable result can be recovered. */
  readonly onRepeat?: (() => void) | undefined
}

export function ToolRow({ name, failed, unavailable = false, running = false, t, onRepeat }: ToolRowProps) {
  return (
    <div
      className={clsx(css.tool, failed && css.toolFailed)}
      data-board-tool={running ? 'running' : failed ? 'failed' : 'done'}
    >
      {running
        ? <span className={css.runningDot} aria-hidden="true" />
        : failed ? <IconWarningOutline16 /> : <IconCheckOutline14 />}
      <span className={css.toolName}>{name}</span>
      {running && <span className={css.toolNote}>{t('conversation.toolRunning')}</span>}
      {failed && <span className={css.toolNote}>{t('conversation.toolFailed')}</span>}
      {unavailable && <span className={css.toolNote}>{t('conversation.toolUnavailable')}</span>}
      {unavailable && onRepeat !== undefined && (
        <button type="button" className={css.repeat} onClick={onRepeat}>
          {t('conversation.toolRepeat')}
        </button>
      )}
    </div>
  )
}
