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
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import {
  FileTypeIcon,
  fileSizeText,
  IconBranchOutline16,
  IconChecklistOutline14,
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconCloseOutline16,
  IconEditOutline16,
  IconGoalOutline16,
  IconPaperclipOutline16,
  IconQueueOutline14,
  IconSendOutline14,
  IconSendOutline16,
  IconShieldOutline16,
  IconSparkle16,
  IconStopFill16,
  IconTrashOutline16,
  Menu,
  RiskConfirmation,
  Tooltip,
  type MenuEntry,
  type MenuItem,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  BoardCommandRow, BoardDraftFile, BoardDraftImage, BoardMentionRow, BoardPromptFile, BoardPromptMode,
  BoardWindowInjectProps, BoardWindowSessionState, WindowId,
} from '../contract/slots.ts'
import type { BoardStoreHandle } from '../store.ts'
import { contextReading, contextRingState, type ContextRingState } from '../context-ring.ts'
import { menuPlacement } from '../menu-placement.ts'
import type { BoardTranslate } from '../locale.ts'
import { MicGlyph, useDictation } from '../dictation.tsx'
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

/** One submission's draft, captured so a refused prompt can return it. */
interface OutgoingDraft {
  readonly text: string
  readonly images: readonly BoardDraftImage[]
  readonly files: readonly BoardDraftFile[]
}

/**
 * One durable queued image rendered as a fixed-size thumbnail. The read is
 * keyed by the attachment identity, so republished queue rows never restart it,
 * and a failure keeps the empty placeholder (the transcript surfaces reads).
 */
function QueueThumb({ windowId, attachment, loadImage, label }: {
  readonly windowId: WindowId
  readonly attachment: ImageAttachmentRef
  readonly loadImage: BoardWindowInjectProps['loadQueueImage']
  readonly label: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  const latest = useRef(attachment)
  latest.current = attachment
  useEffect(() => {
    let alive = true
    void loadImage(windowId, latest.current).then(
      (resolved) => { if (alive) setUrl(resolved) },
      () => { /* placeholder retained; the durable transcript surfaces read errors */ },
    )
    return () => { alive = false }
  }, [windowId, attachment.attachmentId, loadImage])
  return url === null
    ? <span className={css.queueThumb} aria-hidden="true" />
    : <img className={css.queueThumb} src={url} alt={label} />
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

/** Ring modifier class per state; the normal rung keeps the base stroke. */
const CONTEXT_STATE_CLASS = {
  empty: css.ringEmpty,
  normal: undefined,
  warning: css.ringWarning,
  critical: css.ringCritical,
} as const satisfies Record<ContextRingState, string | undefined>

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
  /** Board store's read seat: the queued composer intents. */
  useStore: PropsStore<BoardStoreHandle>['useStore']
  /** Board store's action seat: consuming one queued composer intent. */
  actions: PropsStore<BoardStoreHandle>['actions']
}

export function ComposerBar({ windowId, session, t, injected, onSent, useStore, actions }: ComposerBarProps) {
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
  const [queueEdit, setQueueEdit] = useState<{ readonly id: string; readonly text: string } | null>(null)
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
  // Admission round-trips still in flight; the composer's unmount cancels them.
  const inflight = useRef(new Set<AbortController>())

  useEffect(() => () => {
    for (const controller of inflight.current) controller.abort()
    inflight.current.clear()
  }, [])

  /**
   * Open one popover, or close it when its own trigger is clicked again. The
   * placement follows the trigger's position: the side with more room wins and
   * a trigger past the middle of the viewport aligns its list to the end.
   */
  const openMenu = useCallback((kind: MenuKind, trigger: HTMLElement | null): void => {
    setMenu((current) => {
      if (current?.kind === kind) return null
      return { kind, ...menuPlacement(trigger ?? cardRef.current) }
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
  const intents = useStore(s => s.composerIntents)

  // Board chrome commands land here: text is appended to the draft (the
  // inspector's element chip), `pickFiles` opens the file picker (the
  // Omnibox's attach entry). A `pickFiles` command whose session cannot take
  // attachments yet waits unconsumed for the next pass.
  useEffect(() => {
    for (const intent of intents) {
      if (intent.windowId !== windowId) continue
      if (intent.pickFiles === true && !canAcceptDrop) continue
      if (intent.pickFiles === true) fileInput.current?.click()
      const text = intent.text
      if (text !== undefined) {
        setDraft(current => current === '' ? text : `${current} ${text}`)
      }
      actions.consumeComposerIntent(intent.id)
    }
  }, [intents, windowId, canAcceptDrop, actions])

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

  /** Clear every visible draft field; staged file sources stay until their send settles. */
  const resetDraftState = (): void => {
    setDraft('')
    setImages([])
    setFiles([])
    setIntakeError(null)
    closeMenu()
    setMentionQuery(null)
    // Sending ends dictation: the transcript belongs to the message it fed.
    dictation.stop()
  }

  const clearDraft = (): void => {
    resetDraftState()
    fileSources.current.clear()
  }

  /**
   * Return a refused submission to the composer. An untouched composer gets the
   * draft back verbatim; one the user has typed into keeps its text and gains
   * the refused message as a new paragraph, so a refusal never loses or
   * overwrites what the user wrote. Chips already present are not duplicated.
   */
  const restoreDraft = (outgoing: OutgoingDraft): void => {
    setDraft(current => current === '' ? outgoing.text : `${current}\n\n${outgoing.text}`)
    setImages(current => [...current, ...outgoing.images.filter(image => !current.some(held => held.id === image.id))])
    setFiles(current => [...current, ...outgoing.files.filter(file => !current.some(held => held.id === file.id))])
  }

  const submit = (mode: BoardPromptMode): void => {
    const text = draft.trim()
    if (!canSend) return
    const name = leadingCommand(text)
    if (name === 'file') {
      if (canAcceptDrop) fileInput.current?.click()
      clearDraft()
      return
    }
    if (name === 'model') {
      clearDraft()
      openMenu('model', modelAnchor.current)
      return
    }
    const command = name === null ? undefined : session.commands.find(row => row.name === name)
    const outgoing: OutgoingDraft = { text, images, files: readyFiles }
    const promptFiles: BoardPromptFile[] = readyFiles.map(file => ({
      receiptId: file.receiptId as string,
      ...(file.file === undefined ? {} : { file: file.file }),
    }))

    if (command !== undefined) {
      injected.executeCommand(windowId, text, images, promptFiles)
      clearDraft()
      onSent()
      return
    }
    // The echo appears in the lane at once (the bridge registers it before the
    // admission round-trip); the draft clears optimistically so the next
    // message queues without waiting, and a refusal returns it exactly once.
    const controller = new AbortController()
    inflight.current.add(controller)
    void injected.sendPrompt(windowId, text, running ? mode : 'queue', images, promptFiles, controller.signal)
      .then((accepted) => {
        if (!accepted) {
          restoreDraft(outgoing)
          return
        }
        // An accepted send owns its staged bytes: the retry sources go with it.
        for (const file of outgoing.files) fileSources.current.delete(file.id)
      }, () => { restoreDraft(outgoing) })
      .finally(() => { inflight.current.delete(controller) })
    resetDraftState()
    onSent()
  }

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault()
    submit('queue')
  }

  /** Commit one in-place queue edit; an empty or disappeared row ends the edit. */
  const saveQueueEdit = (): void => {
    if (queueEdit === null || queueEdit.text.trim() === '') return
    injected.updateQueueItem(windowId, queueEdit.id, { kind: 'edit', text: queueEdit.text })
    setQueueEdit(null)
  }

  // A row the host consumed (steered, removed, dispatched) ends its edit too.
  useEffect(() => {
    if (queueEdit !== null && !(session?.queue ?? []).some(row => row.id === queueEdit.id)) setQueueEdit(null)
  }, [queueEdit, session?.queue])

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
      if (canAcceptDrop) fileInput.current?.click()
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
      injected.executeCommand(windowId, `/${name}`, images, readyFiles.map(file => ({
        receiptId: file.receiptId as string,
        ...(file.file === undefined ? {} : { file: file.file }),
      })))
      clearDraft()
    } else {
      setDraft(`/${name} `)
    }
  }

  const pickMention = (row: BoardMentionRow): void => {
    setDraft(current => `${current.replace(/@[^\s@]*$/, '')}${row.insert} `)
    setMentionQuery(null)
  }

  /**
   * Escape pressed on a focused palette row closes the palette and stops there:
   * the board's Escape ladder would otherwise close the chats panel (or leave
   * fullscreen) while the row the reader is on stays open.
   */
  const dismissOnEscape = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    closeMenu()
    setMentionQuery(null)
    setCommandsDismissed(true)
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
          // A ready chip carries no failure text: a retry that succeeded must
          // drop the previous attempt's error rather than keep it as a title.
          ? { id: item.id, name: item.name, status: 'ready' as const, receiptId: result.receiptId }
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
    if (!canAcceptDrop) return
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

  // A broken preset cannot compose a session, so the menu never offers it; it
  // stays in the roster only so a current preset still resolves its label.
  const presetItems: readonly MenuEntry[] = useMemo(
    () => (session?.presets ?? [])
      .filter(preset => preset.broken === undefined)
      .map(preset => ({ id: preset.id, label: preset.name })),
    [session?.presets],
  )
  const presetPickerVisible = (session?.presetPickerEnabled ?? true) && (session?.presets.length ?? 0) > 0

  // The catalog failure belongs in the model menu, where the user goes to fix
  // it; the chip keeps showing whatever selection is in force.
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
      ...(state.error === undefined
        ? []
        : [{ type: 'label', id: 'modelError', text: `${t('model.error')}: ${state.error}` }] satisfies readonly MenuEntry[]),
      { id: 'model', label: t('model.menu'), submenu: modelRows },
      { id: 'effort', label: t('model.effort'), submenu: effortRows },
    ]
  }, [session?.model, t])

  // The model tooltip names the selection in force and states the system-default
  // side effect of switching, so the chip never surprises the user.
  const modelName = session?.model.modelName ?? session?.model.model
  const effortName = session?.model.effortName ?? session?.model.effort
  const modelTooltip = modelName === undefined
    ? t('model.hint.none')
    : effortName === undefined
      ? t('model.hintPlain', { model: modelName })
      : t('model.hint', { model: modelName, effort: effortName })

  const todoDone = (session?.todos ?? []).filter(todo => todo.status === 'completed').length
  const todoActive = (session?.todos ?? []).filter(todo => todo.status === 'in_progress').length
  const todoPending = (session?.todos ?? []).filter(todo => todo.status === 'pending').length
  // The strip owns the queued surface: durable occurrences wait their turn, and
  // local echoes fill the gap until their occurrence arrives. Steering rides the
  // lane instead, as its pending bubble and then its durable transcript node.
  const queueRows = (session?.queue ?? []).filter(row => row.placement === 'queued')
  const queuedEchoes = (session?.pending ?? []).filter(row => row.placement === 'queued')
  const queueCount = queueRows.length + queuedEchoes.length
  const hasStrips = session?.goal !== undefined || (session?.todos.length ?? 0) > 0 || queueCount > 0
    || session?.queueError !== undefined

  // The context ring reads the bridge's occupancy figures: an empty ladder rung
  // before the first provider report, then normal/warning/critical with the
  // `% · used / window` tooltip (units shorten to K/M through the dictionary).
  const contextState = contextRingState(session?.context)
  const contextLabel = contextReading(session?.context, t)

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
          {queueCount > 0 && (
            <div className={css.strip}>
              <IconQueueOutline14 />
              <span className={css.stripTitle}>{t('queue.count', { n: String(queueCount) })}</span>
            </div>
          )}
          {queueRows.map(row => (
            <div key={row.id} className={css.strip} data-board-queue-row="" data-board-queue-state="queued">
              {queueEdit?.id === row.id
                ? (
                  <>
                    <input
                      autoFocus
                      className={css.stripInput}
                      aria-label={t('queue.edit')}
                      value={queueEdit.text}
                      data-board-action="queue-edit-input"
                      onChange={(e) => { setQueueEdit({ id: row.id, text: e.target.value }) }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          setQueueEdit(null)
                          return
                        }
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                          e.preventDefault()
                          saveQueueEdit()
                        }
                      }}
                    />
                    <Tooltip label={t('queue.save')} side="top">
                      <button
                        type="button"
                        className={css.stripAction}
                        aria-label={t('queue.save')}
                        data-board-action="queue-edit-save"
                        disabled={queueEdit.text.trim() === ''}
                        onClick={saveQueueEdit}
                      >
                        <IconCheckOutline16 size={14} />
                      </button>
                    </Tooltip>
                    <Tooltip label={t('queue.cancelEdit')} side="top">
                      <button
                        type="button"
                        className={css.stripAction}
                        aria-label={t('queue.cancelEdit')}
                        data-board-action="queue-edit-cancel"
                        onClick={() => { setQueueEdit(null) }}
                      >
                        <IconCloseOutline16 />
                      </button>
                    </Tooltip>
                  </>
                )
                : (
                  <>
                    {row.attachments.length > 0 && (
                      <span className={css.stripAttachments}>
                        {row.attachments.map((attachment, index) => attachment.kind === 'image'
                          ? (
                            <QueueThumb
                              key={`${attachment.attachment.attachmentId}:${index}`}
                              windowId={windowId}
                              attachment={attachment.attachment}
                              loadImage={injected.loadQueueImage}
                              label={t('queue.image')}
                            />
                          )
                          : (
                            <span key={`${attachment.name}:${index}`} className={css.stripFile} title={attachment.name}>
                              <FileTypeIcon path={attachment.name} size={14} />
                              <span className={css.stripFileName}>{attachment.name}</span>
                              <span className={css.stripFileSize}>{fileSizeText(attachment.bytes)}</span>
                            </span>
                          ))}
                      </span>
                    )}
                    <span className={css.stripText}>{row.preview}</span>
                    <Tooltip label={t('queue.edit')} side="top" disabled={row.text === null}>
                      <button
                        type="button"
                        className={css.stripAction}
                        aria-label={t('queue.edit')}
                        data-board-action="queue-edit"
                        title={row.text === null ? t('queue.edit.unsupported') : undefined}
                        disabled={row.text === null}
                        onClick={() => { if (row.text !== null) setQueueEdit({ id: row.id, text: row.text }) }}
                      >
                        <IconEditOutline16 size={14} />
                      </button>
                    </Tooltip>
                    <Tooltip label={t('queue.remove')} side="top">
                      <button
                        type="button"
                        className={css.stripAction}
                        aria-label={t('queue.remove')}
                        data-board-action="queue-remove"
                        onClick={() => { injected.updateQueueItem(windowId, row.id, { kind: 'remove' }) }}
                      >
                        <IconTrashOutline16 size={14} />
                      </button>
                    </Tooltip>
                    <Tooltip label={running ? t('queue.steer') : t('queue.steer.unavailable')} side="top" disabled={running}>
                      <button
                        type="button"
                        className={css.stripAction}
                        aria-label={t('queue.steer')}
                        data-board-action="queue-steer"
                        disabled={!running}
                        onClick={() => { injected.updateQueueItem(windowId, row.id, { kind: 'steer' }) }}
                      >
                        <IconSendOutline14 />
                      </button>
                    </Tooltip>
                  </>
                )}
            </div>
          ))}
          {queuedEchoes.map(row => (
            <div key={row.id} className={clsx(css.strip, css.stripEcho)} data-board-queue-row="" data-board-queue-state="sending">
              <IconQueueOutline14 />
              {row.images.length > 0 && (
                <span className={css.stripAttachments}>
                  {row.images.map(image => (
                    <img key={image.id} className={css.queueThumb} src={image.preview} alt={image.name ?? t('queue.image')} />
                  ))}
                </span>
              )}
              {row.files.map(name => (
                <span key={name} className={css.stripFile} title={name}>
                  <FileTypeIcon path={name} size={14} />
                  <span className={css.stripFileName}>{name}</span>
                </span>
              ))}
              <span className={css.stripText}>{row.text}</span>
              <span className={css.stripStatus} role="status">{t('queue.sending')}</span>
            </div>
          ))}
          {session?.queueError !== undefined && (
            <div className={clsx(css.strip, css.stripError)} data-board-queue-error="">
              {t('queue.failed')}: {session.queueError}
            </div>
          )}
        </div>
      )}

      <div className={css.contextRow}>
        {/* The deployment can disable visible preset selection for new
            sessions; the chip then has nothing honest to offer. */}
        {presetPickerVisible && (
          <>
            {/* The hint must stay visible while the chip is disabled (a
                started session), and a disabled button fires no mouse events:
                the span wrapper owns the tooltip anchor. */}
            <Tooltip label={t('preset.hint')} side="top" disabled={isOpen('preset')}>
              <span className={css.chipAnchor}>
                <button
                  ref={presetAnchor}
                  type="button"
                  className={clsx(css.chip, css.presetChip)}
                  disabled={!(session?.blank ?? false)}
                  onClick={() => { openMenu('preset', presetAnchor.current) }}
                  data-board-action="composer-preset"
                  aria-label={t('preset.aria')}
                >
                  <span className={css.chipIcon}><IconBranchOutline16 /></span>
                  <span className={css.chipLabel}>
                    {(session?.presets ?? []).find(preset => preset.id === session?.presetId)?.name
                      ?? session?.presetId
                      ?? t('preset.none')}
                  </span>
                  <span className={css.chipIcon}><IconChevronDownOutline14 /></span>
                </button>
              </span>
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
          </>
        )}
      </div>

      {mentionQuery !== null && (
        <div
          className={css.popup}
          role="listbox"
          aria-label={t('mention.aria')}
          onKeyDown={dismissOnEscape}
        >
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
        <div
          className={css.popup}
          role="listbox"
          aria-label={t('command.menuAria')}
          onKeyDown={dismissOnEscape}
        >
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
        {session?.presetError !== undefined && (
          <div className={css.intakeError} data-board-preset-error="">
            {t('preset.failed')}: {session.presetError}
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
              disabled={!canAcceptDrop}
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
            {session !== undefined && (
              <Tooltip label={contextLabel} side="top">
                <span
                  className={clsx(css.context, CONTEXT_STATE_CLASS[contextState])}
                  data-board-context-state={contextState}
                  aria-label={contextLabel}
                >
                  <svg className={css.ring} viewBox="0 0 20 20" aria-hidden="true">
                    <circle className={css.ringTrack} cx="10" cy="10" r={RING_RADIUS} />
                    <circle
                      className={css.ringValue}
                      cx="10"
                      cy="10"
                      r={RING_RADIUS}
                      strokeDasharray={`${RING_CIRCUMFERENCE * (session.context?.percent ?? 0) / 100} ${RING_CIRCUMFERENCE}`}
                    />
                  </svg>
                  <span>{session.context === undefined ? t('context.emptyMark') : `${session.context.percent}%`}</span>
                </span>
              </Tooltip>
            )}

            <Tooltip label={modelTooltip} side="top" disabled={isOpen('model')}>
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
