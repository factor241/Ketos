/**
 * Window composer: the reference chat bar rebuilt for a floating window.
 *
 * It renders the context chips (agent preset, permission, plan), the card
 * (image and file attachments, text, tool row), the dock strips (goal, todo,
 * queue), the slash-command and `@` mention popups, and the full-access risk
 * gate. Every popover opens through the shared `Menu` portal so nothing is
 * clipped by the window and the lists stay above the tooltips; the layout
 * follows the card's own width through container queries so no row can push
 * the send button out of the window. Every value comes from the injected
 * per-window session state; every action goes back through the injected
 * callbacks — the component holds only the draft, its attachments, and which
 * menu is open.
 *
 * Submission follows the board's own policy (documented in the package
 * README): plain Enter queues or sends, Cmd/Ctrl+Enter steers the running
 * turn, and the bar reads no submission-preference setting.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent, type KeyboardEvent } from 'react'
import clsx from 'clsx'
import {
  IconBranchOutline16,
  IconChecklistOutline14,
  IconChevronDownOutline14,
  IconCloseOutline16,
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
  BoardCommandRow, BoardDraftFile, BoardDraftImage, BoardMentionRow, BoardPromptMode, BoardWindowInjectProps,
  BoardWindowSessionState, WindowId,
} from '../contract/slots.ts'
import type { BoardTranslate } from '../locale.ts'
import { MicGlyph, useDictation } from './dictation.tsx'
import css from './ComposerBar.module.css'

/** The popover kinds the bar owns; one is open at a time. */
type MenuKind = 'actions' | 'preset' | 'permission' | 'model'

/** The board-owned palette entries the host registry does not carry. */
const BUILTIN_COMMANDS = ['file', 'model'] as const

/** Localized status line of one draft file chip. */
const FILE_STATUS_KEYS = {
  uploading: 'attachment.uploading',
  ready: 'attachment.ready',
  error: 'attachment.error',
} as const satisfies Record<BoardDraftFile['status'], string>

/** One open popover: which trigger owns it and where it is placed. */
interface OpenMenu {
  readonly kind: MenuKind
  readonly side: 'top' | 'bottom'
  readonly align: 'start' | 'end'
}

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
    case 'voice': return t('command.voice')
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

/** The mention kind's localized label. */
function mentionKindLabel(t: BoardTranslate, kind: BoardMentionRow['kind']): string {
  switch (kind) {
    case 'file': return t('mention.kind.file')
    case 'directory': return t('mention.kind.directory')
    case 'session': return t('mention.kind.session')
  }
}

/** The command name a draft addresses, when it leads with one. */
function leadingCommand(text: string): string | null {
  const match = /^\/([a-z][a-z0-9_-]*)(?=\s|$)/i.exec(text)
  return match?.[1]?.toLowerCase() ?? null
}

/** Human byte size for the attachment-limit messages: one decimal at most. */
function sizeText(t: BoardTranslate, bytes: number): string {
  const round = (value: number): number => Math.round(value * 10) / 10
  if (bytes >= 1024 * 1024) return t('size.megabytes', { value: String(round(bytes / (1024 * 1024))) })
  if (bytes >= 1024) return t('size.kilobytes', { value: String(round(bytes / 1024)) })
  return t('size.bytes', { value: String(bytes) })
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
  injected: Omit<BoardWindowInjectProps, 'useWindowSession'>
  /** Callback handed to the lane so the bar can grow the transcript first. */
  onSent: () => void
}

export function ComposerBar({ windowId, session, t, injected, onSent }: ComposerBarProps) {
  const [draft, setDraft] = useState('')
  const [images, setImages] = useState<readonly BoardDraftImage[]>([])
  const [files, setFiles] = useState<readonly BoardDraftFile[]>([])
  const [intakeError, setIntakeError] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const [fullAccessOpen, setFullAccessOpen] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [mentions, setMentions] = useState<readonly BoardMentionRow[]>([])
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  // Escape dismisses the command palette for the current draft; the next edit
  // brings it back, so the menu never traps the keyboard.
  const [commandsDismissed, setCommandsDismissed] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const cardRef = useRef<HTMLFormElement>(null)
  const actionsAnchor = useRef<HTMLButtonElement>(null)
  const presetAnchor = useRef<HTMLButtonElement>(null)
  const permissionAnchor = useRef<HTMLButtonElement>(null)
  const modelAnchor = useRef<HTMLButtonElement>(null)
  // Source files of non-image chips, kept for retry after a failed upload.
  const fileSources = useRef(new Map<string, File>())
  const dragDepth = useRef(0)

  /**
   * Open one popover, or close it when its own trigger is clicked again. The
   * placement follows the trigger's position: the side with more room wins and
   * a trigger past the middle of the viewport aligns its list to the end.
   */
  const openMenu = useCallback((kind: MenuKind, trigger: HTMLElement | null): void => {
    setMenu((current) => {
      if (current?.kind === kind) return null
      const rect = trigger?.getBoundingClientRect() ?? cardRef.current?.getBoundingClientRect()
      if (rect === undefined) return { kind, side: 'top', align: 'start' }
      return {
        kind,
        side: rect.top >= window.innerHeight - rect.bottom ? 'top' : 'bottom',
        align: rect.left > window.innerWidth / 2 ? 'end' : 'start',
      }
    })
  }, [])
  const closeMenu = useCallback(() => { setMenu(null) }, [])
  const isOpen = (kind: MenuKind): boolean => menu?.kind === kind
  const sideOf = (kind: MenuKind): 'top' | 'bottom' => menu?.kind === kind ? menu.side : 'top'
  const alignOf = (kind: MenuKind): 'start' | 'end' => menu?.kind === kind ? menu.align : 'start'

  const dictation = useDictation((text) => {
    setDraft(current => current === '' ? text : `${current} ${text}`)
  })

  const ready = session?.status === 'ready'
  const running = session?.running === true
  const blocked = session?.blocked
  const uploading = files.some(file => file.status === 'uploading')
  const readyFiles = files.filter(file => file.status === 'ready' && file.receiptId !== undefined)
  const hasDraft = draft.trim() !== '' || images.length > 0 || readyFiles.length > 0
  const canSend = ready && blocked === undefined && !uploading && hasDraft
  const canAcceptDrop = ready && blocked === undefined

  const slashQuery = commandsDismissed ? null : /\/([a-z0-9-]*)$/i.exec(draft)
  const slashRows = useMemo(() => {
    if (slashQuery === null) return []
    const query = (slashQuery[1] ?? '').toLowerCase()
    const builtins: BoardCommandRow[] = BUILTIN_COMMANDS.map(name => ({
      name,
      description: commandDescription(t, name, ''),
    }))
    const host = (session?.commands ?? []).filter(row => !BUILTIN_COMMANDS.includes(row.name as typeof BUILTIN_COMMANDS[number]))
    const rows = [...builtins, ...host]
    const filtered = query === '' ? rows : rows.filter(row => row.name.startsWith(query))
    return filtered.slice(0, 12)
  }, [slashQuery, session?.commands, t])

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

  const clearDraft = (): void => {
    setDraft('')
    setImages([])
    setFiles([])
    setIntakeError(null)
    fileSources.current.clear()
    closeMenu()
    setMentionQuery(null)
    // Sending ends dictation: the transcript belongs to the message it fed.
    dictation.stop()
  }

  const submit = (mode: BoardPromptMode): void => {
    const text = draft.trim()
    if (!canSend) return
    const name = leadingCommand(text)
    if (name === 'file') {
      fileInput.current?.click()
      clearDraft()
      return
    }
    if (name === 'model') {
      clearDraft()
      openMenu('model', modelAnchor.current)
      return
    }
    const command = name === null ? undefined : session.commands.find(row => row.name === name)

    if (command !== undefined) {
      injected.executeCommand(windowId, text, images, readyFiles.map(file => file.receiptId as string))
      clearDraft()
      onSent()
      return
    }
    injected.sendPrompt(
      windowId,
      text,
      running ? mode : 'queue',
      images,
      readyFiles.map(file => file.receiptId as string),
    )
    clearDraft()
    onSent()
  }

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault()
    submit('queue')
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Escape') {
      closeMenu()
      setMentionQuery(null)
      setCommandsDismissed(true)
      return
    }
    if (e.key !== 'Enter' || e.shiftKey) return
    e.preventDefault()
    submit(!e.metaKey && !e.ctrlKey ? 'queue' : 'steer')
  }

  const pickCommand = (name: string): void => {
    closeMenu()
    if (name === 'file') {
      fileInput.current?.click()
      setDraft('')
      return
    }
    if (name === 'model') {
      setDraft('')
      openMenu('model', modelAnchor.current)
      return
    }
    const row = session?.commands.find(entry => entry.name === name)
    if (row?.hint === undefined) {
      injected.executeCommand(windowId, `/${name}`, images, readyFiles.map(file => file.receiptId as string))
      clearDraft()
    } else {
      setDraft(`/${name} `)
    }
  }

  const pickMention = (row: BoardMentionRow): void => {
    setDraft(current => `${current.replace(/@[^\s@]*$/, '')}${row.insert} `)
    setMentionQuery(null)
  }

  /** Stage one non-image file through the background upload service. */
  const stageFile = useCallback(async (file: File, existingId?: string): Promise<void> => {
    const id = existingId ?? `${file.name}:${file.size}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 6)}`
    fileSources.current.set(id, file)
    setFiles(current => existingId === undefined
      ? [...current, { id, name: file.name, status: 'uploading' }]
      : current.map(item => item.id === existingId ? { ...item, status: 'uploading' as const } : item))
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const result = await injected.uploadFile(windowId, file.name, bytes)
      setFiles(current => current.map(item => item.id === id
        ? result.receiptId !== undefined
          ? { ...item, status: 'ready' as const, receiptId: result.receiptId }
          : { ...item, status: 'error' as const, error: result.error ?? t('attachment.error') }
        : item))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setFiles(current => current.map(item => item.id === id ? { ...item, status: 'error' as const, error: message } : item))
    }
  }, [injected, t, windowId])

  /** Retry one failed upload from its retained source file. */
  const retryFile = (id: string): void => {
    const source = fileSources.current.get(id)
    if (source === undefined) return
    void stageFile(source, id)
  }

  const removeFile = (id: string): void => {
    fileSources.current.delete(id)
    setFiles(current => current.filter(item => item.id !== id))
  }

  /**
   * Intake one picked, pasted, or dropped batch. Image attachments obey the
   * projected limits as a whole batch — a batch that would break one is refused
   * with the localized reason and never enters the rail — while other files
   * carry no client-side limit and upload as soon as they arrive.
   */
  const intake = (incoming: readonly File[]): void => {
    if (incoming.length === 0) return
    const limits = session?.imageLimits
    // The projected media types own the split where the host exposes them: an
    // image type outside the list stages like any other file.
    const isImage = (file: File): boolean =>
      limits === undefined ? file.type.startsWith('image/') : limits.mediaTypes.includes(file.type)
    const imageFiles = incoming.filter(isImage)
    const otherFiles = incoming.filter(file => !isImage(file))
    if (limits !== undefined && imageFiles.length > 0) {
      if (images.length + imageFiles.length > limits.maxImagesPerMessage) {
        setIntakeError(t('image.tooMany', { count: String(limits.maxImagesPerMessage) }))
        return
      }
      if (imageFiles.some(file => file.size > limits.maxImageBytes)) {
        setIntakeError(t('image.fileTooLarge', { size: sizeText(t, limits.maxImageBytes) }))
        return
      }
      const total = imagesBytes(images) + imageFiles.reduce((sum, file) => sum + file.size, 0)
      if (total > limits.maxMessageImageBytes) {
        setIntakeError(t('image.totalTooLarge', { size: sizeText(t, limits.maxMessageImageBytes) }))
        return
      }
    }
    setIntakeError(null)
    for (const file of imageFiles) {
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
    for (const file of otherFiles) void stageFile(file)
  }

  const handleDragEnter = (e: DragEvent<HTMLDivElement>): void => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    dragDepth.current += 1
    setDragActive(true)
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>): void => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = canAcceptDrop ? 'copy' : 'none'
  }

  const handleDragLeave = (): void => {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragActive(false)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    dragDepth.current = 0
    setDragActive(false)
    if (!canAcceptDrop) return
    intake([...e.dataTransfer.files])
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
    // Attachment, dictation, and model entries are board-owned, not host commands.
    entries.push({ type: 'label', id: 'add', text: t('command.section.add') })
    entries.push({ id: 'file', label: commandLabel(t, 'file'), icon: <IconPaperclipOutline16 /> })
    entries.push({ id: 'voice', label: commandLabel(t, 'voice'), icon: <MicGlyph /> })
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
  const hasStrips = session?.goal !== undefined || (session?.todos.length ?? 0) > 0 || (session?.queue.length ?? 0) > 0

  return (
    <div
      className={clsx(css.composerWrap, dragActive && css.dropActive)}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragActive && (
        <div className={css.dropHint} data-board-drop-hint="">{t('attachment.drop')}</div>
      )}

      {hasStrips && (
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
        <Tooltip label={t('preset.hint')} side="top" disabled={isOpen('preset')}>
          <button
            ref={presetAnchor}
            type="button"
            className={clsx(css.chip, css.presetChip)}
            disabled={!(session?.blank ?? false) || (session?.presets.length ?? 0) === 0}
            onClick={() => { openMenu('preset', presetAnchor.current) }}
            data-board-action="composer-preset"
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
          portal
          open={isOpen('preset')}
          side={sideOf('preset')}
          align={alignOf('preset')}
          selection="fill"
          anchor={<span className={css.anchor} />}
          getAnchorRect={() => presetAnchor.current?.getBoundingClientRect() ?? null}
          items={presetItems}
          onSelect={(id) => { closeMenu(); injected.selectAgentPreset(windowId, id) }}
          onClose={closeMenu}
        />
      </div>

      {mentionQuery !== null && (
        <div className={css.popup} role="listbox" aria-label={t('mention.aria')}>
          {mentions.length === 0 && <div className={css.popupEmpty}>{t('mention.empty')}</div>}
          {mentions.map(row => (
            <button key={row.id} type="button" role="option" className={css.popupRow} onClick={() => { pickMention(row) }}>
              <span className={css.popupName}>{row.label}</span>
              <span className={css.popupHint}>{mentionKindLabel(t, row.kind)}</span>
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

      <form ref={cardRef} className={css.card} onSubmit={handleSubmit} data-composer-card="">
        {(images.length > 0 || files.length > 0) && (
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
            {files.map(file => (
              <div
                key={file.id}
                className={clsx(css.fileChip, file.status === 'error' && css.fileChipError)}
                data-board-file={file.status}
                title={file.error}
              >
                <IconPaperclipOutline16 />
                <span className={css.fileName}>{file.name}</span>
                <span className={css.fileStatus}>{t(FILE_STATUS_KEYS[file.status])}</span>
                {file.status === 'error' && (
                  <button
                    type="button"
                    className={css.fileAction}
                    aria-label={t('attachment.retry')}
                    onClick={() => { retryFile(file.id) }}
                  >
                    {t('attachment.retry')}
                  </button>
                )}
                <button
                  type="button"
                  className={css.fileAction}
                  aria-label={t('attachment.remove', { name: file.name })}
                  onClick={() => { removeFile(file.id) }}
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
          data-board-action="composer-input"
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
            setDraft(e.target.value)
            setCommandsDismissed(false)
            trackMention(e.target.value)
          }}
          onKeyDown={handleKeyDown}
          onPaste={(e) => {
            const pasted = [...e.clipboardData.items]
              .filter(item => item.kind === 'file')
              .map(item => item.getAsFile())
              .filter((file): file is File => file !== null)
            if (pasted.length === 0) return
            intake(pasted)
            // A mixed clipboard keeps its text: the files are staged and the
            // browser inserts the text as usual.
            if (e.clipboardData.getData('text/plain') === '') e.preventDefault()
          }}
        />

        {blocked !== undefined && (
          <div className={css.blocked} data-board-blocked={blocked}>
            {t('conversation.blocked')}: {blocked}
          </div>
        )}
        {intakeError !== null && (
          <div className={css.intakeError} data-board-attachment-error="">{intakeError}</div>
        )}
        {session?.commandError !== undefined && (
          <div className={css.intakeError} data-board-command-error="">
            {t('command.failed')}: {session.commandError}
          </div>
        )}

        <div className={css.toolRow}>
          <div className={css.toolGroup}>
            <Menu
              portal
              open={isOpen('actions')}
              side={sideOf('actions')}
              align={alignOf('actions')}
              selection="fill"
              anchor={(
                <Tooltip label={t('composer.actions')} side="top" disabled={isOpen('actions')}>
                  <button
                    ref={actionsAnchor}
                    type="button"
                    className={css.roundButton}
                    onClick={() => { openMenu('actions', actionsAnchor.current) }}
                    data-board-action="composer-actions"
                    aria-label={t('composer.actions')}
                  >
                    +
                  </button>
                </Tooltip>
              )}
              items={menuItems}
              onSelect={(id) => {
                closeMenu()
                if (id === 'voice') {
                  dictation.toggle()
                  return
                }
                pickCommand(id)
              }}
              onClose={closeMenu}
            />
            <input
              ref={fileInput}
              className={css.fileInput}
              type="file"
              multiple
              aria-label={t('attachment.pick')}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                intake([...(e.target.files ?? [])])
                e.target.value = ''
              }}
            />

            <Tooltip
              label={dictation.supported
                ? (dictation.listening ? t('voice.stop') : t('voice.start'))
                : t('voice.unsupported')}
              side="top"
            >
              <button
                type="button"
                className={clsx(css.roundButton, css.ghost, dictation.listening && css.listening)}
                disabled={!dictation.supported}
                aria-pressed={dictation.listening}
                data-board-action="composer-dictate"
                aria-label={t('voice.start')}
                onClick={dictation.toggle}
              >
                <MicGlyph />
              </button>
            </Tooltip>

            {(session?.permissions.length ?? 0) > 0 && (
              <>
                <Tooltip label={t('permission.aria')} side="top" disabled={isOpen('permission')}>
                  <button
                    ref={permissionAnchor}
                    type="button"
                    className={clsx(css.chip, css.permissionChip)}
                    onClick={() => { openMenu('permission', permissionAnchor.current) }}
                    data-board-action="composer-permission"
                    aria-label={t('permission.aria')}
                  >
                    <span className={css.chipIcon}><IconShieldOutline16 /></span>
                    <span className={css.chipLabel}>
                      {permissionLabel(t, session?.permission ?? '')}
                    </span>
                    <span className={css.chipIcon}><IconChevronDownOutline14 /></span>
                  </button>
                </Tooltip>
                <Menu
                  portal
                  open={isOpen('permission')}
                  side={sideOf('permission')}
                  align={alignOf('permission')}
                  selection="fill"
                  anchor={<span className={css.anchor} />}
                  getAnchorRect={() => permissionAnchor.current?.getBoundingClientRect() ?? null}
                  items={(session?.permissions ?? []).map(option => ({ id: option.id, label: permissionLabel(t, option.id) }))}
                  onSelect={(id) => {
                    closeMenu()
                    const option = session?.permissions.find(entry => entry.id === id)
                    if (option?.dangerous === true) {
                      setAcknowledged(false)
                      setFullAccessOpen(true)
                      return
                    }
                    injected.selectPermission(windowId, id)
                  }}
                  onClose={closeMenu}
                />
              </>
            )}

            {session?.plan === true && (
              <Tooltip label={t('plan.exit')} side="top">
                <button
                  type="button"
                  className={clsx(css.chip, css.planChip)}
                  onClick={() => { injected.exitPlanMode(windowId) }}
                  aria-label={t('plan.exit')}
                >
                  <span className={css.chipIcon}><IconChecklistOutline14 /></span>
                  <span className={css.chipLabel}>{t('plan.active')}</span>
                </button>
              </Tooltip>
            )}
          </div>

          <div className={css.trailing}>
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

            <Tooltip label={t('model.aria')} side="top" disabled={isOpen('model')}>
              <button
                ref={modelAnchor}
                type="button"
                className={clsx(css.chip, css.modelChip)}
                onClick={() => { openMenu('model', modelAnchor.current) }}
                data-board-action="composer-model"
                aria-label={t('model.aria')}
              >
                <span className={css.chipLabel}>
                  {session?.model.modelName ?? session?.model.model
                    ?? (session?.model.loading === true ? t('model.loading') : t('model.none'))}
                </span>
                {session?.model.effortName !== undefined && (
                  <span className={clsx(css.chipLabel, css.effortLabel)}>{session.model.effortName}</span>
                )}
                <span className={css.chipIcon}><IconChevronDownOutline14 /></span>
              </button>
            </Tooltip>
            <Menu
              portal
              open={isOpen('model')}
              side={sideOf('model')}
              align={alignOf('model')}
              selection="fill"
              anchor={<span className={css.anchor} />}
              getAnchorRect={() => modelAnchor.current?.getBoundingClientRect() ?? null}
              items={modelItems}
              onSelect={(id) => {
                closeMenu()
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
              onClose={closeMenu}
            />

            {running
              ? (
                <Tooltip label={t('agent.stop')} side="top">
                  <button
                    type="button"
                    className={clsx(css.primary, css.stop)}
                    onClick={() => { injected.cancelPrompt(windowId) }}
                    data-board-action="composer-stop"
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
                    data-board-action="composer-send"
                    aria-label={t('menu.send')}
                  >
                    <IconSendOutline16 />
                  </button>
                </Tooltip>
              )}
          </div>
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

/** Total byte size of the draft's image attachments, decoded from their base64 payloads. */
function imagesBytes(images: readonly BoardDraftImage[]): number {
  return images.reduce((sum, image) => sum + image.data.length * 3 / 4, 0)
}
