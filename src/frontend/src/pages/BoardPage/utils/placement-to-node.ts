import type { Node } from "@xyflow/react";

import type { BoardExecution } from "@/controllers/API/queries/executions";
import type { BoardNote, BoardNoteNodeData, Placement } from "@/types/board";
import type { ChatThread } from "@/types/chat";
import type { AutomationSummary } from "@/types/flow/automation";

const TERMINAL_EXECUTION_STATUSES = new Set([
  "succeeded",
  "failed",
  "cancelled",
]);

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
export type ResultSceneNodeData = {
  placementId: string;
  targetId: string;
  targetKind: "job_result";
  execution: BoardExecution;
  placement: Placement;
} & Record<string, unknown>;
export type ResultSceneNode = Node<ResultSceneNodeData, "jobResult">;
export type BoardSceneNode =
  | BoardNoteSceneNode
  | ChatSceneNode
  | AutomationSceneNode
  | ResultSceneNode;

export function placementToNode(
  placement: Placement,
  notesById: ReadonlyMap<string, BoardNote>,
  chatsById: ReadonlyMap<string, ChatThread>,
  automationsById: ReadonlyMap<string, AutomationSummary>,
  executionsById: ReadonlyMap<string, BoardExecution> = new Map(),
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

  if (placement.targetKind === "job_result") {
    const execution = executionsById.get(placement.targetId);
    if (
      !execution ||
      execution.board_id !== placement.boardId ||
      !TERMINAL_EXECUTION_STATUSES.has(execution.status)
    )
      return null;
    return {
      id: placement.id,
      type: "jobResult",
      position: { x: placement.x, y: placement.y },
      style: { width: placement.width, height: placement.height },
      zIndex: placement.zIndex,
      draggable: placement.displayState === "normal",
      dragHandle: ".board-card-drag-handle",
      data: {
        placementId: placement.id,
        targetId: placement.targetId,
        targetKind: "job_result",
        execution,
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
  executions: readonly BoardExecution[] = [],
): BoardSceneNode[] {
  const notesById = new Map(notes.map((note) => [note.id, note]));
  const chatsById = new Map(chats.map((chat) => [chat.id, chat]));
  const automationsById = new Map(
    automations.map((automation) => [automation.id, automation]),
  );
  const executionsById = new Map(
    executions.map((execution) => [execution.job_id, execution]),
  );
  return placements.flatMap((placement) => {
    const node = placementToNode(
      placement,
      notesById,
      chatsById,
      automationsById,
      executionsById,
    );
    return node ? [node] : [];
  });
}
