/**
 * Center floating Omnibox with its Action Menu. The menu is the shared
 * ui-primitives `Menu`; the entries are the navigation stubs the later stages
 * wire to capabilities.
 */
import { useState, type FormEvent } from 'react'
import clsx from 'clsx'
import {
  IconGlobeOutline14,
  IconInspectOutline12,
  IconPaperclipOutline16,
  IconSendOutline16,
  IconSparkle16,
  Menu,
  Tooltip,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardStoreHandle } from '../store.ts'
import css from './DashboardToolbar.module.css'

export type DashboardToolbarProps =
  PropsRuntime<'board.omnibar'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>

export function DashboardToolbar({ actions, t }: DashboardToolbarProps) {
  const [text, setText] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    // Submit clears the field; prompt delivery is not implemented.
    setText('')
  }

  const menuItems: readonly MenuEntry[] = [
    { id: 'attachFile', label: t('menu.attachFile'), icon: <IconPaperclipOutline16 /> },
    { id: 'dictate', label: t('menu.dictate'), icon: <IconSparkle16 /> },
    { id: 'webSearch', label: t('menu.webSearch'), icon: <IconGlobeOutline14 /> },
    { id: 'selectElement', label: t('menu.selectElement'), icon: <IconInspectOutline12 /> },
  ]

  // Attach, dictation, and web search close the menu without reaching their capabilities yet.
  const handleMenuSelect = (id: string): void => {
    setMenuOpen(false)
    if (id === 'selectElement') actions.setSelectingElement(true)
  }

  return (
    <div data-board-layer="omnibar" className={css.omnibar}>
      <form onSubmit={handleSubmit} className={css.form}>
        <Menu
          open={menuOpen}
          side="top"
          selection="fill"
          anchor={(
            <Tooltip label={t('menu.openActionMenu')} side="top">
              <button
                type="button"
                onClick={() => { setMenuOpen(!menuOpen) }}
                className={clsx(css.menuButton, menuOpen && css.open)}
                aria-label={t('menu.openActionMenu')}
              >
                +
              </button>
            </Tooltip>
          )}
          items={menuItems}
          onSelect={handleMenuSelect}
          onClose={() => { setMenuOpen(false) }}
        />

        <input
          type="text"
          value={text}
          onChange={(e) => { setText(e.target.value) }}
          placeholder={t('toolbar.composerPlaceholder')}
          className={css.input}
        />

        <Tooltip label={t('menu.send')} side="top">
          <button
            type="submit"
            className={clsx(css.submit, text.trim() !== '' && css.ready)}
            aria-label={t('menu.send')}
          >
            <IconSendOutline16 />
          </button>
        </Tooltip>
      </form>
    </div>
  )
}
