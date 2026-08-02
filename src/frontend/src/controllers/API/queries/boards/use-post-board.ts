import type { useMutationFunctionType } from "@/types/api";
import type { BoardCreate, BoardRead } from "@/types/board";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";
import { boardKeys } from "./keys";

export const usePostBoard: useMutationFunctionType<
  { projectId: string },
  BoardCreate,
  BoardRead
> = ({ projectId }, options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    boardKeys.list(projectId),
    async (payload: BoardCreate) =>
      (
        await api.post<BoardRead>(
          `${getURL("PROJECTS")}/${projectId}/boards`,
          payload,
        )
      ).data,
    {
      ...options,
      retry: false,
      onSuccess: async (...args) => {
        await queryClient.invalidateQueries({
          queryKey: boardKeys.list(projectId),
        });
        await options?.onSuccess?.(...args);
      },
    },
  );
};
