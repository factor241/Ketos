/**
 * Window composer: the reference chat bar rebuilt for a floating window.
 *
 * It renders the context chips (working directory, agent preset), the card
 * (image attachments, text, tool row), the dock strips (goal, todo, queue),
 * the slash-command and `@` mention popups, and the full-access risk gate.
 * Every value comes from the injected per-window session state; every action
 * goes back through the injected callbacks — the component holds only the
 * draft, its images, and which menu is open.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import clsx from 'clsx'
import {
  IconBranchOutline16,
  IconChecklistOutline14,
  IconChevronDownOutline14,
  IconCloseOutline16,
  IconFolderOpen16,
  IconGoalOutline16,
  IconPaperclipOutline16,
  IconQueueOutline14,
  IconSendOutline16,
  IconShieldOutline16,
  IconSparkle16,
  IconStopFill16,
  Menu,
  RiskConfirmation,
  Tooltip,
  type MenuEntry,
  type MenuItem,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  BoardDraftImage, BoardMentionRow, BoardPromptMode, BoardWindowInjected,
  BoardWindowSessionState, WindowId,
} from '../contract/slots.ts'
import type { BoardTranslate } from '../locale.ts'
import css from './ComposerBar.module.css'

/** The permission chip's label per preset id. */
function permissionLabel(t: BoardTranslate, id: string): string {
  switch (id) {
    case 'read-only': return t('permission.readOnly')
    case 'workspace-write': return t('permission.workspaceWrite')
    case 'danger-full-access': return t('permission.fullAccess')
    default: return id
  }
}

/** The slash-command label per built-in command name. */
function commandLabel(t: BoardTranslate, name: string): string {
  switch (name) {
    case 'file': return t('command.file')
    case 'goal': return t('command.goal')
    case 'plan': return t('command.plan')
    case 'feedback': return t('command.feedback')
    case 'compact': return t('command.compact')
    case 'permission': return t('command.permission')
    case 'model': return t('command.model')
    case 'export': return t('command.export')
    default: return `/${name}`
  }
}

/** The slash-command description per built-in command name, falling back to the host text. */
function commandDescription(t: BoardTranslate, name: string, fallback: string): string {
  switch (name) {
    case 'file': return t('command.file.description')
    case 'goal': return t('command.goal.description')
    case 'plan': return t('command.plan.description')
    case 'feedback': return t('command.feedback.description')
    case 'compact': return t('command.compact.description')
    case 'permission': return t('command.permission.description')
    case 'model': return t('command.model.description')
    case 'export': return t('command.export.description')
    default: return fallback
  }
}

/** Context ring geometry. */
const RING_RADIUS = 8
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

export interface ComposerBarProps {
  /** Window the bar belongs to. */
  windowId: WindowId
  /** The window's session state. */
  session: BoardWindowSessionState | undefined
  /** Locale seat of the board namespace. */
  t: BoardTranslate
  /** Apply-side commands and lookups. */
  injected: Omit<BoardWindowInjected, 'keyedHooks' | 'ensureWindowSession'>
  /** Callback handed to the lane so the bar can grow the transcript first. */
  onSent: () => void
}

export function ComposerBar({ windowId, session, t, injected, onSent }: ComposerBarProps) {
  const [draft, setDraft] = useState('')
  const [images, setImages] = useState<readonly BoardDraftImage[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [cwdOpen, setCwdOpen] = useState(false)
  const [presetOpen, setPresetOpen] = useState(false)
  const [permissionOpen, setPermissionOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [fullAccessOpen, setFullAccessOpen] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [mentions, setMentions] = useState<readonly BoardMentionRow[]>([])
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const ready = session?.status === 'ready'
  const running = session?.running === true
  const blocked = session?.blocked
  const canSend = ready && blocked === undefined && (draft.trim() !== '' || images.length > 0)

  const slashQuery = /\/([a-z0-9-]*)$/i.exec(draft)
  const slashRows = useMemo(() => {
    if (slashQuery === null) return []
    const query = (slashQuery[1] ?? '').toLowerCase()
    const rows = session?.commands ?? []
    const filtered = query === '' ? rows : rows.filter(row => row.name.startsWith(query))
    return filtered.slice(0, 12)
  }, [slashQuery, session?.commands])

  // Mention discovery: one lookup per query, cancelled when the draft moves on.
  useEffect(() => {
    if (mentionQuery === null) {
      setMentions([])
      return
    }
    const controller = new AbortController()
    void injected.loadMentions(windowId, mentionQuery, controller.signal)
      .then((rows) => { setMentions(rows.slice(0, 12)) })
      .catch(() => { setMentions([]) })
    return () => { controller.abort() }
  }, [injected, windowId, mentionQuery])

  const trackMention = useCallback((next: string) => {
    const tail = /(?:^|\s)@([^\s@]*)$/.exec(next)
    setMentionQuery(tail === null ? null : (tail[1] ?? ''))
  }, [])

  const submit = (mode: BoardPromptMode): void => {
    const text = draft.trim()
    if (!canSend) return
    injected.sendPrompt(windowId, text, running ? mode : 'queue', images)
    setDraft('')
    setImages([])
    setMenuOpen(false)
    setMentionQuery(null)
    onSent()
  }

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault()
    submit('queue')
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Escape') {
      setMenuOpen(false)
      setMentionQuery(null)
      return
    }
    if (e.key !== 'Enter' || e.shiftKey) return
    e.preventDefault()
    submit(!e.metaKey && !e.ctrlKey ? 'queue' : 'steer')
  }

  const pickCommand = (name: string): void => {
    const row = session?.commands.find(entry => entry.name === name)
    if (row?.hint === undefined) {
      injected.runCommand(windowId, `/${name}`)
      setDraft('')
    } else {
      setDraft(`/${name} `)
    }
    setMenuOpen(false)
  }

  const pickMention = (row: BoardMentionRow): void => {
    setDraft(current => `${current.replace(/@[^\s@]*$/, '')}${row.insert} `)
    setMentionQuery(null)
  }

  const addImages = (files: readonly File[]): void => {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      const reader = new FileReader()
      reader.addEventListener('load', () => {
        const url = typeof reader.result === 'string' ? reader.result : ''
        const comma = url.indexOf(',')
        if (comma < 0) return
        setImages(current => [...current, {
          id: `${file.name}:${file.size}:${current.length}`,
          name: file.name,
          mediaType: file.type,
          data: url.slice(comma + 1),
          preview: url,
        }])
      })
      reader.readAsDataURL(file)
    }
  }

  const menuItems: readonly MenuEntry[] = useMemo(() => {
    const rows = session?.commands ?? []
    const build = (name: string): MenuEntry => ({
      id: name,
      label: commandLabel(t, name),
      icon: name === 'file' ? <IconPaperclipOutline16 /> : name === 'goal' ? <IconGoalOutline16 /> : <IconSparkle16 />,
    })
    const add = ['goal', 'plan', 'feedback'].filter(name => rows.some(row => row.name === name))
    const commands = ['compact', 'permission', 'model', 'export'].filter(name => rows.some(row => row.name === name))
    const entries: MenuEntry[] = []
    // The attachment entry is board-owned (inline images), not a host command.
    entries.push({ type: 'label', id: 'add', text: t('command.section.add') })
    entries.push({ id: 'file', label: commandLabel(t, 'file'), icon: <IconPaperclipOutline16 /> })
    for (const name of add) entries.push(build(name))
    if (commands.length > 0) {
      entries.push({ type: 'separator', id: 'sep' })
      entries.push({ type: 'label', id: 'commands', text: t('command.section.commands') })
      for (const name of commands) entries.push(build(name))
    }
    return entries
  }, [session?.commands, t])

  const modelItems: readonly MenuEntry[] = useMemo(() => {
    const state = session?.model
    if (state === undefined) return []
    const modelRows: MenuItem[] = []
    for (const group of state.groups) {
      for (const model of group.models) {
        modelRows.push({
          id: `model:${group.id}:${model.id}`,
          label: model.name,
          ...(state.model === model.id && state.provider === group.id ? { icon: <IconChecklistOutline14 /> } : {}),
        })
      }
    }
    const effortRows: MenuItem[] = state.efforts.map(effort => ({
      id: `effort:${effort.id}`,
      label: effort.name,
      ...(state.effort === effort.id ? { icon: <IconChecklistOutline14 /> } : {}),
    }))
    return [
      { id: 'model', label: t('model.menu'), submenu: modelRows },
      { id: 'effort', label: t('model.effort'), submenu: effortRows },
    ]
  }, [session?.model, t])

  const presetItems: readonly MenuEntry[] = useMemo(
    () => (session?.presets ?? []).map(preset => ({ id: preset.id, label: preset.name })),
    [session?.presets],
  )

  const todoDone = (session?.todos ?? []).filter(todo => todo.status === 'completed').length
  const todoActive = (session?.todos ?? []).filter(todo => todo.status === 'in_progress').length
  const todoPending = (session?.todos ?? []).filter(todo => todo.status === 'pending').length

  return (
    <div className={css.composerWrap}>
      {(session?.goal !== undefined || (session?.todos.length ?? 0) > 0 || (session?.queue.length ?? 0) > 0) && (
        <div className={css.strips}>
          {session?.goal !== undefined && (
            <div className={css.strip}>
              <IconGoalOutline16 />
              <span className={css.stripTitle}>{t(`goal.phase.${session.goal.phase}`)}</span>
              <span className={css.stripText}>{session.goal.objective}</span>
              {session.goal.phase === 'paused'
                ? (
                  <Tooltip label={t('goal.action.resume')} side="top">
                    <button type="button" className={css.stripAction} aria-label={t('goal.action.resume')} onClick={() => { injected.goalAction(windowId, 'resume') }}>
                      <IconChecklistOutline14 />
                    </button>
                  </Tooltip>
                )
                : (
                  <Tooltip label={t('goal.action.pause')} side="top">
                    <button type="button" className={css.stripAction} aria-label={t('goal.action.pause')} onClick={() => { injected.goalAction(windowId, 'pause') }}>
                      <IconChevronDownOutline14 />
                    </button>
                  </Tooltip>
                )}
              <Tooltip label={t('goal.action.clear')} side="top">
                <button type="button" className={css.stripAction} aria-label={t('goal.action.clear')} onClick={() => { injected.goalAction(windowId, 'clear') }}>
                  <IconCloseOutline16 />
                </button>
              </Tooltip>
            </div>
          )}
          {(session?.todos.length ?? 0) > 0 && (
            <div className={css.strip}>
              <IconChecklistOutline14 />
              <span className={css.stripTitle}>{t('todo.title')}</span>
              <span className={css.stripText}>
                {t('todo.counts', { done: String(todoDone), active: String(todoActive), pending: String(todoPending) })}
              </span>
            </div>
          )}
          {(session?.queue.length ?? 0) > 0 && (
            <div className={css.strip}>
              <IconQueueOutline14 />
              <span className={css.stripTitle}>{t('queue.count', { n: String(session?.queue.length ?? 0) })}</span>
            </div>
          )}
          {(session?.queue ?? []).map(row => (
            <div key={row.id} className={css.strip}>
              <span className={css.stripText}>{row.preview}</span>
              <Tooltip label={t('queue.steer')} side="top">
                <button type="button" className={css.stripAction} aria-label={t('queue.steer')} onClick={() => { injected.updateQueueItem(windowId, row.id, 'steer') }}>
                  <IconQueueOutline14 />
                </button>
              </Tooltip>
              <Tooltip label={t('queue.remove')} side="top">
                <button type="button" className={css.stripAction} aria-label={t('queue.remove')} onClick={() => { injected.updateQueueItem(windowId, row.id, 'remove') }}>
                  <IconCloseOutline16 />
                </button>
              </Tooltip>
            </div>
          ))}
        </div>
      )}

      <div className={css.contextRow}>
        <Tooltip label={session?.cwd ?? t('cwd.none')} side="top">
          <button
            type="button"
            className={css.chip}
            disabled={!(session?.blank ?? false)}
            onClick={() => { setCwdOpen(!cwdOpen) }}
            aria-label={t('cwd.choose')}
          >
            <span className={css.chipIcon}><IconFolderOpen16 /></span>
            <span className={css.chipLabel}>{session?.cwd ?? t('cwd.choose')}</span>
            <span className={css.chipIcon}><IconChevronDownOutline14 /></span>
          </button>
        </Tooltip>
        <Menu
          open={cwdOpen}
          align="start"
          selection="fill"
          anchor={<span />}
          items={[{ id: 'pick', label: t('cwd.pick'), icon: <IconFolderOpen16 /> }]}
          onSelect={() => { setCwdOpen(false); injected.pickWorkspace(windowId) }}
          onClose={() => { setCwdOpen(false) }}
        />

        <Tooltip label={t('preset.hint')} side="top">
          <button
            type="button"
            className={css.chip}
            disabled={!(session?.blank ?? false) || (session?.presets.length ?? 0) === 0}
            onClick={() => { setPresetOpen(!presetOpen) }}
            aria-label={t('preset.aria')}
          >
            <span className={css.chipIcon}><IconBranchOutline16 /></span>
            <span className={css.chipLabel}>
              {(session?.presets ?? []).find(preset => preset.id === session?.presetId)?.name
                ?? ((session?.presets.length ?? 0) === 0 ? t('preset.none') : session?.presetId)
                ?? t('preset.none')}
            </span>
            <span className={css.chipIcon}><IconChevronDownOutline14 /></span>
          </button>
        </Tooltip>
        <Menu
          open={presetOpen}
          align="start"
          selection="fill"
          anchor={<span />}
          items={presetItems}
          onSelect={(id) => { setPresetOpen(false); injected.selectAgentPreset(windowId, id) }}
          onClose={() => { setPresetOpen(false) }}
        />
      </div>

      {mentionQuery !== null && (
        <div className={css.popup} role="listbox" aria-label={t('mention.aria')}>
          {mentions.length === 0 && <div className={css.popupEmpty}>{t('mention.empty')}</div>}
          {mentions.map(row => (
            <button key={row.id} type="button" role="option" className={css.popupRow} onClick={() => { pickMention(row) }}>
              <span className={css.popupName}>{row.label}</span>
              <span className={css.popupHint}>{row.kind}</span>
            </button>
          ))}
        </div>
      )}

      {slashRows.length > 0 && mentionQuery === null && (
        <div className={css.popup} role="listbox" aria-label={t('command.menuAria')}>
          {slashRows.map(row => (
            <button key={row.name} type="button" role="option" className={css.popupRow} onClick={() => { pickCommand(row.name) }}>
              <span className={css.popupName}>{commandLabel(t, row.name)}</span>
              {row.hint !== undefined && <span className={css.popupHint}>{row.hint}</span>}
              <span className={css.popupDescription}>{commandDescription(t, row.name, row.description)}</span>
            </button>
          ))}
        </div>
      )}

      <form className={css.card} onSubmit={handleSubmit} data-composer-card="">
        {images.length > 0 && (
          <div className={css.attachments}>
            {images.map(image => (
              <div key={image.id} className={css.attachment}>
                <img className={css.attachmentImage} src={image.preview} alt={image.name} />
                <button
                  type="button"
                  className={css.attachmentRemove}
                  aria-label={t('attachment.remove', { name: image.name })}
                  onClick={() => { setImages(current => current.filter(item => item.id !== image.id)) }}
                >
                  <IconCloseOutline16 />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          className={css.input}
          value={draft}
          rows={2}
          placeholder={t('composer.placeholder')}
          aria-label={t('composer.placeholder')}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
            setDraft(e.target.value)
            trackMention(e.target.value)
          }}
          onKeyDown={handleKeyDown}
        />

        {blocked !== undefined && <div className={css.blocked}>{blocked}</div>}

        <div className={css.toolRow}>
          <Menu
            open={menuOpen}
            side="top"
            align="start"
            selection="fill"
            anchor={(
              <Tooltip label={t('composer.actions')} side="top">
                <button
                  type="button"
                  className={css.roundButton}
                  onClick={() => { setMenuOpen(!menuOpen) }}
                  aria-label={t('composer.actions')}
                >
                  +
                </button>
              </Tooltip>
            )}
            items={menuItems}
            onSelect={(id) => {
              setMenuOpen(false)
              if (id === 'file') {
                fileInput.current?.click()
                return
              }
              pickCommand(id)
            }}
            onClose={() => { setMenuOpen(false) }}
          />
          <input
            ref={fileInput}
            className={css.fileInput}
            type="file"
            accept="image/*"
            multiple
            aria-label={t('attachment.pick')}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              addImages([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />

          {(session?.permissions.length ?? 0) > 0 && (
            <>
              <Menu
                open={permissionOpen}
                side="top"
                align="start"
                selection="fill"
                anchor={(
                  <Tooltip label={t('permission.aria')} side="top">
                    <button
                      type="button"
                      className={css.chip}
                      onClick={() => { setPermissionOpen(!permissionOpen) }}
                      aria-label={t('permission.aria')}
                    >
                      <span className={css.chipIcon}><IconShieldOutline16 /></span>
                      <span className={css.chipLabel}>
                        {permissionLabel(t, session?.permission ?? '')}
                      </span>
                      <span className={css.chipIcon}><IconChevronDownOutline14 /></span>
                    </button>
                  </Tooltip>
                )}
                items={(session?.permissions ?? []).map(option => ({ id: option.id, label: permissionLabel(t, option.id) }))}
                onSelect={(id) => {
                  setPermissionOpen(false)
                  const option = session?.permissions.find(entry => entry.id === id)
                  if (option?.dangerous === true) {
                    setAcknowledged(false)
                    setFullAccessOpen(true)
                    return
                  }
                  injected.selectPermission(windowId, id)
                }}
                onClose={() => { setPermissionOpen(false) }}
              />
            </>
          )}

          {session?.plan === true && (
            <Tooltip label={t('plan.exit')} side="top">
              <button
                type="button"
                className={css.chip}
                onClick={() => { injected.exitPlanMode(windowId) }}
                aria-label={t('plan.exit')}
              >
                <span className={css.chipIcon}><IconChecklistOutline14 /></span>
                <span className={css.chipLabel}>{t('plan.active')}</span>
              </button>
            </Tooltip>
          )}

          <span className={css.toolRowSpacer} />

          {session?.context !== undefined && (
            <Tooltip label={t('context.aria', { percent: String(session.context.percent) })} side="top">
              <span className={css.context}>
                <svg className={css.ring} viewBox="0 0 20 20" aria-hidden="true">
                  <circle className={css.ringTrack} cx="10" cy="10" r={RING_RADIUS} />
                  <circle
                    className={css.ringValue}
                    cx="10"
                    cy="10"
                    r={RING_RADIUS}
                    strokeDasharray={`${RING_CIRCUMFERENCE * session.context.percent / 100} ${RING_CIRCUMFERENCE}`}
                  />
                </svg>
                <span>{session.context.percent}%</span>
              </span>
            </Tooltip>
          )}

          <Menu
            open={modelOpen}
            side="top"
            align="end"
            selection="fill"
            anchor={(
              <Tooltip label={t('model.aria')} side="top">
                <button
                  type="button"
                  className={css.chip}
                  onClick={() => { setModelOpen(!modelOpen) }}
                  aria-label={t('model.aria')}
                >
                  <span className={css.chipLabel}>
                    {session?.model.modelName ?? session?.model.model
                      ?? (session?.model.loading === true ? t('model.loading') : t('model.none'))}
                  </span>
                  {session?.model.effortName !== undefined && (
                    <span className={css.chipLabel}>{session.model.effortName}</span>
                  )}
                  <span className={css.chipIcon}><IconChevronDownOutline14 /></span>
                </button>
              </Tooltip>
            )}
            items={modelItems}
            onSelect={(id) => {
              setModelOpen(false)
              if (id.startsWith('model:')) {
                const [, provider, model] = id.split(':')
                if (provider === undefined || model === undefined) return
                injected.selectModel(windowId, { provider, model })
                return
              }
              if (id.startsWith('effort:')) {
                const effort = id.slice('effort:'.length)
                const provider = session?.model.provider
                const model = session?.model.model
                if (provider === undefined || model === undefined) return
                injected.selectModel(windowId, { provider, model, reasoningEffort: effort })
              }
            }}
            onClose={() => { setModelOpen(false) }}
          />

          {running
            ? (
              <Tooltip label={t('agent.stop')} side="top">
                <button
                  type="button"
                  className={clsx(css.primary, css.stop)}
                  onClick={() => { injected.cancelPrompt(windowId) }}
                  aria-label={t('agent.stop')}
                >
                  <IconStopFill16 />
                </button>
              </Tooltip>
            )
            : (
              <Tooltip label={t('menu.send')} side="top">
                <button
                  type="submit"
                  className={clsx(css.primary, canSend && css.ready)}
                  disabled={!canSend}
                  aria-label={t('menu.send')}
                >
                  <IconSendOutline16 />
                </button>
              </Tooltip>
            )}
        </div>
      </form>

      <RiskConfirmation
        open={fullAccessOpen}
        title={t('permission.confirm.title')}
        description={t('permission.confirm.description')}
        acknowledgeLabel={t('permission.confirm.acknowledge')}
        cancelLabel={t('permission.confirm.cancel')}
        closeLabel={t('window.close')}
        confirmLabel={t('permission.confirm.enable')}
        acknowledged={acknowledged}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => { setFullAccessOpen(false) }}
        onConfirm={() => {
          setFullAccessOpen(false)
          injected.selectPermission(windowId, 'danger-full-access')
        }}
      />
    </div>
  )
}
