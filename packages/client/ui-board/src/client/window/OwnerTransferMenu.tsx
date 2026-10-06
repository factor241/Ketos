/**
 * Owner transfer menu of one window bezel: the owner's name opens a menu that
 * lists every other board participant and transfers the window on confirm.
 *
 * The menu mounts only for the participant who manages the window; everyone
 * else sees the plain {@link OwnerBadge} caption. The transfer runs through
 * the board store, which drops the new owner from the window's selected-people
 * list and withdraws the management rights from this participant.
 *
 * The card is the shared `Menu` primitive rather than a bare `MenuSurface`:
 * it owns portal placement against the window's popover host, outside-click
 * and Escape dismissal, and the `role="menu"` node the frame's Escape ladder
 * stands down for.
 */
import { useCallback, useState } from 'react'
import { brandString } from '@deepseek-ai/dsh-brand'
import { Menu, MenuItemButton, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardStoreHandle } from '../store.ts'
import type { BoardWindowState } from '../contract/slots.ts'
import type { BoardTranslate } from '../locale.ts'
import { boardParticipants, participantLabel, type OwnerId } from '../owners.ts'
import { useBoardMenuDismiss } from '../board-popover.tsx'
import { OwnerBadge } from './OwnerBadge.tsx'
import { PersonOption } from './PersonOption.tsx'

/** Row-id prefix naming one participant candidate. */
const PERSON_PREFIX = 'person:'

export interface OwnerTransferMenuProps {
  /** The window whose owner the menu changes. */
  readonly window: BoardWindowState
  /** Board namespace translator. */
  readonly t: BoardTranslate
  /** Board store read seat; the menu resolves the roster through it. */
  readonly useStore: PropsStore<BoardStoreHandle>['useStore']
  /** Board action face, for the transfer. */
  readonly actions: PropsStore<BoardStoreHandle>['actions']
}

/**
 * Render the owner badge and, for the managing participant, its transfer menu.
 * @param props - the window, the translator, the store seat, and the action face.
 * @returns the badge trigger with the portaled transfer menu.
 */
export function OwnerTransferMenu({ window: cardWindow, t, useStore, actions }: OwnerTransferMenuProps) {
  const participants = useStore(s => boardParticipants(s))
  const owner = participants.find(participant => participant.id === cardWindow.ownerId)
  const ownerLabel = participantLabel(t, owner)
  const candidates = participants.filter(participant => participant.id !== cardWindow.ownerId)
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<OwnerId | null>(null)

  const close = useCallback((): void => {
    setOpen(false)
    setChosen(null)
  }, [])
  // Moving, resizing, culling, or closing the window takes its menu with it.
  useBoardMenuDismiss(close)

  const toggle = (): void => {
    if (open) {
      close()
      return
    }
    setChosen(null)
    setOpen(true)
  }

  const confirm = (): void => {
    if (chosen === null) return
    actions.transferWindow(cardWindow.id, chosen)
    close()
  }

  const items: readonly MenuEntry[] = [
    { type: 'label', id: 'title', text: t('bezel.transfer.title') },
    ...(candidates.length === 0
      ? [{ id: 'empty', label: t('bezel.transfer.empty'), disabled: true } satisfies MenuEntry]
      : candidates.map((participant): MenuEntry => ({
        id: `${PERSON_PREFIX}${participant.id}`,
        label: <PersonOption participant={participant} t={t} />,
      }))),
  ]

  return (
    <Menu
      portal
      open={open}
      anchor={(
        <OwnerBadge
          label={ownerLabel}
          onTriggerClick={toggle}
          expanded={open}
          triggerLabel={t('bezel.owner.aria', { name: ownerLabel })}
        />
      )}
      selectedId={chosen === null ? undefined : `${PERSON_PREFIX}${chosen}`}
      items={items}
      onSelect={(id) => {
        if (!id.startsWith(PERSON_PREFIX)) return
        setChosen(brandString<OwnerId>(id.slice(PERSON_PREFIX.length)))
      }}
      onClose={close}
    >
      <MenuItemButton separatorBefore disabled={chosen === null} onSelect={confirm}>
        {t('bezel.transfer.action')}
      </MenuItemButton>
    </Menu>
  )
}
