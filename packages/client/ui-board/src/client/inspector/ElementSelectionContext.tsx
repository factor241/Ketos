/**
 * Spatial Element Inspector Overlay OpenSwarm-style.
 */
import { useEffect } from 'react'

export interface ElementSelectionOverlayProps {
  active: boolean
  onCancel: () => void
}

export function ElementSelectionOverlay({
  active,
  onCancel,
}: ElementSelectionOverlayProps) {
  useEffect(() => {
    if (!active) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    globalThis.addEventListener('keydown', handleKeyDown)
    return () => globalThis.removeEventListener('keydown', handleKeyDown)
  }, [active, onCancel])

  if (!active) return null

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 500,
        pointerEvents: 'none',
        border: '3px dashed #B8532F',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#B8532F',
          color: '#FFFFFF',
          padding: '8px 18px',
          borderRadius: 9999,
          fontSize: 13,
          fontWeight: 600,
          boxShadow: '0 8px 24px rgba(184, 83, 47, 0.4)',
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <span>🎯 Select an element or window on the canvas</span>
        <button
          onClick={onCancel}
          style={{
            background: 'rgba(0,0,0,0.2)',
            border: 'none',
            color: '#FFFFFF',
            borderRadius: '50%',
            width: 20,
            height: 20,
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
