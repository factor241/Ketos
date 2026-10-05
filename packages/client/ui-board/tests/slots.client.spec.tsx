// @vitest-environment jsdom
/**
 * Board slot composition: the layer cascade and its render sites, keyed window
 * dispatch per type, the keyed window-body seat, open-close cycles, and
 * disposal with the plugin fiber.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { createBoardStore } from '../src/client/store.ts'
import type { BoardWindowState, WindowId } from '../src/client/contract/slots.ts'
import { BOARD_PANEL_ID } from '../src/client/contract/slots.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CloneId } from '@ketos/clone-core/types'
import { chatSnapshot, createBoardBench } from './fixtures.client.ts'
import railCss from '../src/client/dock/SessionRail.module.css'
import minimapCss from '../src/client/canvas/Minimap.module.css'
import type { ConversationNode } from '@deepseek-ai/dsh-client-ui-chat/client'

/** The live board store instance the renderer resolves for the board's registrations. */
type BoardInstance = ReturnType<ReturnType<typeof createBoardStore>['create']>

const runtimes = new Set<SlotTestRuntime>()

afterEach(async () => {
  try {
    for (const runtime of runtimes) await runtime.dispose()
  } finally {
    runtimes.clear()
    cleanup()
  }
})

/** Bench with the services the board injects and the slots it occupies declared. */
async function bench() {
  const prepared = await createBoardBench({ session: { prompt: () => Promise.resolve({ ok: true, value: { accepted: true } }) } })
  runtimes.add(prepared.runtime)
  const board = await prepared.mountBoard()
  return { runtime: prepared.runtime, board, chat: prepared.chat, mountBoard: prepared.mountBoard }
}

/** The window state literal the composition tests vary. */
function windowState(overrides: Partial<Parameters<BoardInstance['actions']['openWindow']>[0]> & { id: WindowId }) {
  return {
    kind: 'agent' as const,
    bodyKind: 'conversation' as const,
    ordinal: 1,
    width: 552,
    height: 648,
    ...overrides,
  }
}

describe('board slot composition', () => {
  it('declares the full board cascade and occupies every declared slot', async () => {
    const { runtime } = await bench()

    // The panel entry declares the three floating layers it renders.
    const panel = runtime.slots.entries('main')[0]
    expect(Object.keys(panel?.children ?? {})).toEqual([
      'board.canvas', 'board.dock', 'board.minimap',
    ])
    for (const key of ['board.canvas', 'board.dock', 'board.minimap'] as const) {
      expect(runtime.slots.entriesOfSlot(key)).toHaveLength(1)
    }

    // Cascade: canvas declares the window layer, the layer declares both keyed window seats.
    expect(runtime.slots.entriesOfSlot('board.windows')).toHaveLength(1)
    expect(runtime.slots.entries('board.windows')[0]?.children).toEqual({
      'board.window': { kind: 'keyed', scope: 'root' },
      'board.window.body': { kind: 'keyed', scope: 'root' },
      'board.window.panel': { kind: 'keyed', scope: 'root' },
    })
    expect(runtime.slots.spec('board.window')).toEqual({ kind: 'keyed', scope: 'root' })
    expect(runtime.slots.spec('board.window.body')).toEqual({ kind: 'keyed', scope: 'root' })

    // One frame registration per window type; the conversation body, the clone
    // card editor, the clone memory list, and the task list are the occupied
    // bodies, and the MVP-external kinds share one unavailable notice.
    expect(runtime.slots.entries('board.window').map(entry => entry.options.key)).toEqual([
      'agent', 'clone', 'connectors', 'settings', 'dashboard', 'tasks',
    ])
    expect(runtime.slots.entries('board.window.body').map(entry => entry.options.key)).toEqual([
      'conversation', 'clone', 'clone-memory', 'tasks', 'connectors', 'settings', 'dashboard',
    ])

    // The switch registers in the sidebar brand row; the panel list stays empty (Т2.8).
    expect(runtime.slots.entries('sidebar.brand.actions').map(entry => entry.options.id)).toEqual(['board'])
    expect(runtime.slots.entries('sidebar.panellist')).toEqual([])
    // The return control occupies the header's utility row and the blank
    // Session's own seat (Т2.11/Т2.15).
    expect(runtime.slots.entries('conversation.session.header.utilities').map(entry => entry.options.id)).toEqual(['board-return'])
    expect(runtime.slots.entries('conversation.session.header.blank').map(entry => entry.options.id)).toEqual(['board-return'])
  })

  it('renders every declared layer and puts the window layer inside the canvas transform', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    // Every declared layer has its render site: a dropped renderSlot call leaves the layer missing.
    for (const layer of ['canvas', 'dock', 'minimap'] as const) {
      expect(panel.container.querySelectorAll(`[data-board-layer="${layer}"]`)).toHaveLength(1)
    }

    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await runtime.flush()

    // The window layer renders inside the transformed canvas surface, not beside the canvas.
    const transformed = panel.container.querySelector('[data-surface="canvas-layer"]')
    expect(transformed?.querySelectorAll('[data-board-window="agent"]')).toHaveLength(1)
  })

  it('routes each window to the frame registered for its kind', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    const toolKinds = ['connectors', 'settings', 'dashboard', 'tasks'] as const
    act(() => {
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'First agent' }))
      for (const [index, kind] of toolKinds.entries()) {
        board.actions.openWindow(windowState({
          id: `t${String(index)}` as WindowId,
          kind,
          bodyKind: kind,
          ordinal: index + 2,
          customTitle: `Tool ${kind}`,
          width: 520,
          height: 480,
        }))
      }
    })
    await runtime.flush()

    // Each frame renders its own component: only the agent frame carries the
    // session composer, so a frame dispatched to the wrong occupant fails these assertions.
    const agentFrame = panel.container.querySelector('[data-board-window="agent"]')
    expect(agentFrame?.querySelector('textarea')).not.toBeNull()
    expect(agentFrame?.querySelector('button[aria-label="Send"]')).not.toBeNull()
    expect(agentFrame?.textContent).toContain('First agent')
    // Every tool kind keeps the shared frame without the chat-only controls.
    // The chats panel is opened from its own rail, never from a duplicate
    // header button, and the expand-to-standard control is the chat window's
    // alone (Т2.3).
    expect(agentFrame?.querySelector('button[aria-label="Chats"]')).toBeNull()
    expect(agentFrame?.querySelector('button[aria-label="Open fullscreen"]')).not.toBeNull()
    for (const kind of toolKinds) {
      const toolFrame = panel.container.querySelector(`[data-board-window="${kind}"]`)
      expect(toolFrame).not.toBeNull()
      expect(toolFrame?.textContent).toContain(`Tool ${kind}`)
      expect(toolFrame?.querySelector('textarea')).toBeNull()
      expect(toolFrame?.querySelector('button[aria-label="Send"]')).toBeNull()
      expect(toolFrame?.querySelector('button[aria-label="Chats"]')).toBeNull()
      expect(toolFrame?.querySelector('button[aria-label="Open fullscreen"]')).toBeNull()
    }

    // A clone window edits a record, not a chat: no expand control either.
    act(() => { board.actions.openWindow(windowState({
      id: 'c1' as WindowId, kind: 'clone', bodyKind: 'clone', cloneId: 'clone-1' as CloneId, ordinal: 6,
    })) })
    await runtime.flush()
    const cloneFrame = panel.container.querySelector('[data-board-window="clone"]')
    expect(cloneFrame?.querySelector('button[aria-label="Open fullscreen"]')).toBeNull()
  })

  it('swaps the body occupant when bodyKind changes', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => {
      board.actions.openWindow(windowState({ id: 'a1' as WindowId }))
    })
    await runtime.flush()
    expect(panel.container.querySelector('textarea')).not.toBeNull()
    expect(panel.view.getByText('Write a message to start.')).not.toBeNull()

    // A kind outside the MVP swaps in the unavailable notice, not an empty region.
    act(() => { board.actions.setWindowBodyKind('a1' as WindowId, 'connectors') })
    await runtime.flush()
    expect(panel.container.querySelector('textarea')).toBeNull()
    expect(panel.container.querySelector('[data-board-window="agent"]')).not.toBeNull()
    expect(panel.view.getByText('This window is not available in the MVP')).not.toBeNull()

    act(() => { board.actions.setWindowBodyKind('a1' as WindowId, 'conversation') })
    await runtime.flush()
    expect(panel.container.querySelector('textarea')).not.toBeNull()
  })

  it('renders the conversation body for an agent window and the memory body for a clone window', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => {
      board.actions.openWindow(windowState({ id: 'a1' as WindowId }))
      board.actions.openWindow(windowState({
        id: 'c1' as WindowId,
        kind: 'clone',
        bodyKind: 'clone-memory',
        cloneId: 'clone-1' as CloneId,
        ordinal: 3,
        customTitle: 'Clone memory',
      }))
    })
    await runtime.flush()

    expect(panel.container.querySelector('textarea')).not.toBeNull()

    const cloneFrame = panel.container.querySelector('[data-board-window="clone"]')
    expect(cloneFrame).not.toBeNull()
    expect(cloneFrame?.textContent).toContain('Clone memory')
    // The memory body occupies the clone frame's content region; this bench has
    // no route, so the refused read renders its own failure row rather than an
    // empty memory.
    await vi.waitFor(() => {
      expect(cloneFrame?.querySelector('[data-board-memory-notice="read"]')).not.toBeNull()
    })
    expect(cloneFrame?.querySelector('[data-board-memory-list]')).not.toBeNull()
    expect(cloneFrame?.querySelector('[data-board-memory-empty]')).toBeNull()
  })

  it('closes a window through its frame and removes it from the layer', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => {
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'First agent' }))
      board.actions.openWindow(windowState({ id: 'a2' as WindowId, customTitle: 'Second agent' }))
    })
    await runtime.flush()
    expect(panel.container.querySelectorAll('[data-board-window="agent"]')).toHaveLength(2)

    const firstFrame = panel.container.querySelectorAll('[data-board-window="agent"]')[0] as HTMLElement
    fireEvent.click(firstFrame.querySelector('button[aria-label="Close"]') as Element)
    await runtime.flush()

    expect(panel.container.querySelectorAll('[data-board-window="agent"]')).toHaveLength(1)
    expect(board.store.getSnapshot().windowOrder).toHaveLength(1)
    expect(panel.view.queryByText('First agent')).toBeNull()
    expect(panel.view.getByText('Second agent')).not.toBeNull()
  })

  it('hands the window draft to the standard interface through the expand control (Т2.1/Т2.4)', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'First agent' })) })
    await runtime.flush()
    // The window owns a draft: text, an image, and a staged file.
    act(() => {
      board.actions.setDraftText('a1' as WindowId, 'перенесённый текст')
      board.actions.addDraftImages('a1' as WindowId, [{
        id: 'img-1', name: 'pic.png', mediaType: 'image/png', data: 'AA==', preview: 'data:image/png;base64,AA==',
      }])
      board.actions.addDraftFiles('a1' as WindowId, [{
        record: { id: 'f1', name: 'notes.txt', status: 'ready', receiptId: 'r1' },
        source: new File(['x'], 'notes.txt', { type: 'text/plain' }),
      }])
    })
    await runtime.flush()

    // The standard composer already holds its own text: the window's draft
    // joins it as a new paragraph instead of replacing it.
    const conversation = runtime.ctx.get('conversation') as unknown as {
      seedStandardDraft: (sessionId: string, text: string) => unknown
      standardInputs: Map<string, { drafts: string[]; files: readonly (readonly File[])[] }>
    }
    conversation.seedStandardDraft('session-1', 'существующий черновик')

    fireEvent.click(panel.container.querySelector('button[aria-label="Open fullscreen"]') as Element)
    await runtime.flush()

    // The standard interface selected the window's session and received the
    // whole draft: text, the image decoded back to a File, and the staged file.
    const workspace = runtime.ctx.get('uiWorkspace') as unknown as { openedSessions: string[] }
    expect(workspace.openedSessions).toEqual(['session-1'])
    const standard = conversation.standardInputs.get('session-1')
    expect(standard?.drafts).toEqual(['существующий черновик\n\nперенесённый текст'])
    expect(standard?.files[0]?.map(file => file.name)).toEqual(['pic.png', 'notes.txt'])
    expect(standard?.files[0]?.map(file => file.type)).toEqual(['image/png', 'text/plain'])
    // The window's own draft is gone with the handoff, the window itself stays
    // on the board (the control navigates, it never mutates the layout), and
    // the store remembers it as the expanded window for the return rules.
    expect(board.store.getSnapshot().drafts['a1']).toBeUndefined()
    expect(panel.container.querySelectorAll('[data-board-window="agent"]')).toHaveLength(1)
    expect(board.store.getSnapshot().expandedWindowId).toBe('a1')
  })

  it('reports every expand failure on the window and keeps its draft (Т2.1)', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    const conversation = runtime.ctx.get('conversation') as unknown as {
      setAddFilesMode: (mode: 'ok' | 'busy' | 'throw') => void
    }

    act(() => {
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' }))
      board.actions.setDraftText('a1' as WindowId, 'черновик')
      board.actions.addDraftFiles('a1' as WindowId, [{
        record: { id: 'f1', name: 'notes.txt', status: 'ready', receiptId: 'r1' },
        source: new File(['x'], 'notes.txt', { type: 'text/plain' }),
      }])
    })
    await runtime.flush()
    const clickExpand = (): void => {
      fireEvent.click(panel.container.querySelector('button[aria-label="Open fullscreen"]') as Element)
    }
    const notice = (): string | undefined =>
      panel.container.querySelector('[data-board-action-error]')?.textContent ?? undefined

    // A standard composer mid-admission refuses the files: the window keeps
    // its draft and says to retry.
    conversation.setAddFilesMode('busy')
    clickExpand()
    await runtime.flush()
    expect(notice()).toBe('The session is sending a message — try again')
    expect(board.store.getSnapshot().drafts['a1']?.text).toBe('черновик')
    expect(board.store.getSnapshot().expandedWindowId).toBeNull()

    // A rejected file (an unsupported type) reports the attachment failure.
    conversation.setAddFilesMode('throw')
    clickExpand()
    await runtime.flush()
    expect(notice()).toBe('Could not transfer the attachments')
    expect(board.store.getSnapshot().drafts['a1']?.text).toBe('черновик')
    expect(board.store.getSnapshot().expandedWindowId).toBeNull()

    // The session left the list: the handoff cannot resolve it.
    conversation.setAddFilesMode('ok')
    await runtime.sessions.remove('session-1')
    await runtime.flush()
    clickExpand()
    await runtime.flush()
    expect(notice()).toBe('Session unavailable')
    expect(board.store.getSnapshot().drafts['a1']?.text).toBe('черновик')
    expect(board.store.getSnapshot().expandedWindowId).toBeNull()

    // The session returns; a fresh attempt starts clean, reports its own
    // reason, and a successful handoff clears the notice and arms the return
    // rules.
    await runtime.sessions.add({ id: 'session-1' })
    await runtime.flush()
    conversation.setAddFilesMode('busy')
    clickExpand()
    await runtime.flush()
    expect(notice()).toBe('The session is sending a message — try again')
    conversation.setAddFilesMode('ok')
    clickExpand()
    await runtime.flush()
    expect(notice()).toBeUndefined()
    expect(board.store.getSnapshot().expandedWindowId).toBe('a1')
  })

  it('returns the standard draft to the window on the return control (Т2.11)', async () => {
    const prepared = await createBoardBench({
      session: { prompt: () => Promise.resolve({ ok: true, value: { accepted: true } }) },
    })
    runtimes.add(prepared.runtime)
    await prepared.mountBoard()
    const { runtime } = prepared
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const sessionReference = runtime.sessions.retain('session-1' as SessionId, { source: 'testView' })
    const header = runtime.renderSlot('conversation.session.header.utilities', {}, { session: sessionReference })
    const blankHeader = runtime.renderSlot('conversation.session.header.blank', {}, { session: sessionReference })
    const board = runtime.storeOf('board.dock') as BoardInstance
    const conversation = runtime.ctx.get('conversation') as unknown as {
      seedStandardDraft: (sessionId: string, text: string) => { addFiles: (files: readonly File[]) => boolean }
      standardInputs: Map<string, { current: string; files: readonly (readonly File[])[] }>
    }

    act(() => {
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' }))
      board.actions.setDraftText('a1' as WindowId, 'из окна')
      board.actions.addDraftFiles('a1' as WindowId, [{
        record: { id: 'f1', name: 'notes.txt', status: 'ready', receiptId: 'r1' },
        source: new File(['x'], 'notes.txt', { type: 'text/plain' }),
      }])
    })
    await runtime.flush()

    // Expand: the window's whole draft moves into the standard composer.
    fireEvent.click(panel.container.querySelector('button[aria-label="Open fullscreen"]') as Element)
    await runtime.flush()
    const standard = conversation.standardInputs.get('session-1')
    expect(standard?.current).toBe('из окна')
    expect(standard?.files[0]?.map(file => file.name)).toEqual(['notes.txt'])

    // The user keeps typing there and attaches an image; meanwhile the window
    // acquires a draft of its own.
    conversation.seedStandardDraft('session-1', 'из окна и ещё')
      .addFiles([new File([Uint8Array.of(1, 2, 3)], 'pic.png', { type: 'image/png' })])
    act(() => { board.actions.setDraftText('a1' as WindowId, 'новое в окне') })

    // The return control is present while the Session is bound to the window,
    // in the header's utility row and in the blank Session's own seat.
    const button = header.container.querySelector('[data-board-action="return-to-window"]')
    expect(button).not.toBeNull()
    expect(blankHeader.container.querySelector('[data-board-action="return-to-window"]')).not.toBeNull()
    fireEvent.click(button as Element)
    await runtime.flush()

    // The standard draft moved into the window: the window's text first, the
    // standard text as a new paragraph, the image beside it, and the file as
    // a receipt-only entry (no browser bytes, so no retry).
    const drafts = board.store.getSnapshot().drafts['a1']
    expect(drafts?.text).toBe('новое в окне\n\nиз окна и ещё')
    expect(drafts?.images.map(image => image.name)).toEqual(['pic.png'])
    expect(drafts?.files.map(entry => [entry.record.name, entry.record.status, entry.record.receiptId, entry.source])).toEqual([
      ['notes.txt', 'ready', 'receipt:notes.txt', undefined],
    ])
    // The standard composer was emptied, and the board panel was selected with
    // the window armed for its return highlight.
    expect(standard?.current).toBe('')
    expect(standard?.files).toEqual([])
    expect((runtime.ctx.get('layout') as unknown as { selectPanelCalls: string[] }).selectPanelCalls).toContain('board')
    expect(board.store.getSnapshot().returnWindowId).toBe('a1')
    expect(board.store.getSnapshot().expandedWindowId).toBeNull()
  })

  it('returns to the window and reports the draft that stayed in the standard interface (Т2.11)', async () => {
    const prepared = await createBoardBench({
      session: { prompt: () => Promise.resolve({ ok: true, value: { accepted: true } }) },
    })
    runtimes.add(prepared.runtime)
    await prepared.mountBoard()
    const { runtime } = prepared
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const sessionReference = runtime.sessions.retain('session-1' as SessionId, { source: 'testView' })
    const header = runtime.renderSlot('conversation.session.header.utilities', {}, { session: sessionReference })
    const board = runtime.storeOf('board.dock') as BoardInstance
    const conversation = runtime.ctx.get('conversation') as unknown as {
      seedStandardDraft: (sessionId: string, text: string) => unknown
      setTakeDraftMode: (mode: 'ok' | 'refuse') => void
    }

    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' })) })
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('button[aria-label="Open fullscreen"]') as Element)
    await runtime.flush()
    conversation.seedStandardDraft('session-1', 'останется в стандарте')
    conversation.setTakeDraftMode('refuse')

    fireEvent.click(header.container.querySelector('[data-board-action="return-to-window"]') as Element)
    await runtime.flush()

    // The navigation happened, the draft stayed where it was, and the window
    // carries the reason.
    expect((runtime.ctx.get('layout') as unknown as { selectPanelCalls: string[] }).selectPanelCalls).toContain('board')
    expect(board.store.getSnapshot().returnWindowId).toBe('a1')
    expect(board.store.getSnapshot().drafts['a1']).toBeUndefined()
    expect(panel.container.querySelector('[data-board-action-error]')?.textContent)
      .toBe('The draft stayed in the standard interface')
  })

  it('adopts the Session opened in the standard interface while a window is expanded (Т2.13–Т2.16)', async () => {
    const prepared = await createBoardBench({
      session: { prompt: () => Promise.resolve({ ok: true, value: { accepted: true } }) },
      sessionSummary: { displayTitle: 'Chat one' },
      extraSessions: [{ id: 'session-2', displayTitle: 'Chat two' }],
    })
    runtimes.add(prepared.runtime)
    await prepared.mountBoard()
    const { runtime } = prepared
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const brand = runtime.renderSlot('sidebar.brand.actions', { wide: true })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await runtime.flush()
    const title = (): string | null =>
      panel.container.querySelector('[data-board-action="window-rename"]')?.getAttribute('data-board-title') ?? null
    expect(title()).toBe('Chat one')

    // Opening a Session in the standard interface retains it for `mainView`
    // (ui-workspace owns the selection); the board watches the list's
    // main-view holder.
    let mainReference = runtime.sessions.retain('session-2' as SessionId, { source: 'mainView' })
    const openInMain = async (id: string): Promise<void> => {
      mainReference.release()
      mainReference = runtime.sessions.retain(id as SessionId, { source: 'mainView' })
      await runtime.flush()
    }

    // Т2.16: the sidebar switch (not an expand) arms no rules — opening
    // another Session in the standard interface leaves the window alone.
    fireEvent.click(brand.container.querySelector('[data-board-action="open-board"]') as Element)
    await openInMain('session-2')
    expect(title()).toBe('Chat one')

    // Back on the window's own Session (the rules run, but the holder guard
    // keeps the window where it is), then expand to arm them: the next
    // existing Session the user opens moves the expanded window (Т2.13).
    await openInMain('session-1')
    expect(title()).toBe('Chat one')
    fireEvent.click(panel.container.querySelector('button[aria-label="Open fullscreen"]') as Element)
    await runtime.flush()
    await openInMain('session-2')
    expect(title()).toBe('Chat two')

    // A brand-new blank Session leaves the window alone (Т2.15).
    await runtime.sessions.add({ id: 'session-3', summary: { displayTitle: 'New chat', blank: true } })
    await openInMain('session-3')
    expect(title()).toBe('Chat two')
    mainReference.release()
  })

  it('opens the panel beside the frame from the window header control', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => {
      // Room on both sides of the centred window, so the panel takes its own column.
      board.actions.setViewport(1400, 900)
      board.actions.openWindow(windowState({ id: 'a1' as WindowId }))
    })
    await runtime.flush()

    // The header control keeps the panel one click away while it is closed;
    // every chat window carries its own.
    const hidden = panel.container.querySelector('[data-board-panel]') as HTMLElement
    expect(hidden.getAttribute('data-board-panel-open')).toBeNull()
    expect(panel.container.querySelector('[data-board-action="window-left-panel"]')).not.toBeNull()
    expect(panel.container.querySelector('[data-board-action="window-right-panel"]')).not.toBeNull()

    fireEvent.click(panel.container.querySelector('[data-board-action="window-left-panel"]') as Element)
    await runtime.flush()
    const shown = panel.container.querySelector('[data-board-panel]') as HTMLElement
    const window = board.store.getSnapshot().windows['a1'] as BoardWindowState
    const width = window.leftPanelWidth ?? 0
    expect(shown.getAttribute('data-board-panel')).toBe('left')
    expect(shown.getAttribute('data-board-panel-side')).toBe('left')
    expect(shown.getAttribute('data-board-panel-open')).toBe('')
    // The panel stands beside the frame at the stored width and the window
    // height, at the window's own stacking level (the frame paints above it).
    expect(shown.style.left).toBe(`${String(window.x - width)}px`)
    expect(shown.style.top).toBe(`${String(window.y)}px`)
    expect(shown.style.width).toBe(`${String(width)}px`)
    expect(shown.style.height).toBe(`${String(window.height)}px`)
    expect(shown.style.zIndex).toBe(String(window.zIndex))

    // Dragging the outer edge resizes the panel by the world-unit delta.
    const handle = panel.container.querySelector('[aria-label="Resize the chats panel"]') as HTMLElement
    // jsdom implements no pointer capture at all; the gesture only needs its deltas.
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: () => {},
      configurable: true,
      writable: true,
    })
    act(() => { board.actions.setWindowPanelWidth('a1' as WindowId, 'left', 320) })
    // The gesture starts from the width the panel actually shows.
    const beforeDrag = board.store.getSnapshot().windows['a1']?.leftPanelWidth ?? 0
    fireEvent.pointerDown(handle, { clientX: 200, pointerId: 7 })
    // The panel rides the frame's left edge, so dragging left widens it. The
    // gesture listens on the global; drive it with plain events carrying the
    // pointer coordinates (jsdom ships no PointerEvent constructor).
    for (const [type, clientX] of [['pointermove', 160], ['pointerup', 160]] as const) {
      const event = new Event(type)
      Object.assign(event, { clientX, pointerId: 7 })
      globalThis.dispatchEvent(event)
    }
    expect(board.store.getSnapshot().windows['a1']?.leftPanelWidth).toBe(beforeDrag + 40)
    Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')

    // The collapse control lives in the panel's own header; the header's own
    // button brings the panel back.
    fireEvent.click(panel.container.querySelector('[data-board-action="panel-collapse"]') as Element)
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-panel-open]')).toBeNull()

    // Escape closes the panel first and leaves the window alone.
    fireEvent.click(panel.container.querySelector('[data-board-action="window-left-panel"]') as Element)
    await runtime.flush()
    fireEvent.keyDown(document, { key: 'Escape' })
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-panel-open]')).toBeNull()
    expect(panel.container.querySelector('[data-board-window="agent"]')).not.toBeNull()

  })

  it('opens both panels of one window independently, each at its own width (Т3.12)', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => {
      board.actions.setViewport(1600, 900)
      board.actions.openWindow(windowState({ id: 'a1' as WindowId }))
    })
    await runtime.flush()

    fireEvent.click(panel.container.querySelector('[data-board-action="window-left-panel"]') as Element)
    fireEvent.click(panel.container.querySelector('[data-board-action="window-right-panel"]') as Element)
    await runtime.flush()

    const state = board.store.getSnapshot()
    expect(state.windows['a1']?.leftPanelOpen).toBe(true)
    expect(state.windows['a1']?.rightPanelOpen).toBe(true)
    const window = state.windows['a1'] as BoardWindowState
    const left = panel.container.querySelector('[data-board-panel-side="left"]') as HTMLElement
    const right = panel.container.querySelector('[data-board-panel-side="right"]') as HTMLElement
    expect(left.getAttribute('data-board-panel-open')).toBe('')
    expect(right.getAttribute('data-board-panel-open')).toBe('')
    expect(left.style.left).toBe(`${String(window.x - (window.leftPanelWidth ?? 0))}px`)
    expect(right.style.left).toBe(`${String(window.x + window.width)}px`)

    // Each side keeps its own stored width.
    act(() => {
      board.actions.setWindowPanelWidth('a1' as WindowId, 'left', 300)
      board.actions.setWindowPanelWidth('a1' as WindowId, 'right', 520)
    })
    await runtime.flush()
    const widths = board.store.getSnapshot().windows['a1']
    expect(widths?.leftPanelWidth).toBe(300)
    expect(widths?.rightPanelWidth).toBe(520)

    // Closing one leaves the other open.
    fireEvent.click(left.querySelector('[data-board-action="panel-collapse"]') as Element)
    await runtime.flush()
    expect(board.store.getSnapshot().windows['a1']?.leftPanelOpen).toBe(false)
    expect(board.store.getSnapshot().windows['a1']?.rightPanelOpen).toBe(true)
  })

  it('shifts the board when an opened panel would fall outside the safe area (Т3.5)', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => {
      board.actions.setViewport(1200, 900)
      // A window at the world origin: its left panel has no room on screen.
      board.actions.addWindow({ ...windowState({ id: 'a1' as WindowId }), x: 0, y: 100, zIndex: 10 })
    })
    await runtime.flush()
    const before = board.store.getSnapshot()
    expect(before.panX).toBe(0)

    fireEvent.click(panel.container.querySelector('[data-board-action="window-left-panel"]') as Element)
    await runtime.flush()

    // The board shifted right by exactly the panel's overflow; the zoom never
    // changed, and the panel now starts at the safe area's left edge.
    const after = board.store.getSnapshot()
    const window = after.windows['a1'] as BoardWindowState
    const width = window.leftPanelWidth ?? 0
    expect(after.zoom).toBe(before.zoom)
    expect(after.panX).toBe(width)
    expect(after.panX + (window.x - width) * after.zoom).toBe(0)
  })

  it('expands a folder in place and opens its new session from the group (Т3.3)', async () => {
    const prepared = await createBoardBench()
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    const created = await runtime.sessions.add({ id: 'session-1', summary: { displayTitle: 'Alpha' } })
    runtime.sessions.stubCreate(async () => created)
    await runtime.sessions.add({ id: 'chat-2', summary: { displayTitle: 'Beta' } })
    await runtime.workspaces.update((draft) => {
      draft.items = [{
        workspaceId: 'ws-1' as never,
        path: '/work/one',
        title: 'One',
        sessionIds: ['session-1' as never, 'chat-2' as never],
        createdAt: '2026-09-16T00:00:00.000Z',
        updatedAt: '2026-09-16T00:00:00.000Z',
      }]
    })
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('[data-board-action="window-left-panel"]') as Element)
    await runtime.flush()

    // The window's own session opens its folder automatically.
    const group = () => panel.container.querySelector('[data-board-group="ws-1"]')
    const toggle = () => group()?.querySelector('[data-board-group-toggle]')
    expect(toggle()?.getAttribute('data-board-group-toggle')).toBe('open')
    expect(panel.container.querySelector('[data-board-chat-current]')?.textContent).toContain('Alpha')

    // Collapsing hides the sessions; expanding again shows them in place.
    fireEvent.click(panel.view.getByText('One'))
    await runtime.flush()
    expect(toggle()?.getAttribute('data-board-group-toggle')).toBe('closed')
    expect(panel.container.querySelector('[data-board-chat-current]')).toBeNull()
    fireEvent.click(panel.view.getByText('One'))
    await runtime.flush()
    expect(toggle()?.getAttribute('data-board-group-toggle')).toBe('open')
    // Clicking another chat binds this window to it and keeps the panel open.
    const before = runtime.sessions.calls.filter(call => call.method === 'retain').length
    fireEvent.click(panel.view.getByText('Beta'))
    await runtime.flush()
    expect(runtime.sessions.calls.filter(call => call.method === 'retain').length).toBe(before + 1)
    expect(panel.container.querySelector('[data-board-chat-current]')?.textContent).toContain('Beta')
    expect(panel.container.querySelector('[data-board-panel-side="left"]')?.getAttribute('data-board-panel-open')).toBe('')

    // The group's own control starts a new session in its folder.
    fireEvent.click(group()?.querySelector('[data-board-action="panel-new-chat"]') as Element)
    await runtime.flush()
    expect(runtime.sessions.calls.some(call => call.method === 'create')).toBe(true)
  })

  it('points the window at the chat picked in its panel', async () => {
    const prepared = await createBoardBench()
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    const created = await runtime.sessions.add({ id: 'session-1', summary: { cwd: '/work/one' } })
    runtime.sessions.stubCreate(async () => created)
    await runtime.sessions.add({ id: 'chat-2', summary: { displayTitle: 'Second chat', cwd: '/work/two' } })
    await runtime.workspaces.update((draft) => {
      draft.items = [{
        workspaceId: 'ws-1' as never,
        path: '/work/two',
        title: 'Two',
        sessionIds: ['chat-2' as never],
        createdAt: '2026-09-16T00:00:00.000Z',
        updatedAt: '2026-09-16T00:00:00.000Z',
      }]
    })
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await runtime.flush()

    fireEvent.click(panel.container.querySelector('[data-board-action="window-left-panel"]') as Element)
    await runtime.flush()
    fireEvent.click(panel.view.getByText('Two'))
    await runtime.flush()
    fireEvent.click(panel.view.getByText('Second chat'))
    await runtime.flush()

    // The window's session is the picked chat: the panel marks that row current.
    expect(panel.container.querySelector('[data-board-chat-current]')?.textContent).toContain('Second chat')
    expect(runtime.sessions.calls.some(call => call.method === 'retain' && call.args[0] === 'chat-2')).toBe(true)
  })

  it('manages projects from the panel: rename, reorder, delete', async () => {
    const prepared = await createBoardBench()
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    await runtime.workspaces.update((draft) => {
      draft.items = [
        {
          workspaceId: 'ws-1' as never,
          path: '/work/one',
          title: 'One',
          sessionIds: [],
          createdAt: '2026-09-16T00:00:00.000Z',
          updatedAt: '2026-09-16T00:00:00.000Z',
        },
        {
          workspaceId: 'ws-2' as never,
          path: '/work/two',
          title: 'Two',
          sessionIds: ['chat-2' as never],
          createdAt: '2026-09-16T00:00:00.000Z',
          updatedAt: '2026-09-16T00:00:00.000Z',
        },
      ]
    })
    const created = await runtime.sessions.add({ id: 'session-1', summary: { cwd: '/work/one' } })
    runtime.sessions.stubCreate(async () => created)
    await runtime.sessions.add({ id: 'chat-2', summary: { displayTitle: 'Second chat', cwd: '/work/two' } })
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await runtime.flush()

    // Rename the first project through its row menu.
    const rows = () => [...panel.container.querySelectorAll('[data-row-key^="project:"]')] as HTMLElement[]
    const firstMenu = rows()[0]?.parentElement?.querySelector('button[aria-label="More actions"]')
    fireEvent.click(firstMenu as Element)
    await runtime.flush()
    fireEvent.click(screen.getByText('Rename'))
    await runtime.flush()
    const input = panel.container.querySelector('[data-board-row-edit="rename"] input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await runtime.flush()
    expect(runtime.workspaces.calls.some(call => call.method === 'rename' && call.args[1] === 'Renamed')).toBe(true)

    // Move it down, then delete the second project with the confirm step.
    fireEvent.click(rows()[0]?.parentElement?.querySelector('button[aria-label="More actions"]') as Element)
    await runtime.flush()
    fireEvent.click(screen.getByText('Move down'))
    await runtime.flush()
    expect(runtime.workspaces.calls.some(call => call.method === 'insertBefore')).toBe(true)

    const second = panel.container.querySelector('[data-row-key="project:ws-2"]')?.parentElement
    fireEvent.click(second?.querySelector('button[aria-label="More actions"]') as Element)
    await runtime.flush()
    fireEvent.click(screen.getByText('Delete project'))
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-row-edit="confirm"]')).not.toBeNull()
    fireEvent.click(screen.getByText('Confirm'))
    await runtime.flush()
    expect(runtime.workspaces.calls.some(call => call.method === 'delete' && call.args[0] === 'ws-2')).toBe(true)
  })

  it('branches and archives a chat from the panel', async () => {
    const prepared = await createBoardBench()
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    const created = await runtime.sessions.add({ id: 'session-1', summary: { cwd: '/work/one' } })
    runtime.sessions.stubCreate(async () => created)
    await runtime.sessions.add({ id: 'chat-2', summary: { displayTitle: 'Second chat', cwd: '/work/two' } })
    await runtime.workspaces.update((draft) => {
      draft.items = [{
        workspaceId: 'ws-1' as never,
        path: '/work/two',
        title: 'Two',
        sessionIds: ['chat-2' as never],
        createdAt: '2026-09-16T00:00:00.000Z',
        updatedAt: '2026-09-16T00:00:00.000Z',
      }]
    })
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await runtime.flush()

    fireEvent.click(panel.container.querySelector('[data-board-action="window-left-panel"]') as Element)
    await runtime.flush()
    fireEvent.click(panel.view.getByText('Two'))
    await runtime.flush()
    // The chat's own row menu inside the expanded folder.
    const chatMenu = '[data-board-group="ws-1"] [data-board-action="panel-row-menu"]'
    fireEvent.click(panel.container.querySelector(chatMenu) as Element)
    await runtime.flush()
    fireEvent.click(screen.getByText('Branch'))
    await runtime.flush()
    expect(runtime.sessions.calls.some(call => call.method === 'fork')).toBe(true)

    fireEvent.click(panel.container.querySelector(chatMenu) as Element)
    await runtime.flush()
    fireEvent.click(screen.getByText('Archive chat'))
    await runtime.flush()
    fireEvent.click(screen.getByText('Confirm'))
    await runtime.flush()
    expect(runtime.workspaces.calls.some(call => call.method === 'archiveSession')).toBe(true)
  })

  it('registers a folder through the panel folder browser', async () => {
    const listing = {
      path: '/work',
      home: '/home',
      crumbs: [{ name: '', path: '/' }, { name: 'work', path: '/work' }],
      entries: [{ name: 'ketos', path: '/work/ketos', hidden: false }],
      truncated: false,
    }
    const prepared = await createBoardBench({
      uiWorkspace: {
        listDirectory: async () => listing,
        createDirectory: async () => '/work/ketos',
      },
    })
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    const created = await runtime.sessions.add({ id: 'session-1', summary: { cwd: '/work/one' } })
    runtime.sessions.stubCreate(async () => created)
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await runtime.flush()

    fireEvent.click(panel.container.querySelector('[data-board-action="window-left-panel"]') as Element)
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('button[aria-label="Add a folder…"]') as Element)
    await runtime.flush()
    expect(panel.view.getByText('ketos')).not.toBeNull()
    fireEvent.click(panel.view.getByText('Use this folder'))
    await runtime.flush()
    expect(runtime.workspaces.calls.some(call => call.method === 'create' && (call.args[0] as { path: string }).path === '/work')).toBe(true)
  })

  it('falls back to the host chooser when no browse picker is mounted', async () => {
    let picked = 0
    const prepared = await createBoardBench({
      uiWorkspace: {
        listDirectory: async () => { throw new Error('directory browsing is not available') },
        pickDirectory: async () => { picked += 1; return '/work' },
      },
    })
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    const created = await runtime.sessions.add({ id: 'session-1', summary: { cwd: '/work/one' } })
    runtime.sessions.stubCreate(async () => created)
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await runtime.flush()

    fireEvent.click(panel.container.querySelector('[data-board-action="window-left-panel"]') as Element)
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('button[aria-label="Add a folder…"]') as Element)
    await runtime.flush()

    // A host whose boot mounted the native picker serves no listing: the level
    // states that and offers the chooser instead of a dead browser.
    expect(panel.view.getByText('Folder browsing is unavailable')).not.toBeNull()
    fireEvent.click(panel.view.getByText('Choose a folder in the system…'))
    await runtime.flush()
    expect(picked).toBe(1)
    expect(runtime.workspaces.calls.some(call => call.method === 'create' && (call.args[0] as { path: string }).path === '/work')).toBe(true)
  })

  it('keeps the ledger, DOM, and store flat across open-close cycles', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    const baselineNodes = panel.container.querySelectorAll('*').length

    for (let cycle = 0; cycle < 10; cycle += 1) {
      act(() => {
        board.actions.openWindow(windowState({ id: `a${String(cycle)}` as WindowId }))
        board.actions.openWindow(windowState({
          id: `t${String(cycle)}` as WindowId, kind: 'connectors', bodyKind: 'connectors', ordinal: 2, customTitle: 'Tools',
        }))
      })
      await runtime.flush()
      act(() => {
        board.actions.closeWindow(`a${String(cycle)}` as WindowId)
        board.actions.closeWindow(`t${String(cycle)}` as WindowId)
      })
      await runtime.flush()
    }

    expect(board.store.getSnapshot().windows).toEqual({})
    expect(panel.container.querySelectorAll('[data-board-window]')).toHaveLength(0)
    expect(panel.container.querySelectorAll('*').length).toBe(baselineNodes)
    expect(runtime.slots.entriesOfSlot('board.canvas')).toHaveLength(1)
    expect(runtime.slots.entriesOfSlot('board.windows')).toHaveLength(1)
    expect(runtime.slots.entries('board.window')).toHaveLength(6)
    expect(runtime.slots.entries('board.window.body')).toHaveLength(7)
  })

  it('culls a window that leaves the visible canvas and keeps its draft', async () => {
    const prepared = await createBoardBench()
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    const created = await runtime.sessions.add({ id: 'session-1', summary: { cwd: '/work' } })
    runtime.sessions.stubCreate(async () => created)
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => {
      board.actions.setViewport(1200, 900)
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' }))
    })
    await runtime.flush()
    fireEvent.change(panel.container.querySelector('textarea') as Element, { target: { value: 'draft' } })

    act(() => { board.actions.setPan(-6000, -6000) })
    await runtime.flush()
    const frame = panel.container.querySelector('[data-board-window="agent"]') as HTMLElement
    expect(frame.getAttribute('data-board-culled')).toBe('')
    expect((panel.container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('draft')

    act(() => { board.actions.setPan(0, 0) })
    await runtime.flush()
    expect(frame.getAttribute('data-board-culled')).toBeNull()
    expect((panel.container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('draft')
  })

  it("keeps the active window's resize affordances above the floating chrome", async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, configurable: true, writable: true })

    act(() => {
      board.actions.setViewport(1200, 900)
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' }))
      board.actions.moveWindow('a1' as WindowId, 24, 200, false)
    })
    await runtime.flush()

    // The ring projects the window border into panel pixels: the eight handles
    // sit outside the frame, above the chrome (the board root renders it after
    // the layers). Sitting outside keeps the scaled header's controls clickable
    // at a zoomed-out canvas.
    const ring = panel.container.querySelector('[data-board-handle-ring]') as HTMLElement
    expect(ring).not.toBeNull()
    const handles = [...ring.querySelectorAll('[data-board-handle]')] as HTMLElement[]
    expect(handles.map(handle => handle.getAttribute('data-board-handle'))).toEqual([
      'n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se',
    ])
    const east = ring.querySelector('[data-board-handle="e"]') as HTMLElement
    expect(east.style.left).toBe('576px')
    expect(east.style.top).toBe('214px')
    const northWest = ring.querySelector('[data-board-handle="nw"]') as HTMLElement
    expect(northWest.style.left).toBe('10px')
    expect(northWest.style.top).toBe('186px')
    const rootChildren = [...(panel.container.querySelector('[data-surface="board"]') as HTMLElement).children]
    expect(rootChildren.indexOf(ring)).toBeGreaterThan(rootChildren.findIndex(node => node.getAttribute('data-board-layer') === 'dock'))

    // A ring handle resizes the window through the shared gesture (the drag is
    // snapped to the 24px grid: 552 + 40 lands on 600).
    fireEvent.pointerDown(east, { clientX: 585, pointerId: 9 })
    for (const [type, clientX] of [['pointermove', 625], ['pointerup', 625]] as const) {
      const event = new Event(type)
      Object.assign(event, { clientX, pointerId: 9 })
      window.dispatchEvent(event)
    }
    expect(board.store.getSnapshot().windows['a1']?.width).toBe(600)
    Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
  })

  it('swaps the detail chrome for the simplified card below the detail threshold (Д6.1)', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => {
      board.actions.setViewport(1200, 900)
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' }))
    })
    await runtime.flush()
    const frame = panel.container.querySelector('[data-board-window="agent"]') as HTMLElement
    // Detail mode at zoom 1: the card is absent, and the frame handles and
    // the header's panel controls are present.
    expect(frame.querySelector('[data-board-action="window-simplified-card"]')).toBeNull()
    expect(frame.querySelectorAll('[data-board-handle]')).toHaveLength(8)
    expect(frame.querySelector('[data-board-action="window-left-panel"]')).not.toBeNull()

    act(() => { board.actions.setZoom(0.3) })
    await runtime.flush()
    const card = frame.querySelector('[data-board-action="window-simplified-card"]') as HTMLElement
    expect(card).not.toBeNull()
    expect(card.textContent).toContain('Agent')
    expect(card.textContent).toContain('Idle')
    expect(card.getAttribute('data-board-status')).toBe('ready')
    // Type is world-sized for 12 screen pixels at the 0.4 threshold.
    expect(card.style.fontSize).toBe('30px')
    // The frame handles and the screen-space ring stand down with the chrome;
    // the header (and its panel controls) stays mounted but hidden.
    expect(frame.querySelectorAll('[data-board-handle]')).toHaveLength(0)
    expect(panel.container.querySelector('[data-board-handle-ring]')).toBeNull()

    // Clicking the card restores the detail view: the zoom rises to the
    // threshold and the window is centred.
    fireEvent.click(card)
    await runtime.flush()
    expect(board.store.getSnapshot().zoom).toBe(0.4)
    expect(frame.querySelector('[data-board-action="window-simplified-card"]')).toBeNull()
    expect(frame.querySelectorAll('[data-board-handle]')).toHaveLength(8)
  })

  it('publishes chrome contributions per declared edge and clears them on unmount (Д3.1)', async () => {
    const callbacks: Array<() => void> = []
    class FakeResizeObserver {
      constructor(callback: () => void) { callbacks.push(callback) }
      observe(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    try {
      const { runtime } = await bench()
      const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
      const board = runtime.storeOf('board.dock') as BoardInstance
      const root = panel.container.querySelector('[data-surface="board"]') as HTMLElement
      const dock = panel.container.querySelector('[data-board-layer="dock"]') as HTMLElement
      const minimap = panel.container.querySelector('[data-board-layer="minimap"]') as HTMLElement
      const badge = panel.container.querySelector('[data-board-layer="badge"]') as HTMLElement
      const box = (left: number, top: number, right: number, bottom: number) => ({
        left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}),
      })
      root.getBoundingClientRect = () => box(0, 0, 1000, 800)
      // The dock is a bottom strip; the minimap and the badge take the top.
      dock.getBoundingClientRect = () => box(300, 730, 700, 784)
      minimap.getBoundingClientRect = () => box(776, 24, 976, 164)
      badge.getBoundingClientRect = () => box(4, 18, 40, 46)

      // The observer signal re-measures the live boxes; each element takes only
      // its own edge.
      act(() => { for (const callback of callbacks) callback() })
      await runtime.flush()
      const sources = board.store.getSnapshot().chromeInsetSources
      const entries = Object.values(sources)
      expect(entries.map(entry => entry.edge).sort()).toEqual(['bottom', 'top', 'top'])
      expect(entries.find(entry => entry.edge === 'bottom')?.depth).toBe(70)
      expect(entries.filter(entry => entry.edge === 'top').map(entry => entry.depth).sort((a, b) => a - b))
        .toEqual([46, 164])

      // Opening a window panel stands the minimap down while the dock stays
      // (Т1.14): the minimap's contribution goes with its unmounted element,
      // and the dock and badge keep theirs.
      act(() => {
        board.actions.openWindow(windowState({ id: 'a1' as WindowId }))
        board.actions.setWindowPanel('a1' as WindowId, 'left', true)
      })
      await runtime.flush()
      const remaining = board.store.getSnapshot().chromeInsetSources
      const rest = Object.values(remaining)
      expect(rest.map(entry => entry.edge).sort()).toEqual(['bottom', 'top'])
      expect(rest.find(entry => entry.edge === 'bottom')?.depth).toBe(70)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('arms will-change only while a board gesture is live (Д6.2)', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, configurable: true, writable: true })
    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await runtime.flush()
    const root = panel.container.querySelector('[data-surface="board"]') as HTMLElement
    const surface = panel.container.querySelector('[data-surface="canvas"]') as Element
    expect(root.hasAttribute('data-board-gesture')).toBe(false)

    vi.useFakeTimers()
    try {
      fireEvent.pointerDown(surface, { pointerId: 21, clientX: 10, clientY: 10, button: 0 })
      expect(root.hasAttribute('data-board-gesture')).toBe(true)
      fireEvent.pointerUp(window, { pointerId: 21 })
      act(() => { vi.advanceTimersByTime(149) })
      expect(root.hasAttribute('data-board-gesture')).toBe(true)
      act(() => { vi.advanceTimersByTime(1) })
      expect(root.hasAttribute('data-board-gesture')).toBe(false)
    } finally {
      vi.useRealTimers()
      Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
    }
  })

  it('keeps the active window when the bare canvas is clicked', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, configurable: true, writable: true })

    act(() => {
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'First' }))
      board.actions.openWindow(windowState({ id: 'a2' as WindowId, customTitle: 'Second' }))
    })
    await runtime.flush()
    act(() => { board.actions.focusWindow('a1' as WindowId) })
    await runtime.flush()

    fireEvent.pointerDown(panel.container.querySelector('[data-surface="canvas"]') as Element, {
      pointerId: 5, clientX: 10, clientY: 10, button: 0,
    })
    fireEvent.pointerUp(window, { pointerId: 5 })
    await runtime.flush()

    // A panel or fullscreen mode keeps its owner: the empty-canvas click pans only.
    expect(board.store.getSnapshot().activeWindowId).toBe('a1')
    Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
  })

  it('gives Escape one action per press: the panel closes and the window never does', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' })) })
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('[data-board-action="window-left-panel"]') as Element)
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-panel-open]')).not.toBeNull()

    // First press: the panel.
    fireEvent.keyDown(document, { key: 'Escape' })
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-panel-open]')).toBeNull()
    expect(board.store.getSnapshot().windows['a1']).toBeDefined()
    expect(panel.container.querySelectorAll('[data-board-window="agent"]')).toHaveLength(1)

    // Second press: nothing left to take.
    const before = board.store.getSnapshot()
    fireEvent.keyDown(document, { key: 'Escape' })
    await runtime.flush()
    expect(board.store.getSnapshot().windows).toEqual(before.windows)
  })

  it('pans on a plain wheel, zooms on ctrl+wheel from the canvas and the chrome, and leaves the window its own wheel', async () => {
    const prepared = await createBoardBench()
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    const created = await runtime.sessions.add({ id: 'session-1', summary: { cwd: '/work' } })
    runtime.sessions.stubCreate(async () => created)
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' })) })
    await runtime.flush()

    // R-4 default: an unmodified wheel pans and leaves the scale alone.
    act(() => { board.actions.setPan(100, 100) })
    fireEvent.wheel(panel.container.querySelector('[data-surface="canvas"]') as Element, { deltaX: 40, deltaY: -100, clientX: 100, clientY: 100 })
    expect(board.store.getSnapshot().zoom).toBe(1)
    expect(board.store.getSnapshot().panX).toBe(60)
    expect(board.store.getSnapshot().panY).toBe(200)

    // Ctrl+wheel (a trackpad pinch) zooms around the pointer; Δ is clamped to
    // 50px, so the factor is exp(50 · 0.0023).
    fireEvent.wheel(panel.container.querySelector('[data-surface="canvas"]') as Element, { ctrlKey: true, deltaY: -100, clientX: 100, clientY: 100 })
    const zoomed = board.store.getSnapshot().zoom
    expect(zoomed).toBeCloseTo(Math.exp(50 * 0.0023))

    // A window lane keeps its own plain wheel: the lane scrolls, the view stays.
    const panBefore = board.store.getSnapshot().panX
    fireEvent.wheel(panel.container.querySelector('textarea') as Element, { deltaY: -100, clientX: 100, clientY: 100 })
    expect(board.store.getSnapshot().zoom).toBeCloseTo(zoomed)
    expect(board.store.getSnapshot().panX).toBe(panBefore)

    // A pinch (ctrl+wheel) over the lane zooms only the board (П-01).
    fireEvent.wheel(panel.container.querySelector('textarea') as Element, { ctrlKey: true, deltaY: -100, clientX: 100, clientY: 100 })
    expect(board.store.getSnapshot().zoom).toBeGreaterThan(zoomed)

    // The floating chrome sits beside the canvas: ctrl+wheel zooms it too.
    fireEvent.wheel(panel.container.querySelector('[data-board-layer="dock"] button') as Element, { ctrlKey: true, deltaY: -100, clientX: 40, clientY: 400 })
    expect(board.store.getSnapshot().zoom).toBeGreaterThan(zoomed)
  })

  it('applies Safari pinch gestures and ignores the duplicate ctrl+wheel mid-gesture', async () => {
    const prepared = await createBoardBench()
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    const created = await runtime.sessions.add({ id: 'session-1', summary: { cwd: '/work' } })
    runtime.sessions.stubCreate(async () => created)
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' })) })
    await runtime.flush()

    const root = panel.container.querySelector('[data-surface="board"]') as Element
    const canvas = panel.container.querySelector('[data-surface="canvas"]') as Element
    const gesture = (type: string, scale: number): Event => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.assign(event, { scale, clientX: 100, clientY: 100 })
      root.dispatchEvent(event)
      return event
    }

    expect(gesture('gesturestart', 1).defaultPrevented).toBe(true)
    expect(gesture('gesturechange', 1.5).defaultPrevented).toBe(true)
    expect(board.store.getSnapshot().zoom).toBeCloseTo(1.5)

    // One pinch reported twice: the ctrl+wheel spelling must not compound it.
    fireEvent.wheel(canvas, { ctrlKey: true, deltaY: -100, clientX: 100, clientY: 100 })
    expect(board.store.getSnapshot().zoom).toBeCloseTo(1.5)

    gesture('gestureend', 1.5)
    fireEvent.wheel(canvas, { ctrlKey: true, deltaY: -100, clientX: 100, clientY: 100 })
    expect(board.store.getSnapshot().zoom).toBeGreaterThan(1.5)
  })

  it('anchors a Safari pinch on the board root, not on the screen (П-04)', async () => {
    const prepared = await createBoardBench()
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    const created = await runtime.sessions.add({ id: 'session-1', summary: { cwd: '/work' } })
    runtime.sessions.stubCreate(async () => created)
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' })) })
    await runtime.flush()

    const root = panel.container.querySelector('[data-surface="board"]') as HTMLElement
    // An expanded app sidebar offsets the board root, exactly as on the stand:
    // screen and board coordinates differ by the root's box origin.
    root.getBoundingClientRect = () => new DOMRect(280, 40, 1000, 800)
    act(() => {
      board.actions.setZoom(1)
      board.actions.setPan(60, 30)
    })
    const clientX = 500
    const clientY = 300
    const before = board.store.getSnapshot()
    const worldX = (clientX - 280 - before.panX) / before.zoom
    const worldY = (clientY - 40 - before.panY) / before.zoom
    const gesture = (type: string, scale: number): Event => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.assign(event, { scale, clientX, clientY })
      root.dispatchEvent(event)
      return event
    }

    gesture('gesturestart', 1)
    gesture('gesturechange', 2)
    const after = board.store.getSnapshot()
    expect(after.zoom).toBeCloseTo(2)
    // The world point under the gesture stays fixed: the handler subtracts the
    // root box exactly as the wheel branch does.
    expect((clientX - 280 - after.panX) / after.zoom).toBeCloseTo(worldX)
    expect((clientY - 40 - after.panY) / after.zoom).toBeCloseTo(worldY)
    gesture('gestureend', 2)
  })

  it('handles Cmd+0, +=, and − only while the pointer or focus is on the board', async () => {
    const prepared = await createBoardBench()
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    const created = await runtime.sessions.add({ id: 'session-1', summary: { cwd: '/work' } })
    runtime.sessions.stubCreate(async () => created)
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' })) })
    await runtime.flush()
    const root = panel.container.querySelector('[data-surface="board"]') as Element

    // Outside the board (pointer not inside, nothing focused) the key is the browser's.
    act(() => {
      board.actions.setZoom(1.5)
      board.actions.setPan(20, 30)
    })
    fireEvent.keyDown(document, { key: '0', metaKey: true })
    expect(board.store.getSnapshot().zoom).toBe(1.5)

    // The pointer over the board engages the shortcuts: += steps the zoom up.
    fireEvent.pointerEnter(root)
    fireEvent.keyDown(document, { key: '=', metaKey: true })
    expect(board.store.getSnapshot().zoom).toBeCloseTo(1.5 * 1.25)

    // Focus inside the board engages them too, the pointer aside.
    fireEvent.pointerLeave(root)
    const editor = panel.container.querySelector('textarea') as HTMLTextAreaElement
    editor.focus()
    fireEvent.keyDown(document, { key: '0', metaKey: true })
    expect(board.store.getSnapshot().zoom).toBe(1)
    expect(board.store.getSnapshot().panX).toBe(0)
    editor.blur()
  })

  it('drags a frame header and resizes through a frame handle', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, configurable: true, writable: true })

    act(() => {
      board.actions.setViewport(1200, 900)
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' }))
    })
    await runtime.flush()
    const frame = panel.container.querySelector('[data-board-window="agent"]') as HTMLElement
    const before = board.store.getSnapshot().windows['a1'] as BoardWindowState

    // The header drag moves the window by the world delta (snapped to the grid).
    fireEvent.pointerDown(frame.querySelector('[class*="header"]') as Element, {
      pointerId: 11, clientX: 300, clientY: 100,
    })
    for (const [type, clientX, clientY] of [['pointermove', 360, 160], ['pointerup', 360, 160]] as const) {
      const event = new Event(type)
      Object.assign(event, { clientX, clientY, pointerId: 11 })
      window.dispatchEvent(event)
    }
    const moved = board.store.getSnapshot().windows['a1'] as BoardWindowState
    expect(moved.x).toBe(Math.round((before.x + 60) / 24) * 24)
    expect(moved.y).toBe(Math.round((before.y + 60) / 24) * 24)

    // The frame's east handle resizes exactly one axis through the shared gesture.
    fireEvent.pointerDown(frame.querySelector('[data-board-handle="e"]') as Element, {
      pointerId: 12, clientX: 500, clientY: 300,
    })
    for (const [type, clientX] of [['pointermove', 548], ['pointerup', 548]] as const) {
      const event = new Event(type)
      Object.assign(event, { clientX, pointerId: 12 })
      window.dispatchEvent(event)
    }
    const resized = board.store.getSnapshot().windows['a1'] as BoardWindowState
    expect(resized.width).toBe(moved.width + 48)
    expect(resized.height).toBe(moved.height)

    // At zoom 2 the same screen drag is half the world delta.
    act(() => { board.actions.setZoom(2) })
    await runtime.flush()
    const zoomed = board.store.getSnapshot().windows['a1'] as BoardWindowState
    fireEvent.pointerDown(frame.querySelector('[data-board-handle="e"]') as Element, {
      pointerId: 15, clientX: 500, clientY: 300,
    })
    for (const [type, clientX] of [['pointermove', 596], ['pointerup', 596]] as const) {
      const event = new Event(type)
      Object.assign(event, { clientX, pointerId: 15 })
      window.dispatchEvent(event)
    }
    expect((board.store.getSnapshot().windows['a1'] as BoardWindowState).width).toBe(zoomed.width + 48)
    act(() => { board.actions.setZoom(1) })
    await runtime.flush()

    // A south-east corner drag shrinks both axes independently (П-26).
    const corner = board.store.getSnapshot().windows['a1'] as BoardWindowState
    fireEvent.pointerDown(frame.querySelector('[data-board-handle="se"]') as Element, {
      pointerId: 16, clientX: 600, clientY: 400,
    })
    for (const [type, clientX, clientY] of [['pointermove', 500, 300], ['pointerup', 500, 300]] as const) {
      const event = new Event(type)
      Object.assign(event, { clientX, clientY, pointerId: 16 })
      window.dispatchEvent(event)
    }
    await runtime.flush()
    const shrunk = board.store.getSnapshot().windows['a1'] as BoardWindowState
    expect(shrunk.width).toBe(Math.round((corner.width - 100) / 24) * 24)
    expect(shrunk.height).toBe(Math.round((corner.height - 100) / 24) * 24)

    // Shift scales both axes even though the pointer only moved along x.
    fireEvent.pointerDown(frame.querySelector('[data-board-handle="se"]') as Element, {
      pointerId: 17, clientX: 600, clientY: 400,
    })
    for (const [type, clientX, clientY] of [['pointermove', 700, 400], ['pointerup', 700, 400]] as const) {
      const event = new Event(type)
      Object.assign(event, { clientX, clientY, pointerId: 17, shiftKey: true })
      window.dispatchEvent(event)
    }
    await runtime.flush()
    const scaled = board.store.getSnapshot().windows['a1'] as BoardWindowState
    expect(scaled.width).toBe(Math.round((shrunk.width + 100) / 24) * 24)
    expect(scaled.height).toBeGreaterThan(shrunk.height)
    expect(scaled.width / scaled.height).toBeCloseTo(shrunk.width / shrunk.height, 1)

    // Alt releases the grid snap: the axis follows the pointer exactly.
    fireEvent.pointerDown(frame.querySelector('[data-board-handle="e"]') as Element, {
      pointerId: 18, clientX: 500, clientY: 300,
    })
    for (const [type, clientX] of [['pointermove', 525], ['pointerup', 525]] as const) {
      const event = new Event(type)
      Object.assign(event, { clientX, pointerId: 18, altKey: true })
      window.dispatchEvent(event)
    }
    await runtime.flush()
    expect((board.store.getSnapshot().windows['a1'] as BoardWindowState).width).toBe(scaled.width + 25)

    // A header button keeps its own gesture: the drag stands down for it.
    fireEvent.pointerDown(frame.querySelector('button[aria-label="Close"]') as Element, {
      pointerId: 13, clientX: 10, clientY: 10,
    })
    expect(board.store.getSnapshot().windows['a1']).toBeDefined()

    Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
  })

  it('pans with Space over the chrome and over a window, and with the middle button on the ring', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, configurable: true, writable: true })

    act(() => {
      board.actions.setViewport(1200, 900)
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' }))
    })
    await runtime.flush()
    const root = panel.container.querySelector('[data-surface="board"]') as HTMLElement
    const dock = panel.container.querySelector('[data-board-layer="dock"]') as HTMLElement

    const drag = (
      target: Element,
      pointerId: number,
      button: number,
      from: { x: number; y: number },
      to: { x: number; y: number },
    ) => {
      fireEvent.pointerDown(target, { pointerId, button, clientX: from.x, clientY: from.y })
      for (const type of ['pointermove', 'pointerup'] as const) {
        const event = new Event(type)
        Object.assign(event, { clientX: to.x, clientY: to.y, pointerId, button })
        window.dispatchEvent(event)
      }
    }

    // Space arms from the root, so the floating chrome pans too.
    fireEvent.pointerEnter(root)
    fireEvent.keyDown(window, { code: 'Space' })
    drag(dock, 41, 0, { x: 300, y: 400 }, { x: 360, y: 440 })
    expect(board.store.getSnapshot().panX).toBe(60)
    fireEvent.keyUp(window, { code: 'Space' })

    // A middle-button drag on a ring handle pans instead of resizing.
    const before = board.store.getSnapshot()
    drag(panel.container.querySelector('[data-board-handle-ring] [data-board-handle="e"]') as Element, 42, 1, { x: 500, y: 300 }, { x: 540, y: 320 })
    expect(board.store.getSnapshot().panX).toBe(before.panX + 40)
    expect(board.store.getSnapshot().windows['a1']?.width).toBe(before.windows['a1']?.width)
    Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
  })

  it('gives Escape one action per press across the menu, selection overlay, and chats panel', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' })) })
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('[data-board-action="window-left-panel"]') as Element)
    // A menu opened before the overlay still owns the first press; the overlay
    // itself would claim a click made while it is up (that is its pick). The
    // panel stands the floating chrome down, so the menu here is the window
    // composer's own action menu.
    fireEvent.click(panel.container.querySelector('[data-board-action="composer-actions"]') as Element)
    await runtime.flush()
    act(() => { board.actions.setSelectingElement(true) })
    await runtime.flush()
    expect(panel.container.querySelector('[class*="overlay"]')).not.toBeNull()
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    await runtime.flush()
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(board.store.getSnapshot().isSelectingElement).toBe(true)
    expect(board.store.getSnapshot().windows['a1']?.leftPanelOpen).toBe(true)

    // Next press: the selection mode, and only it.
    fireEvent.keyDown(document, { key: 'Escape' })
    await runtime.flush()
    expect(board.store.getSnapshot().isSelectingElement).toBe(false)
    expect(board.store.getSnapshot().windows['a1']?.leftPanelOpen).toBe(true)

    // Next press: the panel, and only it.
    fireEvent.keyDown(document, { key: 'Escape' })
    await runtime.flush()
    expect(board.store.getSnapshot().windows['a1']?.leftPanelOpen).toBe(false)
    expect(board.store.getSnapshot().windows['a1']).toBeDefined()
  })

  it('lets the palette keep Escape while the chats panel is open', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('[data-board-action="window-left-panel"]') as Element)
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-panel][data-board-panel-open]')).not.toBeNull()

    const input = panel.container.querySelector('textarea') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '/fi' } })
    const row = panel.container.querySelector('[role="listbox"] [role="option"]') as Element
    expect(row).not.toBeNull()
    fireEvent.keyDown(row, { key: 'Escape' })
    await runtime.flush()

    // Escape dismissed the palette only: the chats panel is still open.
    expect(panel.container.querySelector('[role="listbox"]')).toBeNull()
    expect(panel.container.querySelector('[data-board-panel][data-board-panel-open]')).not.toBeNull()
    expect(input.value).toBe('/fi')
  })

  it('brings the minimap back when the chats panel collapses', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => {
      board.actions.setViewport(1200, 900)
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' }))
    })
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('[data-board-action="window-left-panel"]') as Element)
    await runtime.flush()
    // The expanded panel is a management surface: the minimap stands down
    // while the bottom dock stays (Т1.14).
    expect(panel.container.querySelectorAll('[data-board-layer="dock"]')).toHaveLength(1)
    expect(panel.container.querySelectorAll('[data-board-layer="minimap"]')).toHaveLength(0)

    fireEvent.click(panel.container.querySelector('[data-board-action="panel-collapse"]') as Element)
    await runtime.flush()
    expect(panel.container.querySelectorAll('[data-board-layer="dock"]')).toHaveLength(1)
    expect(panel.container.querySelectorAll('[data-board-layer="minimap"]')).toHaveLength(1)
    expect(panel.container.querySelector('[data-board-panel-open]')).toBeNull()

    // In fullscreen a collapsed panel takes no Escape: the mode leaves at once.
    fireEvent.click(panel.container.querySelector('button[aria-label="Open fullscreen"]') as Element)
    await runtime.flush()
    fireEvent.keyDown(document, { key: 'Escape' })
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-fullscreen]')).toBeNull()
  })

  it('commits a panel row reorder only on a completed drag', async () => {
    const prepared = await createBoardBench()
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    await runtime.workspaces.update((draft) => {
      draft.items = [1, 2, 3].map(n => ({
        workspaceId: `ws-${String(n)}` as never,
        path: `/work/${String(n)}`,
        title: `P${String(n)}`,
        sessionIds: [`chat-${String(n)}` as never],
        createdAt: '2026-09-16T00:00:00.000Z',
        updatedAt: '2026-09-16T00:00:00.000Z',
      }))
    })
    for (const n of [1, 2, 3]) {
      await runtime.sessions.add({ id: `chat-${String(n)}`, summary: { displayTitle: `C${String(n)}`, cwd: `/work/${String(n)}` } })
    }
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' })) })
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('[data-board-action="window-left-panel"]') as Element)
    await runtime.flush()

    const rows = [...panel.container.querySelectorAll('[data-row-key^="project:"]')] as HTMLElement[]
    const from = rows[0] as HTMLElement
    const to = rows[2] as HTMLElement
    // jsdom lays nothing out, so the gesture carries its own coordinates: the
    // target row comes from the patched hit test.
    Object.defineProperty(document, 'elementFromPoint', { value: () => to, configurable: true })
    const gesture = (lastType: 'pointerup' | 'pointercancel') => {
      fireEvent.pointerDown(from, { pointerId: 51, clientX: 10, clientY: 10 })
      for (const type of ['pointermove', lastType] as const) {
        const event = new Event(type)
        Object.assign(event, { clientX: 10, clientY: 90, pointerId: 51 })
        window.dispatchEvent(event)
      }
    }

    // An aborted drag (pointercancel) leaves the order alone.
    gesture('pointercancel')
    expect(runtime.workspaces.calls.some(call => call.method === 'insertBefore')).toBe(false)

    // A completed drag commits through the same service the menu uses.
    gesture('pointerup')
    expect(runtime.workspaces.calls.some(call => call.method === 'insertBefore')).toBe(true)
    // Drop the own property so the prototype's implementation is visible again.
    Reflect.deleteProperty(document, 'elementFromPoint')
  })

  it('ends every frame gesture when its window closes mid-drag', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, configurable: true, writable: true })
    const move = vi.fn(board.actions.moveWindow)
    board.actions.moveWindow = move
    const resize = vi.fn(board.actions.resizeWindow)
    board.actions.resizeWindow = resize

    const open = async (id: string, title: string) => {
      act(() => { board.actions.openWindow(windowState({ id: id as WindowId, customTitle: title })) })
      await runtime.flush()
      return panel.container.querySelector(`[data-board-window-id="${id}"]`) as HTMLElement
    }
    /** Start a drag and hand back its move step. */
    const start = (target: Element, pointerId: number) => {
      fireEvent.pointerDown(target, { pointerId, clientX: 100, clientY: 100 })
      return (x: number, y: number) => {
        const event = new Event('pointermove')
        Object.assign(event, { clientX: x, clientY: y, pointerId })
        window.dispatchEvent(event)
      }
    }
    const close = async (frame: HTMLElement) => {
      fireEvent.click(frame.querySelector('button[aria-label="Close"]') as Element)
      await runtime.flush()
    }

    // Header drag.
    let frame = await open('a1', 'Agent 1')
    let step = start(frame.querySelector('[class*="header"]') as Element, 61)
    step(200, 200)
    expect(move).toHaveBeenCalledTimes(1)
    await close(frame)
    step(300, 300)
    expect(move).toHaveBeenCalledTimes(1)

    // Frame handle.
    frame = await open('a2', 'Agent 2')
    step = start(frame.querySelector('[data-board-handle="e"]') as Element, 62)
    step(200, 100)
    expect(resize).toHaveBeenCalled()
    const resizesBeforeClose = resize.mock.calls.length
    await close(frame)
    step(300, 100)
    expect(resize.mock.calls.length).toBe(resizesBeforeClose)

    // Ring handle of the active window.
    frame = await open('a3', 'Agent 3')
    const ring = panel.container.querySelector('[data-board-handle-ring] [data-board-handle="e"]') as Element
    step = start(ring, 63)
    step(200, 100)
    expect(resize.mock.calls.length).toBeGreaterThan(resizesBeforeClose)
    const resizesBeforeRingClose = resize.mock.calls.length
    await close(frame)
    step(300, 100)
    expect(resize.mock.calls.length).toBe(resizesBeforeRingClose)
    Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
  })

  it('ends every panel gesture when its window closes mid-drag', async () => {
    const prepared = await createBoardBench()
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    await runtime.workspaces.update((draft) => {
      draft.items = [1, 2].map(n => ({
        workspaceId: `ws-${String(n)}` as never,
        path: `/work/${String(n)}`,
        title: `P${String(n)}`,
        sessionIds: [`chat-${String(n)}` as never],
        createdAt: '2026-09-16T00:00:00.000Z',
        updatedAt: '2026-09-16T00:00:00.000Z',
      }))
    })
    for (const n of [1, 2]) {
      await runtime.sessions.add({ id: `chat-${String(n)}`, summary: { displayTitle: `C${String(n)}`, cwd: `/work/${String(n)}` } })
    }
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, configurable: true, writable: true })
    act(() => {
      board.actions.setViewport(1200, 900)
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' }))
    })
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('[data-board-action="window-left-panel"]') as Element)
    await runtime.flush()
    const windowFrame = panel.container.querySelector('[data-board-window-id="a1"]') as HTMLElement

    const step = (pointerId: number, x: number, y: number) => {
      const event = new Event('pointermove')
      Object.assign(event, { clientX: x, clientY: y, pointerId })
      window.dispatchEvent(event)
    }

    // Panel resize.
    const setWidth = vi.fn(board.actions.setWindowPanelWidth)
    board.actions.setWindowPanelWidth = setWidth
    fireEvent.pointerDown(panel.container.querySelector('[aria-label="Resize the chats panel"]') as Element, {
      pointerId: 71, clientX: 200, clientY: 300,
    })
    step(71, 160, 300)
    expect(setWidth).toHaveBeenCalled()
    const widthCalls = setWidth.mock.calls.length
    fireEvent.click(windowFrame.querySelector('button[aria-label="Close"]') as Element)
    await runtime.flush()
    step(71, 120, 300)
    expect(setWidth.mock.calls.length).toBe(widthCalls)

    // Row drag: a pointerup after the window closed must not commit.
    act(() => { board.actions.openWindow(windowState({ id: 'a2' as WindowId, customTitle: 'Agent 2' })) })
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('[data-board-action="window-left-panel"]') as Element)
    await runtime.flush()
    const rows = [...panel.container.querySelectorAll('[data-row-key^="project:"]')] as HTMLElement[]
    Object.defineProperty(document, 'elementFromPoint', { value: () => rows[1], configurable: true })
    fireEvent.pointerDown(rows[0] as Element, { pointerId: 72, clientX: 10, clientY: 10 })
    step(72, 10, 90)
    fireEvent.click(panel.container.querySelector('[data-board-window-id="a2"] button[aria-label="Close"]') as Element)
    await runtime.flush()
    const up = new Event('pointerup')
    Object.assign(up, { clientX: 10, clientY: 90, pointerId: 72 })
    window.dispatchEvent(up)
    expect(runtime.workspaces.calls.some(call => call.method === 'insertBefore')).toBe(false)
    Reflect.deleteProperty(document, 'elementFromPoint')
    Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
  })

  it('marks the focused window in the dock and on the minimap alike', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    act(() => {
      board.actions.setViewport(1200, 900)
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'First' }))
      board.actions.openWindow(windowState({ id: 'a2' as WindowId, customTitle: 'Second' }))
    })
    await runtime.flush()
    const dockRowOf = (title: string) =>
      panel.container.querySelector(`[data-board-layer="dock"] [data-board-action="dock-row"][data-board-title="${title}"]`) as HTMLElement
    const minimapRects = () => [...panel.container.querySelectorAll('[data-board-layer="minimap"] rect[class*="rect"]')]
    // The stylesheets define both classes; a rename must fail the test loudly.
    const railActive = railCss.active as string
    const minimapActive = minimapCss.active as string

    act(() => { board.actions.focusWindow('a1' as WindowId) })
    await runtime.flush()
    expect(dockRowOf('First').classList.contains(railActive)).toBe(true)
    expect(dockRowOf('Second').classList.contains(railActive)).toBe(false)
    expect(minimapRects()[0]?.classList.contains(minimapActive)).toBe(true)
    expect(minimapRects()[1]?.classList.contains(minimapActive)).toBe(false)

    act(() => { board.actions.focusWindow('a2' as WindowId) })
    await runtime.flush()
    expect(dockRowOf('Second').classList.contains(railActive)).toBe(true)
    expect(minimapRects()[1]?.classList.contains(minimapActive)).toBe(true)
  })

  it('keeps the panel level, its search, and the lane across culling', async () => {
    const prepared = await createBoardBench()
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    await runtime.workspaces.update((draft) => {
      draft.items = [{
        workspaceId: 'ws-1' as never,
        path: '/work/one',
        title: 'One',
        sessionIds: ['chat-1' as never],
        createdAt: '2026-09-16T00:00:00.000Z',
        updatedAt: '2026-09-16T00:00:00.000Z',
      }]
    })
    const created = await runtime.sessions.add({ id: 'chat-1', summary: { displayTitle: 'Chat one', cwd: '/work/one' } })
    runtime.sessions.stubCreate(async () => created)
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    const userNode: ConversationNode = {
      kind: 'user',
      seq: 1,
      time: 0,
      content: [{ type: 'text', text: 'сообщение в ленте' }],
      source: undefined,
    }

    act(() => {
      board.actions.setViewport(1200, 900)
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' }))
    })
    await runtime.flush()
    prepared.chat.set(chatSnapshot([userNode]))
    await runtime.flush()
    expect(panel.container.textContent).toContain('сообщение в ленте')

    // Panel state: the projects level with an active search filter.
    fireEvent.click(panel.container.querySelector('[data-board-action="window-left-panel"]') as Element)
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('button[aria-label="Search chats"]') as Element)
    const search = panel.container.querySelector('[data-board-row-edit="search"] input') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'One' } })
    await runtime.flush()

    act(() => { board.actions.setPan(-6000, -6000) })
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-panel][data-board-culled]')).not.toBeNull()
    act(() => { board.actions.setPan(0, 0) })
    await runtime.flush()
    expect((panel.container.querySelector('[data-board-row-edit="search"] input') as HTMLInputElement).value).toBe('One')
    expect(panel.container.textContent).toContain('сообщение в ленте')

    // The chats level survives a culling round trip too; the window session's
    // folder opened with the panel.
    expect(panel.container.textContent).toContain('Chat one')
    act(() => { board.actions.setPan(-6000, -6000) })
    await runtime.flush()
    act(() => { board.actions.setPan(0, 0) })
    await runtime.flush()
    expect(panel.container.textContent).toContain('Chat one')
  })

  it('re-applies without duplicating registrations and renders again', async () => {
    const { runtime, board, mountBoard } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    await board.dispose()
    // The first mount's DOM must be gone before the rebuild, or the render assertion below is stale.
    await vi.waitFor(() => {
      expect(panel.container.querySelector('[data-surface="canvas"]')).toBeNull()
    })

    const second = await mountBoard()
    try {
      expect(runtime.slots.entries('main').map(entry => entry.options.key)).toEqual(['board'])
      expect(runtime.slots.entriesOfSlot('board.canvas')).toHaveLength(1)
      expect(runtime.slots.entriesOfSlot('board.windows')).toHaveLength(1)
      expect(runtime.slots.entries('board.window')).toHaveLength(6)
      expect(runtime.slots.entries('board.window.body')).toHaveLength(7)
      await vi.waitFor(() => {
        expect(panel.container.querySelector('[data-surface="canvas"]')).not.toBeNull()
      })
    } finally {
      await second.dispose()
    }
  })

  it('navigates to the main panel for a pending approval and brings the window forward on return', async () => {
    const openSession = vi.fn()
    const prepared = await createBoardBench({ uiWorkspace: { openSession } })
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    const created = await runtime.sessions.add({ id: 'session-1' })
    runtime.sessions.stubCreate(async () => created)
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    act(() => { board.actions.setViewport(1600, 900) })
    act(() => {
      board.actions.addWindow({
        ...windowState({ id: 'a1' as WindowId }),
        x: 3000,
        y: 2000,
        zIndex: 10,
      })
    })
    await runtime.flush()
    // The window owns a session by now, so the pending flag has a session to target.
    const registerPending = runtime.ctx.uiSession.registerPendingInteraction<{
      readonly key: string
      readonly kind: string
      readonly sessionId: SessionId
    }>(() => 0)
    const releasePending = registerPending(
      { key: 'approval:1', kind: 'approval', sessionId: created },
      async () => {},
    )
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-pending="approval"]')).not.toBeNull()
    fireEvent.click(panel.view.getByText('Open in the main panel'))
    await runtime.flush()

    // The main panel shows the session, and the board remembers the window.
    expect(openSession).toHaveBeenCalledWith(created)
    expect(board.getSnapshot().returnWindowId).toBe('a1')

    // The board panel comes back: the window is centred, active, and highlighted.
    act(() => { runtime.panelInfo.set({ activePanelId: null }) })
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD_PANEL_ID }) })
    await runtime.flush()
    expect(board.getSnapshot().returnWindowId).toBeNull()
    expect(board.getSnapshot().highlightWindowId).toBe('a1')
    expect(board.getSnapshot().activeWindowId).toBe('a1')
    // Centre of a 552x648 window at (3000, 2000) inside a 1600x900 viewport.
    expect(board.getSnapshot().panX).toBe(-(3000 + 552 / 2 - 1600 / 2))
    expect(board.getSnapshot().panY).toBe(-(2000 + 648 / 2 - 900 / 2))
    releasePending()
  })

  it('withdraws every board contribution with the plugin fiber', async () => {
    const { runtime, board } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const instance = runtime.storeOf('board.dock') as BoardInstance

    act(() => { instance.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await runtime.flush()
    // The window and its layer exist before disposal, so the withdrawal cannot pass vacuously.
    expect(panel.container.querySelectorAll('[data-board-window]')).toHaveLength(1)
    expect(runtime.slots.entriesOfSlot('board.window')).toHaveLength(6)

    await board.dispose()

    for (const key of [
      'board.window', 'board.window.body', 'board.windows', 'board.canvas',
      'board.dock', 'board.minimap', 'sidebar.brand.actions', 'main',
    ] as const) {
      expect(runtime.slots.entries(key)).toEqual([])
    }
    expect(runtime.slots.entriesOfSlot('board.window')).toEqual([])
    // The layers the panel entry declared collapse with it.
    expect(runtime.slots.spec('board.canvas')).toBeUndefined()
    expect(runtime.slots.spec('board.windows')).toBeUndefined()
    await vi.waitFor(() => {
      expect(panel.container.querySelectorAll('[data-board-window]')).toHaveLength(0)
      expect(panel.container.querySelector('[data-surface="canvas"]')).toBeNull()
    })
  })
})
