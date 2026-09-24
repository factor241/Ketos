/**
 * Element-selection overlay: the canvas frame and instruction capsule shown
 * while the user picks a window or canvas element. The layer lets pointers
 * through; a capture-phase click listener claims the click for the pick
 * callback so the control under the pointer never activates.
 */
import { useEffect, useRef } from 'react'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { isBoardEditingTarget } from './editing-target.ts'
import type { BoardTranslate } from './locale.ts'
import css from './ElementSelectionOverlay.module.css'

export interface ElementSelectionOverlayProps {
  /** Locale seat resolving this overlay's copy. */
  t: BoardTranslate
  active: boolean
  onCancel: () => void
  /** Receives the clicked element; the click itself is suppressed. */
  onPick: (element: Element) => void
}

export function ElementSelectionOverlay({
  t,
  active,
  onCancel,
  onPick,
}: ElementSelectionOverlayProps) {
  const pillRef = useRef<HTMLDivElement>(null)

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

  // Capture phase: it runs before the clicked control's own handlers, so
  // `preventDefault` and `stopPropagation` keep the pick from activating the
  // underlying control. The pill is exempt — its cancel button owns its click.
  useEffect(() => {
    if (!active) return
    const handleClick = (e: MouseEvent): void => {
      const target = e.target
      if (!(target instanceof Element)) return
      if (pillRef.current?.contains(target) === true) return
      // Only the board is under inspection: a click on the app's own chrome
      // (the sidebar, a dialog) keeps its normal meaning.
      if (document.querySelector('[data-surface="board"]')?.contains(target) !== true) return
      // An open menu owns the click, like it owns Escape: the pick stands by.
      if (document.querySelector('[role="menu"]') !== null) return
      e.preventDefault()
      e.stopPropagation()
      onPick(target)
    }
    globalThis.addEventListener('click', handleClick, true)
    return () => { globalThis.removeEventListener('click', handleClick, true) }
  }, [active, onPick])

  if (!active) return null

  return (
    <div className={css.overlay}>
      <div ref={pillRef} className={css.pill}>
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
