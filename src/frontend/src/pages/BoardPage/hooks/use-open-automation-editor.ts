import { useCallback } from "react";

import { useCustomNavigate } from "@/customization/hooks/use-custom-navigate";
import { buildAutomationEditorUrl } from "@/utils/automation-editor-route";

type UseOpenAutomationEditorArgs = Readonly<{
  flowId: string;
  boardId: string;
  placementId: string;
}>;

export function useOpenAutomationEditor({
  flowId,
  boardId,
  placementId,
}: UseOpenAutomationEditorArgs) {
  const navigate = useCustomNavigate();
  const href = buildAutomationEditorUrl(flowId, { boardId, placementId });
  const openAutomationEditor = useCallback(
    () => navigate(href),
    [href, navigate],
  );
  return { href, openAutomationEditor } as const;
}
