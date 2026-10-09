// @vitest-environment jsdom
/**
 * Foreign windows: the layer renders other Ketoses' published records with the
 * owner's bezel and no controls, keeps own records out, culls, resolves the
 * title fallback, and leaves the records outside the layout, dock, overview,
 * and management predicate.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement, useRef, useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type {
  BoardDocId, BoardRevision, BoardSnapshot, BoardWindowRecord, OwnerId, WindowId,
} from '@ketos/board-doc/types'
import type { KetosPeerId } from '@ketos/peer/types'
import { ForeignWindowLayer } from '../src/client/window/ForeignWindowLayer.tsx'
import { captureBoardLayout } from '../src/client/board-layout.ts'
import { canManageWindow } from '../src/client/owners.ts'
import { createBoardStore, type BoardState } from '../src/client/store.ts'
import { en, type BoardKey, type BoardTranslate } from '../src/client/locale.ts'
import type { BoardWindowState } from '../src/client/contract/slots.ts'

afterEach(() => { cleanup() })

const DOC = brandString<BoardDocId>('00000000-0000-4000-8000-0000000000d1')
const SELF = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e1')
const OTHER = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e2')
const FOREIGN_WINDOW = brandString<WindowId>('agent-1-remote')
const OWN_WINDOW = brandString<WindowId>('agent-2-local')

/** English-bound locale seat with parameter interpolation, for direct renders. */
const t: BoardTranslate = (key, params) => {
  let text: string = en[key as BoardKey]
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replace(`{${name}}`, String(value))
  }
  return text
}

/** One snapshot with the bench's participants and no windows. */
function snapshot(): BoardSnapshot {
  return {
    docId: DOC,
    selfId: SELF,
    revision: brandNumber<BoardRevision>(1),
    elements: [],
    participants: [
      { id: SELF, name: 'Kirill', color: 1, updatedAt: 1 },
      { id: OTHER, name: 'Юрист', color: 3, updatedAt: 1 },
    ],
    windows: [],
    limits: { elementBytesMax: 262_144, noteTextMax: 20_000, strokePointsMax: 2000, todoItemsMax: 200 },
  }
}

/** One stored window record. */
function record(overrides: Partial<BoardWindowRecord> = {}): BoardWindowRecord {
  return {
    id: FOREIGN_WINDOW,
    hostId: OTHER,
    ownerId: OTHER,
    kind: 'agent',
    bodyKind: 'conversation',
    title: null,
    ordinal: 1,
    x: 24,
    y: 24,
    w: 552,
    h: 648,
    z: 10,
    access: { mode: 'owner', people: [] },
    status: 'ready',
    updatedAt: 5,
    ...overrides,
  }
}

type BoardInstance = ReturnType<ReturnType<typeof createBoardStore>['create']>

/**
 * One board instance that adopted the snapshot and the supplied records.
 * @param records - records to publish through one patch.
 * @returns the instance.
 */
function instanceWith(records: readonly BoardWindowRecord[]): BoardInstance {
  const instance = createBoardStore().create()
  instance.actions.applyBoardSnapshot(snapshot())
  instance.actions.applyBoardPatch({
    revision: brandNumber<BoardRevision>(2),
    upserts: [],
    removes: [],
    windows: { upserts: records, removes: [] },
  })
  return instance
}

/**
 * Layer props over one instance.
 * @param instance - the board instance.
 * @param renderSlot - slot renderer; the default answers the body fallback.
 * @returns the props.
 */
function layerProps(
  instance: BoardInstance,
  renderSlot: (name: string, owner: unknown, opts: { entryKey?: string; fallback?: unknown }) => unknown =
    (_name, _owner, opts) => opts?.fallback ?? null,
): never {
  return {
    useStore: (selector: (value: BoardState) => unknown): unknown => selector(instance.getSnapshot()),
    actions: instance.actions,
    renderSlot,
    t,
  } as never
}

/**
 * Layer props over one instance with a store seat that follows changes the way
 * the board's hook does: a re-render happens only when the selection differs
 * under the selector's equality.
 * @param instance - the board instance.
 * @param renderSlot - slot renderer.
 * @returns the props.
 */
function reactiveLayerProps(
  instance: BoardInstance,
  renderSlot: (name: string, owner: unknown, opts: { entryKey?: string; fallback?: unknown }) => unknown,
): never {
  const useStore = <S,>(selector: (value: BoardState) => S, eq: (a: S, b: S) => boolean = Object.is): S => {
    const last = useRef<{ value: S } | undefined>(undefined)
    return useSyncExternalStore(
      listener => instance.subscribe(listener),
      () => {
        const next = selector(instance.getSnapshot())
        if (last.current !== undefined && eq(last.current.value, next)) return last.current.value
        last.current = { value: next }
        return next
      },
    )
  }
  return { useStore, actions: instance.actions, renderSlot, t } as never
}

describe('foreign window layer', () => {
  it('renders foreign records in the owner color and own records not at all', () => {
    const instance = instanceWith([
      record(),
      record({ id: OWN_WINDOW, hostId: SELF, ownerId: SELF }),
    ])
    const view = render(createElement(ForeignWindowLayer, layerProps(instance)))
    const frames = [...view.container.querySelectorAll('[data-board-foreign-window]')]
    expect(frames).toHaveLength(1)
    expect(frames[0]?.getAttribute('data-board-owner-color')).toBe('3')
    expect(view.container.querySelector('[data-board-foreign-window] [data-board-foreign-title]')?.textContent)
      .toBe('Agent #1')
  })

  it('shows the owner bezel with no controls, handles, or movement', () => {
    const instance = instanceWith([
      // A window published by another Ketos but transferred to this
      // participant: still foreign, still unmanageable here.
      record({ ownerId: SELF }),
    ])
    const view = render(createElement(ForeignWindowLayer, layerProps(instance)))
    const frame = view.container.querySelector('[data-board-foreign-window]')
    expect(frame?.querySelector('[data-board-bezel]')).not.toBeNull()
    expect(frame?.querySelector('button')).toBeNull()
    expect(frame?.querySelector('[data-board-handle]')).toBeNull()
    expect(frame?.querySelector('[data-board-action]')).toBeNull()
    expect(frame?.getAttribute('aria-label')).toBe('Window of Kirill')
  })

  it('falls back to the kind template name and the placeholder body', () => {
    const instance = instanceWith([record({ title: 'Ревью' })])
    const view = render(createElement(ForeignWindowLayer, layerProps(instance)))
    expect(view.container.querySelector('[data-board-foreign-title]')?.textContent).toBe('Ревью')
    expect(view.container.querySelector('[data-board-foreign-placeholder]')?.textContent)
      .toBe('Юрист: Ревью')

    cleanup()
    const untitled = instanceWith([record({ title: null, ordinal: 2 })])
    const second = render(createElement(ForeignWindowLayer, layerProps(untitled)))
    expect(second.container.querySelector('[data-board-foreign-title]')?.textContent).toBe('Agent #2')
  })

  it('renders a kind-registered body instead of the placeholder', () => {
    const instance = instanceWith([record()])
    const renderSlot = (name: string): unknown =>
      name === 'board.foreign.window.body' ? createElement('span', { 'data-testid': 'chat-card' }) : null
    const view = render(createElement(ForeignWindowLayer, layerProps(instance, renderSlot)))
    expect(view.container.querySelector('[data-testid="chat-card"]')).not.toBeNull()
    expect(view.container.querySelector('[data-board-foreign-placeholder]')).toBeNull()
  })

  it('culls a record outside the visible canvas', () => {
    const instance = instanceWith([record({ x: 1_000_000 })])
    const view = render(createElement(ForeignWindowLayer, layerProps(instance)))
    expect(view.container.querySelectorAll('[data-board-foreign-window]')).toHaveLength(0)
  })

  it('marks a foreign host that lost its channel and only that host', () => {
    const instance = instanceWith([record()])
    const peer = { peerId: 'peer-1' as KetosPeerId, selfId: OTHER, name: 'Юрист', color: 3 }
    const peerState = (link: 'online' | 'lost'): never => ({
      self: { selfId: SELF, name: 'Kirill', color: 1 },
      peers: [{ ...peer, link }],
      refreshMs: 1000,
    }) as never

    instance.actions.applyPeerState(peerState('lost'))
    const lost = render(createElement(ForeignWindowLayer, layerProps(instance)))
    expect(lost.container.querySelector('[data-board-stale]')?.textContent).toBe('No connection')
    cleanup()

    instance.actions.applyPeerState(peerState('online'))
    const online = render(createElement(ForeignWindowLayer, layerProps(instance)))
    expect(online.container.querySelector('[data-board-stale]')).toBeNull()
    cleanup()

    // A host the peer roster does not know carries no link state: no mark.
    const stranger = instanceWith([record({ hostId: brandString<OwnerId>('owner-stranger') })])
    const unknown = render(createElement(ForeignWindowLayer, layerProps(stranger)))
    expect(unknown.container.querySelector('[data-board-stale]')).toBeNull()
  })

  it('applies and removes window records through the store patch', () => {
    const instance = instanceWith([record()])
    expect(Object.keys(instance.getSnapshot().windowRecords)).toEqual([FOREIGN_WINDOW])
    instance.actions.applyBoardPatch({
      revision: brandNumber<BoardRevision>(3),
      upserts: [],
      removes: [],
      windows: { upserts: [], removes: [FOREIGN_WINDOW] },
    })
    expect(instance.getSnapshot().windowRecords).toEqual({})
  })

  it('keeps records out of the layout, the dock order, and the overview', () => {
    const instance = instanceWith([record({ x: 30_000, y: 30_000 })])
    const state = instance.getSnapshot()
    expect(state.windowOrder).toEqual([])
    expect(state.dockOrder).toEqual([])
    expect(state.windows).toEqual({})
    expect(captureBoardLayout(state).windows).toEqual([])
    // «Show all» fits the local windows and elements only: a lone foreign
    // record leaves the view where it was.
    instance.actions.setPan(150, 90)
    instance.actions.setZoom(1.5)
    instance.actions.resetView()
    const after = instance.getSnapshot()
    expect(after.panX).toBe(0)
    expect(after.panY).toBe(0)
    expect(after.zoom).toBe(1)
  })

  it('refuses management of a foreign record that names the acting owner', () => {
    const instance = instanceWith([record({ ownerId: SELF })])
    const foreign = record({ ownerId: SELF })
    const pseudo: BoardWindowState = {
      id: foreign.id,
      kind: foreign.kind,
      bodyKind: foreign.bodyKind,
      ordinal: foreign.ordinal,
      ownerId: foreign.ownerId,
      access: { mode: foreign.access.mode, people: [] },
      x: foreign.x,
      y: foreign.y,
      width: foreign.w,
      height: foreign.h,
      zIndex: foreign.z,
    }
    expect(canManageWindow(instance.getSnapshot(), pseudo)).toBe(false)
    // The same id in the local layout is manageable.
    instance.actions.openWindow({ ...pseudo, width: 552, height: 648, id: OWN_WINDOW })
    const local = instance.getSnapshot().windows[OWN_WINDOW as string] as BoardWindowState
    expect(canManageWindow(instance.getSnapshot(), local)).toBe(true)
  })

  it('renders no foreign frame before the first snapshot names the acting owner', () => {
    const instance = createBoardStore().create()
    instance.actions.applyBoardPatch({
      revision: brandNumber<BoardRevision>(2),
      upserts: [],
      removes: [],
      windows: { upserts: [record({ hostId: SELF, ownerId: SELF })], removes: [] },
    })
    expect(Object.keys(instance.getSnapshot().windowRecords)).toEqual([FOREIGN_WINDOW])
    const view = render(createElement(ForeignWindowLayer, layerProps(instance)))
    expect(view.container.querySelectorAll('[data-board-foreign-window]')).toHaveLength(0)
  })

  it('leaves frames and bodies alone when an unrelated part of the store changes', () => {
    const instance = instanceWith([record()])
    const bodies: string[] = []
    const renderSlot = (_name: string, owner: unknown, opts: { fallback?: unknown }): unknown => {
      bodies.push(String((owner as { record: BoardWindowRecord }).record.id))
      return opts.fallback
    }
    render(createElement(ForeignWindowLayer, reactiveLayerProps(instance, renderSlot)))
    expect(bodies).toEqual([FOREIGN_WINDOW])

    act(() => { instance.actions.setElementNotice('element.saveFailed') })
    act(() => { instance.actions.setPan(0, 0) })
    expect(bodies).toEqual([FOREIGN_WINDOW])
  })

  it('re-renders only the frame of a record that changed', () => {
    const second = brandString<WindowId>('agent-3-remote')
    const instance = instanceWith([record(), record({ id: second, ordinal: 2, x: 700 })])
    const bodies: string[] = []
    const renderSlot = (_name: string, owner: unknown, opts: { fallback?: unknown }): unknown => {
      bodies.push(String((owner as { record: BoardWindowRecord }).record.id))
      return opts.fallback
    }
    render(createElement(ForeignWindowLayer, reactiveLayerProps(instance, renderSlot)))
    expect(bodies.sort()).toEqual([FOREIGN_WINDOW, second])
    bodies.length = 0

    act(() => {
      instance.actions.applyBoardPatch({
        revision: brandNumber<BoardRevision>(3),
        upserts: [],
        removes: [],
        windows: { upserts: [record({ id: second, ordinal: 2, x: 700, status: 'running' })], removes: [] },
      })
    })
    expect(bodies).toEqual([second])
  })

  it('makes the no-connection badge focusable and reachable by the pointer', () => {
    const instance = instanceWith([record()])
    instance.actions.applyPeerState({
      self: { selfId: SELF, name: 'Kirill', color: 1 },
      peers: [{ peerId: 'peer-1' as KetosPeerId, selfId: OTHER, name: 'Юрист', color: 3, link: 'lost' }],
      refreshMs: 1000,
    })
    const view = render(createElement(ForeignWindowLayer, layerProps(instance)))
    expect(view.container.querySelector('[data-board-stale]')?.getAttribute('tabindex')).toBe('0')

    // The frame passes no pointer events, so the badge opts back in.
    const css = readFileSync(resolve('packages/client/ui-board/src/client/window/ForeignWindowFrame.module.css'), 'utf8')
    expect(css).toMatch(/\[data-board-stale\]\s*\{[^}]*pointer-events:\s*auto/)
  })

  it('treats a connecting host like a lost one', () => {
    const instance = instanceWith([record()])
    instance.actions.applyPeerState({
      self: { selfId: SELF, name: 'Kirill', color: 1 },
      peers: [{ peerId: 'peer-1' as KetosPeerId, selfId: OTHER, name: 'Юрист', color: 3, link: 'connecting' }],
      refreshMs: 1000,
    })
    const view = render(createElement(ForeignWindowLayer, layerProps(instance)))
    expect(view.container.querySelector('[data-board-stale]')).not.toBeNull()
  })

  it('never offers a take-over on a foreign window, even for an owner nobody knows', () => {
    const instance = instanceWith([record({ ownerId: brandString<OwnerId>('previous-self') })])
    const view = render(createElement(ForeignWindowLayer, layerProps(instance)))
    expect(view.container.querySelector('[data-board-foreign-window]')?.textContent).toContain('Unknown participant')
    expect(view.container.querySelector('[data-board-action="bezel-claim"]')).toBeNull()
  })
})
