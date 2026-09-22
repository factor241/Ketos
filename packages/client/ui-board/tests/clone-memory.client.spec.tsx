// @vitest-environment jsdom
/**
 * Clone memory body: the list reads the window's clone memory with its status
 * filter, the search row asks the route for matches, the row editor saves the
 * edited fact and tags, and a confirmed delete removes the row.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CloneId, MemoryDto, MemoryId } from '@ketos/clone-core/types'
import { CloneMemoryBody, type CloneMemoryBodyProps } from '../src/client/window/CloneMemoryBody.tsx'
import type { BoardWindowState, MemoryReadOutcome, WindowId } from '../src/client/contract/slots.ts'
import { t } from './fixtures.client.ts'

afterEach(() => { cleanup() })

const CARD: BoardWindowState = {
  id: 'clone-window-1' as WindowId,
  kind: 'clone',
  bodyKind: 'clone-memory',
  cloneId: 'clone-1' as CloneId,
  ordinal: 1,
  x: 0,
  y: 0,
  width: 648,
  height: 768,
  zIndex: 10,
}

/** One stored memory row as the host sends it. */
function memory(id: string, content: string, tags: readonly string[] = [], status: MemoryDto['status'] = 'active'): MemoryDto {
  return {
    id: id as MemoryId,
    cloneId: 'clone-1' as CloneId,
    content,
    tags,
    sourceSessionId: 'session-1',
    status,
    createdAt: '2026-09-21T10:00:00.000Z',
    updatedAt: '2026-09-21T10:00:00.000Z',
  }
}

/** Props stub: the window owner share, the locale seat, and the memory actions. */
function memoryProps(overrides: Partial<Record<string, unknown>> = {}): CloneMemoryBodyProps {
  return {
    window: { ...CARD, ...(overrides['window'] as Partial<BoardWindowState> | undefined) },
    t,
    loadMemories: vi.fn(async () => ({ ok: true as const, memories: [] })),
    searchMemories: vi.fn(async () => ({ ok: true as const, memories: [] })),
    saveMemory: vi.fn(async () => 'saved'),
    removeMemory: vi.fn(async () => 'deleted'),
    ...overrides,
  } as unknown as CloneMemoryBodyProps
}

/** The control of one memory row by its data attribute, narrowed to an element. */
function control(name: string): HTMLElement {
  return document.querySelector(`[data-board-memory="${name}"]`) as HTMLElement
}

describe('clone memory list', () => {
  it('reads the active memories of the window clone and switches the status filter', async () => {
    const loadMemories = vi.fn(async (_cloneId: CloneId, status?: MemoryDto['status']) => ({
      ok: true as const,
      memories: status === 'archived' ? [memory('m2', 'Устаревший факт', [], 'archived')] : [memory('m1', 'Короткие письма', ['стиль'])],
    }))
    render(<CloneMemoryBody {...memoryProps({ loadMemories })} />)
    await waitFor(() => { expect(screen.getByText('Короткие письма')).not.toBeNull() })
    expect(loadMemories).toHaveBeenCalledWith('clone-1', 'active')
    expect(screen.getByText('стиль')).not.toBeNull()

    fireEvent.click(document.querySelector('[data-board-memory-filter="archived"]') as HTMLElement)
    await waitFor(() => { expect(screen.getByText('Устаревший факт')).not.toBeNull() })
    expect(loadMemories).toHaveBeenLastCalledWith('clone-1', 'archived')
    expect(screen.queryByText('Короткие письма')).toBeNull()
  })

  it('asks the route for matches and clears back to the listing', async () => {
    const searchMemories = vi.fn(async () => ({ ok: true as const, memories: [memory('m1', 'Навык анализа')] }))
    const loadMemories = vi.fn(async () => ({ ok: true as const, memories: [memory('m2', 'Любит короткие письма')] }))
    render(<CloneMemoryBody {...memoryProps({ searchMemories, loadMemories })} />)
    await waitFor(() => { expect(screen.getByText('Любит короткие письма')).not.toBeNull() })

    fireEvent.change(control('search'), { target: { value: 'навык' } })
    fireEvent.click(control('search-submit'))
    await waitFor(() => { expect(screen.getByText('Навык анализа')).not.toBeNull() })
    expect(searchMemories).toHaveBeenCalledWith('clone-1', 'навык', 'active')

    fireEvent.click(control('search-clear'))
    await waitFor(() => { expect(screen.getByText('Любит короткие письма')).not.toBeNull() })
    expect(searchMemories).toHaveBeenCalledTimes(1)
  })

  it('renders the empty states of the listing and the search', async () => {
    const { rerender } = render(<CloneMemoryBody {...memoryProps()} />)
    await waitFor(() => { expect(screen.getByText('Nothing in this status.')).not.toBeNull() })

    rerender(<CloneMemoryBody {...memoryProps({ searchMemories: vi.fn(async () => ({ ok: true as const, memories: [] })) })} />)
    fireEvent.change(control('search'), { target: { value: 'нет такого' } })
    fireEvent.click(control('search-submit'))
    await waitFor(() => { expect(screen.getByText('No memories matched.')).not.toBeNull() })
  })
})

describe('clone memory editing', () => {
  it('saves the edited content, tags, and status and re-reads the list', async () => {
    const rows = [memory('m1', 'Старый факт', ['старое'])]
    const loadMemories = vi.fn(async () => ({ ok: true as const, memories: [...rows] }))
    const saveMemory = vi.fn(async () => 'saved' as const)
    render(<CloneMemoryBody {...memoryProps({ loadMemories, saveMemory })} />)
    await waitFor(() => { expect(screen.getByText('Старый факт')).not.toBeNull() })

    fireEvent.click(control('edit'))
    const content = document.querySelector('[data-board-memory="content"]') as HTMLTextAreaElement
    fireEvent.change(content, { target: { value: 'Уточнённый факт' } })
    fireEvent.change(control('tags'), { target: { value: 'новое, важное' } })
    fireEvent.click(document.querySelector('[data-board-memory-edit-status="candidate"]') as HTMLElement)
    fireEvent.click(control('save'))

    await waitFor(() => {
      expect(saveMemory).toHaveBeenCalledWith('m1', {
        content: 'Уточнённый факт',
        tags: ['новое', 'важное'],
        status: 'candidate',
      })
    })
    await waitFor(() => { expect(loadMemories).toHaveBeenCalledTimes(2) })
  })

  it('keeps the editor open and reports a refused save', async () => {
    const saveMemory = vi.fn(async () => 'failed' as const)
    render(<CloneMemoryBody {...memoryProps({ loadMemories: vi.fn(async () => ({ ok: true as const, memories: [memory('m1', 'Факт')] })), saveMemory })} />)
    await waitFor(() => { expect(screen.getByText('Факт')).not.toBeNull() })

    fireEvent.click(control('edit'))
    fireEvent.click(control('save'))
    await waitFor(() => { expect(screen.getByText('The operation did not complete; try again.')).not.toBeNull() })
    expect(document.querySelector('[data-board-memory="content"]')).not.toBeNull()
  })

  it('removes a memory only after the confirmation and drops it from the list', async () => {
    const rows = [memory('m1', 'Временный факт')]
    const loadMemories = vi.fn(async () => ({ ok: true as const, memories: [...rows] }))
    const removeMemory = vi.fn(async () => {
      rows.length = 0
      return 'deleted' as const
    })
    render(<CloneMemoryBody {...memoryProps({ loadMemories, removeMemory })} />)
    await waitFor(() => { expect(screen.getByText('Временный факт')).not.toBeNull() })

    fireEvent.click(control('delete'))
    expect(removeMemory).not.toHaveBeenCalled()
    fireEvent.click(control('delete.confirm'))
    await waitFor(() => { expect(removeMemory).toHaveBeenCalledWith('m1') })
    await waitFor(() => { expect(screen.queryByText('Временный факт')).toBeNull() })
    expect(screen.getByText('Nothing in this status.')).not.toBeNull()
  })
})

describe('clone memory window states', () => {
  it('shows the missing-clone state for a window without a clone', () => {
    render(<CloneMemoryBody {...memoryProps({ window: { cloneId: undefined } })} />)
    expect(document.querySelector('[data-board-memory-missing]')).not.toBeNull()
    expect(document.querySelector('[data-board-memory-list]')).toBeNull()
  })

  it('reports a failed read instead of claiming an empty memory, and retries', async () => {
    const loadMemories = vi.fn<() => Promise<MemoryReadOutcome>>(async () => ({ ok: false }))
    render(<CloneMemoryBody {...memoryProps({ loadMemories })} />)
    await waitFor(() => { expect(screen.getByText('Could not read the memory.')).not.toBeNull() })
    // The empty copy belongs to an answered read, never to a refusal.
    expect(screen.queryByText('Nothing in this status.')).toBeNull()

    loadMemories.mockResolvedValueOnce({ ok: true, memories: [memory('m1', 'Факт')] })
    fireEvent.click(control('retry'))
    await waitFor(() => { expect(screen.getByText('Факт')).not.toBeNull() })
    expect(screen.queryByText('Could not read the memory.')).toBeNull()
  })

  it('refuses tags outside the host bounds without asking the route', async () => {
    const saveMemory = vi.fn(async () => 'saved' as const)
    render(<CloneMemoryBody {...memoryProps({
      loadMemories: vi.fn(async () => ({ ok: true as const, memories: [memory('m1', 'Факт')] })),
      saveMemory,
    })} />)
    await waitFor(() => { expect(screen.getByText('Факт')).not.toBeNull() })

    fireEvent.click(control('edit'))
    fireEvent.change(control('tags'), {
      target: { value: Array.from({ length: 51 }, (_, index) => `tag-${String(index)}`).join(', ') },
    })
    fireEvent.click(control('save'))
    await waitFor(() => {
      expect(screen.getByText('Tags must be at most 50 entries, each up to 100 characters and without commas.')).not.toBeNull()
    })
    expect(saveMemory).not.toHaveBeenCalled()
  })

  it('reports a host-refused value as refused, not as a retryable failure', async () => {
    const saveMemory = vi.fn(async () => 'invalid' as const)
    render(<CloneMemoryBody {...memoryProps({
      loadMemories: vi.fn(async () => ({ ok: true as const, memories: [memory('m1', 'Факт')] })),
      saveMemory,
    })} />)
    await waitFor(() => { expect(screen.getByText('Факт')).not.toBeNull() })

    fireEvent.click(control('edit'))
    fireEvent.click(control('save'))
    await waitFor(() => { expect(document.querySelector('[data-board-memory-notice="invalid"]')).not.toBeNull() })
    expect(document.querySelector('[data-board-memory-notice="failed"]')).toBeNull()
  })

  it('keeps a refused mutation visible until the next attempt', async () => {
    const gate = Promise.withResolvers<MemoryReadOutcome>()
    const loadMemories = vi.fn<() => Promise<MemoryReadOutcome>>()
      .mockResolvedValueOnce({ ok: true, memories: [memory('m1', 'Факт')] })
      .mockReturnValueOnce(gate.promise)
    render(<CloneMemoryBody {...memoryProps({
      loadMemories,
      saveMemory: vi.fn(async () => 'failed' as const),
    })} />)
    await waitFor(() => { expect(screen.getByText('Факт')).not.toBeNull() })

    fireEvent.click(control('edit'))
    fireEvent.click(control('save'))
    await waitFor(() => { expect(screen.getByText('The operation did not complete; try again.')).not.toBeNull() })

    // A read landing afterwards must not erase the mutation's notice.
    fireEvent.click(document.querySelector('[data-board-memory-filter="candidate"]') as HTMLElement)
    gate.resolve({ ok: true, memories: [] })
    await waitFor(() => { expect(screen.getByText('Nothing in this status.')).not.toBeNull() })
    expect(screen.getByText('The operation did not complete; try again.')).not.toBeNull()
  })
})
