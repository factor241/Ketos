/**
 * Center floating Omnibox with Action Menu OpenSwarm-style.
 */
import { useState, type FormEvent } from 'react'
import type { BoardTranslate } from '../locale.ts'

export interface DashboardToolbarProps {
  /** Locale seat resolving this omnibox's copy. */
  t: BoardTranslate
  onSendMessage: (text: string) => void
  onStartElementSelection: () => void
  onOpenConnectors: () => void
}

export function DashboardToolbar({
  t,
  onSendMessage,
  onStartElementSelection,
  onOpenConnectors,
}: DashboardToolbarProps) {
  const [text, setText] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    onSendMessage(text)
    setText('')
  }

  // Attachment, dictation, and web-search entries only close the menu until their windows land.
  const closeMenu = () => { setMenuOpen(false) }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        userSelect: 'none',
      }}
    >
      {menuOpen && (
        <div
          style={{
            marginBottom: 10,
            background: '#222126',
            borderRadius: 14,
            border: '1px solid #36353C',
            boxShadow: '0 16px 36px rgba(0,0,0,0.4)',
            padding: 6,
            minWidth: 200,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            color: '#E6E4E8',
            fontSize: 13,
          }}
        >
          <button
            onClick={closeMenu}
            style={{ padding: '8px 12px', textAlign: 'left', background: 'transparent', border: 'none', color: '#E6E4E8', cursor: 'pointer', borderRadius: 8, display: 'flex', gap: 8 }}
          >
            <span>📎</span> {t('menu.attachFile')}
          </button>
          <button
            onClick={closeMenu}
            style={{ padding: '8px 12px', textAlign: 'left', background: 'transparent', border: 'none', color: '#E6E4E8', cursor: 'pointer', borderRadius: 8, display: 'flex', gap: 8 }}
          >
            <span>🎙️</span> {t('menu.dictate')}
          </button>
          <button
            onClick={closeMenu}
            style={{ padding: '8px 12px', textAlign: 'left', background: 'transparent', border: 'none', color: '#E6E4E8', cursor: 'pointer', borderRadius: 8, display: 'flex', gap: 8 }}
          >
            <span>🌐</span> {t('menu.webSearch')}
          </button>
          <button
            onClick={() => { setMenuOpen(false); onStartElementSelection() }}
            style={{ padding: '8px 12px', textAlign: 'left', background: 'rgba(184, 83, 47, 0.15)', border: 'none', color: '#B8532F', fontWeight: 600, cursor: 'pointer', borderRadius: 8, display: 'flex', gap: 8 }}
          >
            <span>🎯</span> {t('menu.selectElement')}
          </button>
          <div style={{ height: 1, background: '#36353C', margin: '4px 0' }} />
          <button
            onClick={() => { setMenuOpen(false); onOpenConnectors() }}
            style={{ padding: '8px 12px', textAlign: 'left', background: 'transparent', border: 'none', color: '#E6E4E8', cursor: 'pointer', borderRadius: 8, display: 'flex', gap: 8 }}
          >
            <span>🔌</span> {t('menu.connectors')}
          </button>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        style={{
          background: 'rgba(43, 42, 48, 0.92)',
          backdropFilter: 'blur(16px)',
          borderRadius: 9999,
          border: '1px solid #3A3940',
          boxShadow: '0 12px 32px -4px rgba(0, 0, 0, 0.35)',
          padding: '6px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: 440,
        }}
      >
        <button
          type="button"
          onClick={() => { setMenuOpen(!menuOpen) }}
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: menuOpen ? '#B8532F' : '#36343C',
            border: 'none',
            color: '#FFFFFF',
            fontSize: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
          title={t('menu.openActionMenu')}
        >
          +
        </button>

        <input
          type="text"
          value={text}
          onChange={(e) => { setText(e.target.value) }}
          placeholder={t('toolbar.composerPlaceholder')}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: '#E6E4E8',
            fontSize: 14,
          }}
        />

        <button
          type="submit"
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: text.trim() ? '#B8532F' : '#36343C',
            border: 'none',
            color: '#FFFFFF',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: text.trim() ? 'pointer' : 'default',
          }}
        >
          ↑
        </button>
      </form>
    </div>
  )
}
