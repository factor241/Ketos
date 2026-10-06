/** Board participants, owner colors, and owner-id format checks. */
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  DEMO_SELF_ID,
  DEMO_TEAM,
  OWNER_ID_MAX_LENGTH,
  boardParticipants,
  currentOwnerId,
  isOwnerIdFormat,
  ownerColorAttr,
  participantInitial,
  participantLabel,
  participantOf,
} from '../src/client/owners.ts'
import { createBoardStore } from '../src/client/store.ts'
import type { BoardState } from '../src/client/store.ts'
import type { BoardParticipant, OwnerId } from '../src/client/owners.ts'
import type { BoardTranslate } from '../src/client/locale.ts'

/** A fresh board state snapshot: stage 27's selectors ignore it. */
function boardState(): BoardState {
  return createBoardStore().create().store.getSnapshot()
}

/** Translator that echoes its key, so a label assertion names the dictionary key it used. */
const t: BoardTranslate = (key, params) => `${key}:${JSON.stringify(params ?? {})}`

describe('boardParticipants', () => {
  it('returns the demo team from the store state', () => {
    expect(boardParticipants(boardState())).toBe(DEMO_TEAM)
  })

  it('lists the four demo participants in roster order', () => {
    expect(DEMO_TEAM.map(participant => String(participant.id))).toEqual([
      'demo-self', 'demo-finance', 'demo-legal', 'demo-analyst',
    ])
  })

  it('gives every demo participant a distinct color', () => {
    expect(new Set(DEMO_TEAM.map(participant => participant.color)).size).toBe(DEMO_TEAM.length)
  })

  it('resolves each demo participant color to its palette attribute', () => {
    for (const participant of DEMO_TEAM) {
      expect(ownerColorAttr(boardState(), participant.id)).toBe(String(participant.color))
    }
  })
})

describe('currentOwnerId', () => {
  it('is the demo self owner', () => {
    expect(String(currentOwnerId(boardState()))).toBe('demo-self')
    expect(currentOwnerId(boardState())).toBe(DEMO_SELF_ID)
  })
})

describe('participantOf', () => {
  it('resolves a known owner id to its participant', () => {
    expect(participantOf(boardState(), DEMO_SELF_ID)).toBe(DEMO_TEAM[0])
  })

  it('reports an unknown owner id as undefined', () => {
    expect(participantOf(boardState(), brandString<OwnerId>('demo-stranger'))).toBeUndefined()
  })
})

describe('ownerColorAttr', () => {
  it('reports an unknown owner as unknown', () => {
    expect(ownerColorAttr(boardState(), brandString<OwnerId>('demo-stranger'))).toBe('unknown')
  })
})

describe('participantLabel', () => {
  it('names each demo participant through its dictionary key', () => {
    expect(DEMO_TEAM.map(participant => participantLabel(t, participant))).toEqual([
      'owner.demo.self:{}',
      'owner.demo.finance:{}',
      'owner.demo.legal:{}',
      'owner.demo.analyst:{}',
    ])
  })

  it('labels a participant carrying its own name', () => {
    const participant: BoardParticipant = { id: brandString<OwnerId>('real-1'), name: 'Анна', color: 5 }
    expect(participantLabel(t, participant)).toBe('Анна')
  })

  it('labels an unresolved participant as unknown', () => {
    expect(participantLabel(t, undefined)).toBe('owner.unknown:{}')
  })

  it('falls back to the unknown label when a participant carries no name', () => {
    const participant: BoardParticipant = { id: brandString<OwnerId>('real-2'), color: 6 }
    expect(participantLabel(t, participant)).toBe('owner.unknown:{}')
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
  it('accepts a demo owner id', () => {
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
