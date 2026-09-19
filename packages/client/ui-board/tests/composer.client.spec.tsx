// @vitest-environment jsdom
/**
 * Window composer: blocked and running states, attachment limits, file uploads,
 * drag-and-drop and paste intake, the slash-command execution path with
 * arguments, the `@` mention menu, and the full-access risk gate. The component
 * renders from injected props only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { ComposerBar, type ComposerBarProps } from '../src/client/window/ComposerBar.tsx'
import { createBoardStore, type BoardState } from '../src/client/store.ts'
import type { BoardWindowInjectProps, BoardWindowSessionState, WindowId } from '../src/client/contract/slots.ts'
import { sessionState, t } from './fixtures.client.ts'

afterEach(() => { cleanup() })

const WINDOW = 'a1' as WindowId

const IMAGE_LIMITS = {
  maxImageBytes: 1024,
  maxImagesPerMessage: 2,
  maxMessageImageBytes: 1500,
  mediaTypes: ['image/png', 'image/jpeg'],
}

/** Injected-callback stub with every member the composer may call. */
function injectedStub(overrides: Partial<BoardWindowInjectProps> = {}): Omit<BoardWindowInjectProps, 'useWindowSession'> {
  return {
    keyedHooks: { windowSession: () => undefined },
    hooks: {},
    ensureWindowSession: vi.fn(),
    releaseWindow: vi.fn(),
    sendPrompt: vi.fn(async () => true),
    cancelPrompt: vi.fn(),
    loadOlderTurns: vi.fn(),
    bindSession: vi.fn(),
    createChat: vi.fn(),
    startChat: vi.fn(),
    renameChat: vi.fn(),
    forkChat: vi.fn(),
    archiveChat: vi.fn(),
    reorderChat: vi.fn(),
    createWorkspace: vi.fn(),
    renameWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    reorderWorkspace: vi.fn(),
    listDirectory: vi.fn(),
    createDirectory: vi.fn(),
    pickDirectory: vi.fn(),
    selectAgentPreset: vi.fn(),
    selectPermission: vi.fn(),
    selectModel: vi.fn(),
    exitPlanMode: vi.fn(),
    runCommand: vi.fn(),
    executeCommand: vi.fn(),
    uploadFile: vi.fn(),
    updateQueueItem: vi.fn(),
    loadQueueImage: vi.fn(async () => ''),
    goalAction: vi.fn(),
    loadMentions: vi.fn(async () => []),
    ...overrides,
  } as unknown as Omit<BoardWindowInjectProps, 'useWindowSession'>
}

function renderComposer(
  session: BoardWindowSessionState,
  overrides: Partial<BoardWindowInjectProps> = {},
  onSent = vi.fn(),
) {
  const injected = injectedStub(overrides)
  const instance = createBoardStore().create()
  const props = {
    windowId: WINDOW,
    session,
    t,
    injected,
    onSent,
    actions: instance.actions,
    useStore: <S,>(selector: (state: BoardState) => S): S =>
      useSyncExternalStore(
        onChange => instance.subscribe(onChange),
        () => selector(instance.getSnapshot()),
      ),
  } as unknown as ComposerBarProps
  const utils = render(<ComposerBar {...props} />)
  return { ...utils, injected, onSent, instance }
}

const textarea = (container: HTMLElement): HTMLTextAreaElement =>
  container.querySelector('textarea') as HTMLTextAreaElement

const fileInput = (container: HTMLElement): HTMLInputElement =>
  container.querySelector('input[type="file"]') as HTMLInputElement

const imageFile = (name: string, bytes: number, type = 'image/png'): File =>
  new File([new Uint8Array(bytes)], name, { type })

describe('ComposerBar states', () => {
  it('shows the block with its reason and keeps the send control inert', () => {
    const { container, getByText } = renderComposer(sessionState(undefined, { blocked: 'This model is unavailable' }))
    expect(getByText(/Composer is blocked/)).not.toBeNull()
    expect(getByText(/This model is unavailable/)).not.toBeNull()
    expect(container.querySelector('[data-board-blocked]')).not.toBeNull()

    fireEvent.change(textarea(container), { target: { value: 'текст' } })
    expect((container.querySelector('button[aria-label="Send"]') as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps the send control disabled on an empty draft and enables it with text', () => {
    const { container } = renderComposer(sessionState(undefined))
    const send = container.querySelector('button[aria-label="Send"]') as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.change(textarea(container), { target: { value: 'привет' } })
    expect(send.disabled).toBe(false)
  })

  it('gates the full-access preset behind the risk confirmation', () => {
    const selectPermission = vi.fn()
    const { container, getByText } = renderComposer(
      sessionState(undefined, {
        permission: 'workspace-write',
        permissions: [
          { id: 'read-only', dangerous: false },
          { id: 'danger-full-access', dangerous: true },
        ],
      }),
      { selectPermission },
    )
    fireEvent.click(container.querySelector('button[aria-label="Permission preset"]') as Element)
    fireEvent.click(getByText('Full access'))
    expect(getByText('Enable Full access?')).not.toBeNull()
    expect(selectPermission).not.toHaveBeenCalled()

    // The dialog is portalled out of the composer subtree.
    fireEvent.click(document.querySelector('input[type="checkbox"]') as Element)
    fireEvent.click(getByText('Enable Full access'))
    expect(selectPermission).toHaveBeenCalledWith(WINDOW, 'danger-full-access')
  })
})

describe('ComposerBar attachments', () => {
  it('refuses an image batch over the projected count limit', () => {
    const { container, getByText } = renderComposer(
      sessionState(undefined, { imageLimits: { ...IMAGE_LIMITS, maxImagesPerMessage: 1 } }),
    )
    fireEvent.change(fileInput(container), { target: { files: [imageFile('a.png', 10), imageFile('b.png', 10)] } })
    expect(getByText('A message can include up to 1 images')).not.toBeNull()
    expect(container.querySelectorAll('img').length).toBe(0)
  })

  it('refuses an oversized image and an over-budget batch', () => {
    const { container, getByText } = renderComposer(sessionState(undefined, { imageLimits: IMAGE_LIMITS }))
    fireEvent.change(fileInput(container), { target: { files: [imageFile('big.png', 4096)] } })
    expect(getByText(/Each image must be smaller than 1 KB/)).not.toBeNull()

    fireEvent.change(fileInput(container), { target: { files: [imageFile('a.png', 1000), imageFile('b.png', 1000)] } })
    expect(getByText(/Images exceed 1.5 KB in total/)).not.toBeNull()
  })

  it('accepts an image within the limits and sends it inline', async () => {
    const sendPrompt = vi.fn(async () => true)
    const { container } = renderComposer(
      sessionState(undefined, { imageLimits: IMAGE_LIMITS }),
      { sendPrompt },
    )
    fireEvent.change(fileInput(container), { target: { files: [imageFile('shot.png', 100)] } })
    await waitFor(() => { expect(container.querySelectorAll('img').length).toBe(1) })

    fireEvent.change(textarea(container), { target: { value: 'посмотри' } })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    expect(sendPrompt).toHaveBeenCalledOnce()
    const [windowId, text, mode, images, files] = (sendPrompt.mock.calls[0] ?? []) as unknown as [
      string, string, string, readonly { name: string }[], readonly string[],
    ]
    expect(windowId).toBe(WINDOW)
    expect(text).toBe('посмотри')
    expect(mode).toBe('queue')
    expect(images).toHaveLength(1)
    expect(images[0]?.name).toBe('shot.png')
    expect(files).toEqual([])
  })

  it('stages a non-image file and sends its receipt', async () => {
    const uploadFile = vi.fn(async () => ({ receiptId: 'receipt-7' }))
    const sendPrompt = vi.fn(async () => true)
    const { container, getByText } = renderComposer(sessionState(undefined), { uploadFile, sendPrompt })

    fireEvent.change(fileInput(container), { target: { files: [new File(['отчёт'], 'report.pdf', { type: 'application/pdf' })] } })
    await waitFor(() => { expect(getByText('Ready')).not.toBeNull() })
    expect(uploadFile).toHaveBeenCalledOnce()
    const uploadCall = uploadFile.mock.calls[0] as unknown as [unknown, unknown]
    expect(uploadCall[0]).toBe(WINDOW)
    expect(uploadCall[1]).toBe('report.pdf')

    fireEvent.change(textarea(container), { target: { value: 'смотри файл' } })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    expect(sendPrompt).toHaveBeenCalledWith(
      WINDOW, 'смотри файл', 'queue', [], [{ receiptId: 'receipt-7' }], expect.any(AbortSignal),
    )
  })

  it('shows an upload failure and retries it into ready', async () => {
    const uploadFile = vi.fn()
      .mockResolvedValueOnce({ error: 'route down' })
      .mockResolvedValueOnce({ receiptId: 'receipt-9' })
    const { container, getByText } = renderComposer(sessionState(undefined), { uploadFile })

    fireEvent.change(fileInput(container), { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } })
    await waitFor(() => { expect(container.querySelector('[data-board-file="error"]')).not.toBeNull() })

    fireEvent.click(getByText('Retry'))
    await waitFor(() => { expect(container.querySelector('[data-board-file="ready"]')).not.toBeNull() })
    expect(uploadFile).toHaveBeenCalledTimes(2)
    // The successful retry dropped the previous attempt's failure text.
    expect(container.querySelector('[data-board-file="ready"]')?.getAttribute('title')).toBeNull()
  })

  it('reports an unavailable upload service', async () => {
    const uploadFile = vi.fn(async () => ({ error: 'File uploads are unavailable on this host' }))
    const { container, getByText } = renderComposer(sessionState(undefined), { uploadFile })
    fireEvent.change(fileInput(container), { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } })
    await waitFor(() => { expect(getByText('Upload failed')).not.toBeNull() })
  })

  it('refuses drop and picker intake while the composer is blocked', () => {
    const uploadFile = vi.fn(async () => ({ receiptId: 'receipt-4' }))
    const { container } = renderComposer(sessionState(undefined, { blocked: 'This model is unavailable' }), { uploadFile })
    const wrapper = container.firstElementChild as HTMLElement
    const dataTransfer = { types: ['Files'], files: [new File(['x'], 'drop.txt', { type: 'text/plain' })], dropEffect: 'none' }

    fireEvent.dragEnter(wrapper, { dataTransfer })
    expect(container.querySelector('[data-board-drop-hint]')).toBeNull()
    fireEvent.drop(wrapper, { dataTransfer })
    expect(uploadFile).not.toHaveBeenCalled()

    const picker = fileInput(container)
    expect(picker.disabled).toBe(true)
    const click = vi.spyOn(picker, 'click').mockImplementation(() => {})
    fireEvent.click(container.querySelector('[data-board-action="composer-actions"]') as Element)
    fireEvent.click(document.querySelector('[role="menu"] [role="menuitem"]') as Element)
    expect(click).not.toHaveBeenCalled()
    click.mockRestore()
  })

  it('shows the drop hint and accepts a dropped batch', async () => {
    const uploadFile = vi.fn(async () => ({ receiptId: 'receipt-2' }))
    const { container } = renderComposer(sessionState(undefined), { uploadFile })
    const wrapper = container.firstElementChild as HTMLElement
    const dataTransfer = { types: ['Files'], files: [new File(['x'], 'drop.txt', { type: 'text/plain' })], dropEffect: 'none' }

    fireEvent.dragEnter(wrapper, { dataTransfer })
    expect(container.querySelector('[data-board-drop-hint]')).not.toBeNull()

    fireEvent.drop(wrapper, { dataTransfer })
    await waitFor(() => { expect(container.querySelector('[data-board-file="ready"]')).not.toBeNull() })
    expect(container.querySelector('[data-board-drop-hint]')).toBeNull()
  })

  it('accepts pasted files while leaving plain text to the editor', async () => {
    const uploadFile = vi.fn(async () => ({ receiptId: 'receipt-3' }))
    const { container } = renderComposer(sessionState(undefined), { uploadFile })
    const input = textarea(container)

    fireEvent.paste(input, { clipboardData: { items: [], getData: () => 'вставленный текст' } })
    expect(uploadFile).not.toHaveBeenCalled()

    fireEvent.paste(input, {
      clipboardData: {
        items: [{ kind: 'file', getAsFile: () => new File(['x'], 'paste.txt', { type: 'text/plain' }) }],
        getData: () => '',
      },
    })
    await waitFor(() => { expect(container.querySelector('[data-board-file="ready"]')).not.toBeNull() })
  })
})

describe('ComposerBar composer intents', () => {
  it('appends a queued text intent to an empty and a filled draft, consuming it', () => {
    const { container, instance } = renderComposer(sessionState(undefined))
    const input = textarea(container)

    act(() => {
      instance.actions.pushComposerIntent(WINDOW, { text: 'Board element: x | selector: y' })
    })
    expect(input.value).toBe('Board element: x | selector: y')
    expect(instance.getSnapshot().composerIntents).toHaveLength(0)

    fireEvent.change(input, { target: { value: 'existing' } })
    act(() => {
      instance.actions.pushComposerIntent(WINDOW, { text: 'Board element: z' })
    })
    expect(input.value).toBe('existing Board element: z')
    expect(instance.getSnapshot().composerIntents).toHaveLength(0)
  })

  it('ignores and keeps an intent addressed to another window', () => {
    const { container, instance } = renderComposer(sessionState(undefined))
    act(() => {
      instance.actions.pushComposerIntent('b2' as WindowId, { text: 'other window' })
    })
    expect(textarea(container).value).toBe('')
    expect(instance.getSnapshot().composerIntents).toHaveLength(1)
  })

  it('opens the file picker for a pick-files intent when the session is ready', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const { instance } = renderComposer(sessionState(undefined))
    act(() => {
      instance.actions.pushComposerIntent(WINDOW, { pickFiles: true })
    })
    expect(click).toHaveBeenCalledOnce()
    expect(instance.getSnapshot().composerIntents).toHaveLength(0)
    click.mockRestore()
  })

  it('keeps a pick-files intent queued while the session cannot accept files', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const { instance } = renderComposer(sessionState(undefined, { status: 'pending' }))
    act(() => {
      instance.actions.pushComposerIntent(WINDOW, { pickFiles: true })
    })
    expect(click).not.toHaveBeenCalled()
    expect(instance.getSnapshot().composerIntents).toHaveLength(1)
    click.mockRestore()
  })
})

describe('ComposerBar submission', () => {
  it('clears the draft exactly once and sends a single prompt per submit', async () => {
    let settle: (accepted: boolean) => void = () => {}
    const sendPrompt = vi.fn(() => new Promise<boolean>((resolve) => { settle = resolve }))
    const { container } = renderComposer(sessionState(undefined), { sendPrompt })
    const input = textarea(container)

    fireEvent.change(input, { target: { value: '  сделай отчёт  ' } })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    // The echo owns the message from here: the draft clears optimistically so
    // the next turn can be queued without waiting for the host round-trip.
    expect(sendPrompt).toHaveBeenCalledOnce()
    expect(sendPrompt).toHaveBeenCalledWith(
      WINDOW, 'сделай отчёт', 'queue', [], [], expect.any(AbortSignal),
    )
    expect(input.value).toBe('')
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    expect(sendPrompt).toHaveBeenCalledOnce()

    await act(async () => { settle(true) })
    expect(input.value).toBe('')
  })

  it('returns the refused draft and its attachments to an untouched composer', async () => {
    let settle: (accepted: boolean) => void = () => {}
    const sendPrompt = vi.fn(() => new Promise<boolean>((resolve) => { settle = resolve }))
    const uploadFile = vi.fn(async () => ({ receiptId: 'receipt-7' }))
    const { container, getByText } = renderComposer(sessionState(undefined), { sendPrompt, uploadFile })

    fireEvent.change(fileInput(container), { target: { files: [new File(['x'], 'report.pdf', { type: 'application/pdf' })] } })
    await waitFor(() => { expect(getByText('Ready')).not.toBeNull() })
    const input = textarea(container)
    fireEvent.change(input, { target: { value: 'смотри файл' } })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    expect(input.value).toBe('')
    expect(container.querySelector('[data-board-file]')).toBeNull()

    await act(async () => { settle(false) })
    expect(input.value).toBe('смотри файл')
    expect(container.querySelector('[data-board-file="ready"]')).not.toBeNull()
    // The returned chip keeps its retry source: a second send carries the receipt.
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    expect(sendPrompt).toHaveBeenLastCalledWith(
      WINDOW, 'смотри файл', 'queue', [], [{ receiptId: 'receipt-7' }], expect.any(AbortSignal),
    )
  })

  it('keeps text typed after a submission and appends the refused draft', async () => {
    let settle: (accepted: boolean) => void = () => {}
    const sendPrompt = vi.fn(() => new Promise<boolean>((resolve) => { settle = resolve }))
    const { container } = renderComposer(sessionState(undefined), { sendPrompt })
    const input = textarea(container)

    fireEvent.change(input, { target: { value: 'старое' } })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    fireEvent.change(input, { target: { value: 'новое' } })

    await act(async () => { settle(false) })
    // Nothing is lost and nothing is overwritten: the newer text stays first.
    expect(input.value).toBe('новое\n\nстарое')
  })

  it('aborts an in-flight admission when the composer unmounts', () => {
    const sendPrompt = vi.fn(() => new Promise<boolean>(() => {}))
    const { container, unmount } = renderComposer(sessionState(undefined), { sendPrompt })
    const input = textarea(container)
    fireEvent.change(input, { target: { value: 'в полёте' } })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    const signal = (sendPrompt.mock.calls[0] as unknown[] | undefined)?.[5] as AbortSignal | undefined
    expect(signal?.aborted).toBe(false)
    unmount()
    expect(signal?.aborted).toBe(true)
  })
})

describe('ComposerBar queue strip', () => {
  const IMAGE_REF = {
    attachmentId: 'img-1' as never,
    mediaType: 'image/png',
    bytes: 128,
    width: 8,
    height: 8,
  } as const

  /** One ready-session state whose queue holds three occurrences. */
  function queuedSession(running = false): BoardWindowSessionState {
    return sessionState(undefined, {
      running,
      queue: [
        {
          id: 'q1',
          preview: 'поправь отчёт',
          text: 'поправь отчёт',
          placement: 'queued',
          attachments: [{ kind: 'file', name: 'report.pdf', bytes: 2048 }],
        },
        {
          id: 'q2',
          preview: 'картинка',
          text: null,
          placement: 'queued',
          attachments: [{ kind: 'image', attachment: IMAGE_REF }],
        },
        { id: 'q3', preview: 'уже в ходу', text: 'уже в ходу', placement: 'steering', attachments: [] },
      ],
      pending: [{
        id: 'echo-1',
        placement: 'queued',
        text: 'ещё не принято',
        images: [],
        files: ['notes.txt'],
      }],
    })
  }

  it('lists queued occurrences with attachments and marks the pending echo', async () => {
    const loadQueueImage = vi.fn(async () => 'blob:queued-image')
    const { container, getByText, queryByText } = renderComposer(queuedSession(), { loadQueueImage })

    expect(container.querySelectorAll('[data-board-queue-state="queued"]')).toHaveLength(2)
    // Steering rides the lane, never the strip.
    expect(queryByText('уже в ходу')).toBeNull()
    expect(container.querySelectorAll('[data-board-queue-state="sending"]')).toHaveLength(1)
    expect(getByText('ещё не принято')).not.toBeNull()
    expect(getByText('Sending…')).not.toBeNull()
    expect(getByText('report.pdf')).not.toBeNull()
    expect(getByText('2.0KB')).not.toBeNull()
    expect(loadQueueImage).toHaveBeenCalledWith(WINDOW, IMAGE_REF)
    await waitFor(() => { expect(container.querySelector('img[src="blob:queued-image"]')).not.toBeNull() })
  })

  it('edits one queued occurrence through the inject action', () => {
    const updateQueueItem = vi.fn()
    const { container, getByText } = renderComposer(queuedSession(), { updateQueueItem })

    const rows = container.querySelectorAll('[data-board-queue-row]')
    fireEvent.click(rows[0]?.querySelector('[data-board-action="queue-edit"]') as Element)
    const editor = container.querySelector('[data-board-action="queue-edit-input"]') as HTMLInputElement
    expect(editor.value).toBe('поправь отчёт')
    fireEvent.change(editor, { target: { value: 'поправь отчёт срочно' } })
    fireEvent.click(container.querySelector('[data-board-action="queue-edit-save"]') as Element)

    expect(updateQueueItem).toHaveBeenCalledWith(WINDOW, 'q1', { kind: 'edit', text: 'поправь отчёт срочно' })
    expect(container.querySelector('[data-board-action="queue-edit-input"]')).toBeNull()
    // A row without editable text disables its edit control.
    const editButtons = container.querySelectorAll('[data-board-action="queue-edit"]')
    expect((editButtons[1] as HTMLButtonElement).disabled).toBe(true)
    expect(getByText('поправь отчёт')).not.toBeNull()
  })

  it('removes and steers through the inject action, steering only while running', () => {
    const updateQueueItem = vi.fn()
    const idle = renderComposer(queuedSession(false), { updateQueueItem })
    const idleRows = idle.container.querySelectorAll('[data-board-queue-row]')
    fireEvent.click(idleRows[0]?.querySelector('[data-board-action="queue-remove"]') as Element)
    expect(updateQueueItem).toHaveBeenCalledWith(WINDOW, 'q1', { kind: 'remove' })
    expect((idleRows[0]?.querySelector('[data-board-action="queue-steer"]') as HTMLButtonElement).disabled).toBe(true)
    idle.unmount()

    const running = renderComposer(queuedSession(true), { updateQueueItem })
    const runningRows = running.container.querySelectorAll('[data-board-queue-row]')
    fireEvent.click(runningRows[0]?.querySelector('[data-board-action="queue-steer"]') as Element)
    expect(updateQueueItem).toHaveBeenCalledWith(WINDOW, 'q1', { kind: 'steer' })
  })

  it('reports a refused queue mutation in the strip', () => {
    const state = sessionState(undefined, { queueError: 'session/queue-item-not-found: gone' })
    const { container, getByText } = renderComposer(state)
    expect(container.querySelector('[data-board-queue-error]')).not.toBeNull()
    expect(getByText(/The queue change failed/)).not.toBeNull()
    expect(getByText(/session\/queue-item-not-found: gone/)).not.toBeNull()
  })
})

describe('ComposerBar commands and mentions', () => {
  it('closes the slash menu on Escape and keeps the draft', () => {
    const { container } = renderComposer(sessionState(undefined))
    const input = textarea(container)
    fireEvent.change(input, { target: { value: '/go' } })
    expect(document.querySelector('[role="menu"]')).toBeNull()

    fireEvent.change(input, { target: { value: '/fi' } })
    expect(container.querySelector('[role="listbox"][aria-label="Command list"]')).not.toBeNull()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(container.querySelector('[role="listbox"][aria-label="Command list"]')).toBeNull()
    expect(input.value).toBe('/fi')
  })

  it('closes the palette when Escape is pressed on one of its rows', () => {
    const { container } = renderComposer(sessionState(undefined))
    const input = textarea(container)
    fireEvent.change(input, { target: { value: '/fi' } })
    const row = container.querySelector('[role="listbox"] [role="option"]') as Element
    expect(row).not.toBeNull()
    fireEvent.keyDown(row, { key: 'Escape' })
    expect(container.querySelector('[role="listbox"]')).toBeNull()
    expect(input.value).toBe('/fi')
  })

  it('executes a command with its arguments instead of prompting', () => {
    const executeCommand = vi.fn()
    const sendPrompt = vi.fn(async () => true)
    const { container } = renderComposer(
      sessionState(undefined, { commands: [{ name: 'goal', description: 'Set the goal', hint: 'objective' }] }),
      { executeCommand, sendPrompt },
    )
    const input = textarea(container)
    fireEvent.change(input, { target: { value: '/goal ship the report' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(executeCommand).toHaveBeenCalledWith(WINDOW, '/goal ship the report', [], [])
    expect(sendPrompt).not.toHaveBeenCalled()
    expect(input.value).toBe('')
  })

  it('runs an argument-free command at pick time and fills the draft for a hinted one', () => {
    const executeCommand = vi.fn()
    const { container, getByText } = renderComposer(
      sessionState(undefined, {
        commands: [
          { name: 'compact', description: 'Compact history' },
          { name: 'goal', description: 'Set the goal', hint: 'objective' },
        ],
      }),
      { executeCommand },
    )
    fireEvent.click(container.querySelector('[data-board-action="composer-actions"]') as Element)
    fireEvent.click(getByText('Compact'))
    expect(executeCommand).toHaveBeenCalledWith(WINDOW, '/compact', [], [])

    fireEvent.click(container.querySelector('[data-board-action="composer-actions"]') as Element)
    fireEvent.click(getByText('Goal'))
    expect(textarea(container).value).toBe('/goal ')
  })

  it('carries the draft attachments into a command execution', async () => {
    const executeCommand = vi.fn()
    const uploadFile = vi.fn(async () => ({ receiptId: 'receipt-5' }))
    const { container } = renderComposer(
      sessionState(undefined, { commands: [{ name: 'goal', description: 'Set the goal', hint: 'objective' }] }),
      { executeCommand, uploadFile },
    )
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] },
    })
    await waitFor(() => { expect(container.querySelector('[data-board-file="ready"]')).not.toBeNull() })
    const input = textarea(container)
    fireEvent.change(input, { target: { value: '/goal ship it' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(executeCommand).toHaveBeenCalledWith(WINDOW, '/goal ship it', [], [{ receiptId: 'receipt-5' }])
  })

  it('opens the model menu for the board-owned /model command', () => {
    const executeCommand = vi.fn()
    const { container } = renderComposer(sessionState(undefined, {
      model: { groups: [{ id: 'p1', name: 'Provider', models: [{ id: 'm1', name: 'Model One' }] }], efforts: [], loading: false },
    }), { executeCommand })
    const input = textarea(container)
    fireEvent.change(input, { target: { value: '/model' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(executeCommand).not.toHaveBeenCalled()
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
  })

  it('opens the file picker for the board-owned /file command', () => {
    const executeCommand = vi.fn()
    const { container } = renderComposer(sessionState(undefined), { executeCommand })
    const picker = fileInput(container)
    const click = vi.spyOn(picker, 'click').mockImplementation(() => {})
    const input = textarea(container)
    fireEvent.change(input, { target: { value: '/file' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(click).toHaveBeenCalledOnce()
    expect(executeCommand).not.toHaveBeenCalled()
    click.mockRestore()
  })

  it('labels mention kinds and inserts a mention without breaking lines', async () => {
    const loadMentions = vi.fn(async () => ([
      { id: 'file:src/a.ts', label: 'src/a.ts', insert: '@src/a.ts', kind: 'file' as const },
    ]))
    const { container, getByText } = renderComposer(sessionState(undefined), { loadMentions })
    const input = textarea(container)
    fireEvent.change(input, { target: { value: 'строка\n@a' } })

    await waitFor(() => { expect(getByText('src/a.ts')).not.toBeNull() })
    expect(getByText('File')).not.toBeNull()
    fireEvent.click(getByText('src/a.ts'))
    expect(input.value).toBe('строка\n@src/a.ts ')
  })

  it('keeps the last command failure visible until the next send', () => {
    const { container, getByText } = renderComposer(
      sessionState(undefined, { commands: [{ name: 'compact', description: 'Compact history' }], commandError: 'Unknown command /missing' }),
    )
    expect(getByText(/Command failed/)).not.toBeNull()
    expect(getByText(/Unknown command \/missing/)).not.toBeNull()
    expect(container.querySelector('[data-board-command-error]')).not.toBeNull()
  })
})
