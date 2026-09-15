/**
 * Center floating Omnibox with Action Menu OpenSwarm-style.
 */
import { useState, type FormEvent } from 'react'
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardStoreHandle } from '../store.ts'
import { openBoardWindow } from '../open-window.ts'
import css from './DashboardToolbar.module.css'

export type DashboardToolbarProps =
  PropsRuntime<'board.omnibar'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>

/** Icon glyphs of the action-menu entries. */
const ATTACH_GLYPH = '📎'
const DICTATE_GLYPH = '🎙️'
const WEB_SEARCH_GLYPH = '🌐'
const SELECT_ELEMENT_GLYPH = '🎯'
const CONNECTORS_GLYPH = '🔌'

export function DashboardToolbar({ actions, t }: DashboardToolbarProps) {
  const [text, setText] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    // Submit clears the field; prompt delivery is not implemented.
    setText('')
  }

  const openConnectors = () => {
    openBoardWindow(actions, 'connectors', t('canvas.connectorsTitle'))
  }

  // Attach, dictation, and web search close the menu without reaching their capabilities.
  const closeMenu = () => { setMenuOpen(false) }

  return (
    <div data-board-layer="omnibar" className={css.omnibar}>
      {menuOpen && (
        <div className={css.menu}>
          <button onClick={closeMenu} className={css.menuItem}>
            <span>{ATTACH_GLYPH}</span> {t('menu.attachFile')}
          </button>
          <button onClick={closeMenu} className={css.menuItem}>
            <span>{DICTATE_GLYPH}</span> {t('menu.dictate')}
          </button>
          <button onClick={closeMenu} className={css.menuItem}>
            <span>{WEB_SEARCH_GLYPH}</span> {t('menu.webSearch')}
          </button>
          <button
            onClick={() => { setMenuOpen(false); actions.setSelectingElement(true) }}
            className={clsx(css.menuItem, css.menuItemAccent)}
          >
            <span>{SELECT_ELEMENT_GLYPH}</span> {t('menu.selectElement')}
          </button>
          <div className={css.menuDivider} />
          <button
            onClick={() => { setMenuOpen(false); openConnectors() }}
            className={css.menuItem}
          >
            <span>{CONNECTORS_GLYPH}</span> {t('menu.connectors')}
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className={css.form}>
        <button
          type="button"
          onClick={() => { setMenuOpen(!menuOpen) }}
          className={clsx(css.menuButton, menuOpen && css.open)}
          title={t('menu.openActionMenu')}
        >
          +
        </button>

        <input
          type="text"
          value={text}
          onChange={(e) => { setText(e.target.value) }}
          placeholder={t('toolbar.composerPlaceholder')}
          className={css.input}
        />

        <button
          type="submit"
          className={clsx(css.submit, text.trim() !== '' && css.ready)}
        >
          ↑
        </button>
      </form>
    </div>
  )
}
