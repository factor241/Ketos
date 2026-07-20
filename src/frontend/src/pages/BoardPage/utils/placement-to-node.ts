import type { Node } from "@xyflow/react";

import type { BoardNote, BoardNoteNodeData, Placement } from "@/types/board";
import type { ChatThread } from "@/types/chat";

export type BoardNoteSceneNodeData = BoardNoteNodeData & {
  placement: Placement;
} & Record<string, unknown>;
export type ChatSceneNodeData = {
  placementId: string;
  targetId: string;
  targetKind: "chat";
  chat: ChatThread;
  placement: Placement;
} & Record<string, unknown>;
export type BoardNoteSceneNode = Node<BoardNoteSceneNodeData, "boardNote">;
export type ChatSceneNode = Node<ChatSceneNodeData, "chat">;
export type BoardSceneNode = BoardNoteSceneNode | ChatSceneNode;

export function placementToNode(
  placement: Placement,
  notesById: ReadonlyMap<string, BoardNote>,
  chatsById: ReadonlyMap<string, ChatThread>,
): BoardSceneNode | null {
  if (placement.targetKind === "note") {
    const note = notesById.get(placement.targetId);
    if (!note) return null;

    return {
      id: placement.id,
      type: "boardNote",
      position: { x: placement.x, y: placement.y },
      style: { width: placement.width, height: placement.height },
      zIndex: placement.zIndex,
      draggable: placement.displayState === "normal",
      dragHandle: ".board-card-drag-handle",
      data: {
        placementId: placement.id,
        targetId: placement.targetId,
        targetKind: "note",
        note,
        placement,
      },
    };
  }

  if (placement.targetKind === "chat") {
    const chat = chatsById.get(placement.targetId);
    if (!chat) return null;
    return {
      id: placement.id,
      type: "chat",
      position: { x: placement.x, y: placement.y },
      style: { width: placement.width, height: placement.height },
      zIndex: placement.zIndex,
      draggable: placement.displayState === "normal",
      dragHandle: ".board-card-drag-handle",
      data: {
        placementId: placement.id,
        targetId: placement.targetId,
        targetKind: "chat",
        chat,
        placement,
      },
    };
  }

  return null;
}

export function placementsToNodes(
  placements: readonly Placement[],
  notes: readonly BoardNote[],
  chats: readonly ChatThread[],
): BoardSceneNode[] {
  const notesById = new Map(notes.map((note) => [note.id, note]));
  const chatsById = new Map(chats.map((chat) => [chat.id, chat]));
  return placements.flatMap((placement) => {
    const node = placementToNode(placement, notesById, chatsById);
    return node ? [node] : [];
  });
}
