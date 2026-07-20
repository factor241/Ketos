import type { Node } from "@xyflow/react";

import type { BoardNote, BoardNoteNodeData, Placement } from "@/types/board";
import type { ChatThread } from "@/types/chat";
import type { AutomationSummary } from "@/types/flow/automation";

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
export type AutomationSceneNodeData = {
  placementId: string;
  targetId: string;
  targetKind: "automation";
  summary: AutomationSummary | null;
  placement: Placement;
} & Record<string, unknown>;
export type BoardNoteSceneNode = Node<BoardNoteSceneNodeData, "boardNote">;
export type ChatSceneNode = Node<ChatSceneNodeData, "chat">;
export type AutomationSceneNode = Node<AutomationSceneNodeData, "automation">;
export type BoardSceneNode =
  | BoardNoteSceneNode
  | ChatSceneNode
  | AutomationSceneNode;

export function placementToNode(
  placement: Placement,
  notesById: ReadonlyMap<string, BoardNote>,
  chatsById: ReadonlyMap<string, ChatThread>,
  automationsById: ReadonlyMap<string, AutomationSummary>,
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

  if (placement.targetKind === "automation") {
    const summary = automationsById.get(placement.targetId) ?? null;
    return {
      id: placement.id,
      type: "automation",
      position: { x: placement.x, y: placement.y },
      style: { width: placement.width, height: placement.height },
      zIndex: placement.zIndex,
      draggable: placement.displayState === "normal",
      dragHandle: ".board-card-drag-handle",
      data: {
        placementId: placement.id,
        targetId: placement.targetId,
        targetKind: "automation",
        summary,
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
  automations: readonly AutomationSummary[],
): BoardSceneNode[] {
  const notesById = new Map(notes.map((note) => [note.id, note]));
  const chatsById = new Map(chats.map((chat) => [chat.id, chat]));
  const automationsById = new Map(
    automations.map((automation) => [automation.id, automation]),
  );
  return placements.flatMap((placement) => {
    const node = placementToNode(
      placement,
      notesById,
      chatsById,
      automationsById,
    );
    return node ? [node] : [];
  });
}
