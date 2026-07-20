import type { NodeTypes } from "@xyflow/react";

export const BOARD_AUTOMATION_NODE_TYPE = "automation" as const;

type BoardNodeRenderers = {
  boardNote: NodeTypes[string];
  chat: NodeTypes[string];
  automation: NodeTypes[string];
};

export function createBoardNodeTypes(renderers: BoardNodeRenderers): NodeTypes {
  return {
    boardNote: renderers.boardNote,
    chat: renderers.chat,
    [BOARD_AUTOMATION_NODE_TYPE]: renderers.automation,
  };
}
