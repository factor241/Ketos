import { useMemo } from "react";

import { useGetProjectBoardNotes } from "@/controllers/API/queries/board-notes";
import { useGetProjectChats } from "@/controllers/API/queries/chat-threads";
import { useGetBoardPlacements } from "@/controllers/API/queries/placements";
import { placementsToNodes } from "../utils/placement-to-node";

export function useBoardScene({
  projectId,
  boardId,
  chatEnabled,
}: {
  projectId: string;
  boardId: string;
  chatEnabled: boolean;
}) {
  const placements = useGetBoardPlacements({ boardId });
  const notes = useGetProjectBoardNotes({ projectId });
  const chats = useGetProjectChats(
    { projectId },
    { enabled: chatEnabled && Boolean(projectId) },
  );
  const nodes = useMemo(
    () =>
      placementsToNodes(
        placements.data ?? [],
        notes.data ?? [],
        chatEnabled ? (chats.data ?? []) : [],
      ),
    [chatEnabled, chats.data, notes.data, placements.data],
  );

  return {
    nodes,
    notes: notes.data ?? [],
    chats: chatEnabled ? (chats.data ?? []) : [],
    placements: placements.data ?? [],
    edges: [],
    isLoading:
      placements.isLoading ||
      notes.isLoading ||
      (chatEnabled && chats.isLoading),
    isError:
      placements.isError || notes.isError || (chatEnabled && chats.isError),
    refetch: async () => {
      await Promise.all([
        placements.refetch(),
        notes.refetch(),
        ...(chatEnabled ? [chats.refetch()] : []),
      ]);
    },
  };
}
