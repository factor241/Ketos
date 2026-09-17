/**
 * Spatial multi-window board slot contract.
 */
import type { ReactNode } from 'react'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { HostObservable, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId, WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'

/** Session-wide identity of one board window. */
export type WindowId = Branded<'BoardWindowId'>

/** Window category, selecting the `board.window` frame that renders it. */
export type WindowKind = 'agent' | 'connectors' | 'settings' | 'dashboard' | 'clone' | 'tasks'

/** Window content category, selecting the `board.window.body` occupant inside the frame. */
export type WindowBodyKind = 'conversation' | 'connectors' | 'settings' | 'dashboard' | 'clone' | 'clone-memory' | 'tasks'

/** One prompt mode the window composer dispatches. */
export type BoardPromptMode = 'queue' | 'steer'

/** One tool call running now: the lane shows it until its result is logged. */
export interface BoardRunningCall {
  readonly id: string
  readonly name: string
}

/** Image admission limits the window composer enforces, as the host projects them. */
export interface BoardImageLimits {
  readonly maxImageBytes: number
  readonly maxImagesPerMessage: number
  readonly maxMessageImageBytes: number
  readonly mediaTypes: readonly string[]
}

/** One non-image file the draft holds while its background upload settles. */
export interface BoardDraftFile {
  readonly id: string
  readonly name: string
  readonly status: 'uploading' | 'ready' | 'error'
  /** Staged receipt the prompt sends once the upload is ready. */
  readonly receiptId?: string
  /** Failure text of the last upload attempt. */
  readonly error?: string
}

/** Outcome of one background file upload: the staged receipt or a failure. */
export interface BoardUploadResult {
  readonly receiptId?: string
  readonly error?: string
}

/** One directory level the panel's folder browser shows. */
export interface BoardDirectoryListing {
  /** Absolute path of the listed directory. */
  readonly path: string
  /** The user's home directory, for path abbreviation. */
  readonly home: string
  /** Ancestor chain from the filesystem root to the listed directory, inclusive. */
  readonly crumbs: readonly { readonly name: string; readonly path: string }[]
  /** Direct child directories. */
  readonly entries: readonly { readonly name: string; readonly path: string; readonly hidden: boolean }[]
  /** Whether the host truncated the listing. */
  readonly truncated: boolean
}

/** Where a chat the panel creates runs: a workspace, or a directory (or the default one). */
export type BoardChatTarget = { readonly workspaceId: WorkspaceId } | { readonly cwd?: string }

/** One image attached to the window draft, already encoded for the prompt. */
export interface BoardDraftImage {
  /** Local identity of the chip. */
  readonly id: string
  /** Original file name, shown on the chip. */
  readonly name: string
  /** Image media type accepted by the prompt contract. */
  readonly mediaType: string
  /** Base64 payload without the data-URL prefix. */
  readonly data: string
  /** `data:` URL for the chip preview. */
  readonly preview: string
}

/** One preset row the window's chip can switch to. */
export interface BoardPresetOption {
  readonly id: string
  readonly name: string
  /** One sentence on what the preset is for. */
  readonly description?: string
}

/** One permission preset row the window's chip can switch to. */
export interface BoardPermissionOption {
  /** Preset table key; the chip resolves its label from the board dictionary. */
  readonly id: string
  /** Whether choosing this preset needs the risk confirmation. */
  readonly dangerous: boolean
}

/** One queued message row the window renders above the composer. */
export interface BoardQueueRow {
  readonly id: string
  readonly preview: string
}

/** One goal row the window renders above the composer. */
export interface BoardGoalState {
  readonly objective: string
  readonly phase: 'active' | 'paused' | 'blocked' | 'complete'
  readonly activation: 'armed' | 'disarmed'
}

/** One todo row the window renders above the composer. */
export interface BoardTodoRow {
  readonly content: string
  readonly status: 'pending' | 'in_progress' | 'completed'
}

/** One selectable reasoning effort for the current model route. */
export interface BoardEffortOption {
  readonly id: string
  readonly name: string
}

/** One provider group of the model catalog, flattened for the window menu. */
export interface BoardModelGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly {
    readonly id: string
    readonly name: string
  }[]
}

/** The window's model directory view: current selection, catalog, and effort rows. */
export interface BoardModelState {
  readonly provider?: string
  readonly model?: string
  readonly modelName?: string
  readonly effort?: string
  readonly effortName?: string
  readonly efforts: readonly BoardEffortOption[]
  readonly groups: readonly BoardModelGroup[]
  readonly loading: boolean
  readonly error?: string
}

/** One slash-command row the window's composer offers. */
export interface BoardCommandRow {
  readonly name: string
  readonly description: string
  /** Argument hint; absent for bare commands. */
  readonly hint?: string
}

/** One mention candidate (`@`) the window's composer offers. */
export interface BoardMentionRow {
  readonly id: string
  readonly label: string
  /** Text inserted into the draft when the row is picked. */
  readonly insert: string
  readonly kind: 'file' | 'directory' | 'session'
}

/** Lane-facing state of one board window's Harness session. */
export interface BoardWindowSessionState {
  /** `pending` until the session exists, `error` when creation failed. */
  readonly status: 'pending' | 'ready' | 'error'
  /** Whether the session has a running turn. */
  readonly running: boolean
  /** Failure text from session creation. */
  readonly error?: string | undefined
  /** Failure text from the last refused prompt or command. */
  readonly promptError?: string | undefined
  /** Failure text of the last turn the agent aborted. */
  readonly turnError?: string | undefined
  /** Assembled chat snapshot, absent until the chat view builder publishes. */
  readonly chat?: ChatSnapshot | undefined
  /** The session the window is bound to, absent until one exists. */
  readonly sessionId?: SessionId | undefined
  /** Chat title the session list reports; the frame falls back to the window name. */
  readonly displayTitle?: string | undefined
  /** Session working directory, as the list row reports it. */
  readonly cwd?: string | undefined
  /** Whether the session has not started its first turn (setup switches allowed). */
  readonly blank: boolean
  /** Whether the host window still holds turns before the loaded window. */
  readonly hasMore: boolean
  /** Whether an older-turns page is in flight. */
  readonly loadingOlder: boolean
  /** Tool calls running now, in transcript order. */
  readonly runningCalls: readonly BoardRunningCall[]
  /** Image admission limits, absent when the host composes no attachment service. */
  readonly imageLimits?: BoardImageLimits | undefined
  /** Agent preset in force, and the roster the chip can switch to. */
  readonly presetId?: string | undefined
  readonly presets: readonly BoardPresetOption[]
  /** Permission preset in force and the switchable rows. */
  readonly permission?: string | undefined
  readonly permissions: readonly BoardPermissionOption[]
  /** Plan mode in force. */
  readonly plan: boolean
  /** Queued messages waiting behind the running turn. */
  readonly queue: readonly BoardQueueRow[]
  /** The goal in force, when one exists. */
  readonly goal?: BoardGoalState | undefined
  /** The agent's current to-do list. */
  readonly todos: readonly BoardTodoRow[]
  /** Model directory view for the chip. */
  readonly model: BoardModelState
  /** Slash-command rows for the composer menu. */
  readonly commands: readonly BoardCommandRow[]
  /** Reason the composer is inert, when the conversation reports a block. */
  readonly blocked?: string | undefined
  /** Failure text of the last slash-command line the composer executed. */
  readonly commandError?: string | undefined
  /** Context occupancy, absent until the provider reports both figures. */
  readonly context?: { readonly percent: number; readonly usedTokens: number; readonly window: number } | undefined
}

/**
 * Apply-side face shared by the window registrations: the per-window session
 * channel (a keyed hook so one registration serves every window) plus the
 * composer's session commands. Components never see the channel itself.
 */
export interface BoardWindowInjected {
  keyedHooks: {
    /** Per-window session state; the key is the window id. */
    windowSession: (key: string) => HostObservable<BoardWindowSessionState> | undefined
  }
  /** Sources the chats panel lists projects and chats from. */
  hooks: {
    /** Every session the client knows, with the working directory each one runs in. */
    sessionList: HostObservable<SessionListState>
    /** Workspaces (project folders) and the sessions attached to them. */
    workspaceList: HostObservable<WorkspaceSnapshot>
  }
  /** Create the window's session on first use; idempotent. */
  ensureWindowSession: (windowId: WindowId) => void
  /**
   * Drop one window's bridge record when the window closes: its channel and
   * session subscriptions go, while the session itself stays alive and listed.
   */
  releaseWindow: (windowId: WindowId) => void
  /** Send one prompt into the window's session, with optional inline images and staged file receipts. */
  sendPrompt: (
    windowId: WindowId,
    text: string,
    mode: BoardPromptMode,
    images?: readonly BoardDraftImage[],
    files?: readonly string[],
  ) => void
  /** Cancel the window's running turn. */
  cancelPrompt: (windowId: WindowId) => void
  /** Load older turns into the window's lane. */
  loadOlderTurns: (windowId: WindowId) => void
  /** Point the window at an existing session, replacing its current chat. */
  bindSession: (windowId: WindowId, sessionId: SessionId) => void
  /** Create a chat in a workspace or directory and bind the window to it. */
  createChat: (windowId: WindowId, target: BoardChatTarget) => void
  /** Start a chat in a workspace, reusing its blank one, and bind the window to it. */
  startChat: (windowId: WindowId, workspaceId?: WorkspaceId) => Promise<void>
  /** Rename one chat. */
  renameChat: (sessionId: SessionId, title: string) => Promise<void>
  /** Branch one chat at its last completed turn and bind the window to the child. */
  forkChat: (windowId: WindowId, sessionId: SessionId) => Promise<void>
  /** Archive one chat; the client has no unarchive. */
  archiveChat: (sessionId: SessionId) => Promise<void>
  /** Move one chat inside its workspace. */
  reorderChat: (workspaceId: WorkspaceId, sessionId: SessionId, beforeSessionId?: SessionId) => Promise<void>
  /** Register a workspace for one directory. */
  createWorkspace: (path: string) => Promise<void>
  /** Rename one workspace. */
  renameWorkspace: (workspaceId: WorkspaceId, title: string) => Promise<void>
  /** Delete one workspace registration; its chats and files stay. */
  deleteWorkspace: (workspaceId: WorkspaceId) => Promise<void>
  /** Move one workspace before another, or to the end. */
  reorderWorkspace: (workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId) => Promise<void>
  /** List one directory level for the panel's folder browser. */
  listDirectory: (path?: string) => Promise<BoardDirectoryListing>
  /** Create one directory inside a parent and return its path. */
  createDirectory: (path: string, name: string) => Promise<string>
  /**
   * Pick one directory through the host's chooser — the native OS dialog when
   * the boot picked that interaction, the browse flow otherwise.
   */
  pickDirectory: () => Promise<string | null>
  /** Switch the agent preset of the window's still-blank session. */
  selectAgentPreset: (windowId: WindowId, presetId: string) => void
  /** Switch the permission preset of the window's session. */
  selectPermission: (windowId: WindowId, presetId: string) => void
  /** Switch the model or the reasoning effort of the window's session. */
  selectModel: (windowId: WindowId, selection: { provider: string; model: string; reasoningEffort?: string }) => void
  /** Leave plan mode through the host command. */
  exitPlanMode: (windowId: WindowId) => void
  /** Run one slash-command line against the window's session. */
  runCommand: (windowId: WindowId, line: string) => void
  /**
   * Execute one slash-command line, arguments included, and report its outcome
   * on the window channel; the composer shows the failure until the next send.
   * The draft's images and staged file receipts ride along, so a command that
   * accepts attachments receives them and one that does not is refused by the
   * host with its own reason.
   */
  executeCommand: (
    windowId: WindowId,
    line: string,
    images?: readonly BoardDraftImage[],
    files?: readonly string[],
  ) => void
  /**
   * Stage one non-image file for the window's session through the background
   * upload service.
   * @returns the staged receipt, or the failure text.
   */
  uploadFile: (windowId: WindowId, name: string, bytes: Uint8Array<ArrayBuffer>) => Promise<BoardUploadResult>
  /** Edit, remove, or steer one queued message. */
  updateQueueItem: (windowId: WindowId, itemId: string, action: 'remove' | 'steer') => void
  /** Pause, resume, or clear the window session's goal. */
  goalAction: (windowId: WindowId, action: 'pause' | 'resume' | 'clear') => void
  /** Resolve `@` mention candidates for the draft's query. */
  loadMentions: (windowId: WindowId, query: string, signal: AbortSignal) => Promise<readonly BoardMentionRow[]>
}


/** The inject face a board component receives: callbacks verbatim, hook sources bound. */
export type BoardWindowInjectProps = InjectFace<BoardWindowInjected>

/**
 * Layout fields for one window on the board canvas.
 * Position, size, and stack order are board-local view state, not session data;
 * the window's Harness session identity lives in the plugin's session bridge,
 * not in this store.
 */
export interface BoardWindowState {
  id: WindowId
  kind: WindowKind
  /** Body presented inside the frame; switching it swaps the rendered content. */
  bodyKind: WindowBodyKind
  /**
   * User-given window name. While set it overrides the chat title, so a renamed
   * window keeps the name the user chose; an empty value clears it.
   */
  customTitle?: string
  /**
   * Ordinal of the window among its kind, fixed at opening. The frame names the
   * template fallback from it at render time, so the window keeps its name
   * through locale switches instead of freezing the locale it opened in.
   */
  ordinal: number
  x: number
  y: number
  width: number
  height: number
  zIndex: number
}

/**
 * Render the body slot occurrence for one window. The windows layer owns the
 * `board.window.body` declaration, so its frames receive this dispatcher as an
 * owner prop instead of a `renderSlot` seat of their own.
 */
export type RenderWindowBody = (window: BoardWindowState) => ReactNode

/**
 * Owner props of one keyed `board.window` slot instance.
 * @param window - the window state the frame renders.
 * @param renderBody - body dispatcher bound to the declaring windows layer.
 */
export interface BoardWindowOwnerProps {
  window: BoardWindowState
  renderBody: RenderWindowBody
}

/** Owner props of one window's chats panel: the same window share the frame gets. */
export interface BoardWindowPanelOwnerProps {
  window: BoardWindowState
}

/**
 * Owner props of one keyed `board.window.body` slot instance.
 * @param window - the window state whose `bodyKind` selected this occupant.
 */
export interface BoardWindowBodyOwnerProps {
  window: BoardWindowState
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Root container of the spatial board canvas; renders the floating layers. */
    'board.canvas': { kind: 'single'; scope: 'root' }
    /** Left floating rail showing active sessions / windows. */
    'board.dock': { kind: 'single'; scope: 'root' }
    /** Multi-window layer inside the canvas transform; renders the keyed window slots. */
    'board.windows': { kind: 'single'; scope: 'root' }
    /**
     * Window container for a single board card. The owner share is the same for
     * every kind; the keyed table is what closes the dispatch domain to
     * `WindowKind`.
     */
    'board.window': {
      kind: 'keyed'
      scope: 'root'
      owner: BoardWindowOwnerProps
      keyProps: { [Key in WindowKind]: BoardWindowOwnerProps }
    }
    /**
     * Window content inside one board card, declared by the windows layer. The
     * owner share is the same for every body kind; the keyed table is what
     * closes the dispatch domain to `WindowBodyKind`.
     */
    'board.window.body': {
      kind: 'keyed'
      scope: 'root'
      owner: BoardWindowBodyOwnerProps
      keyProps: { [Key in WindowBodyKind]: BoardWindowBodyOwnerProps }
    }
    /**
     * Chats panel of one board card: a companion layer the frame's own fullscreen
     * toggle expands. The keyed table closes the dispatch domain to `WindowKind`.
     */
    'board.window.panel': {
      kind: 'keyed'
      scope: 'root'
      owner: BoardWindowPanelOwnerProps
      keyProps: { [Key in WindowKind]: BoardWindowPanelOwnerProps }
    }
    /** Bottom-right interactive SVG minimap. */
    'board.minimap': { kind: 'single'; scope: 'root' }
    /** Floating center omnibox. */
    'board.omnibar': { kind: 'single'; scope: 'root' }
  }
}
