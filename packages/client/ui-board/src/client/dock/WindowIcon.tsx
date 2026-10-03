/**
 * The dock's window icon: a chat window wears a lettered circle tinted by its
 * working folder, a clone the record's initials, and a utility window the
 * glyph of its kind. The row's status dot and active background stay on the
 * dock button around this icon (Т1.7, Т1.8).
 */
import type { ReactNode } from 'react'
import clsx from 'clsx'
import {
  IconBrowseOutlineRegular,
  IconChecklistOutlineRegular,
  IconPluginPinwheelOutlineRegular,
  IconGaugeOutlineRegular,
  IconSettingsOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WindowKind } from '../contract/slots.ts'
import { folderPaletteIndex, titleInitials } from './window-icon.ts'
import css from './WindowIcon.module.css'

/** The folder-palette class of one slot; the slots are exactly the three tints. */
function paletteClass(index: number): string | undefined {
  switch (index) {
    case 0: return css.chipBusiness
    case 1: return css.chipSuccess
    default: return css.chipWarn
  }
}

/**
 * The glyph of one utility window kind; chat and clone kinds never reach it.
 * @param kind - the window kind.
 * @returns the kind's icon element.
 */
export function windowKindGlyph(kind: WindowKind): ReactNode {
  switch (kind) {
    case 'settings': return <IconSettingsOutlineRegular />
    case 'connectors': return <IconPluginPinwheelOutlineRegular />
    case 'dashboard': return <IconGaugeOutlineRegular />
    case 'tasks': return <IconChecklistOutlineRegular />
    default: return <IconBrowseOutlineRegular />
  }
}

/** Props of one dock window icon. */
export interface WindowIconProps {
  /** The window the icon stands for. */
  readonly kind: WindowKind
  /** The window's resolved title; its letters name a chat chip. */
  readonly title: string
  /** The clone record's name for a clone window. */
  readonly cloneName?: string | undefined
  /**
   * The window's folder identity (its workspace id, else its working
   * directory); absent while the session has no folder. A clone ignores it.
   */
  readonly folderKey?: string | undefined
}

/**
 * One dock icon: the lettered chip, the clone initials, or the kind glyph.
 * @param props - the window kind, title, clone name, and folder key.
 * @returns the icon element.
 */
export function WindowIcon({ kind, title, cloneName, folderKey }: WindowIconProps): ReactNode {
  if (kind === 'clone') {
    return (
      <span className={clsx(css.chip, css.chipNeutral)} data-board-icon="clone">
        {titleInitials(cloneName ?? title)}
      </span>
    )
  }
  if (kind !== 'agent') {
    return <span className={css.kindGlyph} data-board-icon={kind}>{windowKindGlyph(kind)}</span>
  }
  const letters = titleInitials(title)
  if (letters === '') {
    return <span className={css.kindGlyph} data-board-icon="agent">{windowKindGlyph(kind)}</span>
  }
  const palette = folderKey === undefined ? undefined : folderPaletteIndex(folderKey)
  return (
    <span
      className={clsx(css.chip, palette === undefined ? css.chipNeutral : paletteClass(palette))}
      data-board-icon="letters"
      data-board-palette={palette ?? 'none'}
    >
      {letters}
    </span>
  )
}
