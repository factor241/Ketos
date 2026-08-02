import type { useQueryFunctionType } from "@/types/api";
import type { BoardRead } from "@/types/board";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";
import { boardKeys } from "./keys";

export const useGetBoards: useQueryFunctionType<
  { projectId: string },
  BoardRead[]
> = ({ projectId }, options) => {
  const { query } = UseRequestProcessor();
  return query(
    boardKeys.list(projectId),
    async () =>
      (await api.get<BoardRead[]>(`${getURL("PROJECTS")}/${projectId}/boards`))
        .data,
    { ...options, enabled: Boolean(projectId) && (options?.enabled ?? true) },
  );
};
