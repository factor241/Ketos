/**
 * Right panel of one board window: the session's file surface, built on the
 * standard interface's pieces — a tab strip with a `+`, a Home tab offering
 * «Файлы рабочей области», a Files tab holding the session workspace tree, and a
 * viewer tab per opened file. The panel is a companion of the window, so its
 * only chrome control is «Свернуть» (Т3.7, Т3.8).
 *
 * Tabs and files trees live in the board store keyed by session id, so the
 * panel follows the window's session (Т3.11) and duplicate viewer tabs for one
 * path are activated, not duplicated. Every read is guarded by the mounting
 * controller and a per-level generation, so a switched tab never paints a
 * settled answer that belongs to a request it already replaced.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import {
  FileTypeIcon, IconCloseOutlineRegular, IconFolderCloseRegular, IconFolderOpenRegular, IconPanelLeftOutlineRegular,
  IconPlusOutlineRegular, IconRefreshOutlineRegular, MarkdownText, Tooltip, classifyFileType,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceDirectoryEntry } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { pathPartsOf } from '@deepseek-ai/dsh-util-workspace-path'
import type { BoardWindowInjected, WindowId } from '../contract/slots.ts'
import type { BoardTranslate } from '../locale.ts'
import type { BoardFilesTabState, BoardRightPanelTab, BoardStoreHandle } from '../store.ts'
import css from './RightPanel.module.css'

/** Everything one window's right panel renders and writes: the window and its
 * session, the board store seats, and the injected file face. */
export type RightPanelProps = {
  /** Window whose panel this is; the collapse control writes its open flag. */
  readonly windowId: WindowId
  /** Session the panel belongs to, absent while the window has no session. */
  readonly sessionId: SessionId | undefined
  /** Session working directory: the workspace root of a files tab. */
  readonly cwd: string | undefined
  /** Board locale seat. */
  readonly t: BoardTranslate
  /** Board store selector seat. */
  readonly useStore: PropsStore<BoardStoreHandle>['useStore']
  /** Board store write set. */
  readonly actions: PropsStore<BoardStoreHandle>['actions']
  /** Open one file in a viewer tab and reveal the panel. */
  readonly openFileInPanel: BoardWindowInjected['openFileInPanel']
  /** Loading mode of the preview implementation matching one path. */
  readonly documentPreviewFor: BoardWindowInjected['documentPreviewFor']
  /** List one directory of the session workspace. */
  readonly listWorkspaceDirectory: BoardWindowInjected['listWorkspaceDirectory']
  /** Read one file of the session workspace. */
  readonly readWorkspaceFile: BoardWindowInjected['readWorkspaceFile']
}

/** Suffixes the viewer draws as an image, in the standard interface's set. */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg'])

/** Natural, case-insensitive name order, so `file2` precedes `file10`. */
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Say why a directory or file could not be read, in terms of the path.
 * @param t - board locale seat.
 * @param code - the host's stable failure code.
 * @param message - the host's own message.
 * @returns the line to show in the panel for the active locale.
 */
function failureLine(t: BoardTranslate, code: string, message: string): string {
  switch (code) {
    case 'workspace-file/not-found': return t('right.error.notFound')
    case 'workspace-file/outside-workspace': return t('right.error.outsideWorkspace')
    case 'workspace-file/not-directory': return t('right.error.notDirectory')
    // Carrier and unclassified host failures reach the reader as themselves.
    default: return t('right.error.unavailable', { message })
  }
}

/* jscpd:ignore-start -- the tree helpers are ui-sidebar-files' (orderEntries,
   childPath); a plugin bundle shares runtime code only through the platform
   modules, so the board keeps its own copy until one home exists. */
/**
 * Order one level's entries for display: directories first, then everything
 * else, each group by name.
 * @param entries - the listing as the endpoint returned it.
 * @returns a new array, directories first, then by name within each group.
 */
function orderEntries(entries: readonly WorkspaceDirectoryEntry[]): WorkspaceDirectoryEntry[] {
  return [...entries].sort((left, right) => {
    const group = Number(right.type === 'directory') - Number(left.type === 'directory')
    return group !== 0 ? group : byName.compare(left.name, right.name)
  })
}

/**
 * The absolute path of one child entry, joined with `/` whatever the parent's
 * separators.
 * @param parent - absolute path of the listed directory.
 * @param name - the entry's basename.
 * @returns the child's absolute path.
 */
function childPath(parent: string, name: string): string {
  return `${parent.replace(/[/\\]+$/, '')}/${name}`
}
/* jscpd:ignore-end */

/**
 * The viewer one path selects by extension; the document-preview definition
 * decides how its content is read, not which renderer draws it.
 * @param path - absolute file path.
 * @returns `image`, `pdf`, `markdown`, or `text`.
 */
function viewerKindOf(path: string): 'image' | 'pdf' | 'markdown' | 'text' {
  const name = pathPartsOf(path).name.toLowerCase()
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (extension === 'pdf') return 'pdf'
  if (extension === 'md' || extension === 'markdown') return 'markdown'
  return 'text'
}

/** One viewer tab's read state. */
type ViewerState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'bytes'; readonly data: Uint8Array }
  | { readonly kind: 'failed'; readonly code: string; readonly message: string }

/** Object URL of one byte payload, revoked when the payload or viewer goes away. */
function useObjectUrl(data: Uint8Array): string {
  const url = useMemo(() => URL.createObjectURL(new Blob([Uint8Array.from(data)])), [data])
  useEffect(() => () => { URL.revokeObjectURL(url) }, [url])
  return url
}

/** One image viewer over complete bytes. */
function ImageViewer({ data, name }: { readonly data: Uint8Array; readonly name: string }): ReactNode {
  const url = useObjectUrl(data)
  return <img className={css.image} src={url} alt={name} data-board-right-viewer="image" />
}

/** One PDF viewer over complete bytes. */
function PdfViewer({ data, name }: { readonly data: Uint8Array; readonly name: string }): ReactNode {
  const url = useObjectUrl(data)
  return <iframe className={css.frame} title={name} src={url} data-board-right-viewer="pdf" />
}

/**
 * One viewer tab: reads its file in the mode the matching preview declared and
 * draws the extension's renderer. A switched tab aborts its read and paints
 * nothing; a failed read shows the localized failure.
 */
function ViewerPane({ sessionId, tab, t, documentPreviewFor, readWorkspaceFile }: {
  readonly sessionId: SessionId
  readonly tab: BoardRightPanelTab
  readonly t: BoardTranslate
  readonly documentPreviewFor: BoardWindowInjected['documentPreviewFor']
  readonly readWorkspaceFile: BoardWindowInjected['readWorkspaceFile']
}): ReactNode {
  const path = tab.path ?? ''
  const [state, setState] = useState<ViewerState>({ kind: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    setState({ kind: 'loading' })
    const mode = documentPreviewFor(path)?.loading ?? 'text-pages'
    void readWorkspaceFile(sessionId, path, mode, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (!result.ok) setState({ kind: 'failed', code: result.code, message: result.message })
      else if (result.kind === 'bytes') setState({ kind: 'bytes', data: result.data })
      else setState({ kind: 'text', text: result.text })
    })
    return () => { controller.abort() }
  }, [sessionId, path, documentPreviewFor, readWorkspaceFile])

  const markdownLabels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('markdown.copy'), copiedLabel: t('markdown.copied') },
    footnotes: t('markdown.footnotes'),
  }), [t])

  if (state.kind === 'loading') {
    return <div className={css.rowNote} data-board-right-viewer="loading">{t('right.loading')}</div>
  }
  if (state.kind === 'failed') {
    return (
      <div className={css.rowNote} data-board-right-viewer="failed">
        {failureLine(t, state.code, state.message)}
      </div>
    )
  }
  const name = pathPartsOf(path).name
  const kind = viewerKindOf(path)
  if (state.kind === 'bytes') {
    if (kind === 'image') return <ImageViewer data={state.data} name={name} />
    if (kind === 'pdf') return <PdfViewer data={state.data} name={name} />
    return <div className={css.rowNote} data-board-right-viewer="failed">{t('right.viewerFailed')}</div>
  }
  if (kind === 'markdown') {
    return (
      <div className={css.markdown} data-board-right-viewer="markdown">
        <MarkdownText text={state.text} labels={markdownLabels} />
      </div>
    )
  }
  return <pre className={css.text} data-board-right-viewer="text">{state.text}</pre>
}

/** One entry row of the files tree and its children while expanded. */
function TreeEntry({ parent, entry, tree }: {
  readonly parent: string
  readonly entry: WorkspaceDirectoryEntry
  readonly tree: TreeContext
}): ReactNode {
  const path = childPath(parent, entry.name)
  if (entry.type === 'directory') {
    const expanded = tree.state.expanded.includes(path)
    return (
      <div className={css.entry}>
        <button
          type="button"
          className={css.entryRow}
          aria-expanded={expanded}
          data-board-right-entry="directory"
          data-board-right-path={path}
          onClick={() => { tree.onToggle(path) }}
        >
          {expanded
            ? <IconFolderOpenRegular className={css.entryIcon} />
            : <IconFolderCloseRegular className={css.entryIcon} />}
          <span className={css.entryName}>{entry.name}</span>
        </button>
        {expanded && <div className={css.level}><TreeLevel path={path} tree={tree} /></div>}
      </div>
    )
  }
  if (entry.type === 'file') {
    return (
      <div className={css.entry}>
        <button
          type="button"
          className={css.entryRow}
          data-board-right-entry="file"
          data-board-right-path={path}
          onClick={() => { tree.onOpen(path) }}
        >
          <FileTypeIcon kind={classifyFileType(entry.name)} size={16} className={css.entryIcon} />
          <span className={css.entryName}>{entry.name}</span>
        </button>
      </div>
    )
  }
  return (
    <div className={css.entry}>
      <span
        className={clsx(css.entryRow, css.entryOther)}
        data-board-right-entry="other"
        data-board-right-path={path}
      >
        {entry.name}
      </span>
    </div>
  )
}

/** What every tree level shares: its state, its two gestures, and its copy. */
interface TreeContext {
  readonly state: BoardFilesTabState
  readonly t: BoardTranslate
  readonly onToggle: (path: string) => void
  readonly onOpen: (path: string) => void
}

/** One directory's rows: its state while listing, its entries once listed. */
function TreeLevel({ path, tree }: { readonly path: string; readonly tree: TreeContext }): ReactNode {
  const level = tree.state.levels[path]
  if (level === undefined || level.kind === 'loading') {
    return <div className={css.rowNote} data-board-right-row="loading">{tree.t('right.loading')}</div>
  }
  if (level.kind === 'failed') {
    return (
      <div className={css.rowNote} data-board-right-row="failed" data-board-right-code={level.code}>
        {failureLine(tree.t, level.code, level.message)}
      </div>
    )
  }
  const entries = orderEntries(level.entries)
  return (
    <>
      {entries.length === 0 && <div className={css.rowNote} data-board-right-row="empty">{tree.t('right.empty')}</div>}
      {entries.map(entry => <TreeEntry key={entry.name} parent={path} entry={entry} tree={tree} />)}
      {level.truncated && <div className={css.rowNote} data-board-right-row="truncated">{tree.t('right.truncated')}</div>}
    </>
  )
}

/**
 * One files tab: the absolute workspace root, its reload control, and the tree
 * of expanded directories. Every expanded level without state is listed once;
 * a settled listing older than the level's newest request writes nothing.
 */
function FilesPane({ sessionId, tabId, state, t, actions, windowId, openFileInPanel, listWorkspaceDirectory }: {
  readonly sessionId: SessionId
  readonly tabId: string
  readonly state: BoardFilesTabState
  readonly t: BoardTranslate
  readonly actions: RightPanelProps['actions']
  readonly windowId: WindowId
  readonly openFileInPanel: RightPanelProps['openFileInPanel']
  readonly listWorkspaceDirectory: RightPanelProps['listWorkspaceDirectory']
}): ReactNode {
  const [controller] = useState(() => new AbortController())
  const generations = useRef(new Map<string, number>())
  const live = useRef(true)
  useEffect(() => () => {
    live.current = false
    controller.abort()
  }, [controller])

  const load = useCallback((path: string): void => {
    const generation = (generations.current.get(path) ?? 0) + 1
    generations.current.set(path, generation)
    actions.filesLoading(sessionId, tabId, path)
    void listWorkspaceDirectory(sessionId, path, controller.signal).then((result) => {
      // An unmounted pane and a level asked for again both retire this answer.
      if (!live.current || generations.current.get(path) !== generation) return
      if (result.ok) actions.filesLoaded(sessionId, tabId, path, result)
      else actions.filesFailed(sessionId, tabId, path, result.code, result.message)
    })
  }, [actions, sessionId, tabId, listWorkspaceDirectory, controller])

  useEffect(() => {
    for (const path of state.expanded) {
      if (state.levels[path] === undefined) load(path)
    }
  }, [state.expanded, state.levels, load])

  const tree: TreeContext = {
    state,
    t,
    onToggle: (path) => { actions.filesToggle(sessionId, tabId, path) },
    onOpen: (path) => { openFileInPanel(windowId, path) },
  }
  return (
    <div className={css.files} data-board-right-files="">
      <div className={css.filesHeader}>
        <span className={css.filesPath} title={state.root} data-board-right-files-path="">{state.root}</span>
        <button
          type="button"
          className={css.filesReload}
          data-board-action="right-files-reload"
          aria-label={t('right.reload')}
          title={t('right.reload')}
          onClick={() => { actions.filesReset(sessionId, tabId) }}
        >
          <IconRefreshOutlineRegular />
        </button>
      </div>
      <div className={css.tree}>
        <TreeLevel path={state.root} tree={tree} />
      </div>
    </div>
  )
}

/** One tab chip: the label button and its sibling close control. */
function TabChip({ tab, active, t, onActivate, onClose }: {
  readonly tab: BoardRightPanelTab
  readonly active: boolean
  readonly t: BoardTranslate
  readonly onActivate: () => void
  readonly onClose: () => void
}): ReactNode {
  const label = tab.kind === 'home'
    ? t('right.home')
    : tab.kind === 'files' ? t('right.files') : pathPartsOf(tab.path ?? '').name
  return (
    <div className={clsx(css.chip, active && css.chipActive)}>
      <button
        type="button"
        role="tab"
        aria-selected={active}
        className={css.chipLabel}
        data-board-action="right-tab"
        data-board-tab-id={tab.id}
        data-board-tab-kind={tab.kind}
        onClick={onActivate}
      >
        {label}
      </button>
      <button
        type="button"
        className={css.chipClose}
        data-board-action="right-tab-close"
        aria-label={t('right.closeTab')}
        onClick={onClose}
      >
        <IconCloseOutlineRegular />
      </button>
    </div>
  )
}

/** The window's right panel: tab strip, Home, files tree, and file viewers. */
export function RightPanel({
  windowId, sessionId, cwd, t, useStore, actions, openFileInPanel, documentPreviewFor,
  listWorkspaceDirectory, readWorkspaceFile,
}: RightPanelProps): ReactNode {
  const panel = useStore(s => sessionId === undefined ? undefined : s.rightPanels[sessionId])
  const tabs = panel === undefined ? [] : panel.tabs
  const activeTab = tabs.find(tab => tab.id === panel?.activeTabId)
  const filesState = activeTab?.kind === 'files' && sessionId !== undefined
    ? panel?.files[activeTab.id]
    : undefined

  useEffect(() => {
    if (sessionId === undefined || activeTab?.kind !== 'files' || filesState !== undefined || cwd === undefined) return
    actions.filesStart(sessionId, activeTab.id, cwd)
  }, [sessionId, activeTab?.id, activeTab?.kind, filesState, cwd, actions])

  let content: ReactNode
  if (sessionId === undefined || activeTab === undefined) {
    content = <div className={css.empty} data-board-right-empty="">{t('right.noTabs')}</div>
  } else if (activeTab.kind === 'home') {
    content = (
      <div className={css.home} data-board-right-home="">
        <button
          type="button"
          className={css.homeRow}
          data-board-action="right-open-files"
          onClick={() => { actions.openRightTab(sessionId, { id: 'files', kind: 'files' }) }}
        >
          <IconFolderOpenRegular className={css.homeIcon} />
          <span className={css.homeText}>{t('right.workspaceFiles')}</span>
        </button>
      </div>
    )
  } else if (activeTab.kind === 'files') {
    content = filesState === undefined
      ? <div className={css.rowNote} data-board-right-row="loading">{t('right.loading')}</div>
      : (
        <FilesPane
          sessionId={sessionId}
          tabId={activeTab.id}
          state={filesState}
          t={t}
          actions={actions}
          windowId={windowId}
          openFileInPanel={openFileInPanel}
          listWorkspaceDirectory={listWorkspaceDirectory}
        />
      )
  } else {
    content = (
      <ViewerPane
        sessionId={sessionId}
        tab={activeTab}
        t={t}
        documentPreviewFor={documentPreviewFor}
        readWorkspaceFile={readWorkspaceFile}
      />
    )
  }

  return (
    <>
      <div className={css.header}>
        {sessionId !== undefined && (
          <div className={css.tabs} data-board-right-tabs="">
            {tabs.map(tab => (
              <TabChip
                key={tab.id}
                tab={tab}
                active={tab.id === panel?.activeTabId}
                t={t}
                onActivate={() => { actions.activateRightTab(sessionId, tab.id) }}
                onClose={() => { actions.closeRightTab(sessionId, tab.id) }}
              />
            ))}
            <button
              type="button"
              className={css.add}
              data-board-action="right-tab-add"
              aria-label={t('right.newTab')}
              title={t('right.newTab')}
              onClick={() => { actions.openRightTab(sessionId, { id: 'home', kind: 'home' }) }}
            >
              <IconPlusOutlineRegular />
            </button>
          </div>
        )}
        <span className={css.headerGap} />
        <Tooltip label={t('panel.collapse')} side="bottom">
          <button
            type="button"
            className={css.collapse}
            data-board-action="panel-collapse-right"
            aria-label={t('panel.collapse')}
            onClick={() => { actions.setWindowPanel(windowId, 'right', false) }}
          >
            <IconPanelLeftOutlineRegular className={css.collapseIcon} />
          </button>
        </Tooltip>
      </div>
      <div className={css.body}>{content}</div>
    </>
  )
}
