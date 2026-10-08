/**
 * Element layer of the board: every readable element of the host document,
 * drawn in world coordinates inside the canvas transform below the windows.
 *
 * The layer owns the paint order (kind rank, then z, then id), the culling
 * against the visible world rectangle, and the body dispatch: a kind with a
 * registered `board.element.body` occupant renders it, every other kind falls
 * back to the neutral body. Clicks on empty layer space reach the canvas
 * because the container ignores pointer events and only element boxes accept
 * them.
 */
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardElement } from '@ketos/board-doc/types'
import { BOARD_ELEMENT_LAYER_RANK } from '@ketos/board-doc/kinds'
import type { BoardRect } from '../chrome-insets.ts'
import { visibleWorldRect, type BoardViewport } from '../board-coordinates.ts'
import { CULL_MARGIN } from '../culling.ts'
import { boardParticipants, participantColorAttr, participantLabel } from '../owners.ts'
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
  const selfId = useStore(s => s.selfId)
  const participants = useStore(s => boardParticipants(s))
  const eraserPreview = useStore(s => s.eraserPreview)
  const panX = useStore(s => s.panX)
  const panY = useStore(s => s.panY)
  const zoom = useStore(s => s.zoom)
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
    .filter(element => isVisible(visible, element))

  return (
    <div data-board-layer="elements" className={css.layer}>
      {ordered.map((element) => {
        const selected = element.id === selectedId
        const editable = selfId !== null && element.ownerId === selfId
        const participant = roster.get(element.ownerId)
        const label = editable
          ? t('element.aria', { kind: element.kind })
          : t('element.foreign', { name: participantLabel(t, participant) })
        return (
          <ElementFrame
            key={element.id}
            element={element}
            selected={selected}
            editable={editable}
            ownerColor={participantColorAttr(participant)}
            zoom={zoom}
            label={label}
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
  )
}
