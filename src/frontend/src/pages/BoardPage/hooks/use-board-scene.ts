import { useMemo } from "react";

import { useGetProjectBoardNotes } from "@/controllers/API/queries/board-notes";
import { useGetBoardPlacements } from "@/controllers/API/queries/placements";
import { placementsToNodes } from "../utils/placement-to-node";

export function useBoardScene({
  projectId,
  boardId,
}: {
  projectId: string;
  boardId: string;
}) {
  const placements = useGetBoardPlacements({ boardId });
  const notes = useGetProjectBoardNotes({ projectId });
  const nodes = useMemo(
    () => placementsToNodes(placements.data ?? [], notes.data ?? []),
    [notes.data, placements.data],
  );

  return {
    nodes,
    notes: notes.data ?? [],
    placements: placements.data ?? [],
    edges: [],
    isLoading: placements.isLoading || notes.isLoading,
    isError: placements.isError || notes.isError,
    refetch: async () => {
      await Promise.all([placements.refetch(), notes.refetch()]);
    },
  };
}
