/**
 * Owner settings of a selected note, registered as the note's
 * `board.element.toolbar` occupant: one button that opens the font, text size,
 * and scale menu.
 *
 * Every choice patches exactly one operation: a font or size replaces its data
 * key, and a scale patches `w`, `h`, and `data.scale` together so the world
 * rectangle keeps the same content at the new zoom step. A foreign note offers
 * no button, and data the decoder refuses offers nothing to configure.
 */
import { useRef, useState } from 'react'
import {
  IconSettingsOutlineRegular, Menu, Tooltip, type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { NOTE_FONTS, NOTE_SCALE_STEPS, NOTE_SIZES, parseNoteData } from '@ketos/board-doc/data'
import type { NoteFont, NoteSize } from '@ketos/board-doc/types'
import type { BoardElementInjected } from '../contract/slots.ts'
import type { BoardStoreHandle } from '../store.ts'
import css from './NoteSettingsButton.module.css'

export type NoteSettingsButtonProps =
  PropsRuntime<'board.element.toolbar', 'note'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>
  & BoardElementInjected

export function NoteSettingsButton({ element, editable, useStore, t, patchElement }: NoteSettingsButtonProps) {
  const limits = useStore(s => s.boardLimits)
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const note = limits === null ? null : parseNoteData(element.data, limits)
  if (!editable || note === null) return null

  const items: readonly MenuEntry[] = [
    { type: 'label', id: 'label.note.font', text: t('note.font') },
    ...NOTE_FONTS.map(font => ({ id: `font:${font}`, label: t(`note.font.${font}`) })),
    { type: 'separator', id: 'separator.note.size' },
    { type: 'label', id: 'label.note.size', text: t('note.size') },
    ...NOTE_SIZES.map(size => ({ id: `size:${size}`, label: t(`note.size.${size}`) })),
    { type: 'separator', id: 'separator.note.scale' },
    { type: 'label', id: 'label.note.scale', text: t('note.scale') },
    ...NOTE_SCALE_STEPS.map(scale => ({
      id: `scale:${String(scale)}`,
      label: t('note.scale.percent', { percent: Math.round(scale * 100) }),
    })),
  ]

  /** Apply one menu choice as exactly one patch operation. */
  const apply = (id: string): void => {
    setOpen(false)
    if (id.startsWith('font:')) {
      const font = id.slice('font:'.length) as NoteFont
      if (NOTE_FONTS.includes(font)) void patchElement(element.id, { data: { font } })
      return
    }
    if (id.startsWith('size:')) {
      const size = id.slice('size:'.length) as NoteSize
      if (NOTE_SIZES.includes(size)) void patchElement(element.id, { data: { size } })
      return
    }
    if (id.startsWith('scale:')) {
      const scale = Number(id.slice('scale:'.length))
      if (!NOTE_SCALE_STEPS.includes(scale) || scale === note.scale) return
      const factor = scale / note.scale
      void patchElement(element.id, { w: element.w * factor, h: element.h * factor, data: { scale } })
    }
  }

  return (
    <Menu
      portal
      open={open}
      side="bottom"
      align="start"
      selection="check"
      anchor={(
        <Tooltip label={t('note.settings')} side="bottom" delayMs={300} disabled={open}>
          <button
            ref={buttonRef}
            type="button"
            data-board-action="note-settings"
            aria-label={t('note.settings')}
            aria-haspopup="menu"
            aria-expanded={open}
            className={css.button}
            onClick={() => { setOpen(current => !current) }}
          >
            <IconSettingsOutlineRegular size={12} />
          </button>
        </Tooltip>
      )}
      getAnchorRect={() => buttonRef.current?.getBoundingClientRect() ?? null}
      items={items}
      selectedIds={[`font:${note.font}`, `size:${note.size}`, `scale:${String(note.scale)}`]}
      onSelect={apply}
      onClose={() => { setOpen(false) }}
    />
  )
}
