/**
 * Body of a window kind the MVP does not serve: instead of an empty content
 * region the frame shows the localized unavailable line, tagged with the window
 * kind so the rendered notice names which window it belongs to.
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './MvpUnavailableBody.module.css'

export type MvpUnavailableBodyProps =
  PropsRuntime<'board.window.body'>
  & PropsLocale<'board'>

/**
 * Render the unavailable notice of one window body.
 * @param props - the window owner share and the locale seat.
 * @returns the centred unavailable line.
 */
export function MvpUnavailableBody({ window: cardWindow, t }: MvpUnavailableBodyProps) {
  return (
    <div className={css.body} data-board-window-unavailable={cardWindow.kind}>
      <span className={css.text}>{t('window.unavailable')}</span>
    </div>
  )
}
