import { useMemo } from "react";
import { useGetProjectBoardNotes } from "@/controllers/API/queries/board-notes";
import { useGetProjectChats } from "@/controllers/API/queries/chat-threads";
import type { BoardExecution } from "@/controllers/API/queries/executions";
import { useGetAutomationSummaries } from "@/controllers/API/queries/flows/use-get-automation-summaries";
import { useGetBoardPlacements } from "@/controllers/API/queries/placements";
import { placementsToNodes } from "../utils/placement-to-node";

export function useBoardScene({
  projectId,
  boardId,
  chatEnabled,
  executions = [],
}: {
  projectId: string;
  boardId: string;
  chatEnabled: boolean;
  executions?: readonly BoardExecution[];
}) {
  const placements = useGetBoardPlacements({ boardId });
  const notes = useGetProjectBoardNotes({ projectId });
  const chats = useGetProjectChats(
    { projectId },
    { enabled: chatEnabled && Boolean(projectId) },
  );
  const automations = useGetAutomationSummaries({ projectId });
  const nodes = useMemo(
    () =>
      placementsToNodes(
        placements.data ?? [],
        notes.data ?? [],
        chatEnabled ? (chats.data ?? []) : [],
        automations.data ?? [],
        executions,
      ),
    [
      automations.data,
      chatEnabled,
      chats.data,
      executions,
      notes.data,
      placements.data,
    ],
  );

  return {
    nodes,
    notes: notes.data ?? [],
    chats: chatEnabled ? (chats.data ?? []) : [],
    automations: automations.data ?? [],
    automationState: automations.isLoading
      ? ("loading" as const)
      : automations.isError
        ? ("error" as const)
        : ("ready" as const),
    placements: placements.data ?? [],
    edges: [],
    isLoading:
      placements.isLoading ||
      notes.isLoading ||
      automations.isLoading ||
      (chatEnabled && chats.isLoading),
    isError:
      placements.isError ||
      notes.isError ||
      automations.isError ||
      (chatEnabled && chats.isError),
    refetch: async () => {
      await Promise.all([
        placements.refetch(),
        notes.refetch(),
        automations.refetch(),
        ...(chatEnabled ? [chats.refetch()] : []),
      ]);
    },
  };
}
