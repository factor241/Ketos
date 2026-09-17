/**
 * Element-selection overlay: the canvas frame and instruction capsule shown
 * while the user picks a window or canvas element.
 */
import { useEffect } from 'react'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { isBoardEditingTarget } from './editing-target.ts'
import type { BoardTranslate } from './locale.ts'
import css from './ElementSelectionOverlay.module.css'

export interface ElementSelectionOverlayProps {
  /** Locale seat resolving this overlay's copy. */
  t: BoardTranslate
  active: boolean
  onCancel: () => void
}

export function ElementSelectionOverlay({
  t,
  active,
  onCancel,
}: ElementSelectionOverlayProps) {
  // Escape leaves the mode, after an open menu and a focused editor have had
  // their say: the ladder is menu -> editor -> selection -> chats panel ->
  // fullscreen, and the frame stands down while this overlay is active.
  useEffect(() => {
    if (!active) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (document.querySelector('[role="menu"]') !== null) return
      if (isBoardEditingTarget(e.target)) return
      onCancel()
    }
    globalThis.addEventListener('keydown', handleKeyDown)
    return () => { globalThis.removeEventListener('keydown', handleKeyDown) }
  }, [active, onCancel])

  if (!active) return null

  return (
    <div className={css.overlay}>
      <div className={css.pill}>
        <span>{t('inspector.selectTarget')}</span>
        <button
          type="button"
          onClick={onCancel}
          className={css.cancel}
          aria-label={t('inspector.cancel')}
        >
          <IconCloseOutline16 />
        </button>
      </div>
    </div>
  )
}
