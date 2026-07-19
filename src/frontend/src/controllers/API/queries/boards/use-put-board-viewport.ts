import type { useMutationFunctionType } from "@/types/api";
import type { BoardRead, BoardViewportUpdate } from "@/types/board";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";
import { boardKeys } from "./keys";

export const usePutBoardViewport: useMutationFunctionType<
  { projectId: string; boardId: string },
  BoardViewportUpdate,
  BoardRead
> = ({ projectId, boardId }, options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    boardKeys.detail(projectId, boardId),
    async (payload: BoardViewportUpdate) =>
      (await api.put<BoardRead>(`${getURL("BOARDS")}/${boardId}/viewport`, payload)).data,
    {
      ...options,
      retry: false,
      onSuccess: async (board, ...args) => {
        queryClient.setQueryData(boardKeys.detail(projectId, boardId), board);
        await queryClient.invalidateQueries({ queryKey: boardKeys.list(projectId) });
        await options?.onSuccess?.(board, ...args);
      },
    },
  );
};
