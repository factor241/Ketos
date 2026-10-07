/**
 * The exact operation wire of the board: parsing one batch body, resolving the
 * defaults the host owns, checking the complete merged result, and applying
 * every mutation inside one document transaction.
 *
 * The whole batch is resolved against a simulated state before anything
 * mutates, so an error in the last operation leaves the document untouched;
 * a browser batch may only create elements under `selfId` and patch or remove
 * elements it owns, while a host batch bypasses that check.
 * @module @ketos/board-doc/ops
 */

import { assertNever } from '@deepseek-ai/dsh-util-values'
import { isElementData, isElementId, validateElementData } from './data.ts'
import type { BoardDocument } from './doc.ts'
import { BOARD_ELEMENT_COORDINATE_LIMIT, isBoardElementKind } from './kinds.ts'
import type {
  BoardCreateOp, BoardElement, BoardElementData, BoardLimits, BoardOp, BoardOrigin,
  BoardPatchOp, BoardRemoveOp, ElementId, OwnerId,
} from './types.ts'
import {
  BoardError, finiteNumber, rejectUnknownFields, record, optionalFiniteNumber,
} from './wire.ts'

/** Deployment limits the operation parser and resolver enforce. */
export interface BoardOpLimits {
  /** Largest number of operations one request may batch. */
  readonly maxOpsPerRequest: number
  /** Largest number of elements the document may hold. */
  readonly maxElements: number
  /** Element limits published in the snapshot. */
  readonly elements: BoardLimits
}

/** Result of one applied batch: which elements changed and which left. */
export interface BoardOpResult {
  /** Elements created or changed by the batch, in element order. */
  readonly upserts: readonly BoardElement[]
  /** Elements the batch removed. */
  readonly removes: readonly ElementId[]
}

/** State a create resolves against while the batch is simulated. */
export interface BoardCreateState {
  /** Element keys already occupied by the simulated batch. */
  readonly ids: ReadonlySet<string>
  /** Highest stored `z` before the batch. */
  readonly maxZ: number
}

/** Fields of one batch body. */
const BATCH_FIELDS = ['ops'] as const
/** Fields a create operation accepts. */
const CREATE_FIELDS = ['op', 'id', 'kind', 'x', 'y', 'w', 'h', 'data'] as const
/** Fields a patch operation accepts. */
const PATCH_FIELDS = ['op', 'id', 'x', 'y', 'w', 'h', 'z', 'data'] as const
/** Fields a remove operation accepts. */
const REMOVE_FIELDS = ['op', 'id'] as const

/**
 * Parse one operation-request body. Unknown fields, missing fields, and values
 * outside their bounds are refused with `ketos/invalid`; the batch size bound
 * answers the same code.
 * @param body - decoded request body.
 * @param limits - deployment limits.
 * @returns the parsed batch.
 */
export function parseBoardOps(body: unknown, limits: BoardOpLimits): BoardOp[] {
  const source = record(body, 'body must be a JSON object')
  rejectUnknownFields(source, BATCH_FIELDS)
  const ops = source.ops
  if (!Array.isArray(ops)) throw new BoardError('ketos/invalid', 'ops must be an array')
  if (ops.length > limits.maxOpsPerRequest) {
    throw new BoardError('ketos/invalid', `ops exceeds ${String(limits.maxOpsPerRequest)} entries`)
  }
  return ops.map(entry => parseOp(entry))
}

/**
 * Resolve one create against the state the batch has reached so far: the host
 * stamps the owner, the paint priority above every stored element, and both
 * timestamps; the browser never sends them.
 * @param op - parsed create operation.
 * @param state - occupied ids and the current `z` ceiling.
 * @param selfId - identity of this Ketos.
 * @param now - batch timestamp in milliseconds since the Unix epoch.
 * @returns the complete element to store.
 */
export function resolveCreate(
  op: BoardCreateOp,
  state: BoardCreateState,
  selfId: OwnerId,
  now: number,
): BoardElement {
  if (state.ids.has(op.id)) {
    throw new BoardError('ketos/element-exists', `element ${op.id} already exists`)
  }
  return {
    id: op.id,
    kind: op.kind,
    ownerId: selfId,
    x: op.x,
    y: op.y,
    w: op.w,
    h: op.h,
    z: state.maxZ + 1,
    data: op.data ?? {},
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Apply one parsed batch. Every operation is resolved and validated first, so
 * a refusal never leaves a partial batch behind; the mutations then run as one
 * document transaction with the batch's origin.
 * @param doc - live board document.
 * @param ops - parsed batch.
 * @param origin - who sent the batch.
 * @param selfId - identity of this Ketos.
 * @param limits - deployment limits.
 * @param now - batch timestamp in milliseconds since the Unix epoch.
 * @returns the elements the batch changed and removed.
 */
export function applyBoardOps(
  doc: BoardDocument,
  ops: readonly BoardOp[],
  origin: BoardOrigin,
  selfId: OwnerId,
  limits: BoardOpLimits,
  now: number,
): BoardOpResult {
  const state: { ids: Set<string>; maxZ: number } = { ids: new Set(doc.ids()), maxZ: doc.maxZ() }
  let count = doc.count()
  const overlay = new Map<string, BoardElement | null>()
  const mutations: Array<() => void> = []

  const current = (id: ElementId): BoardElement | undefined => {
    if (overlay.has(id)) return overlay.get(id) ?? undefined
    return doc.readElement(id)
  }

  for (const op of ops) {
    switch (op.op) {
      case 'create': {
        if (count >= limits.maxElements) {
          throw new BoardError('ketos/limit', `the document already holds ${String(limits.maxElements)} elements`)
        }
        const element = resolveCreate(op, state, selfId, now)
        assertValidElement(element, limits.elements)
        mutations.push(() => { doc.create(element) })
        overlay.set(op.id, element)
        state.ids.add(op.id)
        state.maxZ = Math.max(state.maxZ, element.z)
        count += 1
        break
      }
      case 'patch': {
        const existing = current(op.id)
        if (existing === undefined) {
          throw new BoardError('ketos/element-not-found', `element ${op.id} does not exist`)
        }
        assertOwned(existing, origin, selfId)
        const merged = mergePatch(existing, op, now)
        assertValidElement(merged, limits.elements)
        mutations.push(() => { doc.patch(op.id, merged) })
        overlay.set(op.id, merged)
        break
      }
      case 'remove': {
        const existing = current(op.id)
        if (existing === undefined) {
          throw new BoardError('ketos/element-not-found', `element ${op.id} does not exist`)
        }
        assertOwned(existing, origin, selfId)
        mutations.push(() => { doc.remove(op.id) })
        overlay.set(op.id, null)
        state.ids.delete(op.id)
        count -= 1
        break
      }
      default:
        return assertNever(op)
    }
  }

  doc.transact(origin, () => {
    for (const mutate of mutations) mutate()
  })

  const upserts: BoardElement[] = []
  const removes: ElementId[] = []
  for (const [id, element] of overlay) {
    if (element === null) removes.push(id as ElementId)
    else upserts.push(element)
  }
  return { upserts, removes }
}

/**
 * Parse one operation entry.
 * @param value - decoded operation.
 * @returns the parsed operation.
 */
function parseOp(value: unknown): BoardOp {
  const op = record(value, 'every operation must be a JSON object')
  switch (op.op) {
    case 'create':
      return parseCreate(op)
    case 'patch':
      return parsePatch(op)
    case 'remove':
      return parseRemove(op)
    default:
      throw new BoardError('ketos/invalid', `unknown operation ${JSON.stringify(op.op)}`)
  }
}

/**
 * Parse one create operation.
 * @param op - decoded operation object.
 * @returns the parsed create.
 */
function parseCreate(op: Record<string, unknown>): BoardCreateOp {
  rejectUnknownFields(op, CREATE_FIELDS)
  const id = parseElementId(op.id)
  const kind = parseKind(op.kind)
  const x = finiteNumber(op, 'x', -BOARD_ELEMENT_COORDINATE_LIMIT, BOARD_ELEMENT_COORDINATE_LIMIT)
  const y = finiteNumber(op, 'y', -BOARD_ELEMENT_COORDINATE_LIMIT, BOARD_ELEMENT_COORDINATE_LIMIT)
  const w = finiteNumber(op, 'w', Number.MIN_VALUE, BOARD_ELEMENT_COORDINATE_LIMIT)
  const h = finiteNumber(op, 'h', Number.MIN_VALUE, BOARD_ELEMENT_COORDINATE_LIMIT)
  const data = parseData(op.data)
  return { op: 'create', id, kind, x, y, w, h, ...(data === undefined ? {} : { data }) }
}

/**
 * Parse one patch operation; every field is optional and absent fields keep
 * their stored value.
 * @param op - decoded operation object.
 * @returns the parsed patch.
 */
function parsePatch(op: Record<string, unknown>): BoardPatchOp {
  rejectUnknownFields(op, PATCH_FIELDS)
  const id = parseElementId(op.id)
  const x = optionalFiniteNumber(op, 'x', -BOARD_ELEMENT_COORDINATE_LIMIT, BOARD_ELEMENT_COORDINATE_LIMIT)
  const y = optionalFiniteNumber(op, 'y', -BOARD_ELEMENT_COORDINATE_LIMIT, BOARD_ELEMENT_COORDINATE_LIMIT)
  const w = optionalFiniteNumber(op, 'w', Number.MIN_VALUE, BOARD_ELEMENT_COORDINATE_LIMIT)
  const h = optionalFiniteNumber(op, 'h', Number.MIN_VALUE, BOARD_ELEMENT_COORDINATE_LIMIT)
  const z = optionalFiniteNumber(op, 'z', 0, BOARD_ELEMENT_COORDINATE_LIMIT)
  const data = parseData(op.data)
  return {
    op: 'patch',
    id,
    ...(x === undefined ? {} : { x }),
    ...(y === undefined ? {} : { y }),
    ...(w === undefined ? {} : { w }),
    ...(h === undefined ? {} : { h }),
    ...(z === undefined ? {} : { z }),
    ...(data === undefined ? {} : { data }),
  }
}

/**
 * Parse one remove operation.
 * @param op - decoded operation object.
 * @returns the parsed remove.
 */
function parseRemove(op: Record<string, unknown>): BoardRemoveOp {
  rejectUnknownFields(op, REMOVE_FIELDS)
  return { op: 'remove', id: parseElementId(op.id) }
}

/**
 * Parse one element id field.
 * @param value - decoded value.
 * @returns the branded id.
 */
function parseElementId(value: unknown): ElementId {
  if (!isElementId(value)) throw new BoardError('ketos/invalid', 'id must be a UUID')
  return value
}

/**
 * Parse one kind field.
 * @param value - decoded value.
 * @returns the known kind.
 */
function parseKind(value: unknown): BoardCreateOp['kind'] {
  if (!isBoardElementKind(value)) {
    throw new BoardError('ketos/invalid', 'kind must be one of note, stroke, todo')
  }
  return value
}

/**
 * Parse one optional data field.
 * @param value - decoded value.
 * @returns the data object, or undefined when absent.
 */
function parseData(value: unknown): BoardElementData | undefined {
  if (value === undefined) return undefined
  if (!isElementData(value)) throw new BoardError('ketos/invalid', 'data must be a JSON object')
  return value
}

/**
 * Merge one patch into the stored element: geometry, `z`, and `data` merge by
 * key, `kind` and the owner stay, and the host stamps the change time. A
 * `null` value in `data` removes that key, which is how a host clears an
 * optional flag without rewriting the whole payload.
 * @param existing - stored element.
 * @param op - parsed patch.
 * @param now - batch timestamp.
 * @returns the complete element after the merge.
 */
function mergePatch(existing: BoardElement, op: BoardPatchOp, now: number): BoardElement {
  return {
    ...existing,
    x: op.x ?? existing.x,
    y: op.y ?? existing.y,
    w: op.w ?? existing.w,
    h: op.h ?? existing.h,
    z: op.z ?? existing.z,
    data: op.data === undefined ? existing.data : mergeData(existing.data, op.data),
    updatedAt: now,
  }
}

/**
 * Merge one patch's data into the stored data, treating a `null` value as a
 * removal of that key.
 * @param existing - stored data.
 * @param patch - patch data.
 * @returns the complete data after the merge.
 */
function mergeData(existing: BoardElementData, patch: BoardElementData): BoardElementData {
  const merged: Record<string, BoardElementData[string]> = { ...existing }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) Reflect.deleteProperty(merged, key)
    else merged[key] = value
  }
  return merged
}

/**
 * Refuse a batch that would touch another participant's element.
 * @param element - stored element.
 * @param origin - who sent the batch.
 * @param selfId - identity of this Ketos.
 */
function assertOwned(element: BoardElement, origin: BoardOrigin, selfId: OwnerId): void {
  if (origin === 'browser' && element.ownerId !== selfId) {
    throw new BoardError('ketos/element-foreign', `element ${element.id} belongs to another participant`)
  }
}

/**
 * Validate one complete element: the kind's data rules and the serialized size
 * of the whole envelope.
 * @param element - element after resolution.
 * @param limits - element limits.
 */
function assertValidElement(element: BoardElement, limits: BoardLimits): void {
  const reason = validateElementData(element.kind, element.data, limits, { w: element.w, h: element.h })
  if (reason !== null) throw new BoardError('ketos/invalid', reason)
  const bytes = new TextEncoder().encode(JSON.stringify(element)).length
  if (bytes > limits.elementBytesMax) {
    throw new BoardError('ketos/limit', `element ${element.id} exceeds ${String(limits.elementBytesMax)} bytes`)
  }
}
