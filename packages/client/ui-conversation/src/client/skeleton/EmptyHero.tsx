// The composer remains in ConversationRoot so switching out of the blank-draft
// phase does not remount its textarea.

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import {
  IconChevronDownOutline14, IconFolderClose16, IconFolderOpen16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { workspaceTitleOf } from '@deepseek-ai/dsh-util-workspace-path'
import type { ConversationSlotProps } from '../contract/slots.ts'
import { FoldText } from './FoldText.tsx'
import css from './HeroShell.module.css'

/** The owner's locale seat type, passed to hero chrome as a plain prop. */
type HeroTranslate = ConversationSlotProps['t']

/**
 * Basename label for the workspace chip (the shared derivation);
 * separator-only paths echo the raw cwd.
 * @param cwd - workspace directory path (non-empty).
 * @returns chip label.
 */
export function workspaceLabel(cwd: string): string {
  const base = workspaceTitleOf(cwd)
  return base !== '' ? base : cwd
}

/**
 * The workspace chip (folder + label + chevron), always interactive: before
 * the first message the workspace stays switchable — picking another one
 * moves the New Session flow to that workspace's blank session. Without a
 * label the chip renders its placeholder state: closed folder + the
 * "Choose workspace" call to action.
 * @param props.label - chip label (see {@link workspaceLabel}); omitted → placeholder.
 * @param props.menuOpen - menu expansion echo.
 * @param props.onClick - menu toggle.
 * @returns the chip button element.
 */
export function WorkspaceChip({ buttonRef, label, menuOpen = false, onClick, t }: {
  buttonRef?: RefObject<HTMLButtonElement>
  label?: string | undefined
  menuOpen?: boolean
  onClick?: () => void
  t: HeroTranslate
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={css.workspace}
      aria-label={t('hero.chooseWorkspace')}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onClick={onClick}
    >
      {label === undefined
        ? <IconFolderClose16 className={css.folder} size={16} />
        : <IconFolderOpen16 className={css.folder} size={16} />}
      <span className={css.workspaceLabel}>{label ?? t('hero.chooseWorkspace')}</span>
      <IconChevronDownOutline14 className={css.chevron} size={12} />
    </button>
  )
}

/** Hero chrome props. The workspace row rides the InputBar accessory hole, not here. */
export interface HeroShellProps {
  /** The owner's locale seat, passed down as a plain prop. */
  t: HeroTranslate
  /** Overlay content after the stack (modals). */
  children?: ReactNode
}

/** Pause between hero phrase rotations, in milliseconds. */
const HERO_ROTATION_MS = 60_000

/**
 * Pick a phrase from the pool, never repeating the current one.
 * @param phrases - the non-empty phrase pool.
 * @param avoid - the phrase to avoid; omitted on the first pick.
 * @returns the chosen phrase.
 */
function pickPhrase(phrases: readonly string[], avoid?: string): string {
  const candidates = phrases.length > 1 && avoid !== undefined
    ? phrases.filter(phrase => phrase !== avoid)
    : phrases
  return candidates[Math.floor(Math.random() * candidates.length)] ?? ''
}

/**
 * Rotate the hero phrases: one phrase on mount, then a different random phrase
 * every minute, each arriving through the FoldText unfold. The pick never
 * repeats the current phrase, and the unfold timing is jittered per phrase, so
 * the cadence stays calm rather than metronomic.
 * @param props.t - the hero's locale seat.
 * @returns the animated headline text.
 */
function HeroHeadline({ t }: { t: HeroTranslate }) {
  const pool = t('hero.headlines')
  const phrases = useMemo(
    () => pool.split('\n').map(phrase => phrase.trim()).filter(phrase => phrase !== ''),
    [pool],
  )
  const [phrase, setPhrase] = useState(() => pickPhrase(phrases))

  // A locale switch replaces the pool; adopt a phrase from the new language.
  useEffect(() => {
    if (!phrases.includes(phrase)) setPhrase(pickPhrase(phrases))
  }, [phrases, phrase])

  useEffect(() => {
    if (phrases.length < 2) return undefined
    const timer = window.setInterval(() => {
      setPhrase(current => pickPhrase(phrases, current))
    }, HERO_ROTATION_MS)
    return () => { window.clearInterval(timer) }
  }, [phrases])

  const animation = useMemo(
    () => ({ duration: 0.55 + Math.random() * 0.2, stagger: 0.03 + Math.random() * 0.03 }),
    [phrase],
  )

  return (
    <FoldText
      text={phrase}
      duration={animation.duration}
      stagger={animation.stagger}
      ease="cubic-bezier(0.165, 0.84, 0.44, 1)"
      perspective={700}
      creaseShading={0.55}
      fontSize="inherit"
      fontWeight={500}
      color="var(--dsw-alias-label-primary)"
    />
  )
}

/**
 * Render the hero chrome (headline only; no composer, no workspace row).
 * @param props - see {@link HeroShellProps}.
 * @returns the centered hero element tree.
 */
export function HeroShell({ t, children }: HeroShellProps) {
  return (
    <div className={css.root}>
      <div className={css.stack}>
        <div className={css.headline}>
          <span className={css.headlineText} data-testid="hero-headline">
            <HeroHeadline t={t} />
          </span>
        </div>
        <div className={css.body}>
          {/* The composer remains mounted outside this component. */}
        </div>
      </div>
      {children}
    </div>
  )
}
