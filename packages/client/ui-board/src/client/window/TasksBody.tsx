/**
 * Clone tasks window body: the deployment's autonomous clone tasks as a
 * filterable list the person can start, cancel, open the session of, and read
 * the report of.
 *
 * A row reads the stored task; the report expands in place with the task's
 * Markdown summary and the file artifacts folded from its session transcript.
 * While any task is `pending` or `running` the body re-reads the roster on the
 * shared poll interval, so a task started in another window appears and a
 * running one reaches its terminal status without a manual refresh.
 */
import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import {
  Button, Input, MarkdownText, Pill, Tag, type MarkdownLabels, type TagTone,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TaskStatus } from '@ketos/clone-core/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  TASK_OBJECTIVE_LIMIT, type BoardTaskOutcome, type BoardTaskProgress, type BoardWindowInjected,
} from '../contract/slots.ts'
import { TASK_POLL_INTERVAL_MS } from '../tasks-api.ts'
import type { BoardTranslate } from '../locale.ts'
import { relativeAge } from '../relative-age.ts'
import css from './TasksBody.module.css'

export type TasksBodyProps =
  PropsRuntime<'board.window.body'>
  & PropsLocale<'board'>
  & InjectFace<BoardWindowInjected>

/** Locale key of one task status row. */
const STATUS_KEYS = {
  pending: 'tasks.status.pending',
  running: 'tasks.status.running',
  done: 'tasks.status.done',
  failed: 'tasks.status.failed',
  cancelled: 'tasks.status.cancelled',
} as const satisfies Record<TaskStatus, Parameters<BoardTranslate>[0]>

/** Tag tone of one task status row. */
const STATUS_TONES = {
  pending: 'neutral',
  running: 'info',
  done: 'success',
  failed: 'danger',
  cancelled: 'quiet',
} as const satisfies Record<TaskStatus, TagTone>

/** Outcome of one refused gesture; success needs no notice because the row moves. */
type TaskFailure = Exclude<BoardTaskOutcome, 'started' | 'cancelled'>

/** Locale key of one refused-gesture notice. */
const FAILURE_KEYS = {
  missing: 'tasks.outcome.missing',
  'not-ready': 'tasks.outcome.not-ready',
  'agent-not-live': 'tasks.outcome.agent-not-live',
  conflict: 'tasks.outcome.conflict',
  failed: 'tasks.outcome.failed',
} as const satisfies Record<TaskFailure, Parameters<BoardTranslate>[0]>

/**
 * Whether one outcome is a refusal the body must report.
 * @param outcome - outcome of the gesture.
 * @returns whether the outcome is a refusal.
 */
function isFailure(outcome: BoardTaskOutcome): outcome is TaskFailure {
  return outcome !== 'started' && outcome !== 'cancelled'
}

/** Locale key of one artifact kind label, falling back to the read label. */
function artifactKindKey(kind: string): Parameters<BoardTranslate>[0] {
  switch (kind) {
    case 'created': return 'artifacts.created'
    case 'modified': return 'artifacts.modified'
    default: return 'artifacts.read'
  }
}

/**
 * Render the task list of the window's scope.
 * @param props - window owner props, the locale seat, and the task actions.
 * @returns the filter and create row, the task rows with their reports, and the notices.
 */
export function TasksBody({
  window: cardWindow, t, useTaskList, refreshTasks, createTask, startTask, cancelTask,
  loadTaskProgress, loadTaskArtifacts, openChat,
}: TasksBodyProps) {
  const roster = useTaskList(source => source)
  const cloneId = cardWindow.cloneId
  // A window opened on one clone (the Autopilot gesture) starts scoped to it;
  // the Omnibox's plain tasks window starts over every clone.
  const [scope, setScope] = useState<'all' | 'clone'>(cloneId === undefined ? 'all' : 'clone')
  const [objective, setObjective] = useState('')
  const [busy, setBusy] = useState(false)
  /** Refusal of the last gesture, shown until the next one. */
  const [notice, setNotice] = useState<TaskFailure | undefined>(undefined)
  /** Ids of the rows whose report is expanded. */
  const [expanded, setExpanded] = useState<readonly string[]>([])
  const [progress, setProgress] = useState<Record<string, BoardTaskProgress>>({})

  const scoped = scope === 'clone' && cloneId !== undefined
  const tasks = useMemo(
    () => (scoped ? roster.tasks.filter(task => task.cloneId === cloneId) : roster.tasks),
    [roster.tasks, scoped, cloneId],
  )
  const active = roster.tasks.some(task => task.status === 'pending' || task.status === 'running')

  // The shared roster is read on mount; while any task is active the same read
  // repeats on the poll interval. The interval stops with the last active task
  // and on unmount.
  useEffect(() => {
    refreshTasks()
  }, [refreshTasks])

  useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(() => { refreshTasks() }, TASK_POLL_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [active, refreshTasks])

  // Round progress belongs to the goal of each running task's session; a
  // settled row shows its final status instead.
  useEffect(() => {
    const running = tasks.filter(task => task.status === 'running' && task.sessionId !== null)
    if (running.length === 0) {
      // Keeping the same empty object avoids a re-render on every settled poll.
      setProgress(current => Object.keys(current).length === 0 ? current : {})
      return undefined
    }
    let live = true
    void Promise.all(running.map(async (task): Promise<readonly [string, BoardTaskProgress | undefined]> =>
      [task.id, await loadTaskProgress(task.sessionId as SessionId)]))
      .then((entries) => {
        if (!live) return
        const next: Record<string, BoardTaskProgress> = {}
        for (const [id, value] of entries) {
          if (value !== undefined) next[id] = value
        }
        setProgress(next)
      })
    return () => { live = false }
  }, [tasks, loadTaskProgress])

  const markdownLabels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('markdown.copy'), copiedLabel: t('markdown.copied') },
    footnotes: t('markdown.footnotes'),
  }), [t])

  /** Apply one task gesture and report a refusal. */
  const run = async (gesture: () => Promise<BoardTaskOutcome>): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNotice(undefined)
    const outcome = await gesture()
    setBusy(false)
    if (isFailure(outcome)) setNotice(outcome)
  }

  const onCreate = async (): Promise<void> => {
    const value = objective.trim()
    if (cloneId === undefined || value === '' || busy) return
    setBusy(true)
    setNotice(undefined)
    const outcome = await createTask(cloneId, value)
    setBusy(false)
    if (isFailure(outcome)) {
      setNotice(outcome)
      return
    }
    setObjective('')
  }

  const toggleReport = (id: string): void => {
    setExpanded(current => current.includes(id)
      ? current.filter(entry => entry !== id)
      : [...current, id])
  }

  return (
    <div className={css.body}>
      <div className={css.filters} data-board-tasks-filters="">
        <Pill
          active={scope === 'all'}
          data-board-tasks-filter="all"
          onClick={() => { setScope('all') }}
        >
          {t('tasks.filter.all')}
        </Pill>
        {cloneId !== undefined && (
          <Pill
            active={scope === 'clone'}
            data-board-tasks-filter="clone"
            onClick={() => { setScope('clone') }}
          >
            {t('tasks.filter.clone')}
          </Pill>
        )}
      </div>

      {cloneId !== undefined && (
        <form
          className={css.create}
          data-board-tasks-create=""
          onSubmit={(event) => {
            event.preventDefault()
            void onCreate()
          }}
        >
          <Input
            value={objective}
            maxLength={TASK_OBJECTIVE_LIMIT}
            aria-label={t('tasks.objective')}
            placeholder={t('tasks.objective.placeholder')}
            data-board-tasks="objective"
            onChange={(event) => { setObjective(event.target.value) }}
          />
          <Button
            type="submit"
            variant="primary"
            disabled={busy || objective.trim() === ''}
            data-board-tasks="create"
          >
            {t('tasks.create')}
          </Button>
        </form>
      )}

      {notice !== undefined && (
        <div className={clsx(css.notice, css.noticeError)} data-board-tasks-notice={notice}>
          {t(FAILURE_KEYS[notice])}
        </div>
      )}
      {!roster.loaded && (
        <div className={css.loading} data-board-tasks-loading="">
          <span className={css.hint}>{t('tasks.loading')}</span>
          <Button size="sm" variant="outline" data-board-tasks="retry" onClick={() => { refreshTasks() }}>
            {t('clone.retry')}
          </Button>
        </div>
      )}
      {roster.loaded && tasks.length === 0 && (
        <span className={css.hint} data-board-tasks-empty="">{t('tasks.empty')}</span>
      )}

      <div className={css.list} data-board-tasks-list="">
        {tasks.map((task) => {
          const openReport = expanded.includes(task.id)
          const rounds = progress[task.id]
          const sessionId = task.sessionId as SessionId | null
          const artifacts = openReport && sessionId !== null ? loadTaskArtifacts(sessionId) : []
          return (
            <div key={task.id} className={css.row} data-board-tasks={task.id}>
              <div className={css.rowHead}>
                <span data-board-tasks-status={task.status}>
                  <Tag tone={STATUS_TONES[task.status]}>{t(STATUS_KEYS[task.status])}</Tag>
                </span>
                <span className={css.meta}>{relativeAge(task.updatedAt, t)}</span>
              </div>
              <p className={css.objective} data-board-tasks-objective={task.id}>{task.objective}</p>
              {task.status === 'running' && rounds !== undefined && (
                <span className={css.meta} data-board-tasks-progress={task.id}>
                  {t('tasks.rounds', { started: String(rounds.roundsStarted), max: String(rounds.maxGoalRounds) })}
                </span>
              )}
              {task.status === 'pending' && (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy}
                  data-board-tasks="start"
                  onClick={() => { void run(() => startTask(task.id)) }}
                >
                  {t('tasks.start')}
                </Button>
              )}
              {(task.status === 'pending' || task.status === 'running') && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  data-board-tasks="cancel"
                  onClick={() => { void run(() => cancelTask(task.id)) }}
                >
                  {t('tasks.cancel')}
                </Button>
              )}
              <div className={css.actions}>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || sessionId === null}
                  data-board-tasks="open-session"
                  onClick={() => { if (sessionId !== null) openChat(sessionId) }}
                >
                  {t('tasks.openSession')}
                </Button>
                {sessionId !== null && (
                  <Button
                    size="sm"
                    variant="ghost"
                    data-board-tasks="report"
                    onClick={() => { toggleReport(task.id) }}
                  >
                    {openReport ? t('tasks.report.hide') : t('tasks.report')}
                  </Button>
                )}
              </div>
              {openReport && sessionId !== null && (
                <div className={css.report} data-board-tasks-report={task.id}>
                  {task.resultSummary === null
                    ? <span className={css.hint} data-board-tasks-report-empty="">{t('tasks.report.empty')}</span>
                    : <MarkdownText text={task.resultSummary} labels={markdownLabels} />}
                  <div className={css.artifacts} data-board-tasks-artifacts={task.id}>
                    <span className={css.label}>{t('tasks.artifacts')}</span>
                    {artifacts.length === 0
                      ? <span className={css.hint}>{t('tasks.artifacts.empty')}</span>
                      : artifacts.map(artifact => (
                        <span key={artifact.path} className={css.artifact} data-board-tasks-artifact={artifact.path}>
                          <span className={css.artifactKind}>{t(artifactKindKey(artifact.kind))}</span>
                          <span className={css.artifactPath}>{artifact.path}</span>
                        </span>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
