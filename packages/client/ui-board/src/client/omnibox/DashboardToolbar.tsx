/**
 * Center floating Omnibox with its Action Menu. Submit delivers the typed text
 * through the window bridge, so Enter and Send land in the active chat window's
 * session (a chat window opens when none is addressed); the menu's window
 * entries open real board windows, and capability entries either reach their
 * board-local target or state why the MVP has none.
 */
import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react'
import clsx from 'clsx'
import {
  IconAgentPresetOutline16,
  IconBrowseOutline16,
  IconGlobeOutline14,
  IconInspectOutline12,
  IconPaperclipOutline16,
  IconSendOutline16,
  IconSparkle16,
  Menu,
  Tooltip,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { BoardWindowInjected } from '../contract/slots.ts'
import type { BoardStoreHandle } from '../store.ts'
import { nextWindowOrdinal } from '../store.ts'
import { menuPlacement, type MenuPlacement } from '../menu-placement.ts'
import { openBoardWindow, resolveChatWindow } from '../open-window.ts'
import { folderName, recentChats } from '../chat-list-model.ts'
import { useDictation } from '../dictation.tsx'
import css from './DashboardToolbar.module.css'

/** Most recent chats the Omnibox menu offers. */
const RECENT_CHAT_LIMIT = 6

export type DashboardToolbarProps =
  PropsRuntime<'board.omnibar'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>
  & InjectFace<BoardWindowInjected>

export function DashboardToolbar({
  useStore, actions, t, sendPrompt, openChat, useSessionList, useWorkspaceList,
}: DashboardToolbarProps) {
  const [text, setText] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuPlacement | null>(null)
  const menuAnchor = useRef<HTMLButtonElement>(null)
  const windows = useStore(s => s.windows)
  const activeWindowId = useStore(s => s.activeWindowId)
  const sessionList = useSessionList(s => s)
  const workspaceList = useWorkspaceList(s => s)
  const recent = useMemo(
    () => recentChats(sessionList, workspaceList, RECENT_CHAT_LIMIT),
    [sessionList, workspaceList],
  )

  const dictation = useDictation((transcript) => {
    setText(current => current === '' ? transcript : `${current} ${transcript}`)
  })

  // The portal positions from the trigger rect, so the side and alignment read
  // the trigger's viewport position once and the list tracks it afterwards.
  const openMenu = useCallback((trigger: HTMLElement | null): void => {
    setMenu(current => current !== null ? null : menuPlacement(trigger))
  }, [])
  const closeMenu = useCallback(() => { setMenu(null) }, [])

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault()
    const value = text.trim()
    if (value === '') return
    const target = resolveChatWindow(actions, windows, activeWindowId)
    void sendPrompt(target, value, 'queue')
    setText('')
    setNotice(null)
  }

  const handleMenuSelect = (id: string): void => {
    closeMenu()
    switch (id) {
      case 'open:agent':
        openBoardWindow(actions, 'agent', nextWindowOrdinal(windows))
        return
      case 'open:connectors':
        openBoardWindow(actions, 'connectors', nextWindowOrdinal(windows))
        return
      case 'open:settings':
        openBoardWindow(actions, 'settings', nextWindowOrdinal(windows))
        return
      case 'open:clone':
        setNotice(t('menu.unavailable.clone'))
        return
      case 'open:dashboard':
        setNotice(t('menu.unavailable.dashboard'))
        return
      case 'open:tasks':
        setNotice(t('menu.unavailable.tasks'))
        return
      case 'attachFile': {
        const target = resolveChatWindow(actions, windows, activeWindowId)
        actions.pushComposerIntent(target, { pickFiles: true })
        return
      }
      case 'dictate':
        if (dictation.supported) dictation.toggle()
        else setNotice(t('voice.unsupported'))
        return
      case 'webSearch':
        // The web capability is host-side with no client path: the notice is
        // the honest outcome, not a session call that cannot exist.
        setNotice(t('menu.unavailable.webSearch'))
        return
      case 'selectElement':
        actions.setSelectingElement(true)
        return
      default:
        if (id.startsWith('recent:')) {
          // The recent list follows the same duplicate rule as the chats panel:
          // an already open chat focuses its window instead of opening twice.
          const outcome = openChat(id.slice('recent:'.length) as SessionId)
          if (outcome.kind === 'unknown') setNotice(t('panel.chatGone'))
        }
        return
    }
  }

  const menuItems: readonly MenuEntry[] = [
    { type: 'label', id: 'group.newWindow', text: t('menu.newWindow') },
    { id: 'open:agent', label: t('menu.open.agent'), icon: <IconAgentPresetOutline16 /> },
    { id: 'open:connectors', label: t('menu.open.connectors'), icon: <IconBrowseOutline16 /> },
    { id: 'open:settings', label: t('menu.open.settings'), icon: <IconBrowseOutline16 /> },
    { id: 'open:clone', label: t('menu.open.clone'), icon: <IconAgentPresetOutline16 /> },
    { id: 'open:dashboard', label: t('menu.open.dashboard'), icon: <IconBrowseOutline16 /> },
    { id: 'open:tasks', label: t('menu.open.tasks'), icon: <IconBrowseOutline16 /> },
    ...(recent.length === 0 ? [] : [
      { type: 'separator', id: 'separator.recent' },
      { type: 'label', id: 'group.recentChats', text: t('menu.recentChats') },
      ...recent.map(row => ({
        id: `recent:${row.id}`,
        label: row.cwd === undefined || row.cwd === '' ? row.title : `${row.title} · ${folderName(row.cwd)}`,
      })),
    ] satisfies readonly MenuEntry[]),
    { type: 'separator', id: 'separator.capabilities' },
    { id: 'attachFile', label: t('menu.attachFile'), icon: <IconPaperclipOutline16 /> },
    { id: 'dictate', label: t('menu.dictate'), icon: <IconSparkle16 /> },
    { id: 'webSearch', label: t('menu.webSearch'), icon: <IconGlobeOutline14 /> },
    { type: 'separator', id: 'separator.selection' },
    { id: 'selectElement', label: t('menu.selectElement'), icon: <IconInspectOutline12 /> },
  ]

  return (
    <div data-board-layer="omnibar" className={css.omnibar}>
      {notice !== null && <div data-board-omnibar-notice className={css.notice}>{notice}</div>}
      <form onSubmit={handleSubmit} className={css.form}>
        <Menu
          portal
          open={menu !== null}
          side={menu?.side ?? 'top'}
          align={menu?.align ?? 'start'}
          selection="fill"
          anchor={(
            <Tooltip label={t('menu.openActionMenu')} side="top" disabled={menu !== null}>
              <button
                ref={menuAnchor}
                type="button"
                data-board-action="omnibar-action-menu"
                onClick={() => { openMenu(menuAnchor.current) }}
                className={clsx(css.menuButton, menu !== null && css.open)}
                aria-label={t('menu.openActionMenu')}
              >
                +
              </button>
            </Tooltip>
          )}
          getAnchorRect={() => menuAnchor.current?.getBoundingClientRect() ?? null}
          items={menuItems}
          onSelect={handleMenuSelect}
          onClose={closeMenu}
        />

        <input
          type="text"
          value={text}
          data-board-action="omnibar-input"
          onChange={(e) => {
            setText(e.target.value)
            setNotice(null)
          }}
          placeholder={t('toolbar.composerPlaceholder')}
          className={css.input}
        />

        <Tooltip label={t('menu.send')} side="top">
          <button
            type="submit"
            data-board-action="omnibar-send"
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
