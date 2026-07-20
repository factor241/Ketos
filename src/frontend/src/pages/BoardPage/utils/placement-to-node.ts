import type { Node } from "@xyflow/react";

import type { BoardNote, BoardNoteNodeData, Placement } from "@/types/board";

export type BoardSceneNodeData = BoardNoteNodeData & {
  placement: Placement;
} & Record<string, unknown>;
export type BoardSceneNode = Node<BoardSceneNodeData, "board-note">;

export function placementToNode(
  placement: Placement,
  notesById: ReadonlyMap<string, BoardNote>,
): BoardSceneNode | null {
  if (placement.targetKind !== "note") return null;
  const note = notesById.get(placement.targetId);
  if (!note) return null;

  return {
    id: placement.id,
    type: "board-note",
    position: { x: placement.x, y: placement.y },
    style: { width: placement.width, height: placement.height },
    zIndex: placement.zIndex,
    draggable: placement.displayState === "normal",
    data: {
      placementId: placement.id,
      targetId: placement.targetId,
      targetKind: "note",
      note,
      placement,
    },
  };
}

export function placementsToNodes(
  placements: readonly Placement[],
  notes: readonly BoardNote[],
): BoardSceneNode[] {
  const notesById = new Map(notes.map((note) => [note.id, note]));
  return placements.flatMap((placement) => {
    const node = placementToNode(placement, notesById);
    return node ? [node] : [];
  });
}
