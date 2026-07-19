import type { useQueryFunctionType } from "@/types/api";
import type { BoardRead } from "@/types/board";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";
import { boardKeys } from "./keys";

export const useGetBoard: useQueryFunctionType<
  { projectId: string; boardId: string },
  BoardRead
> = ({ projectId, boardId }, options) => {
  const { query } = UseRequestProcessor();
  return query(
    boardKeys.detail(projectId, boardId),
    async () => (await api.get<BoardRead>(`${getURL("BOARDS")}/${boardId}`)).data,
    {
      ...options,
      enabled:
        Boolean(projectId) && Boolean(boardId) && (options?.enabled ?? true),
    },
  );
};
