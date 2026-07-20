import { useMemo } from "react";
import { useLocation } from "react-router-dom";

import { api } from "@/controllers/API/api";
import { UseRequestProcessor } from "@/controllers/API/services/request-processor";
import { parseAutomationEditorReturnRef } from "@/utils/automation-editor-route";
import { isUUID } from "@/utils/utils";

export type AutomationEditorContextRead = Readonly<{
  project_id: string;
  board_id: string;
  placement_id: string;
  flow_id: string;
}>;

const CONTEXT_KEYS = [
  "board_id",
  "flow_id",
  "placement_id",
  "project_id",
] as const;

function parseContext(value: unknown): AutomationEditorContextRead {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("invalid automation editor context");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== CONTEXT_KEYS.length ||
    keys.some((key, index) => key !== CONTEXT_KEYS[index])
  )
    throw new TypeError("invalid automation editor context shape");
  for (const key of CONTEXT_KEYS) {
    if (typeof record[key] !== "string" || !isUUID(record[key]))
      throw new TypeError("invalid automation editor context identifier");
  }
  return record as AutomationEditorContextRead;
}

export function useBoardReturnContext({ flowId }: { flowId: string }) {
  const { search } = useLocation();
  const ref = useMemo(() => parseAutomationEditorReturnRef(search), [search]);
  const enabled = ref !== null && isUUID(flowId);
  const { query } = UseRequestProcessor();
  const result = query(
    [
      "automation-editor-context",
      ref?.boardId ?? "",
      ref?.placementId ?? "",
      flowId,
    ],
    async () => {
      if (!ref || !isUUID(flowId))
        throw new TypeError("invalid automation editor context request");
      const response = await api.get<unknown>(
        `/api/v1/boards/${ref.boardId}/placements/${ref.placementId}/automation-editor-context?flow_id=${flowId}`,
      );
      const context = parseContext(response.data);
      if (
        context.board_id !== ref.boardId ||
        context.placement_id !== ref.placementId ||
        context.flow_id !== flowId
      )
        throw new TypeError("mismatched automation editor context");
      return context;
    },
    { enabled, retry: false },
  );
  const context = result.data as AutomationEditorContextRead | undefined;
  const contextMatches =
    enabled &&
    context !== undefined &&
    ref !== null &&
    context.board_id === ref.boardId &&
    context.placement_id === ref.placementId &&
    context.flow_id === flowId &&
    isUUID(context.project_id);
  return {
    returnUrl: contextMatches
      ? `/project/${context.project_id}/board/${context.board_id}?focusPlacementId=${context.placement_id}`
      : null,
    isLoading: result.isLoading,
    isError: result.isError,
    refetch: result.refetch,
  };
}
