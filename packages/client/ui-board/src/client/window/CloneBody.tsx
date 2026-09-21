/**
 * Clone window body: the clone card editor. The window's `cloneId` selects the
 * record; the form holds a local draft, saves it under the revision it read,
 * and reports a conflict instead of overwriting a concurrent edit.
 *
 * The window edits a card, not a session: creating the clone's session is a
 * separate gesture that opens that session's own chat window.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Button, Input, Menu, Pill, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { CloneSessionBinding, CloneStatus, CloneUpdatePatch } from '@ketos/clone-core/types'
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

/** The editable fields of one clone, as the form holds them while typing. */
interface CloneDraft {
  name: string
  role: string
  description: string
  persona: string
  methodology: string
  preferredModel: string | null
  status: CloneStatus
}

/** Notice the form shows above its actions after a mutation. */
type CloneNotice = 'conflict' | 'missing' | 'failed' | undefined

/** Lifecycle status locale key of one status row. */
const STATUS_KEYS = {
  draft: 'clone.status.draft',
  active: 'clone.status.active',
  archived: 'clone.status.archived',
} as const satisfies Record<CloneStatus, Parameters<BoardTranslate>[0]>

/**
 * Render the clone editor for the window's clone.
 * @param props - window owner props, the board store, the locale seat, and the clone actions.
 * @returns the editor, or the notice that the clone is gone.
 */
export function CloneBody({
  window: cardWindow,
  t,
  useCloneList,
  saveClone,
  deleteClone,
  loadCloneModels,
  loadCloneSessions,
  startCloneSession,
  openChat,
}: CloneBodyProps) {
  const roster = useCloneList(source => source)
  const clone = cardWindow.cloneId === undefined
    ? undefined
    : roster.clones.find(entry => entry.id === cardWindow.cloneId)
  const [draft, setDraft] = useState<CloneDraft | undefined>(undefined)
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

  // Re-seed the draft from the stored record whenever its revision moves: a
  // save re-reads the record, and an edit made elsewhere arrives as a new
  // revision. Typing alone never touches the roster, so an unsaved draft
  // survives every unrelated list refresh.
  useEffect(() => {
    if (clone === undefined) return
    setDraft({
      name: clone.name,
      role: clone.role,
      description: clone.description,
      persona: clone.persona,
      methodology: clone.methodology,
      preferredModel: clone.preferredModel,
      status: clone.status,
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

  const modelItems: readonly MenuEntry[] = useMemo(() => [
    { id: 'clone-model:none', label: t('clone.model.none') },
    ...models.map((option, index) => ({
      id: `clone-model:${String(index)}`,
      label: option.providerName === option.name ? option.name : `${option.providerName} · ${option.name}`,
    })),
  ], [models, t])

  const selectedModelId = draft?.preferredModel === null || draft === undefined
    ? 'clone-model:none'
    : (() => {
      const index = models.findIndex(option => formatModelRoute(option.provider, option.model) === draft.preferredModel)
      return index === -1 ? 'clone-model:none' : `clone-model:${String(index)}`
    })()
  const preferredLabel = draft === undefined || draft.preferredModel === null
    ? t('clone.model.none')
    : models.find(option => formatModelRoute(option.provider, option.model) === draft.preferredModel)?.name
      ?? draft.preferredModel

  const draftValid = draft !== undefined && draft.name.trim() !== '' && draft.role.trim() !== ''

  const onSave = async (): Promise<void> => {
    if (clone === undefined || cloneId === undefined || draft === undefined) return
    const patch: CloneUpdatePatch = {
      name: draft.name.trim(),
      role: draft.role.trim(),
      description: draft.description,
      persona: draft.persona,
      methodology: draft.methodology,
      preferredModel: draft.preferredModel,
      status: draft.status,
    }
    setBusy(true)
    const outcome = await saveClone(cloneId, patch, clone.revision)
    setBusy(false)
    // Success needs no banner: the revision indicator moves and the drawer of
    // notices stays reserved for what the user must act on.
    setNotice(outcome === 'saved' ? undefined : outcome)
  }

  const onDelete = async (): Promise<void> => {
    if (clone === undefined || cloneId === undefined) return
    setBusy(true)
    const outcome = await deleteClone(cloneId, clone.revision)
    setBusy(false)
    setConfirmingDelete(false)
    // Success closes the window through the apply-side deletion path, so only
    // the outcomes the user must react to leave a banner here.
    if (outcome !== 'deleted') setNotice(outcome)
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

  if (cloneId === undefined) {
    return (
      <div className={css.missing} data-board-clone-missing="">
        <span>{t('clone.missing')}</span>
        <span className={css.hint}>{t('clone.missing.hint')}</span>
      </div>
    )
  }
  if (clone === undefined) {
    // The first roster read may still be in flight; only an answered read can
    // say that the clone is gone.
    return roster.loaded
      ? (
        <div className={css.missing} data-board-clone-missing="">
          <span>{t('clone.missing')}</span>
          <span className={css.hint}>{t('clone.missing.hint')}</span>
        </div>
      )
      : <div className={css.missing} data-board-clone-loading="" />
  }

  return (
    <div className={css.body}>
      <div className={css.form} data-board-clone-editor="">
        <div className={css.fieldRow}>
          <label className={css.field}>
            <span className={css.label}>{t('clone.name')}</span>
            <Input
              value={draft?.name ?? ''}
              aria-label={t('clone.name')}
              data-board-clone="name"
              onChange={(event) => { setDraft(current => current === undefined ? current : { ...current, name: event.target.value }) }}
            />
          </label>
          <label className={css.field}>
            <span className={css.label}>{t('clone.role')}</span>
            <Input
              value={draft?.role ?? ''}
              aria-label={t('clone.role')}
              data-board-clone="role"
              onChange={(event) => { setDraft(current => current === undefined ? current : { ...current, role: event.target.value }) }}
            />
          </label>
        </div>

        <label className={css.field}>
          <span className={css.label}>{t('clone.description')}</span>
          <Input
            value={draft?.description ?? ''}
            aria-label={t('clone.description')}
            data-board-clone="description"
            onChange={(event) => { setDraft(current => current === undefined ? current : { ...current, description: event.target.value }) }}
          />
        </label>

        <label className={css.field}>
          <span className={css.label}>{t('clone.persona')}</span>
          <textarea
            className={css.textarea}
            value={draft?.persona ?? ''}
            aria-label={t('clone.persona')}
            data-board-clone="persona"
            placeholder={t('clone.persona.placeholder')}
            onChange={(event) => { setDraft(current => current === undefined ? current : { ...current, persona: event.target.value }) }}
          />
        </label>

        <label className={css.field}>
          <span className={css.label}>{t('clone.methodology')}</span>
          <textarea
            className={css.textarea}
            value={draft?.methodology ?? ''}
            aria-label={t('clone.methodology')}
            data-board-clone="methodology"
            placeholder={t('clone.methodology.placeholder')}
            onChange={(event) => { setDraft(current => current === undefined ? current : { ...current, methodology: event.target.value }) }}
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
                  setDraft(current => current === undefined ? current : { ...current, preferredModel: null })
                  return
                }
                const option = models[Number(id.slice('clone-model:'.length))]
                if (option === undefined) return
                const route = formatModelRoute(option.provider, option.model)
                setDraft(current => current === undefined ? current : { ...current, preferredModel: route })
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
              active={draft?.status === status}
              onClick={() => { setDraft(current => current === undefined ? current : { ...current, status }) }}
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
          <span className={css.revision} data-board-clone-revision={String(clone.revision)}>
            {t('clone.revision', { n: String(clone.revision) })}
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
