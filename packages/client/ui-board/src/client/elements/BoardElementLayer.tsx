/**
 * Element layer of the board: every readable element of the host document,
 * drawn in world coordinates inside the canvas transform below the windows.
 *
 * The layer owns the paint order (kind rank, then z, then id), the culling
 * against the visible world rectangle, and the body dispatch: a kind with a
 * registered `board.element.body` occupant renders it, every other kind falls
 * back to the neutral body. Clicks on empty layer space reach the canvas
 * because the container ignores pointer events and only element boxes accept
 * them. The element being edited in place is exempt from culling, and the
 * layer publishes the editing id of its last commit to the bodies through
 * {@link CommittedEditingContext}.
 */
import { createContext, useLayoutEffect, useRef, type RefObject } from 'react'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardElement, ElementId } from '@ketos/board-doc/types'
import { BOARD_ELEMENT_LAYER_RANK } from '@ketos/board-doc/kinds'
import type { BoardRect } from '../chrome-insets.ts'
import { visibleWorldRect, type BoardViewport } from '../board-coordinates.ts'
import { CULL_MARGIN } from '../culling.ts'
import { boardParticipants, ownerLinkLost, participantColorAttr, participantLabel } from '../owners.ts'
import type { BoardElementInjected } from '../contract/slots.ts'
import type { BoardStoreHandle } from '../store.ts'
import { ElementFrame } from './ElementFrame.tsx'
import { NeutralElementBody } from './NeutralElementBody.tsx'
import css from './BoardElementLayer.module.css'

export type BoardElementLayerProps =
  PropsRenderSlots<'board.element.body'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>
  & InjectFace<BoardElementInjected>

/**
 * Element id that is the in-place editing target as of the layer's latest
 * commit, or `null` outside a layer. The layer updates it in a layout effect,
 * so a body's unmount cleanup that runs in the same commit (the previously
 * edited element culled as another one opens) reads the new target instead of
 * the value of the body's last render.
 */
export const CommittedEditingContext = createContext<RefObject<ElementId | null> | null>(null)

/**
 * Paint order of two elements: kind rank first (strokes under everything),
 * then paint priority, then id so the order is total and stable.
 * @param left - one element.
 * @param right - the other element.
 * @returns the comparison result.
 */
function compareElements(left: BoardElement, right: BoardElement): number {
  const rank = BOARD_ELEMENT_LAYER_RANK[left.kind] - BOARD_ELEMENT_LAYER_RANK[right.kind]
  if (rank !== 0) return rank
  if (left.z !== right.z) return left.z - right.z
  if (left.id === right.id) return 0
  return left.id < right.id ? -1 : 1
}

/**
 * Whether any part of one element lies inside the visible world rectangle.
 * @param visible - visible world rectangle with its culling margin.
 * @param element - element to test.
 * @returns true when the element should render.
 */
function isVisible(visible: BoardRect, element: BoardElement): boolean {
  return element.x + element.w >= visible.left
    && element.x <= visible.right
    && element.y + element.h >= visible.top
    && element.y <= visible.bottom
}

export function BoardElementLayer({ renderSlot, useStore, actions, t, moveElement, resizeElement }: BoardElementLayerProps) {
  const elements = useStore(s => s.boardElements)
  const selectedId = useStore(s => s.selectedBoardElementId)
  const editingId = useStore(s => s.editingBoardElementId)
  const selfId = useStore(s => s.selfId)
  const participants = useStore(s => boardParticipants(s))
  const eraserPreview = useStore(s => s.eraserPreview)
  const peerStates = useStore(s => s.peerStates)
  const panX = useStore(s => s.panX)
  const panY = useStore(s => s.panY)
  const zoom = useStore(s => s.zoom)
  const committedEditing = useRef<ElementId | null>(editingId)
  useLayoutEffect(() => { committedEditing.current = editingId }, [editingId])
  const viewportWidth = useStore(s => s.viewportWidth)
  const viewportHeight = useStore(s => s.viewportHeight)

  const viewport: BoardViewport = { panX, panY, zoom, viewportWidth, viewportHeight }
  const visible = visibleWorldRect(viewport, CULL_MARGIN)
  const roster = new Map(participants.map(participant => [participant.id, participant]))
  const ordered = Object.values(elements)
    // A stroke the live eraser pass touched hides while its preview parts draw
    // in its place; the committed batch replaces both.
    .filter(element => eraserPreview?.hidden.includes(element.id) !== true)
    .sort(compareElements)
    // The element being edited stays mounted outside the view: unmounting its
    // editor would drop the draft.
    .filter(element => element.id === editingId || isVisible(visible, element))

  return (
    <CommittedEditingContext.Provider value={committedEditing}>
      <div data-board-layer="elements" className={css.layer}>
        {ordered.map((element) => {
          const selected = element.id === selectedId
          const editable = selfId !== null && element.ownerId === selfId
          const participant = roster.get(element.ownerId)
          const label = editable
            ? t('element.aria', { kind: element.kind })
            : t('element.foreign', { name: participantLabel(t, participant) })
          const stale = !editable && ownerLinkLost({ peerStates }, element.ownerId)
          return (
            <ElementFrame
              key={element.id}
              element={element}
              selected={selected}
              editable={editable}
              ownerColor={participantColorAttr(participant)}
              zoom={zoom}
              label={label}
              staleLabel={stale ? t('peer.stale') : undefined}
              staleHint={stale ? t('peer.stale.hint') : undefined}
              resizeLabel={t('element.resize.aria')}
              onSelect={(id) => {
                actions.selectBoardElement(id)
                actions.clearActiveWindow()
              }}
              onEdit={element.kind === 'note' ? (id) => { actions.setEditingBoardElement(id) } : undefined}
              onMove={moveElement}
              onResize={resizeElement}
            >
              {renderSlot('board.element.body', { element, selected, editable }, {
                entryKey: element.kind,
                fallback: <NeutralElementBody element={element} t={t} />,
              })}
            </ElementFrame>
          )
        })}
      </div>
    </CommittedEditingContext.Provider>
  )
}
