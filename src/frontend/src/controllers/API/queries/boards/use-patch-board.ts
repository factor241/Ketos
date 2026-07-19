import type { useMutationFunctionType } from "@/types/api";
import type { BoardPatch, BoardRead } from "@/types/board";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";
import { boardKeys } from "./keys";

type PatchBoardVariables = BoardPatch & { boardId: string };

export const usePatchBoard: useMutationFunctionType<
  { projectId: string },
  PatchBoardVariables,
  BoardRead
> = ({ projectId }, options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    boardKeys.all,
    async ({ boardId, ...payload }: PatchBoardVariables) =>
      (await api.patch<BoardRead>(`${getURL("BOARDS")}/${boardId}`, payload)).data,
    {
      ...options,
      retry: false,
      onSuccess: async (board, ...args) => {
        queryClient.setQueryData(boardKeys.detail(projectId, board.id), board);
        await queryClient.invalidateQueries({ queryKey: boardKeys.list(projectId) });
        await options?.onSuccess?.(board, ...args);
      },
    },
  );
};
