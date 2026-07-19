import type { useQueryFunctionType } from "@/types/api";
import type { BoardNote } from "@/types/board";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";
import { boardNoteKeys } from "./keys";
import { type BoardNoteWire, mapBoardNote } from "./wire";

export const useGetProjectBoardNotes: useQueryFunctionType<
  { projectId: string },
  BoardNote[]
> = ({ projectId }, options) => {
  const { query } = UseRequestProcessor();
  return query(
    boardNoteKeys.project(projectId),
    async () =>
      (
        await api.get<BoardNoteWire[]>(
          `${getURL("PROJECTS")}/${projectId}/board-notes`,
        )
      ).data.map(mapBoardNote),
    {
      ...options,
      enabled: Boolean(projectId) && (options?.enabled ?? true),
    },
  );
};
