/**
 * The `/api/ketos.board.todo` route: every change a browser makes to a to-do
 * list. The host is the only writer: it verifies the body, finds the element
 * and its owner, runs the change through `bd`, re-reads the epic's items, and
 * writes the snapshot back into the board document. A foreign element is
 * refused before any `bd` call, and `place` is serialized so two tabs cannot
 * both place one list.
 * @module @ketos/board-todo/routes
 */

import type { Context } from '@deepseek-ai/cordis'
// The empty import applies the connection service's Context declaration merge.
import type {} from '@deepseek-ai/dsh-client-connection'
import { mintElementId, parseTodoData } from '@ketos/board-doc/data'
import type {
  BeadsIssueId, BoardElement, BoardElementData, BoardOp, BoardOpsResponse, BoardOrigin,
  BoardSnapshot, ElementId, OwnerId, TodoData,
} from '@ketos/board-doc/types'
import type { BeadsIssue } from './beads.ts'
import { BeadsCommandError, beadsCommandErrorText, BeadsProtocolError, BeadsUnavailableError } from './beads.ts'
import type { TodoAnswer, TodoRequest } from './types.ts'
import {
  boolean, coordinate, elementId, fail, issueId, NO_STORE, ok, record, rejectUnknownFields,
  title, TodoRouteError,
} from './wire.ts'

/** Path of the to-do route below the `/api` mount. */
export const TODO_PATH = '/api/ketos.board.todo'

/** World rectangle a host-created list gets; mirrors the board's todo descriptor. */
export const TODO_DEFAULT_WIDTH = 280

/** World height a host-created list gets; mirrors the board's todo descriptor. */
export const TODO_DEFAULT_HEIGHT = 240

/** The board-document subset the to-do routes use; `ctx.ketosBoardDoc` satisfies it. */
export interface TodoDoc {
  selfId(): Promise<OwnerId>
  snapshot(): Promise<BoardSnapshot>
  apply(ops: readonly BoardOp[], origin: BoardOrigin): Promise<BoardOpsResponse>
}

/** The `bd` subset the to-do routes use; {@link BeadsCli} satisfies it. */
export interface TodoBeads {
  createEpic(title: string, signal: AbortSignal): Promise<BeadsIssue>
  createItem(epicId: BeadsIssueId, title: string, signal: AbortSignal): Promise<BeadsIssue>
  setDone(id: BeadsIssueId, done: boolean, signal: AbortSignal): Promise<BeadsIssue>
  children(epicId: BeadsIssueId, signal: AbortSignal): Promise<BeadsIssue[]>
  show(epicId: BeadsIssueId, signal: AbortSignal): Promise<BeadsIssue | undefined>
}

/** Everything the to-do route and command read from the deployment. */
export interface TodoRouteConfig {
  readonly doc: TodoDoc
  readonly beads: TodoBeads
  /** Largest list or item title in UTF-16 code units. */
  readonly titleMaxChars: number
  /** Host journal sink for `bd` failures; never reaches the browser. */
  readonly logger: (message: string) => void
}

/** One host-side list creation, from the route or the `/todo` command. */
export interface TodoCreateInput {
  readonly title: string
  readonly x: number
  readonly y: number
  /** True when the list waits for a visible tab to place it. */
  readonly pendingPlacement: boolean
}

/** Fields each request action accepts; any other field is refused. */
const ACTION_FIELDS: Readonly<Record<TodoRequest['action'], readonly string[]>> = {
  create: ['action', 'title', 'x', 'y'],
  addItem: ['action', 'elementId', 'title'],
  setDone: ['action', 'elementId', 'itemId', 'done'],
  refresh: ['action', 'elementId'],
  place: ['action', 'elementId', 'x', 'y'],
}

/**
 * Parse one route body into its typed request.
 * @param text - raw request body.
 * @param titleMaxChars - largest accepted title length.
 * @returns the parsed request.
 */
export function parseTodoRequest(text: string, titleMaxChars: number): TodoRequest {
  let decoded: unknown
  try {
    decoded = JSON.parse(text)
  } catch {
    // A body that is not JSON cannot carry any accepted action.
    throw new TodoRouteError('ketos/invalid', 'body must be JSON')
  }
  const body = record(decoded, 'body must be a JSON object')
  const action = body['action']
  if (typeof action !== 'string' || !Object.hasOwn(ACTION_FIELDS, action)) {
    throw new TodoRouteError('ketos/invalid', 'action is unknown')
  }
  rejectUnknownFields(body, ACTION_FIELDS[action as TodoRequest['action']])
  switch (action as TodoRequest['action']) {
    case 'create':
      return { action: 'create', title: title(body, 'title', titleMaxChars), x: coordinate(body, 'x'), y: coordinate(body, 'y') }
    case 'addItem':
      return { action: 'addItem', elementId: elementId(body, 'elementId'), title: title(body, 'title', titleMaxChars) }
    case 'setDone':
      return { action: 'setDone', elementId: elementId(body, 'elementId'), itemId: issueId(body, 'itemId'), done: boolean(body, 'done') }
    case 'refresh':
      return { action: 'refresh', elementId: elementId(body, 'elementId') }
    case 'place':
      return { action: 'place', elementId: elementId(body, 'elementId'), x: coordinate(body, 'x'), y: coordinate(body, 'y') }
  }
}

/**
 * Register the to-do route for the plugin's lifetime.
 * @param ctx - host context carrying `connection`.
 * @param config - the board document, the `bd` wrapper, and the deployment bounds.
 */
export function registerTodoRoutes(ctx: Context, config: TodoRouteConfig): void {
  const placements = new OperationQueue()
  ctx.connection.fetch.register({
    path: TODO_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: request => handleTodoRequest(request, config, placements),
  })
}

/**
 * Answer one to-do request.
 * @param request - the Fetch request.
 * @param config - the board document, the `bd` wrapper, and the deployment bounds.
 * @param placements - the serialization queue `place` runs through.
 * @returns the JSON response.
 */
export async function handleTodoRequest(
  request: Request,
  config: TodoRouteConfig,
  placements: OperationQueue = new OperationQueue(),
): Promise<Response> {
  try {
    const body = parseTodoRequest(await request.text(), config.titleMaxChars)
    switch (body.action) {
      case 'create':
        return ok(await createTodoList(config, { title: body.title, x: body.x, y: body.y, pendingPlacement: false }, request.signal))
      case 'addItem':
        return ok(await addTodoItem(config, body.elementId, body.title, request.signal))
      case 'setDone':
        return ok(await setTodoItemDone(config, body.elementId, body.itemId, body.done, request.signal))
      case 'refresh':
        return ok(await refreshTodoList(config, body.elementId, request.signal))
      case 'place':
        return ok(await placements.run(() => placeTodoList(config, body.elementId, body.x, body.y, request.signal)))
    }
  } catch (error: unknown) {
    return todoFailure(error, config)
  }
}

/**
 * Create the epic and the board element of one list, then answer their ids.
 * @param config - the board document, the `bd` wrapper, and the deployment bounds.
 * @param input - validated creation input.
 * @param signal - the request's cancellation signal.
 * @returns the created element's id and the new revision.
 */
export async function createTodoList(config: TodoRouteConfig, input: TodoCreateInput, signal: AbortSignal): Promise<TodoAnswer> {
  const epic = await config.beads.createEpic(input.title, signal)
  const items = await config.beads.children(epic.id, signal)
  const id = mintElementId()
  const { revision } = await config.doc.apply([{
    op: 'create',
    id,
    kind: 'todo',
    x: input.x,
    y: input.y,
    w: TODO_DEFAULT_WIDTH,
    h: TODO_DEFAULT_HEIGHT,
    data: snapshotData(epic.id, epic.title, items, new Date().toISOString(), input.pendingPlacement),
  }], 'host')
  return { ok: true, elementId: id, revision }
}

/**
 * Append one item and write the re-read snapshot.
 * @param config - the board document, the `bd` wrapper, and the deployment bounds.
 * @param id - element id.
 * @param itemTitle - validated item title.
 * @param signal - the request's cancellation signal.
 * @returns the element id and the new revision.
 */
async function addTodoItem(config: TodoRouteConfig, id: ElementId, itemTitle: string, signal: AbortSignal): Promise<TodoAnswer> {
  const found = await findOwnedTodo(config, id)
  if (found.data.items.length >= found.limits.todoItemsMax) {
    throw new TodoRouteError('ketos/limit', 'the to-do list is full')
  }
  await config.beads.createItem(found.data.epicId, itemTitle, signal)
  const items = await config.beads.children(found.data.epicId, signal)
  return writeSnapshot(config, id, { items: itemData(items), syncedAt: new Date().toISOString(), missing: null })
}

/**
 * Set one item's done state and write the re-read snapshot.
 * @param config - the board document, the `bd` wrapper, and the deployment bounds.
 * @param id - element id.
 * @param itemId - item issue id, required to belong to the list.
 * @param done - true closes the item, false opens it.
 * @param signal - the request's cancellation signal.
 * @returns the element id and the new revision.
 */
async function setTodoItemDone(
  config: TodoRouteConfig,
  id: ElementId,
  itemId: BeadsIssueId,
  done: boolean,
  signal: AbortSignal,
): Promise<TodoAnswer> {
  const found = await findOwnedTodo(config, id)
  if (!found.data.items.some(item => item.id === itemId)) {
    throw new TodoRouteError('ketos/invalid', 'itemId does not belong to the list')
  }
  await config.beads.setDone(itemId, done, signal)
  const items = await config.beads.children(found.data.epicId, signal)
  return writeSnapshot(config, id, { items: itemData(items), syncedAt: new Date().toISOString(), missing: null })
}

/**
 * Re-read the epic; a missing epic marks the snapshot instead of clearing it.
 * @param config - the board document, the `bd` wrapper, and the deployment bounds.
 * @param id - element id.
 * @param signal - the request's cancellation signal.
 * @returns the element id and the new revision.
 */
async function refreshTodoList(config: TodoRouteConfig, id: ElementId, signal: AbortSignal): Promise<TodoAnswer> {
  const found = await findOwnedTodo(config, id)
  const epic = await config.beads.show(found.data.epicId, signal)
  if (epic === undefined) {
    return writeSnapshot(config, id, { missing: true, syncedAt: new Date().toISOString() })
  }
  const items = await config.beads.children(found.data.epicId, signal)
  return writeSnapshot(config, id, { title: epic.title, items: itemData(items), syncedAt: new Date().toISOString(), missing: null })
}

/**
 * Place one list that still waits for placement; the queue around this call
 * makes the check and the flag removal one serialized step.
 * @param config - the board document, the `bd` wrapper, and the deployment bounds.
 * @param id - element id.
 * @param x - target world x.
 * @param y - target world y.
 * @param signal - the request's cancellation signal.
 * @returns the element id and the new revision.
 */
async function placeTodoList(config: TodoRouteConfig, id: ElementId, x: number, y: number, signal: AbortSignal): Promise<TodoAnswer> {
  signal.throwIfAborted()
  const found = await findOwnedTodo(config, id)
  if (found.data.pendingPlacement !== true) {
    throw new TodoRouteError('ketos/placement-taken', 'the list is already placed')
  }
  const { revision } = await config.doc.apply([{
    op: 'patch',
    id,
    x,
    y,
    data: { pendingPlacement: null },
  }], 'host')
  return { ok: true, elementId: id, revision }
}

/**
 * Read one hosted to-do element and its parsed snapshot.
 * @param config - the board document, the `bd` wrapper, and the deployment bounds.
 * @param id - element id.
 * @returns the element, its data, and the document limits.
 */
async function findOwnedTodo(
  config: TodoRouteConfig,
  id: ElementId,
): Promise<{ element: BoardElement; data: TodoData; limits: BoardSnapshot['limits'] }> {
  const snapshot = await config.doc.snapshot()
  const element = snapshot.elements.find(candidate => candidate.id === id)
  if (element === undefined || element.kind !== 'todo') {
    throw new TodoRouteError('ketos/element-not-found', `element ${id} is not a to-do list`)
  }
  const data = parseTodoData(element.data, snapshot.limits)
  if (data === null) throw new TodoRouteError('ketos/element-not-found', `element ${id} carries an unreadable snapshot`)
  if (element.ownerId !== await config.doc.selfId()) {
    throw new TodoRouteError('ketos/not-owner', `element ${id} belongs to another participant`)
  }
  return { element, data, limits: snapshot.limits }
}

/**
 * Write one snapshot patch and answer the new revision.
 * @param config - the board document, the `bd` wrapper, and the deployment bounds.
 * @param id - element id.
 * @param data - snapshot fields to merge; `null` clears one.
 * @returns the element id and the new revision.
 */
async function writeSnapshot(config: TodoRouteConfig, id: ElementId, data: BoardElementData): Promise<TodoAnswer> {
  const { revision } = await config.doc.apply([{ op: 'patch', id, data }], 'host')
  return { ok: true, elementId: id, revision }
}

/**
 * Build the kind data of one list snapshot.
 * @param epicId - epic issue id.
 * @param epicTitle - epic title.
 * @param items - re-read items.
 * @param syncedAt - time of the re-read.
 * @param pendingPlacement - whether a visible tab still has to place the list.
 * @returns the element data.
 */
function snapshotData(
  epicId: BeadsIssueId,
  epicTitle: string,
  items: readonly BeadsIssue[],
  syncedAt: string,
  pendingPlacement: boolean,
): BoardElementData {
  return {
    epicId,
    title: epicTitle,
    items: itemData(items),
    syncedAt,
    ...pendingPlacement ? { pendingPlacement: true } : {},
  }
}

/**
 * Reduce re-read issues to the three fields one stored item carries.
 * @param items - re-read issues.
 * @returns the stored item values.
 */
function itemData(items: readonly BeadsIssue[]): Array<{ id: BeadsIssueId; title: string; status: BeadsIssue['status'] }> {
  return items.map(item => ({ id: item.id, title: item.title, status: item.status }))
}

/**
 * Map one thrown error to its route answer; `bd` output stays in the host log.
 * @param error - the thrown value.
 * @param config - the route configuration with the log sink.
 * @returns the refusal response.
 */
function todoFailure(error: unknown, config: TodoRouteConfig): Response {
  if (error instanceof TodoRouteError) return fail(error.code)
  if (error instanceof BeadsUnavailableError) return fail('ketos/beads-unavailable')
  if (error instanceof BeadsCommandError || error instanceof BeadsProtocolError) {
    config.logger(`to-do list: ${error instanceof BeadsCommandError ? beadsCommandErrorText(error) : error.message}`)
    return fail('ketos/beads-failed')
  }
  config.logger(`to-do list: unexpected failure: ${String(error)}`)
  return new Response(null, { status: 500, headers: NO_STORE })
}

/** Serializes the `place` operations so two tabs cannot both place one list. */
class OperationQueue {
  private tail: Promise<unknown> = Promise.resolve()

  /**
   * Append one task after every earlier task settled.
   * @param task - operation to run.
   * @returns the task's own result.
   */
  run<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task)
    this.tail = run.then(() => undefined, () => undefined)
    return run
  }
}
