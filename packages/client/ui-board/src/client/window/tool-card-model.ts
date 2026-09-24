/**
 * Card derivation for the window lane's tool rows. One running or settled tool
 * node folds into the payload one ui-primitives block renders; a node the table
 * cannot cover — an unknown tool, a result whose metadata is malformed, a call
 * head that the loaded window no longer holds — declines with `null` and the
 * lane renders its safe JSON block instead. Every reader tolerates partial wire
 * data (a half-streamed `argsRaw`, a restored result without metadata) and
 * never throws, so no node type can take the window down.
 */
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { DiffHunk, ReadBlockLine, SearchBlockLineMatch, SearchFileGroup, WebSourceView } from '@deepseek-ai/dsh-client-ui-primitives'

/** A settled result carries its discriminant; a running call carries none. */
function isSettledNode(node: ToolCallBlock): node is ToolResultNode {
  return 'kind' in node
}

/** Block a tool node renders as; `json` is the fallback for everything else. */
export type ToolCardKind =
  | 'terminal' | 'read' | 'diff' | 'search' | 'web' | 'image' | 'todos' | 'question' | 'json'

/**
 * Block the card table selects for one wire tool name. The mapped names are the
 * shipped tool views of the application (`ui-tool` and friends) plus
 * `str_replace_editor`, whose edits render through the diff block; a name the
 * table cannot read renders through the JSON fallback.
 * @param toolName - wire tool name as the call logged it.
 * @returns the block kind the name maps to.
 */
export function toolCardKind(toolName: string): ToolCardKind {
  switch (toolName) {
    case 'bash':
    case 'pwsh':
    case 'terminal_send':
      return 'terminal'
    case 'read':
      return 'read'
    case 'write':
    case 'edit':
    case 'str_replace_editor':
      return 'diff'
    case 'grep':
    case 'glob':
      return 'search'
    case 'web_search':
    case 'web_fetch':
      return 'web'
    case 'read_image':
      return 'image'
    case 'todo_write':
      return 'todos'
    case 'ask_user_question':
      return 'question'
    default:
      return 'json'
  }
}

/**
 * Wire tool name of one node.
 * @param node - running call or settled result.
 * @returns the logged name, or `''` when window truncation left the call head outside.
 */
export function toolNodeName(node: ToolCallBlock): string {
  return (isSettledNode(node) ? node.call?.name : node.name) ?? ''
}

/**
 * Raw JSON arguments of one node.
 * @param node - running call or settled result.
 * @returns the logged argument text, or `''` when the call head is outside the window.
 */
export function toolNodeArgsRaw(node: ToolCallBlock): string {
  return (isSettledNode(node) ? node.call?.argsRaw : node.argsRaw) ?? ''
}

/**
 * Parsed arguments of one node.
 * @param node - running call or settled result.
 * @returns the parsed object, or `null` for a missing head or non-object JSON.
 */
export function toolNodeArgs(node: ToolCallBlock): Record<string, unknown> | null {
  const raw = toolNodeArgsRaw(node)
  if (raw === '') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : null
  } catch {
    // A half-streamed running call or malformed model JSON declines to the fallback.
    return null
  }
}

/**
 * Text of one node's result content.
 * @param node - running call or settled result.
 * @returns text blocks joined by newline; `''` while running or without text.
 */
export function toolNodeText(node: ToolCallBlock): string {
  if (!isSettledNode(node)) return ''
  return node.content
    .map(block => block.type === 'text' ? block.text : '')
    .filter(text => text !== '')
    .join('\n')
}

/** Payload the JSON fallback shows: the call's arguments and its result text. */
export interface ToolJsonPayload {
  readonly arguments: unknown
  readonly result: string
}

/**
 * Payload of the JSON fallback for one node.
 * @param node - running call or settled result.
 * @returns the parsed arguments when available, the raw text otherwise, plus the result text.
 */
export function toolJsonPayload(node: ToolCallBlock): ToolJsonPayload {
  const parsed = toolNodeArgs(node)
  const raw = toolNodeArgsRaw(node)
  return {
    arguments: parsed ?? (raw === '' ? null : raw),
    result: toolNodeText(node),
  }
}

/** Console card data of one terminal call. */
export interface TerminalCardData {
  readonly command: string
  readonly output: string
  readonly exitCode?: number | undefined
  readonly signal?: string | undefined
}

const EXIT_MARKER = /\n?\[exit code: (-?\d+)\]\s*$/
const SIGNAL_MARKER = /\n?\[killed by signal: ([^\]\n]+)\]\s*$/

/**
 * Terminal block data of one `bash`, `pwsh`, or `terminal_send` node.
 * @param node - running call or settled result.
 * @returns the command line plus the output and its exit status, or `null` for another tool or a missing command.
 */
export function terminalCardData(node: ToolCallBlock): TerminalCardData | null {
  const name = toolNodeName(node)
  if (name !== 'bash' && name !== 'pwsh' && name !== 'terminal_send') return null
  const args = toolNodeArgs(node)
  if (args === null) return null
  const command = asString(args.command) ?? asString(args.text)
  if (command === null || command === '') return null
  if (!isSettledNode(node)) return { command, output: '' }
  let output = toolNodeText(node)
  const signal = SIGNAL_MARKER.exec(output)
  if (signal !== null && signal[1] !== undefined) {
    return { command, output: output.slice(0, signal.index), signal: signal[1] }
  }
  const exit = EXIT_MARKER.exec(output)
  if (exit === null) return { command, output, exitCode: 0 }
  output = output.slice(0, exit.index)
  const code = exit[1] === undefined ? undefined : Number(exit[1])
  return code === undefined ? { command, output } : { command, output, exitCode: code }
}

/** File-read card data of one settled `read` result. */
export interface ReadCardData {
  readonly label: string
  readonly lines: ReadBlockLine[]
  readonly totalLines: number
  readonly lang?: string | undefined
}

/**
 * Read block data of one `read` node.
 * @param node - running call or settled result.
 * @returns the returned window's lines and label, or `null` while running or without usable metadata.
 */
export function readCardData(node: ToolCallBlock): ReadCardData | null {
  if (toolNodeName(node) !== 'read' || !isSettledNode(node)) return null
  const meta = isRecord(node.meta) ? node.meta : null
  if (meta === null) return null
  const lines = readLines(meta.lines)
  if (lines === null) return null
  const args = toolNodeArgs(node)
  const label = asString(meta.path) ?? (args === null ? null : asString(args.file_path)) ?? ''
  const total = meta.totalLines
  const totalLines = typeof total === 'number' && Number.isInteger(total) && total >= 0 ? total : lines.length
  const lang = asString(meta.lang)
  return {
    label,
    lines,
    totalLines,
    ...(lang === null ? {} : { lang }),
  }
}

/**
 * Diff block data of one `write`, `edit`, or `str_replace_editor` node: the
 * applied hunks the result reports, or the hunk the arguments intend when the
 * result carries none (a running call, a create/overwrite without metadata).
 * @param node - running call or settled result.
 * @returns the hunks to draw, or `null` when the node is another tool or names no change.
 */
export function diffCardData(node: ToolCallBlock): DiffHunk[] | null {
  const name = toolNodeName(node)
  if (toolCardKind(name) !== 'diff') return null
  if (isSettledNode(node) && isRecord(node.meta)) {
    const applied = diffHunks(node.meta.diffs)
    if (applied !== null && applied.length > 0) return applied
  }
  const args = toolNodeArgs(node)
  if (args === null) return null
  return intendedDiff(name, args)
}

/** Search block data of one settled `grep` or `glob` result, in its result shape. */
export type SearchCardData =
  | { kind: 'matches'; files: SearchFileGroup[]; truncated: boolean; total: number }
  | { kind: 'paths'; paths: string[]; truncated: boolean; total: number }

/**
 * Search block data of one `grep` or `glob` node.
 * @param node - running call or settled result.
 * @returns the matches or paths the result reports, or `null` while running, for another tool, or without usable metadata.
 */
export function searchCardData(node: ToolCallBlock): SearchCardData | null {
  if (toolCardKind(toolNodeName(node)) !== 'search' || !isSettledNode(node)) return null
  if (!isRecord(node.meta)) return null
  const truncated = node.meta.truncated === true
  const total = asCount(node.meta.total)
  if (node.meta.shape === 'matches') {
    const files = searchFiles(node.meta.files)
    if (files === null) return null
    return {
      kind: 'matches',
      files,
      truncated,
      total: total ?? files.reduce((sum, file) => sum + file.matches.length, 0),
    }
  }
  if (node.meta.shape === 'paths') {
    const paths = asStringArray(node.meta.paths)
    if (paths === null) return null
    return { kind: 'paths', paths, truncated, total: total ?? paths.length }
  }
  return null
}

/** Web block data of one settled `web_search` or `web_fetch` result, in its result shape. */
export type WebCardData =
  | { kind: 'search'; answer?: string | undefined; sources: WebSourceView[]; truncated: boolean }
  | { kind: 'fetch'; url: string; statusCode: number; truncated: boolean }

/**
 * Web block data of one `web_search` or `web_fetch` node.
 * @param node - running call or settled result.
 * @returns the citations or fetch summary the result reports, or `null` while running, for another tool, or without usable metadata.
 */
export function webCardData(node: ToolCallBlock): WebCardData | null {
  const name = toolNodeName(node)
  if (name !== 'web_search' && name !== 'web_fetch') return null
  if (!isSettledNode(node) || !isRecord(node.meta)) return null
  const truncated = node.meta.truncated === true
  if (name === 'web_search') {
    const sources = webSources(node.meta.sources)
    if (sources === null) return null
    const answer = asString(node.meta.answer)
    return { kind: 'search', sources, truncated, ...(answer === null ? {} : { answer }) }
  }
  const url = asString(node.meta.url)
  const statusCode = asCount(node.meta.statusCode)
  if (url === null || statusCode === null) return null
  return { kind: 'fetch', url, statusCode, truncated }
}

/** Image card data of one settled `read_image` result. */
export interface ImageCardData {
  readonly label: string
  readonly attachments: ImageAttachmentRef[]
}

/**
 * Image card data of one `read_image` node.
 * @param node - running call or settled result.
 * @returns the durable image references to preview, or `null` for another tool or an error/result without images.
 */
export function imageCardData(node: ToolCallBlock): ImageCardData | null {
  if (toolNodeName(node) !== 'read_image' || !isSettledNode(node) || node.isError) return null
  const attachments: ImageAttachmentRef[] = []
  for (const block of node.content) {
    if (block.type !== 'image') continue
    const ref = imageRef(block.attachment)
    if (ref !== null) attachments.push(ref)
  }
  if (attachments.length === 0) return null
  const meta = isRecord(node.meta) ? node.meta : null
  const args = toolNodeArgs(node)
  const label = (meta === null ? null : asString(meta.path))
    ?? (args === null ? null : asString(args.file_path))
    ?? ''
  return { label, attachments }
}

/** One to-do item the task card lists. */
export interface TodoCardItem {
  readonly content: string
  readonly status: string
}

/**
 * To-do list of one `todo_write` node, taken from the call's arguments.
 * @param node - running call or settled result.
 * @returns the items the call writes, or `null` for another tool or malformed arguments.
 */
export function todoCardData(node: ToolCallBlock): readonly TodoCardItem[] | null {
  if (toolNodeName(node) !== 'todo_write') return null
  const args = toolNodeArgs(node)
  if (args === null || !Array.isArray(args.todos)) return null
  const items: TodoCardItem[] = []
  for (const entry of args.todos) {
    if (!isRecord(entry)) return null
    const content = asString(entry.content)
    const status = asString(entry.status)
    if (content === null || status === null) return null
    items.push({ content, status })
  }
  return items
}

/** One answered question the question card lists. */
export interface QuestionCardPair {
  readonly question: string
  readonly answers: readonly string[]
}

/**
 * Question/answer pairs of one settled `ask_user_question` result.
 * @param node - running call or settled result.
 * @returns one pair per question the result answered, or `null` for another tool, an error, or malformed data.
 */
export function questionCardData(node: ToolCallBlock): readonly QuestionCardPair[] | null {
  if (toolNodeName(node) !== 'ask_user_question' || !isSettledNode(node) || node.isError) return null
  const args = toolNodeArgs(node)
  if (args === null || !Array.isArray(args.questions)) return null
  const answers = questionAnswers(toolNodeText(node))
  if (answers === null) return null
  const pairs: QuestionCardPair[] = []
  for (const entry of args.questions) {
    if (!isRecord(entry)) return null
    const id = asString(entry.id)
    const question = asString(entry.question)
    if (id === null || question === null) return null
    const answer = answers.get(id)
    if (answer === undefined) continue
    pairs.push({ question, answers: answer })
  }
  return pairs.length === 0 ? null : pairs
}

/** Whether a value is a plain object suitable for field reads. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A non-empty-capable string field, or null for another type. */
function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** A non-negative integer field, or null for another type. */
function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/** Every element as a string, or null when the value is not a string array. */
function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) return null
  return value
}

/** Validated read lines from a result's metadata. */
function readLines(value: unknown): ReadBlockLine[] | null {
  if (!Array.isArray(value)) return null
  const lines: ReadBlockLine[] = []
  for (const entry of value) {
    if (!isRecord(entry)) return null
    const number = asCount(entry.number)
    const text = asString(entry.text)
    if (number === null || number < 1 || text === null) return null
    lines.push({ number, text })
  }
  return lines
}

/** Validated applied hunks from a result's metadata. */
function diffHunks(value: unknown): DiffHunk[] | null {
  if (!Array.isArray(value)) return null
  const hunks: DiffHunk[] = []
  for (const entry of value) {
    if (!isRecord(entry)) return null
    const path = asString(entry.path)
    const newText = asString(entry.newText)
    const oldText = entry.oldText === null ? null : asString(entry.oldText)
    if (path === null || newText === null || (entry.oldText !== null && oldText === null)) return null
    hunks.push({ path, oldText, newText })
  }
  return hunks
}

/**
 * The hunk the call's own arguments intend, for a result that reports none.
 * @param name - wire tool name of the node.
 * @param args - parsed call arguments.
 * @returns one hunk, or null when the tool names no change the card can draw.
 */
function intendedDiff(name: string, args: Record<string, unknown>): DiffHunk[] | null {
  if (name === 'write') {
    const path = asString(args.file_path)
    const content = asString(args.content)
    if (path === null || content === null) return null
    return [{ path, oldText: null, newText: content }]
  }
  if (name === 'edit') {
    const path = asString(args.file_path)
    const removed = asString(args.old_string)
    const added = asString(args.new_string)
    if (path === null || removed === null || added === null) return null
    return [{ path, oldText: removed === '' ? null : removed, newText: added }]
  }
  const path = asString(args.path)
  if (path === null) return null
  if (args.command === 'create') {
    const text = asString(args.file_text) ?? ''
    return [{ path, oldText: null, newText: text }]
  }
  if (args.command === 'str_replace') {
    const removed = asString(args.old_str)
    const added = asString(args.new_str)
    if (removed === null || added === null) return null
    return [{ path, oldText: removed === '' ? null : removed, newText: added }]
  }
  return null
}

/** Validated file groups from a search result's metadata. */
function searchFiles(value: unknown): SearchFileGroup[] | null {
  if (!Array.isArray(value)) return null
  const files: SearchFileGroup[] = []
  for (const entry of value) {
    if (!isRecord(entry)) return null
    const path = asString(entry.path)
    const matches = searchMatches(entry.matches)
    if (path === null || matches === null) return null
    files.push({ path, matches })
  }
  return files
}

/** Validated matched lines from one search file group. */
function searchMatches(value: unknown): SearchBlockLineMatch[] | null {
  if (!Array.isArray(value)) return null
  const matches: SearchBlockLineMatch[] = []
  for (const entry of value) {
    if (!isRecord(entry)) return null
    const lineNumber = asCount(entry.lineNumber)
    const line = asString(entry.line)
    if (lineNumber === null || lineNumber < 1 || line === null) return null
    matches.push({ lineNumber, line })
  }
  return matches
}

/** Validated citation views from a web search result's metadata. */
function webSources(value: unknown): WebSourceView[] | null {
  if (!Array.isArray(value)) return null
  const sources: WebSourceView[] = []
  for (const entry of value) {
    if (!isRecord(entry)) return null
    const url = asString(entry.url)
    if (url === null) return null
    const title = asString(entry.title)
    const snippet = asString(entry.snippet)
    const publishedAt = asString(entry.publishedAt)
    sources.push({
      url,
      ...(title === null ? {} : { title }),
      ...(snippet === null ? {} : { snippet }),
      ...(publishedAt === null ? {} : { publishedAt }),
    })
  }
  return sources
}

/** Validated durable image reference, or null for a malformed attachment. */
function imageRef(value: unknown): ImageAttachmentRef | null {
  if (!isRecord(value)) return null
  if (typeof value.attachmentId !== 'string'
    || typeof value.mediaType !== 'string'
    || typeof value.bytes !== 'number'
    || typeof value.width !== 'number'
    || typeof value.height !== 'number') return null
  return value as unknown as ImageAttachmentRef
}

/** Answer lines by question id from an ask-user result's JSON text. */
function questionAnswers(text: string): Map<string, string[]> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // An aborted or cancelled ask may log no answer JSON; the card declines.
    return null
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.answers)) return null
  const byId = new Map<string, string[]>()
  for (const entry of parsed.answers) {
    if (!isRecord(entry)) return null
    const id = asString(entry.id)
    const selected = asStringArray(entry.selected)
    const custom = entry.custom === undefined ? null : asString(entry.custom)
    if (id === null || selected === null) return null
    byId.set(id, custom === null ? selected : [...selected, custom])
  }
  return byId
}
