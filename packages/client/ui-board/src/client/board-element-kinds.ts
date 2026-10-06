/**
 * Browser descriptors of the board element kinds: the size a kind opens with,
 * its resize floor, and whether the common frame may move or resize it. The
 * values are board protocol constants; the element stages (notes, strokes,
 * todo lists) refine their own entry without touching the frame.
 */
import type { BoardElementKind } from '@ketos/board-doc/types'

/** One kind's frame behavior. */
export interface BoardElementKindDescriptor {
  /** Size a new element of this kind opens with, in world units. */
  readonly defaultSize: { readonly width: number; readonly height: number }
  /** Smallest size the frame may resize the kind to, in world units. */
  readonly minSize: { readonly width: number; readonly height: number }
  /** Whether the frame offers the resize corner for this kind. */
  readonly resizable: boolean
  /** Whether the frame moves the kind by dragging its body. */
  readonly movable: boolean
}

/** Every kind's frame descriptor. */
export const BOARD_ELEMENT_KIND_DESCRIPTORS: Readonly<Record<BoardElementKind, BoardElementKindDescriptor>> = {
  note: {
    defaultSize: { width: 240, height: 160 },
    minSize: { width: 120, height: 80 },
    resizable: true,
    movable: true,
  },
  stroke: {
    // A drawing's box follows its points; the frame never resizes it.
    defaultSize: { width: 240, height: 160 },
    minSize: { width: 240, height: 160 },
    resizable: false,
    movable: true,
  },
  todo: {
    defaultSize: { width: 280, height: 240 },
    minSize: { width: 200, height: 160 },
    resizable: true,
    movable: true,
  },
}
