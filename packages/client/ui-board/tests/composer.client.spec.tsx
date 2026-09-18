// @vitest-environment jsdom
/**
 * Window composer: blocked and running states, attachment limits, file uploads,
 * drag-and-drop and paste intake, the slash-command execution path with
 * arguments, the `@` mention menu, and the full-access risk gate. The component
 * renders from injected props only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { ComposerBar, type ComposerBarProps } from '../src/client/window/ComposerBar.tsx'
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
    sendPrompt: vi.fn(),
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
  const props = {
    windowId: WINDOW,
    session,
    t,
    injected,
    onSent,
  } as unknown as ComposerBarProps
  const utils = render(<ComposerBar {...props} />)
  return { ...utils, injected, onSent }
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
    const sendPrompt = vi.fn()
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
    const sendPrompt = vi.fn()
    const { container, getByText } = renderComposer(sessionState(undefined), { uploadFile, sendPrompt })

    fireEvent.change(fileInput(container), { target: { files: [new File(['отчёт'], 'report.pdf', { type: 'application/pdf' })] } })
    await waitFor(() => { expect(getByText('Ready')).not.toBeNull() })
    expect(uploadFile).toHaveBeenCalledOnce()
    const uploadCall = uploadFile.mock.calls[0] as unknown as [unknown, unknown]
    expect(uploadCall[0]).toBe(WINDOW)
    expect(uploadCall[1]).toBe('report.pdf')

    fireEvent.change(textarea(container), { target: { value: 'смотри файл' } })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    expect(sendPrompt).toHaveBeenCalledWith(WINDOW, 'смотри файл', 'queue', [], ['receipt-7'])
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
    const sendPrompt = vi.fn()
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
    expect(executeCommand).toHaveBeenCalledWith(WINDOW, '/goal ship it', [], ['receipt-5'])
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
