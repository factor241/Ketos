// @vitest-environment jsdom
/**
 * Participants popover: the merged roster with link states, the
 * not-configured hint, the invitation flow with its clipboard fallback, and
 * the connect flow's per-code errors.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type { BoardDocId, BoardRevision, OwnerId } from '@ketos/board-doc/types'
import type { KetosPeerId } from '@ketos/peer/types'
import { createBoardStore, type BoardStoreInstance } from '../src/client/store.ts'
import { ParticipantsPopover, type ParticipantsPopoverProps } from '../src/client/dock/ParticipantsPopover.tsx'
import { t } from './fixtures.client.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'clipboard')
})

const DOC = brandString<BoardDocId>('00000000-0000-4000-8000-0000000000d1')
const SELF = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e1')
const REMOTE = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e2')
const GHOST = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e3')
const PEER = brandString<KetosPeerId>('peer-one')

/** One store instance that adopted a document with the supplied participants. */
function storeWith(participants: ReadonlyArray<{ id: OwnerId; name: string; color: number }>): BoardStoreInstance {
  const instance = createBoardStore().create()
  instance.actions.applyBoardSnapshot({
    docId: DOC,
    selfId: SELF,
    revision: brandNumber<BoardRevision>(1),
    elements: [],
    participants: participants.map(participant => ({ ...participant, updatedAt: 1 })),
    limits: { elementBytesMax: 1024, noteTextMax: 1024, strokePointsMax: 2, todoItemsMax: 1 },
  })
  return instance
}

/** The state answer the popover reads through its store seat. */
function connectPeers(instance: BoardStoreInstance, peers: ReadonlyArray<{
  readonly selfId: OwnerId
  readonly name: string
  readonly color: number
  readonly link: 'online' | 'lost'
}>): void {
  instance.actions.applyPeerState({
    self: { selfId: SELF, name: 'Kirill', color: 1 },
    peers: peers.map(peer => ({
      peerId: brandString<KetosPeerId>(`peer-${String(peer.selfId)}`),
      ...peer,
    })),
    refreshMs: 1000,
  })
}

/** Direct-render props over one store instance. */
function props(
  instance: BoardStoreInstance,
  overrides: Partial<ParticipantsPopoverProps> = {},
): ParticipantsPopoverProps {
  return {
    anchor: new DOMRect(40, 400, 26, 26),
    boundary: new DOMRect(0, 0, 800, 600),
    t,
    useStore: <S,>(selector: (state: ReturnType<BoardStoreInstance['getSnapshot']>) => S): S =>
      selector(instance.getSnapshot()),
    createInvite: vi.fn(async () => ({ ok: true as const, invite: 'ketos1.code' })),
    connectPeer: vi.fn(async () => ({ ok: false as const, code: 'ketos/invalid' as const })),
    onClose: vi.fn(),
    ...overrides,
  }
}

describe('participants roster', () => {
  it('lists document and peer participants without duplicates, naming each link state', () => {
    const instance = storeWith([
      { id: SELF, name: 'Kirill', color: 1 },
      { id: REMOTE, name: 'Remote', color: 5 },
    ])
    connectPeers(instance, [
      { selfId: REMOTE, name: 'Remote', color: 5, link: 'online' },
      { selfId: GHOST, name: 'Ghost', color: 6, link: 'lost' },
    ])
    render(<ParticipantsPopover {...props(instance)} />)

    const rows = [...screen.getByRole('dialog').querySelectorAll('[data-board-participant]')]
    expect(rows.map(row => row.getAttribute('data-board-participant')))
      .toEqual([String(GHOST), String(SELF), String(REMOTE)])
    expect(rows.find(row => row.getAttribute('data-board-participant') === String(GHOST))?.textContent)
      .toContain('Not connected')
    expect(rows.find(row => row.getAttribute('data-board-participant') === String(REMOTE))?.textContent)
      .toContain('Connected')
    // The self row carries its own name, not the unknown label.
    expect(rows.find(row => row.getAttribute('data-board-participant') === String(SELF))?.textContent)
      .toContain('Kirill')
  })

  it('shows neither hint nor flows before the first answer, then the hint after a 404', () => {
    const instance = storeWith([{ id: SELF, name: 'Kirill', color: 1 }])
    const seated = props(instance)
    const { rerender } = render(<ParticipantsPopover {...seated} />)
    // No answer yet is not the same as an absent route: the dock stays quiet.
    expect(screen.queryByText('Peer networking is not configured')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Invite' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull()

    instance.actions.markPeerUnavailable()
    rerender(<ParticipantsPopover {...seated} />)
    expect(screen.getByText('Peer networking is not configured')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Invite' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull()
  })

  it('shows every peer as not connected while the last poll failed', () => {
    const instance = storeWith([{ id: SELF, name: 'Kirill', color: 1 }])
    connectPeers(instance, [
      { selfId: REMOTE, name: 'Remote', color: 5, link: 'online' },
      { selfId: GHOST, name: 'Ghost', color: 6, link: 'online' },
    ])
    const seated = props(instance)
    const { rerender } = render(<ParticipantsPopover {...seated} />)
    const row = (id: OwnerId): string => [...screen.getByRole('dialog').querySelectorAll('[data-board-participant]')]
      .find(candidate => candidate.getAttribute('data-board-participant') === String(id))?.textContent ?? ''
    expect(row(REMOTE)).toContain('Connected')
    expect(row(GHOST)).toContain('Connected')

    instance.actions.markPeerUnreachable()
    rerender(<ParticipantsPopover {...seated} />)
    expect(row(REMOTE)).toContain('Not connected')
    expect(row(GHOST)).toContain('Not connected')
  })
})

describe('invitation flow', () => {
  it('mints, shows, and copies the code', async () => {
    const instance = storeWith([{ id: SELF, name: 'Kirill', color: 1 }])
    connectPeers(instance, [])
    const createInvite = vi.fn(async () => ({ ok: true as const, invite: 'ketos1.code' }))
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<ParticipantsPopover {...props(instance, { createInvite })} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Invite' }))
    })
    expect(createInvite).toHaveBeenCalledTimes(1)
    const code = screen.getByLabelText('Invite') as HTMLInputElement
    expect(code.value).toBe('ketos1.code')
    expect(screen.getByText('Give the code to the second Ketos')).not.toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    })
    expect(writeText).toHaveBeenCalledWith('ketos1.code')
    expect(screen.getByRole('button', { name: 'Copied' })).not.toBeNull()
  })

  it('shows the refusal text when the host cannot mint a code', async () => {
    const instance = storeWith([{ id: SELF, name: 'Kirill', color: 1 }])
    connectPeers(instance, [])
    const createInvite = vi.fn(async () => ({ ok: false as const, code: 'ketos/peer-offline' as const }))
    render(<ParticipantsPopover {...props(instance, { createInvite })} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Invite' }))
    })
    expect(screen.getByRole('alert').textContent).toBe('This Ketos is not online yet')
    expect(screen.queryByLabelText('Invite')).toBeNull()
  })

  it('selects the code when the clipboard API is unavailable', async () => {
    const instance = storeWith([{ id: SELF, name: 'Kirill', color: 1 }])
    connectPeers(instance, [])
    render(<ParticipantsPopover {...props(instance)} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Invite' }))
    })
    const code = screen.getByLabelText('Invite') as HTMLInputElement
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    })
    expect(code.selectionStart).toBe(0)
    expect(code.selectionEnd).toBe('ketos1.code'.length)
  })
})

describe('connect flow', () => {
  it('posts the trimmed code and clears the field on success', async () => {
    const instance = storeWith([{ id: SELF, name: 'Kirill', color: 1 }])
    connectPeers(instance, [])
    const connectPeer = vi.fn(async () => ({ ok: true as const, peerId: PEER }))
    render(<ParticipantsPopover {...props(instance, { connectPeer })} />)
    const input = screen.getByPlaceholderText('Invitation code') as HTMLInputElement
    fireEvent.change(input, { target: { value: '  ketos1.other  ' } })

    await act(async () => {
      fireEvent.submit(input.closest('form') as HTMLFormElement)
    })
    expect(connectPeer).toHaveBeenCalledWith('ketos1.other')
    expect(input.value).toBe('')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the error text of the refusal code', async () => {
    const instance = storeWith([{ id: SELF, name: 'Kirill', color: 1 }])
    connectPeers(instance, [])
    const cases = [
      { code: 'ketos/invalid', text: 'Invalid invitation code' },
      { code: 'ketos/peer-self', text: 'This is the code of this Ketos' },
      { code: 'ketos/invite-used', text: 'The invitation code was already used' },
      { code: 'ketos/peer-unreachable', text: 'The second Ketos is unreachable' },
      { code: 'ketos/peer-offline', text: 'This Ketos is not online yet' },
      { code: 'ketos/unreachable', text: 'The second Ketos is unreachable' },
    ] as const
    const connectPeer = vi.fn()
    const { unmount } = render(<ParticipantsPopover {...props(instance, { connectPeer })} />)
    const input = screen.getByPlaceholderText('Invitation code') as HTMLInputElement
    for (const refusal of cases) {
      connectPeer.mockResolvedValueOnce({ ok: false, code: refusal.code })
      fireEvent.change(input, { target: { value: 'ketos1.other' } })
      await act(async () => {
        fireEvent.submit(input.closest('form') as HTMLFormElement)
      })
      expect(screen.getByRole('alert').textContent).toBe(refusal.text)
    }
    unmount()
  })
})

describe('dismissal', () => {
  it('closes on Escape and on a click outside the surface', () => {
    const instance = storeWith([{ id: SELF, name: 'Kirill', color: 1 }])
    const onClose = vi.fn()
    render(<ParticipantsPopover {...props(instance, { onClose })} />)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
