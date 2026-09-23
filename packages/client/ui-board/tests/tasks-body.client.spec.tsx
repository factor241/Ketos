// @vitest-environment jsdom
/**
 * Tasks window body: the task list reads the shared roster with its clone
 * filter, the row actions start, cancel, and open the task's session, the
 * report expands into Markdown plus the session's artifacts, the create form
 * stores and starts an objective, and the poll runs only while a task is active.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CloneId, CloneTaskDto, TaskId } from '@ketos/clone-core/types'
import { TasksBody, type TasksBodyProps } from '../src/client/window/TasksBody.tsx'
import type {
  BoardTaskRoster, BoardWindowState, WindowId,
} from '../src/client/contract/slots.ts'
import { TASK_POLL_INTERVAL_MS } from '../src/client/tasks-api.ts'
import { t } from './fixtures.client.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const CARD: BoardWindowState = {
  id: 'tasks-window-1' as WindowId,
  kind: 'tasks',
  bodyKind: 'tasks',
  cloneId: 'clone-1' as CloneId,
  ordinal: 1,
  x: 0,
  y: 0,
  width: 648,
  height: 768,
  zIndex: 10,
}

/** One stored task as the host sends it. */
function task(overrides: Partial<CloneTaskDto> = {}): CloneTaskDto {
  return {
    id: 'task-1' as TaskId,
    cloneId: 'clone-1' as CloneId,
    sessionId: 'session-1',
    objective: 'Собрать недельный отчёт',
    status: 'running',
    resultSummary: null,
    maxRounds: 8,
    createdAt: '2026-09-21T10:00:00.000Z',
    updatedAt: '2026-09-21T10:00:00.000Z',
    ...overrides,
  }
}

/** Props stub: the window owner share, the locale seat, the roster, and the task actions. */
function tasksProps(overrides: Partial<Record<string, unknown>> = {}): TasksBodyProps {
  const roster = (overrides['roster'] as BoardTaskRoster | undefined) ?? { tasks: [], loaded: true }
  const card = { ...CARD, ...(overrides['window'] as Partial<BoardWindowState> | undefined) }
  return {
    window: card,
    t,
    useTaskList: (selector: (roster: BoardTaskRoster) => unknown) => selector(roster),
    refreshTasks: vi.fn(),
    createTask: vi.fn(async () => 'started'),
    startTask: vi.fn(async () => 'started'),
    cancelTask: vi.fn(async () => 'cancelled'),
    loadTaskProgress: vi.fn(async () => undefined),
    loadTaskArtifacts: vi.fn(() => []),
    openChat: vi.fn(),
    ...overrides,
  } as unknown as TasksBodyProps
}

/** One task row by its identity. */
function row(id: string): HTMLElement {
  return document.querySelector(`[data-board-tasks="${id}"]`) as HTMLElement
}

/** One control inside a task row. */
function rowControl(id: string, name: string): HTMLElement {
  return row(id).querySelector(`[data-board-tasks="${name}"]`) as HTMLElement
}

/** Text of one status pill. */
function statusOf(status: string): string {
  return document.querySelector(`[data-board-tasks-status="${status}"]`)?.textContent ?? ''
}

describe('tasks list', () => {
  it('lists the stored tasks with their statuses and objectives', async () => {
    render(<TasksBody {...tasksProps({
      roster: {
        loaded: true,
        tasks: [
          task({ id: 'task-1' as TaskId, status: 'pending', objective: 'Собрать отчёт', sessionId: null }),
          task({ id: 'task-2' as TaskId, status: 'running', objective: 'Проверить цифры' }),
        ],
      },
    })} />)

    await waitFor(() => { expect(screen.getByText('Собрать отчёт')).not.toBeNull() })
    expect(screen.getByText('Проверить цифры')).not.toBeNull()
    expect(row('task-1')).not.toBeNull()
    expect(row('task-2')).not.toBeNull()
    expect(statusOf('pending')).toContain('Pending')
    expect(statusOf('running')).toContain('Running')
  })

  it('starts scoped to the window clone and switches to every task', async () => {
    const refreshTasks = vi.fn()
    render(<TasksBody {...tasksProps({
      refreshTasks,
      roster: {
        loaded: true,
        tasks: [
          task({ id: 'task-1' as TaskId }),
          task({ id: 'task-2' as TaskId, cloneId: 'clone-2' as CloneId }),
        ],
      },
    })} />)

    await waitFor(() => { expect(row('task-1')).not.toBeNull() })
    expect(row('task-2')).toBeNull()
    expect(refreshTasks).toHaveBeenCalledWith('clone-1')

    fireEvent.click(document.querySelector('[data-board-tasks-filter="all"]') as HTMLElement)
    await waitFor(() => { expect(row('task-2')).not.toBeNull() })
    expect(refreshTasks).toHaveBeenCalledWith(undefined)
  })

  it('shows the loading state until a read answers, retries, then the empty state', async () => {
    const refreshTasks = vi.fn()
    const { rerender } = render(<TasksBody {...tasksProps({
      roster: { tasks: [], loaded: false },
      refreshTasks,
    })} />)

    expect(document.querySelector('[data-board-tasks-loading]')).not.toBeNull()
    fireEvent.click(document.querySelector('[data-board-tasks="retry"]') as HTMLElement)
    expect(refreshTasks).toHaveBeenCalledTimes(2)

    rerender(<TasksBody {...tasksProps({ roster: { tasks: [], loaded: true } })} />)
    expect(document.querySelector('[data-board-tasks-empty]')).not.toBeNull()
    expect(screen.getByText('No tasks yet.')).not.toBeNull()
  })

  it('hides the clone filter and the create form without a clone context', () => {
    render(<TasksBody {...tasksProps({ window: { cloneId: undefined } })} />)
    expect(document.querySelector('[data-board-tasks-filter="clone"]')).toBeNull()
    expect(document.querySelector('[data-board-tasks-create]')).toBeNull()
  })
})

describe('task actions', () => {
  it('starts a pending task and cancels a running one', async () => {
    const startTask = vi.fn(async () => 'started')
    const cancelTask = vi.fn(async () => 'cancelled')
    render(<TasksBody {...tasksProps({
      startTask,
      cancelTask,
      roster: {
        loaded: true,
        tasks: [
          task({ id: 'task-1' as TaskId, status: 'pending', sessionId: null }),
          task({ id: 'task-2' as TaskId, status: 'running' }),
        ],
      },
    })} />)

    await waitFor(() => { expect(row('task-1')).not.toBeNull() })
    fireEvent.click(rowControl('task-1', 'start'))
    await waitFor(() => { expect(startTask).toHaveBeenCalledWith('task-1') })
    // A running row offers no start action.
    expect(row('task-2').querySelector('[data-board-tasks="start"]')).toBeNull()

    fireEvent.click(rowControl('task-2', 'cancel'))
    await waitFor(() => { expect(cancelTask).toHaveBeenCalledWith('task-2') })
    // A pending row offers the cancel action too.
    expect(row('task-1').querySelector('[data-board-tasks="cancel"]')).not.toBeNull()
  })

  it('reports a refused start with its outcome notice', async () => {
    const startTask = vi.fn(async () => 'not-ready')
    render(<TasksBody {...tasksProps({
      startTask,
      roster: { loaded: true, tasks: [task({ id: 'task-1' as TaskId, status: 'pending', sessionId: null })] },
    })} />)

    await waitFor(() => { expect(row('task-1')).not.toBeNull() })
    fireEvent.click(rowControl('task-1', 'start'))
    await waitFor(() => {
      expect(screen.getByText('The clone is not ready yet — finish its interview first.')).not.toBeNull()
    })
    expect(document.querySelector('[data-board-tasks-notice="not-ready"]')).not.toBeNull()
  })

  it('opens the task session and disables the action without one', async () => {
    const openChat = vi.fn()
    render(<TasksBody {...tasksProps({
      openChat,
      roster: {
        loaded: true,
        tasks: [
          task({ id: 'task-1' as TaskId, status: 'done', resultSummary: 'Готово' }),
          task({ id: 'task-2' as TaskId, status: 'pending', sessionId: null }),
        ],
      },
    })} />)

    await waitFor(() => { expect(row('task-1')).not.toBeNull() })
    expect((rowControl('task-2', 'open-session') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(rowControl('task-1', 'open-session'))
    expect(openChat).toHaveBeenCalledWith('session-1')
  })

  it('creates a task from the form and clears the objective on success', async () => {
    const createTask = vi.fn(async () => 'started')
    render(<TasksBody {...tasksProps({ createTask })} />)

    const input = document.querySelector('[data-board-tasks="objective"]') as HTMLInputElement
    const button = document.querySelector('[data-board-tasks="create"]') as HTMLButtonElement
    expect(button.disabled).toBe(true)

    fireEvent.change(input, { target: { value: '  Проверить цифры  ' } })
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    await waitFor(() => { expect(createTask).toHaveBeenCalledWith('clone-1', 'Проверить цифры') })
    await waitFor(() => {
      expect((document.querySelector('[data-board-tasks="objective"]') as HTMLInputElement).value).toBe('')
    })
  })

  it('keeps the typed objective and reports a refused create', async () => {
    const createTask = vi.fn(async () => 'missing')
    render(<TasksBody {...tasksProps({ createTask })} />)

    const input = document.querySelector('[data-board-tasks="objective"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Собрать отчёт' } })
    fireEvent.click(document.querySelector('[data-board-tasks="create"]') as HTMLElement)

    await waitFor(() => { expect(document.querySelector('[data-board-tasks-notice="missing"]')).not.toBeNull() })
    expect(input.value).toBe('Собрать отчёт')
  })

  it('reports a refused cancel as a conflict', async () => {
    const cancelTask = vi.fn(async () => 'conflict')
    render(<TasksBody {...tasksProps({
      cancelTask,
      roster: { loaded: true, tasks: [task({ id: 'task-1' as TaskId })] },
    })} />)

    await waitFor(() => { expect(row('task-1')).not.toBeNull() })
    fireEvent.click(rowControl('task-1', 'cancel'))
    await waitFor(() => {
      expect(screen.getByText('The task state moved; refresh and try again.')).not.toBeNull()
    })
    expect(document.querySelector('[data-board-tasks-notice="conflict"]')).not.toBeNull()
  })
})

describe('task report', () => {
  it('expands the report into Markdown with the session artifacts', async () => {
    const loadTaskArtifacts = vi.fn(() => [{ path: 'reports/weekly.md', kind: 'created' }])
    render(<TasksBody {...tasksProps({
      loadTaskArtifacts,
      roster: {
        loaded: true,
        tasks: [task({ id: 'task-1' as TaskId, status: 'done', resultSummary: '## Итог\n\nОтчёт готов.' })],
      },
    })} />)

    await waitFor(() => { expect(row('task-1')).not.toBeNull() })
    expect(document.querySelector('[data-board-tasks-report="task-1"]')).toBeNull()
    fireEvent.click(rowControl('task-1', 'report'))
    await waitFor(() => { expect(screen.getByText('Итог')).not.toBeNull() })
    expect(screen.getByText('Отчёт готов.')).not.toBeNull()
    expect(document.querySelector('[data-board-tasks-report="task-1"]')).not.toBeNull()
    expect(loadTaskArtifacts).toHaveBeenCalledWith('session-1')

    const artifact = document.querySelector('[data-board-tasks-artifact="reports/weekly.md"]')
    expect(artifact?.textContent).toContain('Created')
    expect(artifact?.textContent).toContain('reports/weekly.md')

    // The toggle collapses the report again.
    fireEvent.click(rowControl('task-1', 'report'))
    await waitFor(() => { expect(document.querySelector('[data-board-tasks-report="task-1"]')).toBeNull() })
  })

  it('reports an empty summary and an empty artifacts list', async () => {
    render(<TasksBody {...tasksProps({
      roster: { loaded: true, tasks: [task({ id: 'task-1' as TaskId, status: 'failed', resultSummary: null })] },
    })} />)

    await waitFor(() => { expect(row('task-1')).not.toBeNull() })
    fireEvent.click(rowControl('task-1', 'report'))
    await waitFor(() => { expect(document.querySelector('[data-board-tasks-report-empty]')).not.toBeNull() })
    expect(screen.getByText('This task has no report yet.')).not.toBeNull()
    expect(screen.getByText('No artifacts created or modified in this session yet')).not.toBeNull()
  })

  it('shows the goal round progress of a running task', async () => {
    const loadTaskProgress = vi.fn(async () => ({ roundsStarted: 3, maxGoalRounds: 8 }))
    render(<TasksBody {...tasksProps({
      loadTaskProgress,
      roster: { loaded: true, tasks: [task({ id: 'task-1' as TaskId, status: 'running' })] },
    })} />)

    await waitFor(() => {
      expect(document.querySelector('[data-board-tasks-progress="task-1"]')?.textContent).toContain('Round 3 of 8')
    })
    expect(loadTaskProgress).toHaveBeenCalledWith('session-1')
  })
})

describe('task polling', () => {
  it('polls while a task is active and stops when none remains', async () => {
    vi.useFakeTimers()
    const refreshTasks = vi.fn()
    const { rerender } = render(<TasksBody {...tasksProps({
      refreshTasks,
      roster: { loaded: true, tasks: [task({ status: 'running' })] },
    })} />)
    await act(async () => { await Promise.resolve() })
    expect(refreshTasks).toHaveBeenCalledTimes(1)

    await act(async () => { vi.advanceTimersByTime(TASK_POLL_INTERVAL_MS) })
    expect(refreshTasks).toHaveBeenCalledTimes(2)

    rerender(<TasksBody {...tasksProps({
      refreshTasks,
      roster: { loaded: true, tasks: [task({ status: 'done' })] },
    })} />)
    await act(async () => { await Promise.resolve() })
    const settled = refreshTasks.mock.calls.length
    await act(async () => { vi.advanceTimersByTime(TASK_POLL_INTERVAL_MS * 3) })
    expect(refreshTasks.mock.calls.length).toBe(settled)
  })

  it('clears the poll on unmount', async () => {
    vi.useFakeTimers()
    const refreshTasks = vi.fn()
    const view = render(<TasksBody {...tasksProps({
      refreshTasks,
      roster: { loaded: true, tasks: [task({ status: 'pending', sessionId: null })] },
    })} />)
    await act(async () => { await Promise.resolve() })
    await act(async () => { vi.advanceTimersByTime(TASK_POLL_INTERVAL_MS) })
    const polled = refreshTasks.mock.calls.length
    expect(polled).toBeGreaterThan(1)

    view.unmount()
    await act(async () => { vi.advanceTimersByTime(TASK_POLL_INTERVAL_MS * 3) })
    expect(refreshTasks.mock.calls.length).toBe(polled)
  })
})
