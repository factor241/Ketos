/** Board participants: roster merge, owner colors, identity adoption, and owner-id format checks. */
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { BoardDocId, BoardParticipantRecord, OwnerId } from '@ketos/board-doc/types'
import type { KetosPeerId, PeerState } from '@ketos/peer/types'
import {
  DEMO_SELF_ID,
  OWNER_ID_MAX_LENGTH,
  boardParticipants,
  canManageWindow,
  currentOwnerId,
  isOwnerIdFormat,
  ownerColorAttr,
  ownerIsUnknown,
  ownerLinkLost,
  participantColorAttr,
  participantInitial,
  participantLabel,
  participantOf,
  type BoardParticipant,
  type OwnerIdentityState,
} from '../src/client/owners.ts'
import { createBoardStore, type BoardState } from '../src/client/store.ts'
import type { WindowId } from '../src/client/contract/slots.ts'
import type { BoardTranslate } from '../src/client/locale.ts'

const DOC = brandString<BoardDocId>('00000000-0000-4000-8000-0000000000d1')
const SELF = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e1')
const ANNA = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e2')
const ZETA = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e3')

/** Translator that echoes its key, so a label assertion names the dictionary key it used. */
const t: BoardTranslate = (key, params) => `${key}:${JSON.stringify(params ?? {})}`

/** One document participant record. */
function record(id: OwnerId, name: string, color: number): BoardParticipantRecord {
  return { id, name, color, updatedAt: 1 }
}

/** One known peer record. */
function peer(selfId: OwnerId, name: string, color: number): PeerState {
  return { peerId: brandString<KetosPeerId>(`peer-${String(selfId)}`), selfId, name, color, link: 'online' }
}

/** One roster-read state carrying test overrides. */
function identity(overrides: Partial<OwnerIdentityState> = {}): OwnerIdentityState {
  return { selfId: null, boardParticipants: [], peerStates: [], peerSelf: null, ...overrides }
}

/** One window of a state snapshot; a miss fails at the call site. */
function windowOf(state: BoardState, id: string): BoardState['windows'][string] {
  const window = state.windows[id]
  if (window === undefined) throw new Error(`window ${id} is missing`)
  return window
}

describe('boardParticipants', () => {
  it('returns an empty roster when neither the document nor a peer names anyone', () => {
    expect(boardParticipants(identity())).toEqual([])
  })

  it('merges document records and peers by selfId without duplicates, ordered by name', () => {
    const roster = boardParticipants(identity({
      boardParticipants: [record(ZETA, 'Zeta', 2), record(SELF, 'Kirill', 1)],
      peerStates: [peer(ANNA, 'Anna', 3), peer(ZETA, 'Duplicate', 4)],
    }))
    expect(roster.map(participant => String(participant.id))).toEqual([String(ANNA), String(SELF), String(ZETA)])
    expect(roster[0]).toMatchObject({ name: 'Anna', color: 3 })
    // The document record wins over the peer record for the same identity.
    expect(roster[2]).toMatchObject({ name: 'Zeta', color: 2 })
  })

  it('includes the acting participant from its document record after the first snapshot', () => {
    const roster = boardParticipants(identity({
      selfId: SELF,
      boardParticipants: [record(SELF, 'Kirill', 1)],
    }))
    expect(roster).toEqual([{ id: SELF, name: 'Kirill', color: 1 }])
  })

  it('falls back to the peer self for the acting participant when the document has no record', () => {
    const withName = boardParticipants(identity({
      selfId: SELF,
      peerSelf: { selfId: SELF, name: 'Kirill', color: 5 },
    }))
    expect(withName).toEqual([{ id: SELF, name: 'Kirill', color: 5 }])

    // A blank configured name labels the acting participant through the key.
    const blank = boardParticipants(identity({
      selfId: SELF,
      peerSelf: { selfId: SELF, name: '  ', color: 5 },
    }))
    expect(blank).toEqual([{ id: SELF, nameKey: 'owner.self', color: 5 }])
  })

  it('keeps the acting participant named "Я" on the first slot until any source names one', () => {
    expect(boardParticipants(identity({ selfId: SELF })))
      .toEqual([{ id: SELF, nameKey: 'owner.self', color: 1 }])
  })

  it('ignores colors outside the palette', () => {
    const roster = boardParticipants(identity({
      selfId: null,
      boardParticipants: [record(SELF, 'Kirill', 11)],
    }))
    expect(roster).toEqual([{ id: SELF, name: 'Kirill' }])
  })
})

describe('boardParticipants: cached roster', () => {
  it('returns the same array while the source slices keep their references', () => {
    const state = identity({
      selfId: SELF,
      boardParticipants: [record(ANNA, 'Anna', 2)],
      peerStates: [peer(ZETA, 'Zeta', 3)],
    })
    const first = boardParticipants(state)
    expect(boardParticipants({ ...state })).toBe(first)
  })

  it('recomputes when any one source slice changes its reference', () => {
    const state = identity({ selfId: SELF, boardParticipants: [record(ANNA, 'Anna', 2)] })
    const first = boardParticipants(state)
    const documentChanged = boardParticipants({ ...state, boardParticipants: [record(ANNA, 'Anna', 2)] })
    expect(documentChanged).not.toBe(first)
    expect(documentChanged).toEqual(first)
    const peersChanged = boardParticipants({ ...state, peerStates: [peer(ZETA, 'Zeta', 3)] })
    expect(peersChanged.map(participant => participant.id)).toContain(ZETA)
    const selfChanged = boardParticipants({ ...state, selfId: ZETA })
    expect(selfChanged.map(participant => participant.id)).toContain(ZETA)
    const peerSelf = { selfId: SELF, name: 'Kirill', color: 4 }
    expect(boardParticipants({ ...state, peerSelf }).find(participant => participant.id === SELF)?.name).toBe('Kirill')
  })
})

describe('boardParticipants: before the first snapshot', () => {
  const windows: BoardState['windows'] = {
    'agent-1': {
      id: 'agent-1' as WindowId,
      kind: 'agent',
      bodyKind: 'conversation',
      ordinal: 1,
      ownerId: ANNA,
      access: { mode: 'owner', people: [] },
      x: 0,
      y: 0,
      width: 552,
      height: 648,
      zIndex: 10,
    },
  }

  it('names the owners of the local windows as the neutral "Я" entry', () => {
    const roster = boardParticipants(identity({ windows }))
    expect(roster).toEqual([{ id: ANNA, nameKey: 'owner.self' }])
  })

  it('leaves an owner a source already names alone, and ignores windows once the identity is known', () => {
    const named = boardParticipants(identity({ windows, boardParticipants: [record(ANNA, 'Anna', 2)] }))
    expect(named).toEqual([{ id: ANNA, name: 'Anna', color: 2 }])
    expect(boardParticipants(identity({ selfId: SELF, windows })).map(participant => participant.id)).toEqual([SELF])
  })

  it('keeps one array identity for the same slices', () => {
    const state = identity({ windows })
    expect(boardParticipants(state)).toBe(boardParticipants({ ...state }))
  })
})

describe('ownerIsUnknown', () => {
  it('names an owner no source knows once the acting identity is known', () => {
    const state = identity({ selfId: SELF, boardParticipants: [record(ANNA, 'Anna', 2)], peerStates: [peer(ZETA, 'Zeta', 3)] })
    expect(ownerIsUnknown(state, brandString<OwnerId>('previous-self'))).toBe(true)
    expect(ownerIsUnknown(state, ANNA)).toBe(false)
    expect(ownerIsUnknown(state, ZETA)).toBe(false)
    expect(ownerIsUnknown(state, SELF)).toBe(false)
  })

  it('names nobody before the first snapshot', () => {
    expect(ownerIsUnknown(identity(), ANNA)).toBe(false)
  })
})

describe('ownerLinkLost', () => {
  const withLink = (link: 'online' | 'connecting' | 'lost'): Pick<BoardState, 'peerStates'> => ({
    peerStates: [{ ...peer(ANNA, 'Anna', 2), link }],
  })

  it('marks a known peer owner whose link is anything but online', () => {
    expect(ownerLinkLost(withLink('lost'), ANNA)).toBe(true)
    expect(ownerLinkLost(withLink('connecting'), ANNA)).toBe(true)
    expect(ownerLinkLost(withLink('online'), ANNA)).toBe(false)
  })

  it('does not mark an owner one of whose peer entries is online', () => {
    const lost = { ...peer(ANNA, 'Anna', 2), link: 'lost' as const }
    const online = { ...peer(ANNA, 'Anna', 2), peerId: brandString<KetosPeerId>('peer-anna-new') }
    expect(ownerLinkLost({ peerStates: [lost, online] }, ANNA)).toBe(false)
    expect(ownerLinkLost({ peerStates: [online, lost] }, ANNA)).toBe(false)
    expect(ownerLinkLost({ peerStates: [lost, { ...lost, peerId: brandString<KetosPeerId>('peer-anna-new') }] }, ANNA))
      .toBe(true)
  })

  it('never marks an owner the peer roster does not know', () => {
    expect(ownerLinkLost(withLink('lost'), ZETA)).toBe(false)
    expect(ownerLinkLost({ peerStates: [] }, ANNA)).toBe(false)
  })
})

describe('currentOwnerId and canManageWindow', () => {
  it('is null before the first snapshot', () => {
    expect(currentOwnerId(identity())).toBeNull()
  })

  it('is the document selfId after the first snapshot', () => {
    expect(currentOwnerId(identity({ selfId: SELF }))).toBe(SELF)
  })

  it('manages a window only while the identity is known and matches', () => {
    const instance = createBoardStore().create()
    instance.actions.openWindow({
      id: 'w1' as WindowId, kind: 'agent', bodyKind: 'conversation', ordinal: 1, width: 552, height: 648,
    })
    instance.actions.openWindow({
      id: 'w2' as WindowId, kind: 'agent', bodyKind: 'conversation', ordinal: 2, width: 552, height: 648,
      ownerId: ANNA,
    })
    const before = instance.getSnapshot()
    expect(canManageWindow(before, windowOf(before, 'w1'))).toBe(false)

    instance.actions.applyBoardSnapshot({
      docId: DOC,
      selfId: SELF,
      revision: before.boardElementsRevision,
      elements: [],
      participants: [],
      windows: [],
      limits: { elementBytesMax: 1024, noteTextMax: 1024, strokePointsMax: 2, todoItemsMax: 1 },
    })
    const after = instance.getSnapshot()
    expect(canManageWindow(after, windowOf(after, 'w1'))).toBe(true)
    expect(canManageWindow(after, windowOf(after, 'w2'))).toBe(false)
  })
})

describe('participantOf and colors', () => {
  it('resolves a known owner id to its participant', () => {
    const state = identity({ selfId: null, boardParticipants: [record(SELF, 'Kirill', 1)] })
    expect(participantOf(state, SELF)).toMatchObject({ name: 'Kirill', color: 1 })
  })

  it('reports an unknown owner id as undefined with the neutral color and label', () => {
    const state = identity()
    const stranger = brandString<OwnerId>('demo-stranger')
    expect(participantOf(state, stranger)).toBeUndefined()
    expect(ownerColorAttr(state, stranger)).toBe('unknown')
    expect(participantColorAttr(undefined)).toBe('unknown')
  })

  it('reports a participant without a color as the neutral attribute', () => {
    const participant: BoardParticipant = { id: SELF, name: 'Kirill' }
    expect(participantColorAttr(participant)).toBe('unknown')
    // A document record outside the palette keeps its owner neutral, while
    // the acting participant without any source falls back to the first slot.
    const state = identity({ selfId: SELF, boardParticipants: [record(ZETA, 'Zeta', 11)] })
    expect(ownerColorAttr(state, ZETA)).toBe('unknown')
    expect(ownerColorAttr(state, SELF)).toBe('1')
  })
})

describe('participantLabel', () => {
  it('labels a participant carrying its own name', () => {
    const participant: BoardParticipant = { id: SELF, name: 'Анна', color: 5 }
    expect(participantLabel(t, participant)).toBe('Анна')
  })

  it('resolves a participant carrying a dictionary key', () => {
    expect(participantLabel(t, { id: SELF, nameKey: 'owner.self', color: 1 })).toBe('owner.self:{}')
  })

  it('labels an unresolved participant as unknown', () => {
    expect(participantLabel(t, undefined)).toBe('owner.unknown:{}')
    expect(participantLabel(t, { id: SELF, color: 6 })).toBe('owner.unknown:{}')
  })
})

describe('adoptSelfId', () => {
  it('rewrites the legacy self owner and access people, leaving other ids alone', () => {
    const instance = createBoardStore().create()
    const legacy = brandString<OwnerId>('demo-legal')
    instance.actions.openWindow({
      id: 'w1' as WindowId, kind: 'agent', bodyKind: 'conversation', ordinal: 1, width: 552, height: 648,
      ownerId: DEMO_SELF_ID,
      access: { mode: 'selected', people: [DEMO_SELF_ID, legacy] },
    })
    instance.actions.openWindow({
      id: 'w2' as WindowId, kind: 'agent', bodyKind: 'conversation', ordinal: 2, width: 552, height: 648,
      ownerId: legacy,
    })
    const state = instance.getSnapshot()
    expect(canManageWindow(state, windowOf(state, 'w1'))).toBe(false)

    instance.actions.applyBoardSnapshot({
      docId: DOC,
      selfId: SELF,
      revision: state.boardElementsRevision,
      elements: [],
      participants: [record(SELF, 'Kirill', 1)],
      windows: [],
      limits: { elementBytesMax: 1024, noteTextMax: 1024, strokePointsMax: 2, todoItemsMax: 1 },
    })
    const adopted = instance.getSnapshot()
    expect(adopted.windows['w1']?.ownerId).toBe(SELF)
    expect(adopted.windows['w1']?.access.people).toEqual([SELF, legacy])
    expect(adopted.windows['w2']?.ownerId).toBe(legacy)
    // The other legacy id is nobody: neutral color, unknown label.
    expect(ownerColorAttr(adopted, legacy)).toBe('unknown')
    expect(participantLabel(t, participantOf(adopted, legacy))).toBe('owner.unknown:{}')
  })
})

describe('participantInitial', () => {
  it('takes the first character of a label', () => {
    expect(participantInitial('Кирилл')).toBe('К')
    expect(participantInitial('分析师')).toBe('分')
  })

  it('reports an empty label as an empty mark', () => {
    expect(participantInitial('')).toBe('')
  })
})

describe('isOwnerIdFormat', () => {
  it('accepts a plain owner id', () => {
    expect(isOwnerIdFormat('demo-self')).toBe(true)
  })

  it('accepts an id at the length limit', () => {
    expect(OWNER_ID_MAX_LENGTH).toBe(64)
    expect(isOwnerIdFormat('a'.repeat(OWNER_ID_MAX_LENGTH))).toBe(true)
  })

  it('rejects an empty string', () => {
    expect(isOwnerIdFormat('')).toBe(false)
  })

  it('rejects an id longer than the limit', () => {
    expect(isOwnerIdFormat('a'.repeat(OWNER_ID_MAX_LENGTH + 1))).toBe(false)
  })

  it('rejects control characters', () => {
    expect(isOwnerIdFormat('line\nbreak')).toBe(false)
    expect(isOwnerIdFormat('demo\u0000self')).toBe(false)
  })

  it('rejects a non-string value', () => {
    expect(isOwnerIdFormat(42)).toBe(false)
    expect(isOwnerIdFormat(undefined)).toBe(false)
  })
})
