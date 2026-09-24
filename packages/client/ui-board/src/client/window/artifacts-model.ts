/**
 * Derivation of session artifacts from transcript tool results. Client-only
 * and filesystem-free: the list is folded directly from settled `write`,
 * `edit`, `str_replace_editor`, and `read` nodes in the chat snapshot.
 */
import type { ChatSnapshot, ConversationNode, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { toolNodeArgs, toolNodeName } from './tool-card-model.ts'

/** The lifecycle phase of one artifact change. */
export type SessionArtifactKind = 'created' | 'modified' | 'read'

/** One file artifact touched or produced by the session. */
export interface SessionArtifact {
  /** File path as reported by the tool call or result metadata. */
  readonly path: string
  /** The most specific mutation or access kind observed. */
  readonly kind: SessionArtifactKind
  /** Unix timestamp in ms of the latest interaction with this path. */
  readonly time: number
}

function isSettledNode(node: unknown): node is ToolResultNode {
  return typeof node === 'object' && node !== null && 'kind' in node && (node as { kind: string }).kind === 'tool-result'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

interface RawArtifactEntry {
  readonly path: string
  readonly kind: SessionArtifactKind
  readonly time: number
}

/**
 * Extract candidate artifact entries from one settled tool result node.
 * @param node - settled tool result node.
 * @returns extracted candidate entries for this tool call.
 */
function extractNodeEntries(node: ToolResultNode): RawArtifactEntry[] {
  if (node.isError) return []
  const name = toolNodeName(node)
  const args = toolNodeArgs(node)
  const meta = asRecord(node.meta)
  const time = typeof node.time === 'number' && !Number.isNaN(node.time) ? node.time : 0
  const entries: RawArtifactEntry[] = []

  switch (name) {
    case 'write': {
      let foundInDiffs = false
      if (meta !== null && Array.isArray(meta.diffs)) {
        for (const diffItem of meta.diffs) {
          const diff = asRecord(diffItem)
          if (typeof diff?.path === 'string' && diff.path !== '') {
            const isCreate = diff.oldText === null || diff.oldText === undefined
            entries.push({ path: diff.path, kind: isCreate ? 'created' : 'modified', time })
            foundInDiffs = true
          }
        }
      }
      if (!foundInDiffs && args !== null) {
        const filePath = args.file_path ?? args.path
        if (typeof filePath === 'string' && filePath !== '') {
          entries.push({ path: filePath, kind: 'created', time })
        }
      }
      break
    }
    case 'edit': {
      let foundInDiffs = false
      if (meta !== null && Array.isArray(meta.diffs)) {
        for (const diffItem of meta.diffs) {
          const diff = asRecord(diffItem)
          if (typeof diff?.path === 'string' && diff.path !== '') {
            entries.push({ path: diff.path, kind: 'modified', time })
            foundInDiffs = true
          }
        }
      }
      if (!foundInDiffs && args !== null) {
        const filePath = args.file_path ?? args.path
        if (typeof filePath === 'string' && filePath !== '') {
          entries.push({ path: filePath, kind: 'modified', time })
        }
      }
      break
    }
    case 'str_replace_editor': {
      const command = args !== null && typeof args.command === 'string' ? args.command : undefined
      const kind: SessionArtifactKind = command === 'create'
        ? 'created'
        : command === 'view'
          ? 'read'
          : 'modified'
      let foundInDiffs = false
      if (meta !== null && Array.isArray(meta.diffs)) {
        for (const diffItem of meta.diffs) {
          const diff = asRecord(diffItem)
          if (typeof diff?.path === 'string' && diff.path !== '') {
            entries.push({ path: diff.path, kind, time })
            foundInDiffs = true
          }
        }
      }
      if (!foundInDiffs && args !== null) {
        if (typeof args.path === 'string' && args.path !== '') {
          entries.push({ path: args.path, kind, time })
        }
      }
      break
    }
    case 'read':
    case 'read_image': {
      let path: string | null = null
      if (meta !== null && typeof meta.path === 'string' && meta.path !== '') {
        path = meta.path
      }
      if (path === null && args !== null) {
        const filePath = args.file_path ?? args.path
        if (typeof filePath === 'string' && filePath !== '') path = filePath
      }
      if (path !== null) {
        entries.push({ path, kind: 'read', time })
      }
      break
    }
    default:
      break
  }

  for (const child of node.subCalls) {
    if (isSettledNode(child)) {
      entries.push(...extractNodeEntries(child))
    }
  }

  return entries
}

/** Precedence rank: mutations outrank passive reads. */
function kindRank(kind: SessionArtifactKind): number {
  switch (kind) {
    case 'created':
    case 'modified':
      return 2
    case 'read':
      return 1
  }
}

/**
 * Fold all successful file-access and file-mutation tool results into a deduplicated list of session artifacts.
 *
 * Duplicates across turns or repeated operations collapse by exact path: a file
 * created and later edited retains its mutation identity and updates its
 * timestamp to the latest occurrence; reads on an already-mutated path preserve
 * the mutation record.
 * @param chat - the loaded session chat snapshot, or undefined when loading.
 * @returns artifacts ordered from newest to oldest interaction.
 */
export function sessionArtifacts(chat?: ChatSnapshot): readonly SessionArtifact[] {
  if (chat === undefined) return []
  const nodes = chat.legacy.nodes as readonly (ConversationNode | undefined)[]
  const map = new Map<string, { kind: SessionArtifactKind; time: number }>()

  for (const node of nodes) {
    if (node === undefined || !isSettledNode(node)) continue
    const entries = extractNodeEntries(node)
    for (const entry of entries) {
      const existing = map.get(entry.path)
      if (existing === undefined) {
        map.set(entry.path, { kind: entry.kind, time: entry.time })
        continue
      }
      const updatedTime = Math.max(existing.time, entry.time)
      let resolvedKind = existing.kind
      if (kindRank(entry.kind) > kindRank(existing.kind)) {
        resolvedKind = entry.kind
      } else if (existing.kind === 'created' && entry.kind === 'modified') {
        resolvedKind = 'modified'
      }
      map.set(entry.path, { kind: resolvedKind, time: updatedTime })
    }
  }

  return [...map.entries()]
    .map(([path, data]) => ({ path, kind: data.kind, time: data.time }))
    .sort((a, b) => b.time - a.time || a.path.localeCompare(b.path))
}
