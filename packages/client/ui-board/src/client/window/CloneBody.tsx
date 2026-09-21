/**
 * Clone window body: the clone card editor. The window's `cloneId` selects the
 * record; the form holds a local draft, saves it under the revision it read, and
 * reports a conflict instead of overwriting a concurrent edit.
 *
 * A revision that moves under an unsaved draft re-bases the revision only: the
 * user's text survives, and the next save applies it over the newer record.
 *
 * The window edits a card, not a session: creating the clone's session is a
 * separate gesture that opens that session's own chat window.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Button, Input, Menu, Pill, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { CloneDto, CloneId, CloneSessionBinding, CloneStatus, CloneUpdatePatch } from '@ketos/clone-core/types'
import { CLONE_STATUS_ROWS, type BoardWindowInjected, type CloneModelOption } from '../contract/slots.ts'
import type { BoardStoreHandle } from '../store.ts'
import type { BoardTranslate } from '../locale.ts'
import { formatModelRoute } from '../clone-model.ts'
import css from './CloneBody.module.css'

export type CloneBodyProps =
  PropsRuntime<'board.window.body'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>
  & InjectFace<BoardWindowInjected>

/** The editable fields of one clone. */
interface CloneDraft {
  name: string
  role: string
  description: string
  persona: string
  methodology: string
  preferredModel: string | null
  status: CloneStatus
}

/**
 * Longest value each field accepts. The route enforces these bounds on the
 * wire (`packages/ketos/clone-core/src/routes.ts` LIMITS); the form caps input
 * at the same numbers so a valid draft can never be refused for its length.
 */
const LIMITS = {
  name: 120,
  role: 120,
  description: 500,
  persona: 20_000,
  methodology: 20_000,
} as const

/** Notice the form shows above its actions after a mutation. */
type CloneNotice = 'conflict' | 'delete-conflict' | 'missing' | 'failed' | undefined

/** Lifecycle status locale key of one status row. */
const STATUS_KEYS = {
  draft: 'clone.status.draft',
  active: 'clone.status.active',
  archived: 'clone.status.archived',
} as const satisfies Record<CloneStatus, Parameters<BoardTranslate>[0]>

/**
 * The form's live state: the draft, the stored values it was seeded from, and
 * the revision the next save must match.
 */
interface CloneEditor {
  /** Clone the draft belongs to, so a window rebound to another clone re-seeds. */
  readonly id: CloneId
  readonly draft: CloneDraft
  /** Stored values the draft started from; equal to the draft means no unsaved edits. */
  readonly base: CloneDraft
  readonly revision: number
}

/** The editable fields of one stored record. */
function toDraft(clone: CloneDto): CloneDraft {
  return {
    name: clone.name,
    role: clone.role,
    description: clone.description,
    persona: clone.persona,
    methodology: clone.methodology,
    preferredModel: clone.preferredModel,
    status: clone.status,
  }
}

/** Whether two drafts hold the same editable values. */
function sameDraft(left: CloneDraft, right: CloneDraft): boolean {
  return left.name === right.name
    && left.role === right.role
    && left.description === right.description
    && left.persona === right.persona
    && left.methodology === right.methodology
    && left.preferredModel === right.preferredModel
    && left.status === right.status
}

/** The complete update patch one draft sends. */
function toPatch(draft: CloneDraft): CloneUpdatePatch {
  return {
    name: draft.name.trim(),
    role: draft.role.trim(),
    description: draft.description,
    persona: draft.persona,
    methodology: draft.methodology,
    preferredModel: draft.preferredModel,
    status: draft.status,
  }
}

/**
 * Render the clone editor for the window's clone.
 * @param props - window owner props, the board store, the locale seat, and the clone actions.
 * @returns the editor, the waiting state, or the notice that the clone is gone.
 */
export function CloneBody({
  window: cardWindow,
  t,
  useCloneList,
  saveClone,
  deleteClone,
  loadCloneModels,
  loadCloneSessions,
  refreshClones,
  startCloneSession,
  openChat,
}: CloneBodyProps) {
  const roster = useCloneList(source => source)
  const clone = cardWindow.cloneId === undefined
    ? undefined
    : roster.clones.find(entry => entry.id === cardWindow.cloneId)
  const [editor, setEditor] = useState<CloneEditor | undefined>(undefined)
  const [notice, setNotice] = useState<CloneNotice>(undefined)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [models, setModels] = useState<readonly CloneModelOption[]>([])
  const [sessions, setSessions] = useState<readonly CloneSessionBinding[]>([])
  const [sessionEpoch, setSessionEpoch] = useState(0)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const modelAnchor = useRef<HTMLButtonElement>(null)

  const cloneId = cardWindow.cloneId
  const storedRevision = clone?.revision

  // Follow the stored record. A clean form takes the stored values; a form with
  // unsaved edits keeps them and adopts only the stored revision, so a save
  // that lost the revision race is retryable instead of silently replacing
  // what the user typed.
  useEffect(() => {
    if (clone === undefined) return
    setEditor((current) => {
      const stored = toDraft(clone)
      if (current === undefined || current.id !== clone.id || sameDraft(current.draft, current.base)) {
        return { id: clone.id, draft: stored, base: stored, revision: clone.revision }
      }
      return { ...current, revision: clone.revision }
    })
  }, [clone?.id, storedRevision])

  useEffect(() => {
    let live = true
    void loadCloneModels().then((rows) => { if (live) setModels(rows) })
    return () => { live = false }
  }, [loadCloneModels])

  useEffect(() => {
    if (cloneId === undefined) return undefined
    let live = true
    void loadCloneSessions(cloneId).then((rows) => { if (live) setSessions(rows) })
    return () => { live = false }
  }, [cloneId, sessionEpoch, loadCloneSessions])

  /** Replace fields of the live draft. */
  const edit = (patch: Partial<CloneDraft>): void => {
    setEditor(current => current === undefined ? current : { ...current, draft: { ...current.draft, ...patch } })
  }

  const modelItems: readonly MenuEntry[] = useMemo(() => [
    { id: 'clone-model:none', label: t('clone.model.none') },
    ...models.map((option, index) => ({
      id: `clone-model:${String(index)}`,
      label: option.providerName === option.name ? option.name : `${option.providerName} · ${option.name}`,
    })),
  ], [models, t])

  const selectedModelId = editor === undefined || editor.draft.preferredModel === null
    ? 'clone-model:none'
    : (() => {
      const index = models.findIndex(option => formatModelRoute(option.provider, option.model) === editor.draft.preferredModel)
      return index === -1 ? 'clone-model:none' : `clone-model:${String(index)}`
    })()
  const preferredLabel = editor === undefined || editor.draft.preferredModel === null
    ? t('clone.model.none')
    : models.find(option => formatModelRoute(option.provider, option.model) === editor.draft.preferredModel)?.name
      ?? editor.draft.preferredModel

  const draftValid = editor !== undefined && editor.draft.name.trim() !== '' && editor.draft.role.trim() !== ''

  const onSave = async (): Promise<void> => {
    if (editor === undefined) return
    setBusy(true)
    const outcome = await saveClone(editor.id, toPatch(editor.draft), editor.revision)
    setBusy(false)
    // Success needs no banner: the revision indicator moves and the drawer of
    // notices stays reserved for what the user must act on.
    setNotice(outcome === 'saved' ? undefined : outcome)
  }

  const onDelete = async (): Promise<void> => {
    if (editor === undefined) return
    setBusy(true)
    const outcome = await deleteClone(editor.id, editor.revision)
    setBusy(false)
    setConfirmingDelete(false)
    if (outcome === 'deleted') return
    // A moved record needs a fresh confirmation, not the save-oriented text.
    setNotice(outcome === 'conflict' ? 'delete-conflict' : outcome)
  }

  const onStartSession = async (): Promise<void> => {
    if (clone === undefined) return
    setBusy(true)
    const outcome = await startCloneSession(clone)
    setBusy(false)
    if (outcome === 'failed') {
      setNotice('failed')
      return
    }
    setSessionEpoch(epoch => epoch + 1)
  }

  if (cloneId !== undefined && clone === undefined && !roster.loaded) {
    return (
      <div className={css.missing} data-board-clone-loading="">
        <span>{t('clone.loading')}</span>
        <Button size="sm" variant="outline" data-board-clone="retry" onClick={refreshClones}>
          {t('clone.retry')}
        </Button>
      </div>
    )
  }

  if (cloneId === undefined || clone === undefined) {
    return (
      <div className={css.missing} data-board-clone-missing="">
        <span>{t('clone.missing')}</span>
        <span className={css.hint}>{t('clone.missing.hint')}</span>
      </div>
    )
  }

  return (
    <div className={css.body}>
      <div className={css.form} data-board-clone-editor="">
        <div className={css.fieldRow}>
          <label className={css.field}>
            <span className={css.label}>{t('clone.name')}</span>
            <Input
              value={editor?.draft.name ?? ''}
              maxLength={LIMITS.name}
              aria-label={t('clone.name')}
              data-board-clone="name"
              onChange={(event) => { edit({ name: event.target.value }) }}
            />
          </label>
          <label className={css.field}>
            <span className={css.label}>{t('clone.role')}</span>
            <Input
              value={editor?.draft.role ?? ''}
              maxLength={LIMITS.role}
              aria-label={t('clone.role')}
              data-board-clone="role"
              onChange={(event) => { edit({ role: event.target.value }) }}
            />
          </label>
        </div>

        <label className={css.field}>
          <span className={css.label}>{t('clone.description')}</span>
          <Input
            value={editor?.draft.description ?? ''}
            maxLength={LIMITS.description}
            aria-label={t('clone.description')}
            data-board-clone="description"
            onChange={(event) => { edit({ description: event.target.value }) }}
          />
        </label>

        <label className={css.field}>
          <span className={css.label}>{t('clone.persona')}</span>
          <textarea
            className={css.textarea}
            value={editor?.draft.persona ?? ''}
            maxLength={LIMITS.persona}
            aria-label={t('clone.persona')}
            data-board-clone="persona"
            placeholder={t('clone.persona.placeholder')}
            onChange={(event) => { edit({ persona: event.target.value }) }}
          />
        </label>

        <label className={css.field}>
          <span className={css.label}>{t('clone.methodology')}</span>
          <textarea
            className={css.textarea}
            value={editor?.draft.methodology ?? ''}
            maxLength={LIMITS.methodology}
            aria-label={t('clone.methodology')}
            data-board-clone="methodology"
            placeholder={t('clone.methodology.placeholder')}
            onChange={(event) => { edit({ methodology: event.target.value }) }}
          />
        </label>

        <div className={css.field}>
          <span className={css.label}>{t('clone.model')}</span>
          <div className={css.row}>
            <button
              ref={modelAnchor}
              type="button"
              className={css.modelButton}
              data-board-clone="model"
              aria-label={t('clone.model.pick')}
              onClick={() => { setModelMenuOpen(open => !open) }}
            >
              {preferredLabel}
            </button>
            <Menu
              portal
              open={modelMenuOpen}
              anchor={<span className={css.anchor} />}
              getAnchorRect={() => modelAnchor.current?.getBoundingClientRect() ?? null}
              items={modelItems}
              selectedId={selectedModelId}
              onSelect={(id) => {
                setModelMenuOpen(false)
                if (id === 'clone-model:none') {
                  edit({ preferredModel: null })
                  return
                }
                const option = models[Number(id.slice('clone-model:'.length))]
                if (option === undefined) return
                edit({ preferredModel: formatModelRoute(option.provider, option.model) })
              }}
              onClose={() => { setModelMenuOpen(false) }}
            />
            <span className={css.hint}>{t('clone.model.hint')}</span>
          </div>
        </div>

        <div className={css.statusRow}>
          <span className={css.statusLabel}>{t('clone.status')}</span>
          {CLONE_STATUS_ROWS.map(status => (
            <Pill
              key={status}
              active={editor?.draft.status === status}
              onClick={() => { edit({ status }) }}
            >
              {t(STATUS_KEYS[status])}
            </Pill>
          ))}
        </div>

        {notice === 'conflict' && (
          <div className={clsx(css.notice, css.noticeConflict)} data-board-clone-notice="conflict">
            {t('clone.conflict')}
          </div>
        )}
        {notice === 'delete-conflict' && (
          <div className={clsx(css.notice, css.noticeConflict)} data-board-clone-notice="delete-conflict">
            {t('clone.delete.conflict')}
          </div>
        )}
        {notice === 'missing' && (
          <div className={clsx(css.notice, css.noticeError)} data-board-clone-notice="missing">
            {t('clone.missing')}
          </div>
        )}
        {notice === 'failed' && (
          <div className={clsx(css.notice, css.noticeError)} data-board-clone-notice="failed">
            {t('clone.failed')}
          </div>
        )}

        <div className={css.actions}>
          <Button
            variant="primary"
            disabled={!draftValid || busy}
            data-board-clone="save"
            onClick={() => { void onSave() }}
          >
            {t('clone.save')}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            data-board-clone={confirmingDelete ? 'delete.confirm' : 'delete'}
            onClick={() => {
              if (!confirmingDelete) {
                setConfirmingDelete(true)
                return
              }
              void onDelete()
            }}
          >
            {confirmingDelete ? t('clone.delete.confirm') : t('clone.delete')}
          </Button>
          {confirmingDelete && (
            <Button variant="ghost" onClick={() => { setConfirmingDelete(false) }}>
              {t('clone.cancel')}
            </Button>
          )}
          <span className={css.revision} data-board-clone-revision={String(editor?.revision ?? clone.revision)}>
            {t('clone.revision', { n: String(editor?.revision ?? clone.revision) })}
          </span>
        </div>

        <div className={css.actions}>
          <Button
            variant="outline"
            disabled={busy}
            data-board-clone="session"
            onClick={() => { void onStartSession() }}
          >
            {t('clone.session.create')}
          </Button>
          <span className={css.hint}>{t('clone.session.hint')}</span>
        </div>

        <div className={css.sessions}>
          <span className={css.label}>{t('clone.sessions')}</span>
          {sessions.length === 0 && <span className={css.hint}>{t('clone.sessions.none')}</span>}
          {sessions.map(binding => (
            <button
              key={binding.sessionId}
              type="button"
              className={css.sessionRow}
              data-board-clone-session={binding.sessionId}
              onClick={() => { openChat(binding.sessionId) }}
            >
              <span className={css.sessionId}>{binding.sessionId}</span>
              <span className={css.hint}>{binding.role}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
