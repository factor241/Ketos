/**
 * Access menu of one window bezel: the indicator opens a menu with the three
 * access modes and, under «Selected people», the participant checklist. A
 * selected person outside the roster is listed as an unknown participant, so
 * the owner can remove them.
 *
 * The menu mounts only for the participant who manages the window; everyone
 * else sees the plain {@link AccessIndicator} caption. Mode switches keep the
 * stored people list, and picking a person turns the selected mode on without
 * closing the menu, so a multi-selection stays one gesture.
 */
import { useCallback, useState } from 'react'
import { brandString } from '@deepseek-ai/dsh-brand'
import { Menu, type MenuEntry, type MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardStoreHandle } from '../store.ts'
import type { BoardWindowState } from '../contract/slots.ts'
import type { BoardTranslate } from '../locale.ts'
import { boardParticipants, type BoardParticipant, type OwnerId } from '../owners.ts'
import { useBoardMenuDismiss } from '../board-popover.tsx'
import { accessPeople, AccessIndicator } from './AccessIndicator.tsx'
import { PersonOption } from './PersonOption.tsx'

/** Row-id prefix naming one selected person inside the mode submenu. */
const PERSON_PREFIX = 'person:'

export interface AccessMenuProps {
  /** The window whose access the menu changes. */
  readonly window: BoardWindowState
  /** Board namespace translator. */
  readonly t: BoardTranslate
  /** Board store read seat; the menu resolves the roster through it. */
  readonly useStore: PropsStore<BoardStoreHandle>['useStore']
  /** Board action face, for the access writes. */
  readonly actions: PropsStore<BoardStoreHandle>['actions']
}

/**
 * Render the access indicator and, for the managing participant, its menu.
 * @param props - the window, the translator, the store seat, and the action face.
 * @returns the indicator trigger with the portaled access menu.
 */
export function AccessMenu({ window: cardWindow, t, useStore, actions }: AccessMenuProps) {
  const participants = useStore(s => boardParticipants(s))
  const [open, setOpen] = useState(false)

  const close = useCallback((): void => {
    setOpen(false)
  }, [])
  // Moving, resizing, culling, or closing the window takes its menu with it.
  useBoardMenuDismiss(close)

  // A selected person the roster does not name (a peer that left, an earlier
  // identity) still gets a row, so the owner can take them off the list.
  const unlisted: readonly BoardParticipant[] = cardWindow.access.people
    .filter(person => !participants.some(participant => participant.id === person))
    .map(person => ({ id: person }))
  const peopleRows: readonly MenuItem[] = [
    ...participants.filter(participant => participant.id !== cardWindow.ownerId),
    ...unlisted,
  ].map((participant): MenuItem => ({
    id: `${PERSON_PREFIX}${participant.id}`,
    label: <PersonOption participant={participant} t={t} />,
  }))
  // A submenu parent needs at least one row to open; the empty roster shows
  // the same caption the transfer menu uses instead of a dead card.
  const peopleSubmenu: readonly MenuItem[] = peopleRows.length === 0
    ? [{ id: 'empty', label: t('bezel.transfer.empty'), disabled: true }]
    : peopleRows

  const items: readonly MenuEntry[] = [
    { id: 'mode:owner', label: t('bezel.access.owner') },
    { id: 'mode:selected', label: t('bezel.access.selected'), submenu: peopleSubmenu },
    { id: 'mode:all', label: t('bezel.access.all') },
  ]

  const onSelect = (id: string): void => {
    if (id === 'mode:owner' || id === 'mode:all') {
      // The selected-people list survives every mode switch.
      actions.setWindowAccess(cardWindow.id, {
        mode: id === 'mode:owner' ? 'owner' : 'all',
        people: [...cardWindow.access.people],
      })
      close()
      return
    }
    if (!id.startsWith(PERSON_PREFIX)) return
    const person = brandString<OwnerId>(id.slice(PERSON_PREFIX.length))
    const next = cardWindow.access.people.some(held => held === person)
      ? cardWindow.access.people.filter(held => held !== person)
      : [...cardWindow.access.people, person]
    // Selecting people is a multi-select gesture: the menu stays open.
    actions.setWindowAccess(cardWindow.id, { mode: 'selected', people: next })
  }

  return (
    <Menu
      portal
      open={open}
      anchor={(
        <AccessIndicator
          mode={cardWindow.access.mode}
          people={accessPeople(t, participants, cardWindow.access.people)}
          t={t}
          onTriggerClick={() => { setOpen(wasOpen => !wasOpen) }}
          expanded={open}
        />
      )}
      selectedIds={[
        `mode:${cardWindow.access.mode}`,
        ...cardWindow.access.people.map(person => `${PERSON_PREFIX}${person}`),
      ]}
      items={items}
      onSelect={onSelect}
      onClose={close}
    />
  )
}
