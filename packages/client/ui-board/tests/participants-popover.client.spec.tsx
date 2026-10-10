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
    windows: [],
    limits: { elementBytesMax: 1024, noteTextMax: 1024, strokePointsMax: 2, todoItemsMax: 1 },
  })
  return instance
}

/** The state answer the popover reads through its store seat. */
function connectPeers(instance: BoardStoreInstance, peers: ReadonlyArray<{
  readonly selfId: OwnerId
  readonly name: string
  readonly color: number
  readonly link: 'online' | 'connecting' | 'lost'
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

describe('shared folder row', () => {
  /** The row's label and state text, or null while no row renders. */
  function folderRow(): { readonly state: string | null; readonly text: string } | null {
    const row = screen.getByRole('dialog').querySelector('[data-board-shared-folder]')
    return row === null ? null : { state: row.getAttribute('data-board-shared-folder'), text: row.textContent ?? '' }
  }

  it('renders no row while the host reports no shared folder', () => {
    const instance = storeWith([{ id: SELF, name: 'Kirill', color: 1 }])
    connectPeers(instance, [])
    const seated = props(instance)
    const { rerender } = render(<ParticipantsPopover {...seated} />)
    expect(folderRow()).toBeNull()

    instance.actions.markPeerUnavailable()
    rerender(<ParticipantsPopover {...seated} />)
    expect(folderRow()).toBeNull()
  })

  it('names the folder state and follows each new answer', () => {
    const instance = storeWith([{ id: SELF, name: 'Kirill', color: 1 }])
    const seated = props(instance)
    const answer = (sharedFolder: 'unavailable' | 'waiting' | 'syncing' | 'synced' | 'error'): void => {
      instance.actions.applyPeerState({
        self: { selfId: SELF, name: 'Kirill', color: 1 },
        peers: [],
        refreshMs: 1000,
        sharedFolder,
      })
    }
    answer('waiting')
    const { rerender } = render(<ParticipantsPopover {...seated} />)
    expect(folderRow()).toEqual({ state: 'waiting', text: 'Shared folderWaiting for the other side' })

    for (const [state, text] of [
      ['syncing', 'Syncing…'],
      ['synced', 'Synced'],
      ['error', 'Sync error'],
      ['unavailable', 'Syncthing is unavailable'],
    ] as const) {
      answer(state)
      rerender(<ParticipantsPopover {...seated} />)
      expect(folderRow()).toEqual({ state, text: `Shared folder${text}` })
    }

    // The host switched the feature off: the next answer carries no field.
    connectPeers(instance, [])
    rerender(<ParticipantsPopover {...seated} />)
    expect(folderRow()).toBeNull()
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

describe('forgetting a peer', () => {
  const peerIdOf = (id: OwnerId): KetosPeerId => brandString<KetosPeerId>(`peer-${String(id)}`)
  const rowOf = (id: OwnerId): Element | undefined =>
    [...screen.getByRole('dialog').querySelectorAll('[data-board-participant]')]
      .find(candidate => candidate.getAttribute('data-board-participant') === String(id))

  it('offers "Forget" only for a known peer without a live channel', () => {
    const instance = storeWith([
      { id: SELF, name: 'Kirill', color: 1 },
      { id: REMOTE, name: 'Remote', color: 5 },
    ])
    connectPeers(instance, [
      { selfId: REMOTE, name: 'Remote', color: 5, link: 'online' },
      { selfId: GHOST, name: 'Ghost', color: 6, link: 'lost' },
      { selfId: brandString<OwnerId>('00000000-0000-4000-8000-0000000000e4'), name: 'Dialing', color: 7, link: 'connecting' },
    ])
    render(<ParticipantsPopover {...props(instance)} />)
    expect(rowOf(REMOTE)?.querySelector('[data-board-action="peer-forget"]')).toBeNull()
    expect(rowOf(SELF)?.querySelector('[data-board-action="peer-forget"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Forget Ghost' }).textContent).toBe('Forget')
    expect(screen.getByRole('button', { name: 'Forget Dialing' })).not.toBeNull()
  })

  it('asks the host to forget the peer and drops a peer-only participant from the list', async () => {
    const instance = storeWith([{ id: SELF, name: 'Kirill', color: 1 }])
    connectPeers(instance, [{ selfId: GHOST, name: 'Ghost', color: 6, link: 'lost' }])
    const forgetPeer = vi.fn(async () => ({ ok: true as const }))
    render(<ParticipantsPopover {...props(instance, { forgetPeer })} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Forget Ghost' }))
    })
    expect(forgetPeer).toHaveBeenCalledWith(peerIdOf(GHOST))
    expect(rowOf(GHOST)).toBeUndefined()
    expect(rowOf(SELF)).not.toBeUndefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps a participant the document records, without the link mark and the button', async () => {
    const instance = storeWith([
      { id: SELF, name: 'Kirill', color: 1 },
      { id: REMOTE, name: 'Remote', color: 5 },
    ])
    connectPeers(instance, [{ selfId: REMOTE, name: 'Remote', color: 5, link: 'lost' }])
    render(<ParticipantsPopover {...props(instance, { forgetPeer: vi.fn(async () => ({ ok: true as const })) })} />)
    expect(rowOf(REMOTE)?.textContent).toContain('Not connected')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Forget Remote' }))
    })
    const row = rowOf(REMOTE)
    expect(row?.textContent).toContain('Remote')
    expect(row?.textContent).not.toContain('Not connected')
    expect(row?.querySelector('[data-board-action="peer-forget"]')).toBeNull()
  })

  it('shows a forgotten peer again once it reconnects while the popover stays open', async () => {
    const instance = storeWith([{ id: SELF, name: 'Kirill', color: 1 }])
    connectPeers(instance, [{ selfId: GHOST, name: 'Ghost', color: 6, link: 'lost' }])
    const seated = props(instance, { forgetPeer: vi.fn(async () => ({ ok: true as const })) })
    const { rerender } = render(<ParticipantsPopover {...seated} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Forget Ghost' }))
    })
    expect(rowOf(GHOST)).toBeUndefined()

    connectPeers(instance, [{ selfId: GHOST, name: 'Ghost', color: 6, link: 'online' }])
    rerender(<ParticipantsPopover {...seated} />)
    expect(rowOf(GHOST)?.textContent).toContain('Connected')
  })

  it('shows a forgotten peer in any state once a poll dropped it and it came back', async () => {
    const instance = storeWith([{ id: SELF, name: 'Kirill', color: 1 }])
    connectPeers(instance, [{ selfId: GHOST, name: 'Ghost', color: 6, link: 'lost' }])
    const seated = props(instance, { forgetPeer: vi.fn(async () => ({ ok: true as const })) })
    const { rerender } = render(<ParticipantsPopover {...seated} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Forget Ghost' }))
    })
    connectPeers(instance, [])
    rerender(<ParticipantsPopover {...seated} />)
    expect(rowOf(GHOST)).toBeUndefined()

    connectPeers(instance, [{ selfId: GHOST, name: 'Ghost', color: 6, link: 'connecting' }])
    rerender(<ParticipantsPopover {...seated} />)
    expect(rowOf(GHOST)?.textContent).toContain('Not connected')
  })

  it('shows the refusal text and keeps the peer and the button', async () => {
    const instance = storeWith([{ id: SELF, name: 'Kirill', color: 1 }])
    connectPeers(instance, [{ selfId: GHOST, name: 'Ghost', color: 6, link: 'lost' }])
    const forgetPeer = vi.fn(async () => ({ ok: false as const, code: 'ketos/peer-online' as const }))
    render(<ParticipantsPopover {...props(instance, { forgetPeer })} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Forget Ghost' }))
    })
    expect(screen.getByRole('alert').textContent).toBe('The connection is still open')
    expect(rowOf(GHOST)).not.toBeUndefined()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Forget Ghost' }).disabled).toBe(false)
  })

  it('treats a peer the host no longer knows as forgotten', async () => {
    const instance = storeWith([{ id: SELF, name: 'Kirill', color: 1 }])
    connectPeers(instance, [{ selfId: GHOST, name: 'Ghost', color: 6, link: 'lost' }])
    const forgetPeer = vi.fn(async () => ({ ok: false as const, code: 'ketos/peer-unknown' as const }))
    render(<ParticipantsPopover {...props(instance, { forgetPeer })} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Forget Ghost' }))
    })
    expect(rowOf(GHOST)).toBeUndefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps one forget request in flight at a time', async () => {
    const instance = storeWith([{ id: SELF, name: 'Kirill', color: 1 }])
    connectPeers(instance, [{ selfId: GHOST, name: 'Ghost', color: 6, link: 'lost' }])
    let release: (() => void) | undefined
    const forgetPeer = vi.fn(() => new Promise<{ ok: true }>((resolve) => { release = () => { resolve({ ok: true }) } }))
    render(<ParticipantsPopover {...props(instance, { forgetPeer })} />)
    const button = screen.getByRole('button', { name: 'Forget Ghost' }) as HTMLButtonElement

    fireEvent.click(button)
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(forgetPeer).toHaveBeenCalledTimes(1)
    await act(async () => { release?.() })
    expect(rowOf(GHOST)).toBeUndefined()
  })

  it('posts to the forget route when the dock supplies no forget verb', async () => {
    const instance = storeWith([{ id: SELF, name: 'Kirill', color: 1 }])
    connectPeers(instance, [{ selfId: GHOST, name: 'Ghost', color: 6, link: 'lost' }])
    const requests: Request[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
      requests.push(new Request(input as never, init))
      return Response.json({ ok: true })
    }))
    try {
      render(<ParticipantsPopover {...props(instance)} />)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Forget Ghost' }))
      })
      expect(new URL(requests[0]?.url ?? '').pathname).toBe('/api/ketos.peer.forget')
      expect(await requests[0]?.json()).toEqual({ peerId: peerIdOf(GHOST) })
      expect(rowOf(GHOST)).toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
    }
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
