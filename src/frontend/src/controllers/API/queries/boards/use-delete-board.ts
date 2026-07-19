import axios from "axios";
import type { useMutationFunctionType } from "@/types/api";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";
import { boardKeys } from "./keys";

type DeleteBoardVariables = { boardId: string; expected_revision: number };

export const useDeleteBoard: useMutationFunctionType<
  { projectId: string },
  DeleteBoardVariables,
  void
> = ({ projectId }, options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    boardKeys.all,
    async ({ boardId, expected_revision }: DeleteBoardVariables) => {
      await api.delete(`${getURL("BOARDS")}/${boardId}`, {
        params: { expected_revision },
      });
    },
    {
      ...options,
      retry: false,
      onSuccess: async (data, variables, ...args) => {
        queryClient.removeQueries({
          queryKey: boardKeys.detail(projectId, variables.boardId),
          exact: true,
        });
        await queryClient.invalidateQueries({ queryKey: boardKeys.list(projectId) });
        await options?.onSuccess?.(data, variables, ...args);
      },
      onError: async (error, variables, ...args) => {
        if (axios.isAxiosError(error) && error.response?.status === 409) {
          await queryClient.refetchQueries({
            queryKey: boardKeys.detail(projectId, variables.boardId),
            exact: true,
          });
        }
        await options?.onError?.(error, variables, ...args);
      },
    },
  );
};
