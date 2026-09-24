/**
 * Clone window body: the clone card editor. The window's `cloneId` selects the
 * record; the form holds a local draft, saves it under the revision it read, and
 * reports a conflict instead of overwriting a concurrent edit.
 *
 * A revision that moves under an unsaved draft re-bases the revision only: the
 * user's text survives, and the next save applies it over the newer record.
 * Fields the agent changed arrive as a marked pending revision the user applies,
 * or overwrites by editing that field, instead of silently losing typed text.
 *
 * The window edits a card, not a session: the interview gesture marks the clone
 * `interviewing`, binds a session with the interview role, and hands that
 * session to this very window, whose Interview tab then presents it.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button, IconEllipsisOutline16, Input, Menu, Modal, Pill, type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { CloneSessionBinding, CloneSkill, CloneStatus } from '@ketos/clone-core/types'
import {
  METHODOLOGY_TEMPLATE, methodologyGaps, methodologySections,
} from '@ketos/clone-core/methodology'
import { CLONE_STATUS_ROWS, TASK_OBJECTIVE_LIMIT, type BoardTaskOutcome, type BoardWindowInjected, type CloneModelOption } from '../contract/slots.ts'
import type { BoardStoreHandle } from '../store.ts'
import type { BoardTranslate } from '../locale.ts'
import { relativeAge } from '../relative-age.ts'
import { formatModelRoute } from '../clone-model.ts'
import {
  CLONE_LIMITS, CLONE_SKILL_NAME_PATTERN, changedFields, sameDraft, toDraft, toPatch, toStoredDraft,
  type CloneDraft, type CloneEdit, type CloneField,
} from '../clone-draft.ts'
import css from './CloneBody.module.css'

export type CloneBodyProps =
  PropsRuntime<'board.window.body'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>
  & InjectFace<BoardWindowInjected>

/** Notice the form shows above its actions after a mutation. */
type CloneNotice = 'conflict' | 'delete-conflict' | 'missing' | 'failed' | undefined

/** Lifecycle status locale key of one status row. */
const STATUS_KEYS = {
  draft: 'clone.status.draft',
  interviewing: 'clone.status.interviewing',
  ready: 'clone.status.ready',
} as const satisfies Record<CloneStatus, Parameters<BoardTranslate>[0]>

/** Chip state of one canonical methodology section in the live draft. */
type MethodologyState = 'filled' | 'empty' | 'missing'

/** Why the skill modal refused to save. */
type SkillError = 'name' | 'duplicate' | 'limit'

/** Locale key of one skill-modal validation failure. */
const SKILL_ERROR_KEYS = {
  name: 'clone.skills.invalid.name',
  duplicate: 'clone.skills.invalid.duplicate',
  limit: 'clone.skills.invalid.limit',
} as const satisfies Record<SkillError, Parameters<BoardTranslate>[0]>

/** Locale key of one Autopilot outcome notice. */
const AUTOPILOT_OUTCOME_KEYS = {
  started: 'tasks.outcome.started',
  cancelled: 'tasks.outcome.cancelled',
  missing: 'tasks.outcome.missing',
  'not-ready': 'tasks.outcome.not-ready',
  'agent-not-live': 'tasks.outcome.agent-not-live',
  conflict: 'tasks.outcome.conflict',
  failed: 'tasks.outcome.failed',
} as const satisfies Record<BoardTaskOutcome, Parameters<BoardTranslate>[0]>

/**
 * One draft skill as a row action or the modal addresses it: the list position
 * the action lands on and the name that position held when it was picked. A
 * revision that replaced the list leaves no matching position, so the action
 * is dropped instead of hitting whichever entry took the row's place.
 */
interface SkillRef {
  readonly index: number
  readonly name: string
}

/** The fields the skill modal edits, with the row it replaces while editing. */
interface SkillModalState {
  /** Row of the draft skill being edited; undefined while adding. */
  readonly original: SkillRef | undefined
  readonly name: string
  readonly description: string
  readonly instructions: string
  /** The refusal the modal shows, or undefined while its fields are unrefused. */
  readonly error: SkillError | undefined
}

/** Localized age of one clone's last update, in the board's short units. */
function updatedLabel(updatedAt: string, t: BoardTranslate): string {
  return t('clone.updated', { time: relativeAge(updatedAt, t) })
}

/** One field's "the agent changed this" badge, keyed by the field it marks. */
function AgentMark({ field, t }: { readonly field: CloneField; readonly t: BoardTranslate }) {
  return (
    <span className={css.agentBadge} data-board-clone-agent-field={field}>
      {t('clone.agent.updated')}
    </span>
  )
}

/**
 * Render the clone editor for the window's clone.
 * @param props - window owner props, the board store, the locale seat, and the clone actions.
 * @returns the editor, the waiting state, or the notice that the clone is gone.
 */
export function CloneBody({
  window: cardWindow,
  actions,
  t,
  useStore,
  useCloneList,
  useWindowSession,
  saveClone,
  deleteClone,
  loadCloneModels,
  loadCloneSessions,
  refreshClones,
  startCloneInterview,
  createTask,
  openTasksWindow,
  openChat,
}: CloneBodyProps) {
  const roster = useCloneList(source => source)
  const clone = cardWindow.cloneId === undefined
    ? undefined
    : roster.clones.find(entry => entry.id === cardWindow.cloneId)
  // Only the session identity matters here; a selector keeps a streamed chunk
  // from re-rendering the whole form while a turn runs.
  const windowSessionId = useWindowSession(cardWindow.id, state => state?.sessionId)
  // The draft lives in the board store, not in this component: the window
  // switches between its profile and interview bodies, and a remount must not
  // drop the user's text or the marks of what the agent rewrote.
  const cloneEdits = useStore(state => state.cloneEdits)
  const [notice, setNotice] = useState<CloneNotice>(undefined)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [autopilotObjective, setAutopilotObjective] = useState('')
  const [autopilotOutcome, setAutopilotOutcome] = useState<BoardTaskOutcome | undefined>(undefined)
  const [models, setModels] = useState<readonly CloneModelOption[]>([])
  const [sessions, setSessions] = useState<readonly CloneSessionBinding[]>([])
  const [sessionEpoch, setSessionEpoch] = useState(0)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [skillMenu, setSkillMenu] = useState<SkillRef | null>(null)
  const [skillModal, setSkillModal] = useState<SkillModalState | undefined>(undefined)
  const modelAnchor = useRef<HTMLButtonElement>(null)
  const skillAnchor = useRef<HTMLButtonElement | null>(null)

  const cloneId = cardWindow.cloneId
  const storedRevision = clone?.revision
  const editor = cloneId === undefined ? undefined : cloneEdits[cloneId]
  // The follow-the-record effect must read the newest draft without depending
  // on it: a dependency on the store field would re-run the effect on the
  // write the user's own save just made, adopting the roster read that has not
  // caught up yet and undoing that save.
  const editsRef = useRef(cloneEdits)
  editsRef.current = cloneEdits

  /** Replace this clone's editor state, or drop it with the clone. */
  const writeEdit = (next: CloneEdit | undefined): void => {
    if (cloneId === undefined) return
    actions.setCloneEdit(cardWindow.id, cloneId, next)
  }

  // Follow the stored record. A clean form takes the stored values and marks
  // the fields that moved since the last adoption; a form with unsaved edits
  // keeps them, adopts only the stored revision, and holds the stored values as
  // a pending revision the user explicitly applies — so a save that lost the
  // revision race is retryable instead of silently replacing what was typed.
  useEffect(() => {
    if (clone === undefined || cloneId === undefined) return
    const stored = toDraft(clone)
    const current = editsRef.current[cloneId]
    if (current === undefined) {
      // A clone the store has not seen yet is a fresh seed.
      writeEdit({ draft: stored, base: stored, revision: clone.revision, agentFields: [] })
      return
    }
    if (sameDraft(current.draft, current.base)) {
      if (current.incoming === undefined
        && current.revision === clone.revision
        && sameDraft(current.base, stored)) return
      writeEdit({ draft: stored, base: stored, revision: clone.revision, agentFields: changedFields(current.base, stored) })
      return
    }
    if (current.revision === clone.revision) return
    writeEdit({
      ...current,
      revision: clone.revision,
      incoming: stored,
      agentFields: changedFields(current.base, stored),
    })
  }, [clone?.id, storedRevision, cloneId])

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

  /** Replace fields of the live draft; an edited field leaves the agent's marks. */
  const edit = (patch: Partial<CloneDraft>): void => {
    if (editor === undefined) return
    const edited = new Set<string>(Object.keys(patch))
    writeEdit({
      ...editor,
      draft: { ...editor.draft, ...patch },
      agentFields: editor.agentFields.filter(field => !edited.has(field)),
    })
  }

  /** The "agent changed this" badge of one field, when it is marked. */
  const mark = (field: CloneField): ReactNode =>
    editor !== undefined && editor.agentFields.includes(field) ? <AgentMark field={field} t={t} /> : null

  /** The live draft's skills, shared by the row list and the modal. */
  const skills = editor?.draft.skills ?? []

  /** Open the skill modal on one draft row, or on empty fields for a new one. */
  const openSkillModal = (target?: SkillRef): void => {
    setSkillMenu(null)
    const skill = target === undefined ? undefined : skills[target.index]
    setSkillModal({
      original: target,
      name: skill?.name ?? '',
      description: skill?.description ?? '',
      instructions: skill?.instructions ?? '',
      error: undefined,
    })
  }

  /** Validate the modal's fields and apply them to the draft's skill list. */
  const onSaveSkill = (): void => {
    if (skillModal === undefined || editor === undefined) return
    const name = skillModal.name.trim()
    if (name === '' || name.length > CLONE_LIMITS.skillName || !CLONE_SKILL_NAME_PATTERN.test(name)) {
      setSkillModal({ ...skillModal, error: 'name' })
      return
    }
    // The edited row is addressed by its position and the name it held when the
    // modal opened: a revision that landed meanwhile may have moved or replaced
    // list entries, so the save must not land on a different skill.
    const original = skillModal.original
    const at = original !== undefined && skills[original.index]?.name === original.name
      ? original.index
      : -1
    if (skills.some((skill, index) => skill.name.trim() === name && index !== at)) {
      setSkillModal({ ...skillModal, error: 'duplicate' })
      return
    }
    if (at === -1 && skills.length >= CLONE_LIMITS.skillCount) {
      setSkillModal({ ...skillModal, error: 'limit' })
      return
    }
    const skill: CloneSkill = {
      name,
      description: skillModal.description,
      instructions: skillModal.instructions,
    }
    edit({
      skills: at === -1
        ? [...skills, skill]
        : skills.map((entry, index) => (index === at ? skill : entry)),
    })
    setSkillModal(undefined)
  }

  /** Apply one row-menu action to the skill the menu was opened on. */
  const onSkillMenuSelect = (id: string): void => {
    const target = skillMenu
    setSkillMenu(null)
    if (target === null) return
    const skill = skills[target.index]
    if (skill === undefined || skill.name !== target.name) return
    if (id === 'edit') {
      openSkillModal(target)
      return
    }
    edit({ skills: skills.filter((_entry, at) => at !== target.index) })
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
    if (editor === undefined || cloneId === undefined) return
    // The draft the request sends, and the normalized snapshot it leaves: the
    // route stores the trimmed name and role the patch carries, so the accepted
    // snapshot holds them and the stored record that follows matches the base.
    const draft = editor.draft
    const saved = toStoredDraft(draft)
    setBusy(true)
    const outcome = await saveClone(cloneId, toPatch(saved), editor.revision)
    setBusy(false)
    if (outcome === 'saved') {
      // This write is the user's own, so the stored record that follows is not
      // an agent revision: the accepted snapshot becomes the base and the
      // revision is the one the route minted, which keeps the form from reading
      // its own save as a pending agent draft. Text typed while the request ran
      // stays in the draft.
      const current = editsRef.current[cloneId]
      const accepted: CloneEdit = { draft: saved, base: saved, revision: editor.revision + 1, agentFields: [] }
      if (current === undefined || sameDraft(current.draft, draft)) {
        writeEdit(accepted)
      } else {
        // The user typed while the request ran: the accepted snapshot becomes
        // the base, the draft keeps their newer text, and the pending agent
        // revision this save superseded is dropped.
        const { incoming: _superseded, ...rest } = current
        writeEdit({ ...rest, base: saved, revision: editor.revision + 1, agentFields: [] })
      }
    }
    // Success needs no banner: the revision indicator moves and the drawer of
    // notices stays reserved for what the user must act on.
    setNotice(outcome === 'saved' ? undefined : outcome)
  }

  /** Replace the draft with the stored revision the agent saved. */
  const onApplyAgent = (): void => {
    if (editor?.incoming === undefined) return
    const { incoming, ...rest } = editor
    writeEdit({ ...rest, draft: incoming, base: incoming })
  }

  const onDelete = async (): Promise<void> => {
    if (editor === undefined || cloneId === undefined) return
    setBusy(true)
    const outcome = await deleteClone(cloneId, editor.revision)
    setBusy(false)
    setConfirmingDelete(false)
    if (outcome === 'deleted') {
      writeEdit(undefined)
      return
    }
    // A moved record needs a fresh confirmation, not the save-oriented text.
    setNotice(outcome === 'conflict' ? 'delete-conflict' : outcome)
  }

  const onStartInterview = async (): Promise<void> => {
    if (clone === undefined) return
    setBusy(true)
    const outcome = await startCloneInterview(clone, cardWindow.id)
    setBusy(false)
    if (outcome === 'failed') {
      setNotice('failed')
      return
    }
    setSessionEpoch(epoch => epoch + 1)
  }

  /**
   * Start one autonomous task for this clone: the objective is stored and the
   * task starts on a fresh session. A start shows the task where it runs — the
   * tasks window scoped to this clone, existing or new — while a refusal keeps
   * the typed objective and reports the outcome.
   */
  const onAutopilot = async (): Promise<void> => {
    if (clone === undefined) return
    const objective = autopilotObjective.trim()
    if (objective === '') return
    setBusy(true)
    setAutopilotOutcome(undefined)
    const outcome = await createTask(clone.id, objective)
    setBusy(false)
    setAutopilotOutcome(outcome)
    if (outcome !== 'started') return
    setAutopilotObjective('')
    // The board resolves the target window: an existing tasks window scoped to
    // this clone comes forward instead of a second one opening.
    openTasksWindow(clone.id)
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

  const methodology = editor?.draft.methodology ?? ''
  const methodologyRows = methodologySections(methodology)
  const methodologyMissing = methodologyGaps(methodology)
  const methodologyBlank = methodology.trim() === ''

  return (
    <div className={css.body}>
      <div className={css.form} data-board-clone-editor="">
        <div className={css.fieldRow}>
          <label className={css.field}>
            <span className={css.label}>{t('clone.name')}{mark('name')}</span>
            <Input
              value={editor?.draft.name ?? ''}
              maxLength={CLONE_LIMITS.name}
              aria-label={t('clone.name')}
              data-board-clone="name"
              onChange={(event) => { edit({ name: event.target.value }) }}
            />
          </label>
          <label className={css.field}>
            <span className={css.label}>{t('clone.role')}{mark('role')}</span>
            <Input
              value={editor?.draft.role ?? ''}
              maxLength={CLONE_LIMITS.role}
              aria-label={t('clone.role')}
              data-board-clone="role"
              onChange={(event) => { edit({ role: event.target.value }) }}
            />
          </label>
        </div>

        <label className={css.field}>
          <span className={css.label}>{t('clone.description')}{mark('description')}</span>
          <Input
            value={editor?.draft.description ?? ''}
            maxLength={CLONE_LIMITS.description}
            aria-label={t('clone.description')}
            data-board-clone="description"
            onChange={(event) => { edit({ description: event.target.value }) }}
          />
        </label>

        <label className={css.field}>
          <span className={css.label}>{t('clone.persona')}{mark('persona')}</span>
          <textarea
            className={css.textarea}
            value={editor?.draft.persona ?? ''}
            maxLength={CLONE_LIMITS.persona}
            aria-label={t('clone.persona')}
            data-board-clone="persona"
            placeholder={t('clone.persona.placeholder')}
            onChange={(event) => { edit({ persona: event.target.value }) }}
          />
        </label>

        <div className={css.field}>
          <span className={css.label}>{t('clone.methodology')}{mark('methodology')}</span>
          <textarea
            className={css.textarea}
            value={editor?.draft.methodology ?? ''}
            maxLength={CLONE_LIMITS.methodology}
            aria-label={t('clone.methodology')}
            data-board-clone="methodology"
            placeholder={t('clone.methodology.placeholder')}
            onChange={(event) => { edit({ methodology: event.target.value }) }}
          />
          <div className={css.row} data-board-clone="methodology-sections">
            <span className={css.label}>{t('clone.methodology.sections')}</span>
            {methodologyRows.map((section) => {
              const state: MethodologyState = !section.present ? 'missing' : section.empty ? 'empty' : 'filled'
              return (
                <span
                  key={section.heading}
                  data-board-clone-methodology-section={section.heading}
                  data-state={state}
                >
                  <Pill>
                    {section.heading}
                    {state !== 'filled' && (
                      <span className={css.sectionMark}>
                        {t(state === 'empty' ? 'clone.methodology.section.empty' : 'clone.methodology.section.missing')}
                      </span>
                    )}
                  </Pill>
                </span>
              )
            })}
          </div>
          {methodologyMissing.length > 0 && (
            <span className={css.hint} data-board-clone="methodology-gaps">
              {t('clone.methodology.gaps', { list: methodologyMissing.join(', ') })}
            </span>
          )}
          {methodologyBlank && (
            <div className={css.row}>
              <Button
                size="sm"
                variant="ghost"
                data-board-clone="methodology-template"
                onClick={() => { edit({ methodology: METHODOLOGY_TEMPLATE }) }}
              >
                {t('clone.methodology.template')}
              </Button>
            </div>
          )}
        </div>

        <div className={css.field}>
          <span className={css.label}>{t('clone.skills')}{mark('skills')}</span>
          <span className={css.hint}>{t('clone.skills.hint')}</span>
          <div className={css.row}>
            <Button
              size="sm"
              variant="outline"
              data-board-clone="skill-add"
              onClick={() => { openSkillModal() }}
            >
              {t('clone.skills.add')}
            </Button>
          </div>
          <div className={css.skillList} data-board-clone="skills">
            {skills.length === 0 && <span className={css.hint}>{t('clone.skills.empty')}</span>}
            {skills.map((skill, index) => {
              const name = skill.name.trim()
              const invalid: SkillError | undefined = name === ''
                || name.length > CLONE_LIMITS.skillName
                || !CLONE_SKILL_NAME_PATTERN.test(name)
                ? 'name'
                : skills.some((entry, at) => at !== index && entry.name.trim() === name) ? 'duplicate' : undefined
              return (
                <div key={`${skill.name}:${String(index)}`} className={css.skillRow} data-board-clone-skill-row={skill.name}>
                  <span className={css.skillName}>{skill.name}</span>
                  {invalid !== undefined
                    ? (
                      <span className={css.skillWarning} data-board-clone="skill-invalid">
                        {t(SKILL_ERROR_KEYS[invalid])}
                      </span>
                    )
                    : skill.description.trim() === ''
                      ? (
                        <span className={css.skillWarning} data-board-clone="skill-incomplete">
                          {t('clone.skills.incomplete')}
                        </span>
                      )
                      : <span className={css.skillDescription}>{skill.description}</span>}
                  <button
                    type="button"
                    className={css.rowAction}
                    data-board-clone-action="skill-menu"
                    aria-label={`${t('clone.skills.menu')}: ${skill.name}`}
                    onClick={(event) => {
                      skillAnchor.current = event.currentTarget
                      setSkillMenu({ index, name: skill.name })
                    }}
                  >
                    <IconEllipsisOutline16 />
                  </button>
                </div>
              )
            })}
          </div>
          <Menu
            portal
            autoFocus
            open={skillMenu !== null}
            side="bottom"
            align="end"
            selection="fill"
            anchor={<span className={css.anchor} />}
            getAnchorRect={() => skillAnchor.current?.getBoundingClientRect() ?? null}
            items={[
              { id: 'edit', label: t('clone.skills.edit') },
              { id: 'delete', label: t('clone.skills.delete'), danger: true },
            ]}
            onSelect={onSkillMenuSelect}
            onClose={() => { setSkillMenu(null) }}
          />
        </div>

        <Modal
          open={skillModal !== undefined}
          onClose={() => { setSkillModal(undefined) }}
          title={skillModal?.original === undefined ? t('clone.skills.modal.add') : t('clone.skills.modal.edit')}
          closeLabel={t('clone.cancel')}
          footer={(
            <>
              <Button
                variant="primary"
                data-board-clone-action="skill-save"
                onClick={onSaveSkill}
              >
                {t('clone.save')}
              </Button>
              <Button variant="outline" onClick={() => { setSkillModal(undefined) }}>
                {t('clone.cancel')}
              </Button>
            </>
          )}
        >
          {skillModal !== undefined && (
            <div className={css.skillForm}>
              <label className={css.field}>
                <span className={css.label}>{t('clone.skills.name')}</span>
                <Input
                  value={skillModal.name}
                  maxLength={CLONE_LIMITS.skillName}
                  aria-label={t('clone.skills.name')}
                  data-board-clone-skill="name"
                  onChange={(event) => { setSkillModal({ ...skillModal, name: event.target.value, error: undefined }) }}
                />
              </label>
              <label className={css.field}>
                <span className={css.label}>{t('clone.skills.description')}</span>
                <Input
                  value={skillModal.description}
                  maxLength={CLONE_LIMITS.skillDescription}
                  aria-label={t('clone.skills.description')}
                  data-board-clone-skill="description"
                  onChange={(event) => { setSkillModal({ ...skillModal, description: event.target.value, error: undefined }) }}
                />
              </label>
              <label className={css.field}>
                <span className={css.label}>{t('clone.skills.instructions')}</span>
                <textarea
                  className={css.textarea}
                  value={skillModal.instructions}
                  maxLength={CLONE_LIMITS.skillInstructions}
                  aria-label={t('clone.skills.instructions')}
                  data-board-clone-skill="instructions"
                  onChange={(event) => { setSkillModal({ ...skillModal, instructions: event.target.value, error: undefined }) }}
                />
              </label>
              {skillModal.error !== undefined && (
                <div className={clsx(css.notice, css.noticeError)} data-board-clone="skill-error">
                  {t(SKILL_ERROR_KEYS[skillModal.error], { n: CLONE_LIMITS.skillCount })}
                </div>
              )}
            </div>
          )}
        </Modal>

        <div className={css.field}>
          <span className={css.label}>{t('clone.model')}{mark('preferredModel')}</span>
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
          <span className={css.statusLabel}>{t('clone.status')}{mark('status')}</span>
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

        {editor?.incoming !== undefined && (
          <div className={clsx(css.notice, css.noticeAgent)} data-board-clone-notice="agent">
            <span>{t('clone.agent.pending')}</span>
            <Button
              size="sm"
              variant="outline"
              data-board-clone="apply-agent"
              onClick={onApplyAgent}
            >
              {t('clone.agent.apply')}
            </Button>
            <span className={css.hint}>{t('clone.agent.hint')}</span>
          </div>
        )}

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

        {autopilotOutcome !== undefined && (
          <div
            className={clsx(css.notice, autopilotOutcome === 'started' ? css.noticeSuccess : css.noticeError)}
            data-board-clone-notice={`autopilot-${autopilotOutcome}`}
          >
            {t(AUTOPILOT_OUTCOME_KEYS[autopilotOutcome])}
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
          <span className={css.updated} data-board-clone-updated="">
            {updatedLabel(clone.updatedAt, t)}
          </span>
        </div>

        <div className={css.actions}>
          <Button
            variant="outline"
            disabled={busy}
            data-board-clone="interview"
            onClick={() => { void onStartInterview() }}
          >
            {clone.status === 'draft' ? t('clone.interview.start') : t('clone.interview.restart')}
          </Button>
        </div>

        <div className={css.actions} data-board-clone="autopilot-row">
          <Input
            value={autopilotObjective}
            maxLength={TASK_OBJECTIVE_LIMIT}
            disabled={busy}
            aria-label={t('clone.autopilot.objective')}
            placeholder={t('clone.autopilot.placeholder')}
            data-board-clone="autopilot-objective"
            onChange={(event) => {
              setAutopilotObjective(event.target.value)
              setAutopilotOutcome(undefined)
            }}
          />
          <Button
            variant="outline"
            disabled={busy || autopilotObjective.trim() === ''}
            data-board-clone="autopilot"
            onClick={() => { void onAutopilot() }}
          >
            {t('clone.autopilot')}
          </Button>
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
              onClick={() => {
                if (binding.sessionId === windowSessionId) {
                  // This window already owns the session: switching tabs shows
                  // it here instead of focusing (or opening) another window.
                  actions.setWindowBodyKind(cardWindow.id, 'conversation')
                  return
                }
                openChat(binding.sessionId)
              }}
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
