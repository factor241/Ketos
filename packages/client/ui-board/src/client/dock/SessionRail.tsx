/**
 * Left floating rail for active sessions/windows OpenSwarm-style.
 */
import { useState } from 'react'
import type { BoardState } from '../store.ts'
import type { WindowId } from '../contract/slots.ts'
import type { BoardTranslate } from '../locale.ts'

export interface SessionRailProps {
  /** Locale seat resolving this rail's copy. */
  t: BoardTranslate
  state: BoardState
  onSelectWindow: (id: WindowId) => void
  onAddAgent: () => void
  onAddTools: () => void
  onResetView: () => void
}

export function SessionRail({
  t,
  state,
  onSelectWindow,
  onAddAgent,
  onAddTools,
  onResetView,
}: SessionRailProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  return (
    <div
      style={{
        position: 'absolute',
        left: 20,
        top: '50%',
        transform: 'translateY(-50%)',
        background: '#28262C',
        borderRadius: 26,
        padding: '12px 8px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        boxShadow: '0 12px 32px -4px rgba(0, 0, 0, 0.35)',
        border: '1px solid #3A3940',
        zIndex: 100,
        userSelect: 'none',
      }}
    >
      {state.windowOrder.map((id) => {
        const win = state.windows[id as string]
        if (!win) return null
        const isActive = id === state.activeWindowId
        const isHovered = hoveredId === id
        const isAgent = win.kind === 'agent'

        return (
          <div
            key={id}
            style={{ position: 'relative' }}
            onMouseEnter={() => setHoveredId(id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <button
              onClick={() => onSelectWindow(id)}
              style={{
                width: 38,
                height: 38,
                borderRadius: '50%',
                background: isActive ? '#B8532F' : '#36343C',
                border: isActive ? '2px solid #FFFFFF' : '1px solid #45434D',
                color: '#FFFFFF',
                fontSize: 14,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              title={win.title}
            >
              {isAgent ? t('rail.agentBadge') : '🛠'}
            </button>

            {isHovered && (
              <div
                style={{
                  position: 'absolute',
                  left: 48,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: '#1E1D22',
                  border: '1px solid #3A3940',
                  color: '#E6E4E8',
                  padding: '6px 12px',
                  borderRadius: 8,
                  fontSize: 12,
                  whiteSpace: 'nowrap',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                  zIndex: 200,
                  pointerEvents: 'none',
                }}
              >
                {win.title}
              </div>
            )}
          </div>
        )
      })}

      <div style={{ width: 24, height: 1, background: '#3A3940', margin: '4px 0' }} />

      <button
        onClick={onAddAgent}
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: '#36343C',
          border: '1px dashed #5A5864',
          color: '#E6E4E8',
          fontSize: 16,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title={t('rail.addAgent')}
      >
        +
      </button>

      <button
        onClick={onAddTools}
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: '#36343C',
          border: '1px solid #45434D',
          color: '#E6E4E8',
          fontSize: 14,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title={t('rail.addConnectors')}
      >
        ⚙
      </button>

      <button
        onClick={onResetView}
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: '#36343C',
          border: '1px solid #45434D',
          color: '#E6E4E8',
          fontSize: 12,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title={t('rail.resetView')}
      >
        ⌖
      </button>
    </div>
  )
}
